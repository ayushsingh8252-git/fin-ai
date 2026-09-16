"""LLMOps observability — Langfuse client singleton.

get_langfuse() returns a configured Langfuse client, or None when
LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY aren't set (see config.py). Every
call site must treat None as "tracing is off" and skip instrumentation —
never a reason to fail or slow down an actual LLM call. Same "empty config
= feature off, fail open" convention as key_manager.py and resilience.py.
"""
import hashlib
import json
import logging
from dataclasses import dataclass
from contextlib import contextmanager, nullcontext
from typing import Any

try:
    from langfuse import Langfuse, propagate_attributes
except ImportError:  # The app must keep serving when optional tracing is absent.
    Langfuse = None
    propagate_attributes = None

from ..config import settings

logger = logging.getLogger(__name__)

_client: Any | None = None
_init_attempted = False


@dataclass(frozen=True)
class ManagedPrompt:
    """Compiled prompt text plus the version identity used for one call."""

    text: str
    name: str
    label: str
    version: int | None
    source: str  # "langfuse" | "local_fallback"

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "prompt_name": self.name,
            "prompt_label": self.label,
            "prompt_version": self.version,
            "prompt_source": self.source,
        }


def get_langfuse() -> Any | None:
    global _client, _init_attempted
    if _init_attempted:
        return _client
    _init_attempted = True

    if Langfuse is None:
        logger.warning("[LLMOps] Langfuse package is not installed; tracing disabled.")
        return None

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
    # Keep this correlation ID deterministic even in a dev environment where
    # the optional SDK is not installed.
    return hashlib.sha256(request_id.encode("utf-8")).hexdigest()[:32]


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


_MAX_ATTR_LEN = 200


def _clean_attr(value: str | None) -> str | None:
    """Coerce a caller-supplied identity value to what Langfuse's
    propagate_attributes() requires: US-ASCII, <=200 chars, non-empty."""
    if not value:
        return None
    cleaned = value.encode("ascii", "ignore").decode("ascii").strip()[:_MAX_ATTR_LEN]
    return cleaned or None


def llmops_context(
    *,
    user_id: str | None = None,
    session_id: str | None = None,
    workflow_type: str | None = None,
):
    """Tags every Langfuse observation created within this `with` block —
    including the root trace — with user_id/session_id/tags=[workflow_type].
    Must wrap the outermost point of a request handler, before any Langfuse
    observation for that request is created (Langfuse's own
    propagate_attributes() only affects the active span and spans created
    after it's entered; it can't retroactively tag earlier ones).

    Fail-open like every other function here: returns nullcontext() when
    Langfuse isn't configured, or when every field ends up empty (e.g. no
    identity headers were sent) — safe to wrap around every request
    unconditionally.
    """
    if get_langfuse() is None or propagate_attributes is None:
        return nullcontext()
    user_id = _clean_attr(user_id)
    session_id = _clean_attr(session_id)
    tags = [workflow_type] if workflow_type else None
    if not user_id and not session_id and not tags:
        return nullcontext()
    return propagate_attributes(user_id=user_id, session_id=session_id, tags=tags)


def normalize_openai_usage(usage: dict | None) -> dict[str, int] | None:
    """Convert an OpenAI-compatible provider usage object into Langfuse keys."""
    if not isinstance(usage, dict):
        return None
    input_tokens = usage.get("prompt_tokens")
    output_tokens = usage.get("completion_tokens")
    if not isinstance(input_tokens, int) and not isinstance(output_tokens, int):
        return None
    details = {
        "input_tokens": max(0, int(input_tokens or 0)),
        "output_tokens": max(0, int(output_tokens or 0)),
    }
    cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
    if isinstance(cached, int) and cached >= 0:
        details["cache_read_input_tokens"] = cached
    return details


def normalize_gemini_usage(usage: Any) -> dict[str, int] | None:
    """Convert google-genai usage_metadata to Langfuse usage fields."""
    if usage is None:
        return None

    def value(name: str) -> int | None:
        raw = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
        return int(raw) if isinstance(raw, int) and raw >= 0 else None

    input_tokens = value("prompt_token_count")
    output_tokens = value("candidates_token_count")
    if input_tokens is None and output_tokens is None:
        return None
    details = {
        "input_tokens": input_tokens or 0,
        "output_tokens": output_tokens or 0,
    }
    cached = value("cached_content_token_count")
    if cached is not None:
        details["cache_read_input_tokens"] = cached
    return details


