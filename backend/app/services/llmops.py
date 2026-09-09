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


def shutdown_langfuse():
    """Flush buffered traces before process exit. Never raises — called from
    main.py's lifespan shutdown, must not block/break app teardown."""
    if _client is not None:
        try:
            _client.flush()
        except Exception as e:
            logger.warning("[LLMOps] Langfuse flush failed: %s", e)
