import os
import time
import json
import logging
from threading import Lock
from typing import List, Dict, Optional, Callable, Set

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# The numbered key vars this module discovers (GROQ_API_KEY_1, GOOGLE_API_KEY_1,
# ...) live only in AI-Policy-Rule-Engine/.env — pydantic-settings (config.py)
# reads that file into its own Settings object, but does NOT copy it into
# os.environ, and nothing else in this app calls load_dotenv() anywhere.
# Docker's `env_file:` directive happens to inject the same values as real
# container environment variables, which is the only reason this worked
# before — a plain local `uvicorn app.main:app` (or any script importing this
# module directly) found zero keys. python-dotenv never overrides a variable
# that's already set (override=False is the default), so this is a no-op,
# not a behavior change, wherever the real env already has these set.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".env"))

COOLDOWN_DEFAULT_SECONDS = 60


def is_rate_limit_error(e: Exception) -> bool:
    """
    Detects HTTP 429, rate limit, quota exceeded, or resource exhausted errors.
    """
    if hasattr(e, "code") and getattr(e, "code") == 429:
        return True
    if hasattr(e, "status_code") and getattr(e, "status_code") == 429:
        return True
    err_str = str(e).lower()
    keywords = [
        "429",
        "quota",
        "rate limit",
        "ratelimit",
        "resource_exhausted",
        "resourceexhausted",
        "too many requests",
    ]
    return any(kw in err_str for kw in keywords)


class APIKeyInfo:
    def __init__(self, provider: str, index: int, label: str, api_key: str):
        self.provider = provider.lower()
        self.index = index
        self.label = label
        self.api_key = api_key
        self.cooldown_until = 0.0

    def is_available(self, now: float = None) -> bool:
        if now is None:
            now = time.time()
        return now >= self.cooldown_until

    def set_cooldown(self, seconds: int = COOLDOWN_DEFAULT_SECONDS, now: float = None):
        if now is None:
            now = time.time()
        self.cooldown_until = now + seconds


