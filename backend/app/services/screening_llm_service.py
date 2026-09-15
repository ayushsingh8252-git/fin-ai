"""
Screening Agent LLM layer — built entirely on LangChain, isolated from
llm_service.py (used by every other feature in this app, and left untouched).

Mirrors llm_service.generate_json's Groq-primary / Gemini-fallback resilience
using LangChain's own combinators instead of a manual try/except cascade:
  - ChatPromptTemplate for every prompt
  - .with_structured_output(<PydanticModel>) for guaranteed-shape output
    (no manual JSON-fence stripping / regex parsing)
  - .with_fallbacks([...]) chaining ChatGroq -> three ChatGoogleGenerativeAI
    model variants, applied *after* binding structured output on each leg
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator
from langchain_core.prompts import ChatPromptTemplate

from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI

from ..config import settings
from .llmops import get_managed_prompt, langchain_invoke_kwargs
from .resilience import retry_with_backoff
from .model_config import GROQ_MODELS, GEMINI_MODELS

INTERVIEWER_NAME = "Ayush"

# ─────────────────────────────────────────────────────────────────────────
# Structured-output schemas
# ─────────────────────────────────────────────────────────────────────────


class ResumeProfile(BaseModel):
    candidate_name: Optional[str] = None
    skills: List[str] = Field(default_factory=list)
    past_roles: List[str] = Field(default_factory=list)
    projects: List[str] = Field(default_factory=list)
    tech_stack: List[str] = Field(default_factory=list)
    resume_highlight: str = ""


class JDProfile(BaseModel):
    key_responsibilities: List[str] = Field(default_factory=list)
    key_requirements: List[str] = Field(default_factory=list)


class ScreeningQuestion(BaseModel):
    category: Literal["greeting", "resume", "jd_role"]
    text: str


class TelephonicScreeningAnalysis(BaseModel):
    """JD-aligned analysis of a completed Telephonic Agent call transcript —
    distinct from telephonic_service.generate_call_evaluation's generic
    communication/relevance/confidence scoring, this specifically judges fit
    against the role's actual job requirements."""

    jd_match_score: int = Field(ge=0, le=100)
    verdict: Literal["Strong Match", "Match", "Consider", "Not a Fit"]
    strengths: List[str] = Field(default_factory=list)
    gaps: List[str] = Field(default_factory=list)
    summary: str = ""


class ScreeningQuestionSet(BaseModel):
    questions: List[ScreeningQuestion]

    @field_validator("questions")
    @classmethod
    def _exactly_eleven(cls, v: List[ScreeningQuestion]) -> List[ScreeningQuestion]:
        if len(v) != 11:
            raise ValueError(f"Expected exactly 11 questions, got {len(v)}")
        return v


# ─────────────────────────────────────────────────────────────────────────
# Models + fallback-chain construction
# ─────────────────────────────────────────────────────────────────────────

# Model IDs come from model_config.py (shared with llm_service.py and
# fraud_llm.py) rather than being hardcoded here — see that module's
# docstring for why this used to drift out of sync (this file previously
# hardcoded llama-3.3-70b-versatile as primary after it had already been
# confirmed removed from Groq's catalog).


def _build_models():
    groq_key = settings.GROQ_API_KEY or settings.GROK_API_KEY
    groq_llms = (
        [ChatGroq(model=m, api_key=groq_key, temperature=0.3, timeout=30) for m in GROQ_MODELS]
        if groq_key
        else []
    )
    gemini_llms = (
        [
            ChatGoogleGenerativeAI(model=m, api_key=settings.GEMINI_API_KEY, temperature=0.3, timeout=30)
            for m in GEMINI_MODELS
        ]
        if settings.GEMINI_API_KEY
        else []
    )
    return groq_llms, gemini_llms


_groq_llms, _gemini_llms = _build_models()


