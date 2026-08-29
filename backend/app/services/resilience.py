"""
Lightweight, dependency-free resilience primitives shared across every
external call in the platform (LLM providers, Pinecone, Tavily, Sarvam, SMTP).

Mirrors the retry-cooldown idiom already used by services/cache.py's
get_redis_client() — a failed dependency is treated as "down for a while,"
not permanently, and callers fail fast instead of hanging on a doomed
request. No new pip dependency: just a small in-memory state machine plus a
backoff loop.
"""
import random
import time
import logging
from threading import Lock

logger = logging.getLogger(__name__)

CLOSED = "closed"
OPEN = "open"
HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when a breaker is OPEN — the caller should fall back immediately."""

    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Circuit breaker '{name}' is open — failing fast.")


class CircuitBreaker:
    """
    Per-dependency circuit breaker. CLOSED (normal) -> OPEN after
    `failure_threshold` consecutive failures -> HALF_OPEN after
    `reset_timeout` seconds (lets exactly one probe call through) -> CLOSED
    again on a probe success, or back to OPEN on a probe failure.
    """

    def __init__(self, name: str, failure_threshold: int = 5, reset_timeout: float = 30.0):
        self.name = name
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self._state = CLOSED
        self._failure_count = 0
        self._opened_at = 0.0
        self._lock = Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._state == OPEN and (time.monotonic() - self._opened_at) >= self.reset_timeout:
                return HALF_OPEN
            return self._state

    def _on_success(self):
        with self._lock:
            self._state = CLOSED
            self._failure_count = 0

    def _on_failure(self):
        with self._lock:
            self._failure_count += 1
            if self._state == HALF_OPEN or self._failure_count >= self.failure_threshold:
                self._state = OPEN
                self._opened_at = time.monotonic()
                logger.warning(
                    "[CircuitBreaker:%s] OPEN after %d consecutive failures — failing fast for %.0fs.",
                    self.name, self._failure_count, self.reset_timeout,
                )

    def call(self, fn, *args, **kwargs):
        current = self.state
        if current == OPEN:
            raise CircuitOpenError(self.name)
        try:
            result = fn(*args, **kwargs)
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result

    def to_dict(self) -> dict:
        return {"name": self.name, "state": self.state, "failure_count": self._failure_count}


_breakers: dict[str, CircuitBreaker] = {}
_breakers_lock = Lock()


def get_breaker(name: str, failure_threshold: int = 5, reset_timeout: float = 30.0) -> CircuitBreaker:
    with _breakers_lock:
        if name not in _breakers:
            _breakers[name] = CircuitBreaker(name, failure_threshold, reset_timeout)
        return _breakers[name]


def all_breaker_states() -> list[dict]:
    with _breakers_lock:
        return [b.to_dict() for b in _breakers.values()]


def retry_with_backoff(
    fn,
    *args,
    max_attempts: int = 3,
    base_delay: float = 0.4,
    max_delay: float = 4.0,
    exceptions: tuple = (Exception,),
    non_retryable: tuple = (),
    on_retry=None,
    **kwargs,
):
    """
    Calls fn(*args, **kwargs), retrying on `exceptions` with exponential
    backoff + jitter. Re-raises the last exception if every attempt fails.
    `non_retryable` is checked first and always re-raised immediately without
    consuming an attempt — for errors where retrying can't help (e.g. an API
    rejection like Sarvam's SarvamCallError, as opposed to a transient
    connection failure). `on_retry(attempt, error)` is an optional callback
    for logging.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            return fn(*args, **kwargs)
        except non_retryable:
            raise
        except exceptions as e:
            if attempt >= max_attempts:
                raise
            if on_retry:
                try:
                    on_retry(attempt, e)
                except Exception:
                    pass
            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            delay += random.uniform(0, delay * 0.25)
            time.sleep(delay)


def call_with_resilience(
    breaker_name: str,
    fn,
    *args,
    max_attempts: int = 3,
    base_delay: float = 0.4,
    max_delay: float = 4.0,
    exceptions: tuple = (Exception,),
    non_retryable: tuple = (),
    failure_threshold: int = 5,
    reset_timeout: float = 30.0,
    **kwargs,
):
    """
    Convenience wrapper: breaker fail-fast check, then retry-with-backoff for
    the attempts that do go through, with breaker state updated on the
    overall outcome. This is the one call most services should use.
    """
    breaker = get_breaker(breaker_name, failure_threshold, reset_timeout)

    def _guarded():
        return retry_with_backoff(
            fn, *args,
            max_attempts=max_attempts, base_delay=base_delay, max_delay=max_delay,
            exceptions=exceptions, non_retryable=non_retryable,
            on_retry=lambda attempt, e: logger.info(
                "[Resilience:%s] attempt %d failed (%s), retrying...", breaker_name, attempt, e
            ),
            **kwargs,
        )

    return breaker.call(_guarded)