class LLMKeyManager:
    """
    Manages API keys for Groq and Gemini providers.
    Provides in-memory round-robin key selection, automatic 429 rate-limit cooldowns,
    Groq -> Gemini provider fallback, and fail-open optional Redis synchronization.
    """

    def __init__(self, cooldown_seconds: int = COOLDOWN_DEFAULT_SECONDS):
        self.cooldown_seconds = cooldown_seconds
        self._keys: Dict[str, List[APIKeyInfo]] = {"groq": [], "gemini": []}
        self._rr_index: Dict[str, int] = {"groq": 0, "gemini": 0}
        self._lock = Lock()
        self.refresh_keys()

    def refresh_keys(self):
        """
        Discovers keys from environment variables and settings.
        Supports GROQ_API_KEY_1..10 / GROQ_API_KEY1..10, GEMINI_API_KEY_1..10 / GEMINI_API_KEY1..10,
        GOOGLE_API_KEY_1..10 / GOOGLE_API_KEY1..10, GROK_API_KEY_1..10 / GROK_API_KEY1..10,
        as well as legacy single keys GROQ_API_KEY/GROK_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY.
        """
        with self._lock:
            self._keys["groq"] = self._discover_provider_keys("groq")
            self._keys["gemini"] = self._discover_provider_keys("gemini")

    def _discover_provider_keys(self, provider: str) -> List[APIKeyInfo]:
        keys: List[APIKeyInfo] = []
        seen_secret_values = set()

        if provider == "groq":
            # 1. Numbered env vars 1 to 10 (supports GROQ_API_KEY_1 and GROQ_API_KEY1)
            for i in range(1, 11):
                val = (
                    os.getenv(f"GROQ_API_KEY_{i}")
                    or os.getenv(f"GROQ_API_KEY{i}")
                    or os.getenv(f"GROK_API_KEY_{i}")
                    or os.getenv(f"GROK_API_KEY{i}")
                )
                if val and val.strip():
                    secret = val.strip()
                    if secret not in seen_secret_values:
                        keys.append(APIKeyInfo("groq", i, f"GROQ_API_KEY_{i}", secret))
                        seen_secret_values.add(secret)

            # 2. Fallback single key if not already present
            single_val = os.getenv("GROQ_API_KEY") or os.getenv("GROK_API_KEY")
            if not single_val:
                try:
                    from ..config import settings
                    single_val = settings.GROQ_API_KEY or settings.GROK_API_KEY
                except Exception:
                    pass
            if single_val and single_val.strip():
                secret = single_val.strip()
                if secret not in seen_secret_values:
                    idx = len(keys) + 1
                    keys.append(APIKeyInfo("groq", idx, "GROQ_API_KEY", secret))
                    seen_secret_values.add(secret)

        elif provider == "gemini":
            # 1. Numbered env vars 1 to 10 (supports GEMINI_API_KEY_1 / GEMINI_API_KEY1 and GOOGLE_API_KEY_1 / GOOGLE_API_KEY1)
            for i in range(1, 11):
                val = (
                    os.getenv(f"GEMINI_API_KEY_{i}")
                    or os.getenv(f"GEMINI_API_KEY{i}")
                    or os.getenv(f"GOOGLE_API_KEY_{i}")
                    or os.getenv(f"GOOGLE_API_KEY{i}")
                )
                if val and val.strip():
                    secret = val.strip()
                    if secret not in seen_secret_values:
                        keys.append(APIKeyInfo("gemini", i, f"GEMINI_API_KEY_{i}", secret))
                        seen_secret_values.add(secret)

            # 2. Fallback single key if not already present
            single_val = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not single_val:
                try:
                    from ..config import settings
                    single_val = settings.GEMINI_API_KEY
                except Exception:
                    pass
            if single_val and single_val.strip():
                secret = single_val.strip()
                if secret not in seen_secret_values:
                    idx = len(keys) + 1
                    keys.append(APIKeyInfo("gemini", idx, "GEMINI_API_KEY", secret))
                    seen_secret_values.add(secret)

        return keys

    def _sync_cooldown_to_redis(self, provider: str, key_info: APIKeyInfo):
        """
        Optional Redis cooldown record. Fails silently if Redis is absent or throws an error.
        """
        try:
            from .cache import get_redis_client
            r = get_redis_client()
            if r:
                r.setex(f"llm_cooldown:{provider}:{key_info.index}", self.cooldown_seconds, "1")
        except Exception:
            pass

    def _is_redis_cooldown(self, provider: str, key_info: APIKeyInfo) -> bool:
        """
        Optional Redis check. Returns False if Redis is absent or throws an error.
        """
        try:
            from .cache import get_redis_client
            r = get_redis_client()
            if r:
                return bool(r.get(f"llm_cooldown:{provider}:{key_info.index}"))
        except Exception:
            pass
        return False

    def mark_cooldown(self, key_info: APIKeyInfo, error_type: str = "RateLimit/429"):
        """
        Marks key as unavailable for `self.cooldown_seconds`.
        Logs provider + key index + error type without exposing the raw API key secret.
        """
        key_info.set_cooldown(self.cooldown_seconds)
        self._sync_cooldown_to_redis(key_info.provider, key_info)
        logger.warning(
            "[LLM KeyManager] Provider %s key %d (%s) hit rate limit/quota error (%s). Cooldown for %ds.",
            key_info.provider,
            key_info.index,
            key_info.label,
            error_type,
            self.cooldown_seconds,
        )

    def get_next_key(self, provider: str, excluded_labels: Set[str] = None) -> Optional[APIKeyInfo]:
        """
        Gets the next available key for `provider` using round-robin rotation.
        Filters out keys in cooldown or listed in `excluded_labels`.
        """
        if excluded_labels is None:
            excluded_labels = set()

        now = time.time()
        with self._lock:
            all_keys = self._keys.get(provider, [])
            if not all_keys:
                return None

            available = [
                k
                for k in all_keys
                if k.label not in excluded_labels
                and k.is_available(now)
                and not self._is_redis_cooldown(provider, k)
            ]

            if not available:
                return None

            curr_idx = self._rr_index[provider] % len(available)
            selected = available[curr_idx]
            self._rr_index[provider] = (curr_idx + 1) % len(available)
            return selected

    def execute_json_generation(
        self,
        prompt: str,
        system_instruction: str = None,
        groq_fn: Callable = None,
        gemini_fn: Callable = None,
        parse_fn: Callable = None,
        trace_sink: Optional[list] = None,
        langfuse_trace_id: Optional[str] = None,
        prompt_metadata: Optional[dict] = None,
    ):
        """
        Main execution flow:
        1. Round-robin Groq keys. Try next key on failure/429.
        2. Fallback to Gemini keys if all Groq keys fail.
        3. Re-raise exception if all keys fail.

        `trace_sink`, if given, gets one dict appended per provider attempt
        (provider, key label, success, latency_ms, error) — observability for
        the LLM section of a request trace (see services/trace.py). Optional
        and additive: every existing caller that doesn't pass it behaves
        exactly as before. Attempt granularity here is still per-provider-key,
        not per-model-candidate.

        `langfuse_trace_id`, if given (see services/llmops.py::trace_id_for),
        makes each attempt below a real Langfuse generation nested under the
        caller's own trace, capturing the full prompt/completion/latency that
        `trace_sink` above deliberately omits. Optional and additive: when
        Langfuse isn't configured (get_langfuse() is None) or this arg is
        omitted, _traced_call below is a plain passthrough — zero behavior
        change, same as trace_sink.

        The Langfuse generation's `model` field: when groq_fn/gemini_fn are
        left at their defaults (the real provider calls), _traced_call passes
        them a `model_used` out-list and corrects `model` from the generic
        provider name to the actual winning model ID (e.g.
        "openai/gpt-oss-120b") once the call returns — closing the gap
        flagged when this generation-wrapping was first added (see git
        history), which matters for per-model cost tracking in Langfuse.
        When a caller injects its own groq_fn/gemini_fn (as tests do), that
        out-list is never passed — those fakes' signatures don't accept it —
        so `model` stays the generic provider name in that case, same as
        before.
        """
        from .llm_service import _call_grok_groq_api, _call_gemini_api, _parse_json
        from .llmops import (
            calculate_cost_details,
            get_langfuse,
            normalize_gemini_usage,
            normalize_openai_usage,
        )

        using_default_groq_fn = groq_fn is None
        using_default_gemini_fn = gemini_fn is None
        if groq_fn is None:
            groq_fn = _call_grok_groq_api
        if gemini_fn is None:
            gemini_fn = _call_gemini_api
        if parse_fn is None:
            parse_fn = _parse_json

        lf = get_langfuse()

        def _record(provider: str, key_info: "APIKeyInfo", success: bool, latency_ms: float, error: str = None):
            if trace_sink is not None:
                trace_sink.append({
                    "provider": provider,
                    "key_label": key_info.label,
                    "attempt": len(trace_sink) + 1,
                    "success": success,
                    "latency_ms": round(latency_ms, 1),
                    "error": error,
                })

        def _traced_call(provider: str, fn: Callable, key_info: "APIKeyInfo", using_default: bool):
            """Runs fn(prompt, ...) inside a Langfuse generation span when
            configured, else calls it directly — never adds a hard dependency
            on Langfuse being reachable."""
            call_kwargs = {"api_key": key_info.api_key}
            model_used: list = []
            usage_used: list = []
            if using_default:
                call_kwargs["model_used"] = model_used
                call_kwargs["usage_used"] = usage_used

            if lf is None:
                return fn(prompt, system_instruction, **call_kwargs)

            trace_context = {"trace_id": langfuse_trace_id} if langfuse_trace_id else None
            with lf.start_as_current_observation(
                name=f"llm.{provider}",
                as_type="generation",
                trace_context=trace_context,
                input={"prompt": prompt, "system_instruction": system_instruction},
                model=provider,
                metadata={"key_label": key_info.label, **(prompt_metadata or {})},
            ) as gen:
                raw_out = fn(prompt, system_instruction, **call_kwargs)
                model = model_used[0] if model_used else provider
                raw_usage = usage_used[0] if usage_used else None
                usage_details = (
                    normalize_openai_usage(raw_usage)
                    if provider == "groq"
                    else normalize_gemini_usage(raw_usage)
                )
                cost_details = calculate_cost_details(model, usage_details)
                metadata = {
                    "key_label": key_info.label,
                    "cost_source": "configured_rate_card" if cost_details else "langfuse_model_registry",
                    **(prompt_metadata or {}),
                }
                gen.update(
                    output=raw_out,
                    model=model,
                    usage_details=usage_details,
                    cost_details=cost_details,
                    metadata=metadata,
                )
                return raw_out

        groq_errors = []
        tried_groq_labels = set()

        # Step A: Try Groq keys
        while True:
            key_info = self.get_next_key("groq", excluded_labels=tried_groq_labels)
            if not key_info:
                break

            tried_groq_labels.add(key_info.label)
            attempt_start = time.time()
            try:
                raw_out = _traced_call("groq", groq_fn, key_info, using_default_groq_fn)
                result = parse_fn(raw_out)
                _record("groq", key_info, True, (time.time() - attempt_start) * 1000)
                return result
            except Exception as e:
                err_type = type(e).__name__
                _record("groq", key_info, False, (time.time() - attempt_start) * 1000, f"{err_type}: {e}")
                if is_rate_limit_error(e):
                    self.mark_cooldown(key_info, error_type=f"{err_type}: 429/Quota")
                else:
                    logger.warning(
                        "[LLM KeyManager] Provider groq key %d (%s) failed (%s: %s).",
                        key_info.index,
                        key_info.label,
                        err_type,
                        str(e),
                    )
                groq_errors.append(f"{key_info.label}: {str(e)}")

        # Step B: Fallback to Gemini keys if Groq failed/unavailable
        if groq_errors or not tried_groq_labels:
            logger.info("[LLM KeyManager] Groq keys unavailable or exhausted. Falling back to Gemini...")

        gemini_errors = []
        tried_gemini_labels = set()

        while True:
            key_info = self.get_next_key("gemini", excluded_labels=tried_gemini_labels)
            if not key_info:
                break

            tried_gemini_labels.add(key_info.label)
            attempt_start = time.time()
            try:
                raw_out = _traced_call("gemini", gemini_fn, key_info, using_default_gemini_fn)
                result = parse_fn(raw_out)
                _record("gemini", key_info, True, (time.time() - attempt_start) * 1000)
                return result
            except Exception as e:
                err_type = type(e).__name__
                _record("gemini", key_info, False, (time.time() - attempt_start) * 1000, f"{err_type}: {e}")
                if is_rate_limit_error(e):
                    self.mark_cooldown(key_info, error_type=f"{err_type}: 429/Quota")
                else:
                    logger.warning(
                        "[LLM KeyManager] Provider gemini key %d (%s) failed (%s: %s).",
                        key_info.index,
                        key_info.label,
                        err_type,
                        str(e),
                    )
                gemini_errors.append(f"{key_info.label}: {str(e)}")

        # Step C: All configured keys failed
        total_errors = groq_errors + gemini_errors
        err_msg = "All configured Groq and Gemini API keys failed."
        if total_errors:
            err_msg += f" Details: {'; '.join(total_errors)}"
        raise RuntimeError(err_msg)


key_manager = LLMKeyManager()