def _structured_chain(prompt: ChatPromptTemplate, schema: type[BaseModel]):
    """Groq-primary, Gemini-fallback runnable — structured output bound on
    each leg individually before fallbacks are composed, since fallbacks must
    wrap the already-structured runnables, not the raw chat models."""
    legs = [llm.with_structured_output(schema) for llm in (*_groq_llms, *_gemini_llms)]
    if not legs:
        raise RuntimeError("No LLM provider configured (missing GROQ_API_KEY / GEMINI_API_KEY).")
    primary, *rest = legs
    runnable = primary.with_fallbacks(rest) if rest else primary
    return prompt | runnable


def _managed_chain(name: str, fallback: ChatPromptTemplate, schema: type[BaseModel]):
    """Use a versioned Langfuse system prompt while retaining local input templates."""
    managed = get_managed_prompt(name, fallback.messages[0].prompt.template)
    prompt = ChatPromptTemplate.from_messages([
        ("system", managed.text),
        ("human", fallback.messages[1].prompt.template),
    ])
    return _structured_chain(prompt, schema), managed.metadata


# ─────────────────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────────────────

RESUME_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You extract structured facts from a candidate's resume text for an AI "
            "screening interview. Only use what's actually in the text — never invent "
            "skills, roles, or projects. If the candidate's name isn't clearly present, "
            "leave candidate_name null rather than guessing.",
        ),
        (
            "human",
            "Resume text:\n\n{resume_text}\n\n"
            "Extract: candidate_name, skills (short list), past_roles, projects, "
            "tech_stack, and one resume_highlight — a short, specific, concrete "
            'achievement/project/skill phrase suitable for a warm interview opener '
            '(e.g. "built a rate limiter with Redis"), not a full sentence.',
        ),
    ]
)

JD_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "You extract key responsibilities and requirements from a job description."),
        (
            "human",
            "Role: {role_title}\n\nJob description:\n\n{jd_text}\n\n"
            "Extract key_responsibilities and key_requirements as short bullet phrases.",
        ),
    ]
)

TELEPHONIC_SCREENING_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are a hiring screening analyst. Judge a candidate's phone-screen "
            "transcript against the ACTUAL job requirements below — not just how "
            "well they communicated. Base every claim only on what the transcript "
            "actually shows; never invent qualifications the candidate didn't mention. "
            "jd_match_score reflects fit against the job description specifically "
            "(0 = no alignment, 100 = excellent alignment). verdict must be exactly "
            'one of "Strong Match", "Match", "Consider", "Not a Fit".',
        ),
        (
            "human",
            "Role: {role_title}\n\nJob description:\n{jd_text}\n\n"
            "Call transcript:\n{transcript}\n\n"
            "Score jd_match_score, choose verdict, and list concrete strengths and "
            "gaps relative to the job description, plus a 2-3 sentence summary.",
        ),
    ]
)

QUESTION_SET_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            'You are {interviewer_name}, an AI interviewer for a first-round screening '
            'interview for the role of "{role_title}". Produce exactly 11 interview '
            "questions in this exact order and mix:\n"
            "1. Exactly ONE 'greeting' question: warm, references the candidate by name "
            'if given (else "there"), mentions the resume_highlight, and ends by '
            "asking if they're ready to start.\n"
            "2. Exactly FIVE 'resume' questions: dynamic, specific, drawn from the "
            "candidate's actual skills/past_roles/projects/tech_stack below — never generic.\n"
            "3. Exactly FIVE 'jd_role' questions: if a job description is given, base them "
            "on its key_responsibilities/key_requirements; if none is given, generate "
            "standard, well-known interview questions appropriate for the role title itself.\n"
            "Each question: 1-3 sentences, conversational, professional. Return questions "
            "in the exact order: greeting, then the 5 resume questions, then the 5 jd_role questions.",
        ),
        (
            "human",
            "Candidate resume profile:\nName: {candidate_name}\nHighlight: {resume_highlight}\n"
            "Skills: {skills}\nPast roles: {past_roles}\nProjects: {projects}\nTech stack: {tech_stack}\n\n"
            "Job description profile:\n{jd_context}",
        ),
    ]
)