def calculate_cost_details(model: str, usage_details: dict[str, int] | None) -> dict[str, float] | None:
    """Return auditable USD costs using explicit account-specific rate config.

    Langfuse can infer prices from its model registry as a fallback, but this
    path emits an explicit cost only when the deployment has supplied its own
    rate card. That makes the dashboard match negotiated provider pricing.
    """
    if not usage_details:
        return None
    try:
        rates = json.loads(settings.LLM_COST_RATES_JSON)
        model_rates = rates.get(model, {}) if isinstance(rates, dict) else {}
    except (TypeError, ValueError):
        logger.warning("[LLMOps] LLM_COST_RATES_JSON is invalid; skipping explicit cost calculation.")
        return None

    costs: dict[str, float] = {}
    input_tokens = usage_details.get("input_tokens", 0)
    cached_tokens = usage_details.get("cache_read_input_tokens", 0)
    input_rate = model_rates.get("input") if isinstance(model_rates, dict) else None
    cached_rate = model_rates.get("cache_read_input") if isinstance(model_rates, dict) else None
    if isinstance(input_tokens, int) and isinstance(input_rate, (int, float)) and input_rate >= 0:
        # Provider input totals usually include cache reads. When a dedicated
        # cache rate is configured, bill only the non-cached share at the
        # standard input rate.
        billable_input = input_tokens - cached_tokens if isinstance(cached_rate, (int, float)) else input_tokens
        costs["input"] = round(max(0, billable_input) * float(input_rate) / 1_000_000, 12)
    output_tokens = usage_details.get("output_tokens", 0)
    output_rate = model_rates.get("output") if isinstance(model_rates, dict) else None
    if isinstance(output_tokens, int) and isinstance(output_rate, (int, float)) and output_rate >= 0:
        costs["output"] = round(output_tokens * float(output_rate) / 1_000_000, 12)
    if isinstance(cached_tokens, int) and isinstance(cached_rate, (int, float)) and cached_rate >= 0:
        costs["cache_read_input"] = round(cached_tokens * float(cached_rate) / 1_000_000, 12)
    return costs or None


@contextmanager
def observe_operation(
    name: str,
    *,
    as_type: str,
    trace_id: str | None = None,
    input: Any = None,
    metadata: dict[str, Any] | None = None,
):
    """Create a non-generation Langfuse observation without making it critical-path."""
    lf = get_langfuse()
    cm = (
        lf.start_as_current_observation(
            name=name,
            as_type=as_type,
            trace_context={"trace_id": trace_id} if trace_id else None,
            input=input,
            metadata=metadata,
        )
        if lf is not None else nullcontext()
    )
    with cm as observation:
        yield observation


def langchain_invoke_kwargs(
    langfuse_trace_id: str | None,
    prompt_metadata: dict[str, Any] | None = None,
) -> dict:
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
    config: dict[str, Any] = {
        "callbacks": [CallbackHandler(trace_context={"trace_id": langfuse_trace_id})],
    }
    if prompt_metadata:
        config["metadata"] = prompt_metadata
    return {"config": config}


def get_managed_prompt(
    name: str,
    fallback: str,
    *,
    label: str | None = None,
    variables: dict[str, Any] | None = None,
    cache_ttl_seconds: int = 300,
) -> ManagedPrompt:
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
    label = label or settings.LANGFUSE_PROMPT_LABEL
    lf = get_langfuse()
    if lf is None:
        return ManagedPrompt(fallback, name, label, None, "local_fallback")
    try:
        prompt = lf.get_prompt(name, label=label, type="text", fallback=fallback, cache_ttl_seconds=cache_ttl_seconds)
        return ManagedPrompt(
            text=prompt.compile(**(variables or {})),
            name=name,
            label=label,
            version=getattr(prompt, "version", None),
            source="langfuse",
        )
    except Exception as e:
        logger.warning("[LLMOps] get_prompt(%s) failed, using local fallback: %s", name, e)
        return ManagedPrompt(fallback, name, label, None, "local_fallback")


def get_prompt_text(name: str, fallback: str, *, label: str = "production", cache_ttl_seconds: int = 300) -> str:
    """Compatibility wrapper for call sites that only need prompt text."""
    return get_managed_prompt(name, fallback, label=label, cache_ttl_seconds=cache_ttl_seconds).text


def shutdown_langfuse():
    """Flush buffered traces before process exit. Never raises — called from
    main.py's lifespan shutdown, must not block/break app teardown."""
    if _client is not None:
        try:
            _client.flush()
        except Exception as e:
            logger.warning("[LLMOps] Langfuse flush failed: %s", e)
