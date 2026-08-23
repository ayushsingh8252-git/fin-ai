import os
import time
import json
import logging
from threading import Lock
from typing import List, Dict, Optional, Callable, Set

logger = logging.getLogger(__name__)

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
    ):
        """
        Main execution flow:
        1. Round-robin Groq keys. Try next key on failure/429.
        2. Fallback to Gemini keys if all Groq keys fail.
        3. Re-raise exception if all keys fail.
        """
        from .llm_service import _call_grok_groq_api, _call_gemini_api, _parse_json

        if groq_fn is None:
            groq_fn = _call_grok_groq_api
        if gemini_fn is None:
            gemini_fn = _call_gemini_api
        if parse_fn is None:
            parse_fn = _parse_json

        groq_errors = []
        tried_groq_labels = set()

        # Step A: Try Groq keys
        while True:
            key_info = self.get_next_key("groq", excluded_labels=tried_groq_labels)
            if not key_info:
                break

            tried_groq_labels.add(key_info.label)
            try:
                raw_out = groq_fn(prompt, system_instruction, api_key=key_info.api_key)
                return parse_fn(raw_out)
            except Exception as e:
                err_type = type(e).__name__
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
            try:
                raw_out = gemini_fn(prompt, system_instruction, api_key=key_info.api_key)
                return parse_fn(raw_out)
            except Exception as e:
                err_type = type(e).__name__
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