# ─────────────────────────────────────────────────────────────────────────
# Deterministic fallbacks (used only if the entire LangChain call fails)
# ─────────────────────────────────────────────────────────────────────────


def _fallback_resume_profile(resume_text: str) -> ResumeProfile:
    return ResumeProfile(
        candidate_name=None,
        skills=[],
        past_roles=[],
        projects=[],
        tech_stack=[],
        resume_highlight=(resume_text[:120].strip() or "your background"),
    )


def _fallback_jd_profile() -> JDProfile:
    return JDProfile(key_responsibilities=[], key_requirements=[])


def _fallback_telephonic_screening_analysis() -> TelephonicScreeningAnalysis:
    return TelephonicScreeningAnalysis(
        jd_match_score=50,
        verdict="Consider",
        strengths=[],
        gaps=[],
        summary="Automated JD-match analysis is temporarily unavailable — both the "
        "primary and fallback LLM providers failed. Please review the transcript manually.",
    )


_GENERIC_ROLE_QUESTIONS = [
    "Walk me through your overall experience and what draws you to this role.",
    "What's a technical decision you made recently that you'd stand behind today?",
    "How do you approach debugging a problem you've never seen before?",
    "Tell me about a time you disagreed with a teammate's approach — what happened?",
    "What are you looking for in your next role that you don't have today?",
]

_GENERIC_RESUME_QUESTIONS = [
    "Which of the projects on your resume are you most proud of, and why?",
    "What's a skill you've listed that you'd like to go deeper on?",
    "Tell me about a role on your resume that shaped how you work today.",
    "What tools or technologies from your background do you enjoy working with most?",
    "Is there a project on your resume where things didn't go as planned? What did you learn?",
]


def _fallback_question_bank(role_title: str, resume_profile: ResumeProfile) -> List[ScreeningQuestion]:
    name = resume_profile.candidate_name or "there"
    greeting = ScreeningQuestion(
        category="greeting",
        text=(
            f"Hi {name}, thanks for joining! I see you've worked on "
            f"{resume_profile.resume_highlight or 'some interesting things'} — excited to "
            f"chat today about the {role_title} role. Ready to get started?"
        ),
    )
    resume_qs = [ScreeningQuestion(category="resume", text=t) for t in _GENERIC_RESUME_QUESTIONS]
    jd_qs = [ScreeningQuestion(category="jd_role", text=t) for t in _GENERIC_ROLE_QUESTIONS]
    return [greeting] + resume_qs + jd_qs


# ─────────────────────────────────────────────────────────────────────────
# Public functions
# ─────────────────────────────────────────────────────────────────────────


def get_resume_profile(resume_text: str, langfuse_trace_id: str | None = None) -> ResumeProfile:
    try:
        chain, prompt_metadata = _managed_chain("screening-resume-profile", RESUME_PROMPT, ResumeProfile)
        return retry_with_backoff(
            chain.invoke, {"resume_text": resume_text[:8000]}, max_attempts=2, base_delay=0.3, max_delay=2.0,
            **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
        )
    except Exception as e:
        print(f"[Screening LLM] resume profile extraction failed: {e}")
        return _fallback_resume_profile(resume_text)


def get_jd_profile(jd_text: str, langfuse_trace_id: str | None = None) -> JDProfile:
    try:
        chain, prompt_metadata = _managed_chain("screening-jd-profile", JD_PROMPT, JDProfile)
        return retry_with_backoff(
            chain.invoke, {"role_title": "the open role", "jd_text": jd_text[:6000]}, max_attempts=2, base_delay=0.3, max_delay=2.0,
            **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
        )
    except Exception as e:
        print(f"[Screening LLM] JD profile extraction failed: {e}")
        return _fallback_jd_profile()


