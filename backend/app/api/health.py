"""
Real liveness/readiness checks. The pre-existing GET /health (main.py)
returns a hardcoded {"status": "ok"} regardless of whether any real
dependency is reachable — cosmetic, not a genuine health signal (see
docs/client-readiness-audit-2026-09-16.md's P1-4 finding). It's left
unchanged for backward compatibility; these two routes are the real checks
and are what docker-compose's healthcheck / a load balancer should use.

Liveness (/health/live): answers "is this process alive" only — never
touches Postgres/Redis/Pinecone/LLM providers. A dependency outage must
never make a live process report itself dead, or an orchestrator would kill
and restart a perfectly fine process over someone else's outage.

Readiness (/health/ready): answers "can this instance actually serve the
requests a load balancer would send it" — checks only the two dependencies
every core API route genuinely needs: the primary database (documents/
chunks/rules/users/... — see database.py) and Redis (Celery broker +
query/result caching — see services/cache.py). Deliberately NOT checked
here, because each already has its own documented, working fail-open
convention elsewhere in this codebase (not an oversight):
  - the episodic-memory Postgres store (config.py: "falls back cleanly...
    logged not raised" if unreachable)
  - Pinecone (services/retrieval.py falls back to local cosine search)
  - LLM providers (services/llm_service.py's Groq->Gemini fallback)
  - SMTP, Tavily, and every MCP connector (all fail soft with a clear
    "not configured"/degraded response, never a hard dependency)
Making any of those mandatory here would report "not ready" for a real,
already-handled degraded mode instead of an actual outage, and a load
balancer would eject a perfectly capable instance over it.
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..config import settings
from ..database import SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])

# Bounds how long a single check can block the request even in a
# pathological case (e.g. a hung TCP connection with no timeout of its
# own) — confirmed worth having empirically: the Celery dispatch work in
# this same codebase hit a near-two-minute hang from an unbounded broker
# reconnect retry, from what looked like an already-timeout-guarded call.
_health_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="health-check")
CHECK_TIMEOUT_SECONDS = 3.0


def _run_with_timeout(name: str, fn) -> bool:
    # `name` is passed explicitly rather than read off fn.__name__ — keeps
    # this usable with anything callable (found via a test that patched the
    # check itself with a Mock, which has no real __name__).
    future = _health_executor.submit(fn)
    try:
        return bool(future.result(timeout=CHECK_TIMEOUT_SECONDS))
    except FutureTimeoutError:
        logger.warning("[health] %s exceeded %.1fs timeout", name, CHECK_TIMEOUT_SECONDS)
        return False
    except Exception as e:
        logger.warning("[health] %s raised: %s", name, e)
        return False


@router.get("/live")
def liveness():
    """No dependency checks, ever — see module docstring. Deliberately the
    cheapest possible handler; if this process can run Python at all, this
    returns 200."""
    return {"status": "alive"}


def _check_database() -> bool:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return True
    finally:
        db.close()


def _check_redis() -> bool:
    # A dedicated short-lived client, not services/cache.py's shared
    # get_redis_client() — that client is constructed with
    # socket_connect_timeout but no socket_timeout (read/write), so a ping
    # on a connection that's gone stale but not yet TCP-RST'd could hang far
    # longer than this endpoint should ever take. Using REDIS_URL (existing
    # config) directly here keeps the check fast and fully decoupled from
    # the query-cache's own retry-cooldown state machine.
    import redis

    client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
    return bool(client.ping())


@router.get("/ready")
def readiness():
    started = time.monotonic()
    db_ok = _run_with_timeout("database", _check_database)
    redis_ok = _run_with_timeout("redis", _check_redis)
    elapsed_ms = round((time.monotonic() - started) * 1000, 1)

    checks = {
        "database": "ok" if db_ok else "failed",
        "redis": "ok" if redis_ok else "failed",
    }
    ready = db_ok and redis_ok
    body = {"status": "ready" if ready else "not_ready", "checks": checks}

    logger.info("[health] readiness=%s db=%s redis=%s (%.1fms)", body["status"], checks["database"], checks["redis"], elapsed_ms)
    return JSONResponse(status_code=200 if ready else 503, content=body)
