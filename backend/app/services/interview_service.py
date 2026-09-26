"""
Screening Agent interviewer turn generation.

Reuses the same Groq-primary/Gemini-fallback JSON generation already used
for policy Q&A and fraud reasoning (see llm_service.generate_json), so the
interview loop gets the same dual-provider resilience instead of a
separate bespoke LLM integration.
"""
from typing import Any, Dict, List, Optional

from .llm_service import generate_json_resilient as generate_json

INTERVIEWER_NAME = "Ayush"

TURN_SYSTEM_INSTRUCTION = """You are {name}, the AI interviewer for AgenticFlow's Screening Agent, conducting a first-round screening interview for the role of "{role_title}".

Conduct a natural, adaptive interview:
- Ask ONE question at a time.
- Start by greeting the candidate and asking them to introduce themselves, then probe technical depth, past experience, and problem solving based on what the candidate actually said — follow up on specifics instead of reading a fixed script.
- Keep each line concise (1-3 sentences), conversational, and professional.
- After the candidate has answered {max_turns} questions, wrap up: thank them for their time and set is_final=true with a short closing line instead of a new question.

{resume_context}{jd_context}
Return ONLY a JSON object with this exact shape: {{"question": "<the next thing to say to the candidate>", "is_final": <true|false>}}"""

EVALUATION_SYSTEM_INSTRUCTION = """You are {name}, the AI interviewer for AgenticFlow's Screening Agent. The screening interview below has just ended. Evaluate the candidate honestly based ONLY on what they actually said in the transcript below — never invent details that aren't there, and never credit a skill the candidate didn't actually demonstrate or claim.

Role being screened for: {role_title}
{jd_context}{skills_context}
Return ONLY a JSON object with this exact shape:
{{
  "communication_score": <0-100 integer>,
  "relevance_score": <0-100 integer>,
  "confidence_score": <0-100 integer>,
  "recommendation": <one of "Strong Hire", "Hire", "Lean Hire", "No Hire">,
  "summary": "<2-3 sentence honest overall summary of how the interview went>",
  "strengths": ["<specific strength grounded in something the candidate actually said>", "..."],
  "areas_for_improvement": ["<specific, actionable area to improve>", "..."],
  "matched_skills": ["<skill relevant to the role the candidate actually demonstrated or credibly discussed>", "..."],
  "missing_skills": ["<skill relevant to the role that was never evidenced, or was clearly weak>", "..."],
  "key_takeaway": "<the single most important one-sentence insight a hiring manager needs>",
  "suggested_next_step": "<one concrete, actionable next step, e.g. 'Advance to a technical round focused on system design'>"
}}
Keep strengths and areas_for_improvement to 2-4 items each, and matched_skills/missing_skills to at most 6 items each. Every list item must be a short, specific, standalone sentence or phrase — no filler."""

FALLBACK_QUESTION = "Could you tell me more about a recent project you're proud of?"
FALLBACK_EVALUATION = {
    "communication_score": None,
    "relevance_score": None,
    "confidence_score": None,
    "overall_score": None,
    "recommendation": "Review Needed",
    "summary": "Automated evaluation is temporarily unavailable — both the primary and fallback LLM providers failed. Please review the transcript manually.",
    "strengths": [],
    "areas_for_improvement": [],
    "matched_skills": [],
    "missing_skills": [],
    "key_takeaway": "Automated scoring failed for this session — review the transcript manually before making a decision.",
    "suggested_next_step": "Manually review the transcript above and score the candidate directly.",
}

_VALID_RECOMMENDATIONS = {"Strong Hire", "Hire", "Lean Hire", "No Hire"}


def _coerce_recommendation(value: Any, overall_score: Optional[int]) -> str:
    """Trusts the LLM's own verdict when it's one of the known labels;
    otherwise derives a safe default from the computed overall_score so the
    report always carries a recommendation even if the model's field was
    missing or off-schema."""
    if isinstance(value, str) and value.strip() in _VALID_RECOMMENDATIONS:
        return value.strip()
    if overall_score is None:
        return "Review Needed"
    if overall_score >= 85:
        return "Strong Hire"
    if overall_score >= 70:
        return "Hire"
    if overall_score >= 50:
        return "Lean Hire"
    return "No Hire"


def _coerce_string_list(value: Any, max_items: int) -> List[str]:
    """Defensively normalizes an LLM-returned field into a clean list of
    short strings — the model may return a single string, omit the field, or
    include empty/duplicate entries."""
    if isinstance(value, str):
        value = [value] if value.strip() else []
    if not isinstance(value, list):
        return []
    seen: set = set()
    deduped: List[str] = []
    for item in value:
        text = str(item).strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        deduped.append(text)
    return deduped[:max_items]


def _format_history(history: List[Dict[str, str]]) -> str:
    lines = []
    for turn in history:
        speaker = INTERVIEWER_NAME if turn.get("role") == "interviewer" else "Candidate"
        lines.append(f"{speaker}: {turn.get('text', '').strip()}")
    return "\n".join(lines)


