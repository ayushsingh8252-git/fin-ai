"""
Fraud Agent LLM layer — built entirely on LangChain, isolated from
llm_service.py (used by every other fraud step, and left untouched) the same
way screening_llm_service.py is isolated for the Screening Agent.

Used by fraud_identity.py (identity field extraction for the duplicate
identity scan) and fraud_resume_authenticity.py (AI-generated-text signal).

Mirrors screening_llm_service's resilience pattern:
  - ChatPromptTemplate for every prompt
  - .with_structured_output(<PydanticModel>) for guaranteed-shape output
    (no manual JSON-fence stripping / regex parsing on untrusted LLM text)
  - .with_fallbacks([...]) chaining ChatGroq -> ChatGoogleGenerativeAI variants
  - a deterministic, non-LLM fallback if every provider call fails, so a
    missing/expired API key degrades the fraud pipeline instead of crashing it
"""

from typing import List, Optional

from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate


from . import llm_chains
from .llmops import get_managed_prompt, langchain_invoke_kwargs
from .resilience import retry_with_backoff

# ─────────────────────────────────────────────────────────────────────────
# Structured-output schemas
# ─────────────────────────────────────────────────────────────────────────


class EmploymentEntry(BaseModel):
    employer: str
    start_date: Optional[str] = Field(default=None, description="YYYY-MM or YYYY-MM-DD if stated, else null")
    end_date: Optional[str] = Field(default=None, description='YYYY-MM/YYYY-MM-DD, "present", or null')
    email_domain_used: Optional[str] = Field(
        default=None, description="Domain of any work email shown for this employer, e.g. 'acme.com' (no @)"
    )


class ExtractedIdentity(BaseModel):
    """Identity fields pulled from a resume/document for the duplicate identity
    scan and resume logic checks. Only fields actually present in the text are
    filled in — the extractor is instructed never to invent values."""

    candidate_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = Field(default=None, description="YYYY-MM-DD if explicitly stated, else null")
    graduation_year: Optional[int] = None
    claimed_total_experience_years: Optional[float] = None
    employers: List[EmploymentEntry] = Field(default_factory=list)


class AiTextSignal(BaseModel):
    ai_generated_likelihood: int = Field(ge=0, le=100)
    reasons: List[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────
# Models + fallback-chain construction
# ─────────────────────────────────────────────────────────────────────────

# Model IDs come from model_config.py (shared with llm_service.py and
# screening_llm_service.py) rather than being hardcoded here — see that
# module's docstring for why this used to drift out of sync.


def _structured_chain(prompt: ChatPromptTemplate, schema: type[BaseModel]):
    """Groq-primary, Gemini-fallback runnable over every configured key
    (services/llm_chains.py) — structured output bound on each leg."""
    return llm_chains.structured_chain(prompt, schema, temperature=0.1)


def _managed_chain(name: str, fallback: ChatPromptTemplate, schema: type[BaseModel]):
    """Replace only the system instruction from Langfuse; input schema stays local."""
    managed = get_managed_prompt(name, fallback.messages[0].prompt.template)
    prompt = ChatPromptTemplate.from_messages([
        ("system", managed.text),
        ("human", fallback.messages[1].prompt.template),
    ])
    return _structured_chain(prompt, schema), managed.metadata


# ─────────────────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────────────────

IDENTITY_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You extract identity and employment-history fields from a candidate document "
            "(resume, offer letter, salary slip, or relieving letter) for a fraud-detection "
            "system. Only extract what is literally present in the text — never guess, infer, "
            "or fabricate a name, date, contact detail, or employer. Leave a field null/empty "
            "if it is not clearly stated. Transcribe dates and numbers exactly as written.",
        ),
        (
            "human",
            "Document text:\n\n{text}\n\n"
            "Extract: candidate_name, email, phone, date_of_birth (only if explicitly present — "
            "resumes rarely state this, and that's fine, leave it null), graduation_year, "
            "claimed_total_experience_years (only if the candidate states a number of years "
            "of experience), and employers — each with employer name, start_date, end_date "
            "(or \"present\" if current), and email_domain_used if a work email is shown for "
            "that employer specifically.",
        ),
    ]
)

AI_TEXT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are one signal in a fraud-detection ensemble that estimates whether resume "
            "text was substantially AI-generated (e.g. produced wholesale by an LLM) rather "
            "than written by the candidate describing their own real experience. This signal "
            "is inherently imperfect and is never used alone to reject a candidate — treat "
            "your output as a probabilistic estimate, not a verdict.\n\n"
            "Look for: generic, interchangeable phrasing that could describe any candidate; "
            "buzzword-dense bullet points with no concrete specific detail (no named tools, "
            "no numbers, no named projects); unnaturally uniform sentence rhythm/length across "
            "every bullet; overuse of stock phrases like \"proven track record\", \"results-driven\", "
            "\"leveraged synergies\", \"spearheaded\"; a mismatch between generic polish and a "
            "junior candidate's stated experience level. A short, plain, specific resume with "
            "typos or informal phrasing is normal and should score LOW, not high — imperfection "
            "is evidence of authenticity, not a red flag.",
        ),
        (
            "human",
            "Resume/document text:\n\n{text}\n\n"
            "Return ai_generated_likelihood (0-100, where 0 = clearly human-written, specific, "
            "and idiosyncratic; 100 = clearly template-generated or LLM-authored) and up to 3 "
            "short reasons grounded in specific phrases or patterns you actually observed.",
        ),
    ]
)


# ─────────────────────────────────────────────────────────────────────────
# Deterministic fallbacks (used only if every LLM provider call fails)
# ─────────────────────────────────────────────────────────────────────────


def _fallback_ai_text_signal() -> AiTextSignal:
    return AiTextSignal(ai_generated_likelihood=50, reasons=["AI-text classifier unavailable (LLM call failed) — treated as neutral/unknown, not counted as evidence."])


# ─────────────────────────────────────────────────────────────────────────
# Public functions
# ─────────────────────────────────────────────────────────────────────────


def extract_identity(text: str, langfuse_trace_id: str | None = None) -> ExtractedIdentity:
    # Deliberately does NOT swallow the failure into a blank ExtractedIdentity()
    # here — that made a genuine LLM outage indistinguishable from a document
    # that simply has no name/contact/identity fields (both looked like an
    # all-None result to fraud_identity.check_identity). Letting this raise
    # means the caller's own except-block reports it as a distinct "error"
    # step instead of a clean "na" one.
    chain, prompt_metadata = _managed_chain("fraud-identity-extraction", IDENTITY_PROMPT, ExtractedIdentity)
    return retry_with_backoff(
        chain.invoke, {"text": text[:8000]}, max_attempts=1, base_delay=0.3, max_delay=2.0,  # the chain already falls back across every key/model
        **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
    )


def classify_ai_text(text: str, langfuse_trace_id: str | None = None) -> AiTextSignal:
    try:
        chain, prompt_metadata = _managed_chain("fraud-ai-text-classification", AI_TEXT_PROMPT, AiTextSignal)
        return retry_with_backoff(
            chain.invoke, {"text": text[:8000]}, max_attempts=1, base_delay=0.3, max_delay=2.0,  # the chain already falls back across every key/model
            **langchain_invoke_kwargs(langfuse_trace_id, prompt_metadata),
        )
    except Exception as e:
        print(f"[Fraud LLM] AI-text classification failed: {e}")
        return _fallback_ai_text_signal()
