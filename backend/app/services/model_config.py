"""
Single source of truth for which Groq/Gemini/xAI model IDs this platform
calls, in fallback order (index 0 tried first).

Provider catalogs drift — models get retired without much warning, and this
app was bitten by it twice: llm_service.py's primary Groq/Gemini models were
confirmed retired (404 model_not_found) and fixed on 2026-08-21, then an
unrelated revert on 2026-08-24 silently reintroduced the exact same retired
IDs because fraud_llm.py and screening_llm_service.py each hardcoded their
own separate copy of this list instead of sharing one. Centralizing it here
means the next retirement only needs a one-file, one-line fix instead of
three files falling out of sync.

Verified live on 2026-08-26 via real API calls against this project's own
keys (see docs/platform-status-audit-2026-08-26-rag-improvement-pass.md):
  - Groq: llama-3.3-70b-versatile and llama-3.1-8b-instant both 404
    (model_not_found) — Groq's live /v1/models catalog confirms the entire
    Llama chat-model family is gone from this account, not just those two
    IDs, so there's no "last resort" value in keeping them. openai/gpt-oss-
    120b, openai/gpt-oss-20b, and qwen/qwen3.8-27b are all confirmed active
    and successfully complete a real JSON-mode call.
  - Gemini: gemini-2.0-flash and gemini-1.5-flash both 404 — Google's own
    error message for gemini-2.0-flash explicitly names gemini-3.6-flash as
    the replacement. gemini-2.5-flash and gemini-3.6-flash both confirmed
    live with a real call.
"""

GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
]

GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-3.6-flash",
]

# xAI Grok (used only when a configured key has the "xai-" prefix — see
# llm_service.py._call_grok_groq_api) — not exercised by this project's
# current keys, so not independently verified in this pass; left as the
# provider's documented model names.
XAI_GROK_MODELS = [
    "grok-2-latest",
    "grok-beta",
]
