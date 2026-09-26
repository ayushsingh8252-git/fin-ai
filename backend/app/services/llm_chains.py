"""LangChain chat-model legs for the structured-output services
(screening_llm_service.py, fraud_llm.py), built from key_manager's key pools.

Those services used to read only the singular GROQ_API_KEY / GEMINI_API_KEY
settings. Deployments configure numbered pools instead (GROQ_API_KEY1..N,
GOOGLE_API_KEY1..N — what key_manager discovers), so the services found no
provider at all and silently fell back to generic template output.

Order of legs, each tried once (LangChain retries are off — the fallback
chain *is* the retry policy, so a 429 never turns into duplicate requests):
  1. every available Groq key on the primary Groq model
  2. the remaining Groq models on the first available Groq key
  3. every available Gemini key on the primary Gemini model
  4. the remaining Gemini models on the first available Gemini key
capped at MAX_LEGS. Keys key_manager has put in rate-limit cooldown are
skipped. Legs are built per call, so a cooldown applies immediately.
"""
import time
from typing import List

from .key_manager import key_manager
from .model_config import GEMINI_MODELS, GROQ_MODELS

MAX_LEGS = 8
TIMEOUT_SECONDS = 30


def _available(provider: str) -> list:
    now = time.time()
    return [k for k in key_manager._keys.get(provider, []) if k.is_available(now)]


def build_chat_legs(temperature: float) -> List:
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_groq import ChatGroq

    legs = []
    groq_keys = _available("groq")
    if groq_keys and GROQ_MODELS:
        for k in groq_keys:
            legs.append(ChatGroq(model=GROQ_MODELS[0], api_key=k.api_key, temperature=temperature,
                                 timeout=TIMEOUT_SECONDS, max_retries=0))
        for m in GROQ_MODELS[1:]:
            legs.append(ChatGroq(model=m, api_key=groq_keys[0].api_key, temperature=temperature,
                                 timeout=TIMEOUT_SECONDS, max_retries=0))
    gemini_keys = _available("gemini")
    if gemini_keys and GEMINI_MODELS:
        for k in gemini_keys:
            legs.append(ChatGoogleGenerativeAI(model=GEMINI_MODELS[0], api_key=k.api_key, temperature=temperature,
                                               timeout=TIMEOUT_SECONDS, max_retries=0))
        for m in GEMINI_MODELS[1:]:
            legs.append(ChatGoogleGenerativeAI(model=m, api_key=gemini_keys[0].api_key, temperature=temperature,
                                               timeout=TIMEOUT_SECONDS, max_retries=0))
    # Keep at least one leg per provider when capping.
    if len(legs) > MAX_LEGS and gemini_keys:
        n_gemini = len(gemini_keys) + max(0, len(GEMINI_MODELS) - 1)
        keep_gemini = min(n_gemini, MAX_LEGS // 2)
        groq_part = legs[: len(legs) - n_gemini][: MAX_LEGS - keep_gemini]
        gemini_part = legs[len(legs) - n_gemini:][:keep_gemini]
        legs = groq_part + gemini_part
    return legs[:MAX_LEGS]


def structured_chain(prompt, schema, temperature: float):
    """prompt | (leg1 with_fallbacks leg2..N), each leg bound to `schema`."""
    legs = [llm.with_structured_output(schema) for llm in build_chat_legs(temperature)]
    if not legs:
        raise RuntimeError("No LLM provider configured (no Groq or Gemini API keys found).")
    primary, *rest = legs
    return prompt | (primary.with_fallbacks(rest) if rest else primary)