def generate_next_turn(
    history: List[Dict[str, str]],
    role_title: str = "the open role",
    jd_text: Optional[str] = None,
    max_turns: int = 5,
    resume_context: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Given the conversation so far, asks the LLM for the interviewer's next
    line. Returns {"question": str, "is_final": bool}.
    """
    candidate_turns = sum(1 for t in history if t.get("role") == "candidate")
    jd_context = f"The role's job description:\n{jd_text.strip()}\n" if jd_text else ""
    resume_ctx = f"The candidate's resume summary:\n{resume_context.strip()}\n" if resume_context else ""

    system_instruction = TURN_SYSTEM_INSTRUCTION.format(
        name=INTERVIEWER_NAME, role_title=role_title, max_turns=max_turns,
        jd_context=jd_context, resume_context=resume_ctx,
    )

    if not history:
        prompt = "The interview is just starting. Greet the candidate briefly and ask them to introduce themselves."
    else:
        prompt = (
            f"Conversation so far (candidate has answered {candidate_turns} question(s)):\n"
            f"{_format_history(history)}\n\n"
            "Given what the candidate just said, produce your next line."
        )

    try:
        result = generate_json(prompt, system_instruction)
    except Exception as e:
        # Never let the transcript go unanswered — a visibly generic fallback
        # question is better than a silently broken interview loop.
        print(f"[Interview Service Error] {e}")
        result = {"question": FALLBACK_QUESTION, "is_final": candidate_turns >= max_turns}

    if not isinstance(result, dict) or not result.get("question"):
        result = {"question": FALLBACK_QUESTION, "is_final": candidate_turns >= max_turns}

    # Hard stop: once the turn limit is reached, force is_final=True even if
    # the LLM returned is_final=false — setdefault alone only fills the key
    # when it's absent, so it could never override a wrongly-false answer.
    result["is_final"] = bool(result.get("is_final", False)) or candidate_turns >= max_turns
    return result


def generate_evaluation(
    history: List[Dict[str, str]],
    role_title: str = "the open role",
    jd_text: Optional[str] = None,
    resume_skills: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Produces a detailed, actionable scored evaluation of the whole
    interview transcript — sub-scores, an overall recommendation, grounded
    strengths/areas for improvement, and matched/missing skills relative to
    the role's JD and the candidate's own resume."""
    if not any(t.get("role") == "candidate" for t in history):
        return {**FALLBACK_EVALUATION, "summary": "No candidate responses were recorded."}

    jd_context = f"\nThe role's job description:\n{jd_text.strip()}\n" if jd_text else ""
    skills_context = (
        f"\nSkills the candidate's resume claims: {', '.join(resume_skills)}\n" if resume_skills else ""
    )
    system_instruction = EVALUATION_SYSTEM_INSTRUCTION.format(
        name=INTERVIEWER_NAME, role_title=role_title, jd_context=jd_context, skills_context=skills_context,
    )
    prompt = f"Full transcript:\n{_format_history(history)}"

    try:
        result = generate_json(prompt, system_instruction)
        if not isinstance(result, dict):
            raise ValueError("Evaluation response was not a JSON object")
    except Exception as e:
        print(f"[Interview Evaluation Error] {e}")
        # Flagged so an invite-link interview isn't closed out on a
        # non-evaluation — the caller can keep the transcript and retry.
        return {**FALLBACK_EVALUATION, "evaluation_unavailable": True}

    # A sub-score the model didn't return stays None — never a made-up 50.
    for field in ("communication_score", "relevance_score", "confidence_score"):
        try:
            result[field] = max(0, min(100, int(result.get(field))))
        except (TypeError, ValueError):
            result[field] = None

    # Single server-computed, auditable overall score instead of leaving
    # aggregation of the three sub-scores implicit/undone — only when all
    # three are real.
    subs = (result["relevance_score"], result["communication_score"], result["confidence_score"])
    result["overall_score"] = (
        round(0.5 * subs[0] + 0.3 * subs[1] + 0.2 * subs[2]) if all(v is not None for v in subs) else None
    )

    result["recommendation"] = _coerce_recommendation(result.get("recommendation"), result["overall_score"])
    result["summary"] = str(result.get("summary") or "").strip() or "No summary was generated."
    result["strengths"] = _coerce_string_list(result.get("strengths"), max_items=4)
    result["areas_for_improvement"] = _coerce_string_list(result.get("areas_for_improvement"), max_items=4)
    result["matched_skills"] = _coerce_string_list(result.get("matched_skills"), max_items=6)
    result["missing_skills"] = _coerce_string_list(result.get("missing_skills"), max_items=6)
    result["key_takeaway"] = str(result.get("key_takeaway") or "").strip()
    result["suggested_next_step"] = str(result.get("suggested_next_step") or "").strip()
    return result
