"""LLMOps observability — Langfuse client singleton.

get_langfuse() returns a configured Langfuse client, or None when
LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY aren't set (see config.py). Every
call site must treat None as "tracing is off" and skip instrumentation —
never a reason to fail or slow down an actual LLM call. Same "empty config
= feature off, fail open" convention as key_manager.py and resilience.py.
"""
import logging

from langfuse import Langfuse

from ..config import settings

logger = logging.getLogger(__name__)

_client: Langfuse | None = None
_init_attempted = False


def get_langfuse() -> Langfuse | None:
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True

    if not (settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY):
        logger.info("[LLMOps] Langfuse keys not configured — tracing disabled.")
        return None

    try:
        _client = Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY,
            host=settings.LANGFUSE_HOST,
        )
    except Exception as e:
        logger.warning("[LLMOps] Failed to initialize Langfuse client: %s", e)
        _client = None

    return _client


def trace_id_for(request_id: str | None) -> str | None:
    """Deterministic Langfuse trace ID derived from an existing request_id
    (see services/trace.py's new_trace()) — the same seed always yields the
    same 32-hex-char ID, so a request's own request_id and its Langfuse trace
    correlate without introducing a second, unrelated ID system. Pure/local
    (sha256 of the seed, no network) — safe to call unconditionally even when
    Langfuse isn't configured; the returned ID is simply unused in that case.
    """
    if not request_id:
        return None
    return Langfuse.create_trace_id(seed=request_id)


def new_trace_id() -> str | None:
    """Random Langfuse trace ID for call sites with no pre-existing
    request_id to correlate with (e.g. agent_tools/planner.py, which has no
    trace.py-style tracker of its own) — None when Langfuse isn't
    configured, so callers can uniformly treat "no trace_id" as "tracing
    off" whether that's because of this or because request_id was empty in
    trace_id_for() above.
    """
    if get_langfuse() is None:
        return None
    return Langfuse.create_trace_id()


def langchain_invoke_kwargs(langfuse_trace_id: str | None) -> dict:
    """Extra kwargs for a LangChain Runnable's .invoke(), attaching a
    Langfuse CallbackHandler when tracing is configured. LangChain's own
    callback mechanism auto-captures a whole chain — including
    .with_fallbacks() legs — as it runs, so LCEL-based callers
    (fraud_llm.py, screening_llm_service.py) don't need the manual
    per-attempt span wrapping key_manager.py uses; that exists only because
    llm_service.py calls providers via raw urllib, not LangChain.

    Returns {} (a no-op) when Langfuse isn't configured or no trace_id was
    given — merge into a call with `chain.invoke(input, **kwargs)`.
    """
    if get_langfuse() is None or not langfuse_trace_id:
        return {}
    from langfuse.langchain import CallbackHandler
    return {"config": {"callbacks": [CallbackHandler(trace_context={"trace_id": langfuse_trace_id})]}}


def get_prompt_text(name: str, fallback: str, *, label: str = "production", cache_ttl_seconds: int = 300) -> str:
    """Fetches a Langfuse-managed *text* prompt by name (no template
    variables — callers needing those should call get_langfuse().get_prompt()
    directly and .compile(**vars) themselves). `fallback` is the hardcoded
    prompt string that used to live directly in code; it's still the only
    thing that ships in this repo, so:
      - Langfuse not configured -> returns `fallback` immediately, no
        network call at all.
      - Langfuse configured but the named prompt doesn't exist yet, or the
        request fails/times out -> get_prompt()'s own `fallback` param
        already returns `fallback` without raising.
      - anything else unexpected -> caught here as one more fail-open layer.
    A prompt edited in the Langfuse UI takes effect on the next cache
    refresh (cache_ttl_seconds) with zero deploy — that's the entire point
    of moving it out of code, while `fallback` keeps this repo runnable
    standalone if Langfuse is ever removed or unreachable.
    """
    lf = get_langfuse()
    if lf is None:
        return fallback
    try:
        prompt = lf.get_prompt(name, label=label, type="text", fallback=fallback, cache_ttl_seconds=cache_ttl_seconds)
        return prompt.compile()
    except Exception as e:
        logger.warning("[LLMOps] get_prompt(%s) failed, using local fallback: %s", name, e)
        return fallback


def shutdown_langfuse():
    """Flush buffered traces before process exit. Never raises — called from
    main.py's lifespan shutdown, must not block/break app teardown."""
    if _client is not None:
        try:
            _client.flush()
        except Exception as e:
            logger.warning("[LLMOps] Langfuse flush failed: %s", e)
