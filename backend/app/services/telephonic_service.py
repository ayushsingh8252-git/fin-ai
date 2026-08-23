"""
Telephonic Agent call-turn generation.

Same Groq-primary/Gemini-fallback JSON generation as the Screening Agent's
interview_service, but tuned for a real phone call: every line here is read
aloud by Twilio's text-to-speech, so it has to stay short, plain, and free
of anything that only makes sense written down.
"""
from typing import Any, Dict, List, Optional

from .llm_service import generate_json_resilient as generate_json

AGENT_NAME = "Ayush"

CALL_SYSTEM_INSTRUCTION = """You are {name}, an AI voice screening agent calling a candidate on the phone on behalf of AgenticFlow, screening them for the role of "{role_title}".

This is a real, live phone call and your words are read aloud by text-to-speech, so:
- Keep every line SHORT (1-2 sentences), plain spoken English — no markdown, no bullet points, no symbols.
- Ask ONE question at a time and wait for the answer.
- Start by greeting {candidate_name} by name, briefly saying who you are and why you're calling, and asking them to briefly introduce themselves.
- Probe their interest in the role, relevant experience, and fit based on what they actually say — follow up on specifics instead of reading a fixed script.
- After the candidate has answered {max_turns} questions, thank them for their time, let them know next steps will follow by email, and set is_final=true instead of asking a new question.

Also read the candidate's most recent answer (if any) for tone — genuinely enthusiastic/positive, neutral/matter-of-fact, or hesitant/negative — since this feeds the call's live sentiment tracking.

Return ONLY a JSON object with this exact shape: {{"question": "<the next thing to say out loud to the candidate>", "is_final": <true|false>, "candidate_sentiment": "<positive|neutral|negative>"}}"""

CALL_EVALUATION_SYSTEM_INSTRUCTION = """You are {name}, an AI voice screening agent who just finished a live phone screening call on behalf of AgenticFlow. Evaluate the candidate honestly based ONLY on what they actually said in the call transcript below — never invent details that aren't there.

Return ONLY a JSON object with this exact shape:
{{"communication_score": <0-100 integer>, "relevance_score": <0-100 integer>, "confidence_score": <0-100 integer>, "summary": "<2-3 sentence honest summary>"}}"""

FALLBACK_QUESTION = "Could you tell me a bit about your relevant experience for this role?"
FALLBACK_CALL_EVALUATION = {
    "communication_score": None,
    "relevance_score": None,
    "confidence_score": None,
    "summary": "Automated evaluation is temporarily unavailable — both the primary and fallback LLM providers failed. Please review the transcript manually.",
}


def _format_history(history: List[Dict[str, str]]) -> str:
    lines = []
    for turn in history:
        speaker = AGENT_NAME if turn.get("role") == "agent" else "Candidate"
        lines.append(f"{speaker}: {turn.get('text', '').strip()}")
    return "\n".join(lines)


def generate_call_turn(
    history: List[Dict[str, str]],
    candidate_name: str = "there",
    role_title: str = "the open role",
    max_turns: int = 4,
) -> Dict[str, Any]:
    """Given the call so far, asks the LLM for the agent's next spoken line.
    Returns {"question": str, "is_final": bool}."""
    candidate_turns = sum(1 for t in history if t.get("role") == "candidate")
    system_instruction = CALL_SYSTEM_INSTRUCTION.format(
        name=AGENT_NAME, role_title=role_title, candidate_name=candidate_name, max_turns=max_turns
    )

    if not history:
        prompt = f"The call with {candidate_name} just connected. Greet them and start the screen."
    else:
        prompt = (
            f"Conversation so far (candidate has answered {candidate_turns} question(s)):\n"
            f"{_format_history(history)}\n\n"
            "Given what the candidate just said, produce your next line."
        )

    try:
        result = generate_json(prompt, system_instruction)
    except Exception as e:
        print(f"[Telephonic Service Error] {e}")
        result = {"question": FALLBACK_QUESTION, "is_final": candidate_turns >= max_turns}

    if not isinstance(result, dict) or not result.get("question"):
        result = {"question": FALLBACK_QUESTION, "is_final": candidate_turns >= max_turns}

    result.setdefault("is_final", candidate_turns >= max_turns)
    if result.get("candidate_sentiment") not in ("positive", "neutral", "negative"):
        result["candidate_sentiment"] = "neutral"
    return result


def generate_call_evaluation(history: List[Dict[str, str]], role_title: str = "the open role") -> Dict[str, Any]:
    """Produces a scored evaluation of the whole phone-call transcript, mirroring
    interview_service.generate_evaluation (used for the web Screening Agent chat flow)
    so completed calls get scored the same way completed chat interviews are."""
    if not any(t.get("role") == "candidate" for t in history):
        return {**FALLBACK_CALL_EVALUATION, "summary": "No candidate responses were recorded."}

    system_instruction = CALL_EVALUATION_SYSTEM_INSTRUCTION.format(name=AGENT_NAME)
    prompt = f"Role: {role_title}\n\nFull call transcript:\n{_format_history(history)}"

    try:
        result = generate_json(prompt, system_instruction)
        if not isinstance(result, dict):
            raise ValueError("Evaluation response was not a JSON object")
    except Exception as e:
        print(f"[Telephonic Evaluation Error] {e}")
        return FALLBACK_CALL_EVALUATION

    for key in ("communication_score", "relevance_score", "confidence_score"):
        try:
            result[key] = max(0, min(100, int(result.get(key))))
        except (TypeError, ValueError):
            result[key] = None
    result.setdefault("summary", "")
    return result