def analyze_telephonic_screening(
    transcript: List[dict], role_title: str, jd_text: Optional[str], langfuse_trace_id: str | None = None
) -> TelephonicScreeningAnalysis:
    """JD-aligned screening analysis of a finished Telephonic Agent call —
    the "Screening Agent" step in Candidate -> Telephonic Agent -> Conversation
    -> Screening Agent -> Screening Result."""
    formatted = "\n".join(
        f"{'Agent' if t.get('role') == 'agent' else 'Candidate'}: {t.get('text', '').strip()}"
        for t in transcript
    )
    if not formatted.strip():
        return TelephonicScreeningAnalysis(
            jd_match_score=0, verdict="Not a Fit", strengths=[], gaps=[],
            summary="No candidate responses were recorded in this call.",
        )

    try:
        chain, prompt_metadata = _managed_chain(
            "screening-telephonic-evaluation", TELEPHONIC_SCREENING_PROMPT, TelephonicScreeningAnalysis
        )
        return retry_with_backoff(
            chain.invoke,
            {
                "role_title": role_title,
                "jd_text": (jd_text or "No job description provided — assess general fit for the role title.")[:6000],
                "transcript": formatted[:8000],
            },
            max_attempts=2, base_delay=0.3, max_delay=2.0,
            **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
        )
    except Exception as e:
        print(f"[Screening LLM] telephonic screening analysis failed: {e}")
        return _fallback_telephonic_screening_analysis()


def _normalize_question_set(
    questions: List[ScreeningQuestion], role_title: str, resume_profile: ResumeProfile
) -> List[ScreeningQuestion]:
    """Defense-in-depth: guarantees exactly 1 greeting + 5 resume + 5 jd_role,
    in that order, regardless of what the LLM (or the deterministic fallback)
    actually produced — pads with generic filler, truncates overflow."""
    fallback = _fallback_question_bank(role_title, resume_profile)
    fallback_by_cat = {
        "greeting": [q for q in fallback if q.category == "greeting"],
        "resume": [q for q in fallback if q.category == "resume"],
        "jd_role": [q for q in fallback if q.category == "jd_role"],
    }
    by_cat = {"greeting": [], "resume": [], "jd_role": []}
    for q in questions:
        if q.category in by_cat:
            by_cat[q.category].append(q)

    def fit(cat: str, target: int) -> List[ScreeningQuestion]:
        items = by_cat[cat][:target]
        i = 0
        while len(items) < target:
            filler = fallback_by_cat[cat][i % len(fallback_by_cat[cat])]
            items.append(filler)
            i += 1
        return items

    return fit("greeting", 1) + fit("resume", 5) + fit("jd_role", 5)


def generate_question_set(
    role_title: str, resume_profile: ResumeProfile, jd_profile: Optional[JDProfile],
    langfuse_trace_id: str | None = None,
) -> List[ScreeningQuestion]:
    jd_context = "No job description provided — use standard questions for this role title."
    if jd_profile is not None and (jd_profile.key_responsibilities or jd_profile.key_requirements):
        jd_context = (
            f"Key responsibilities: {'; '.join(jd_profile.key_responsibilities) or 'n/a'}\n"
            f"Key requirements: {'; '.join(jd_profile.key_requirements) or 'n/a'}"
        )

    try:
        chain, prompt_metadata = _managed_chain("screening-question-set", QUESTION_SET_PROMPT, ScreeningQuestionSet)
        result = retry_with_backoff(
            chain.invoke,
            {
                "interviewer_name": INTERVIEWER_NAME,
                "role_title": role_title,
                "candidate_name": resume_profile.candidate_name or "there",
                "resume_highlight": resume_profile.resume_highlight or "their background",
                "skills": ", ".join(resume_profile.skills) or "n/a",
                "past_roles": ", ".join(resume_profile.past_roles) or "n/a",
                "projects": ", ".join(resume_profile.projects) or "n/a",
                "tech_stack": ", ".join(resume_profile.tech_stack) or "n/a",
                "jd_context": jd_context,
            },
            max_attempts=2, base_delay=0.3, max_delay=2.0,
            **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
        )
        questions = result.questions
    except Exception as e:
        print(f"[Screening LLM] question generation failed: {e}")
        questions = _fallback_question_bank(role_title, resume_profile)

    return _normalize_question_set(questions, role_title, resume_profile)
