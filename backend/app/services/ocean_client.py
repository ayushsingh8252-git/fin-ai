"""
Thin HTTP client for the isolated `ocean-service` container (OCEAN-AI —
aimclub/OCEANAI — behavioral/personality-trait analysis of an interview
recording). Deliberately just a client: no OCEAN-AI import, no torch/opencv/
mediapipe here — those heavy, exactly-pinned deps (transformers==4.45.1
conflicts with this backend's own unpinned transformers, used by
sentence-transformers/CrossEncoder reranking) live only in ocean-service's
own image. See docs/behavioral-analysis.md for the full architecture.

Mirrors the existing external-call convention in services/resilience.py
(circuit breaker, used by every other external dependency — Groq/Gemini,
Pinecone, Tavily, Twilio, SMTP) rather than inventing a new HTTP pattern.
Retry-with-backoff is deliberately NOT used here (max_attempts=1): a single
analysis call can legitimately take minutes, and worker.py's own
task-level retry (via Celery's countdown re-queue) is the right layer to
retry a whole failed attempt, exactly as its own docstring explains for the
ingestion tasks — retrying inside one attempt would just double the wait
inside a single worker slot.
"""
import logging

import httpx

from ..config import settings
from .resilience import call_with_resilience, CircuitOpenError

logger = logging.getLogger(__name__)


class OceanServiceError(Exception):
    """Raised for any failure talking to ocean-service. `retryable` decides
    whether worker.py's Celery task should re-queue itself or give up and
    mark the row status=failed for a human to re-trigger."""

    def __init__(self, message: str, retryable: bool = True):
        self.retryable = retryable
        super().__init__(message)


class OceanServiceNotConfigured(OceanServiceError):
    """OCEAN_SERVICE_URL is unset — a deployment/config problem, not a
    transient one. Never retryable: retrying won't make a URL appear."""

    def __init__(self):
        super().__init__("OCEAN_SERVICE_URL is not configured.", retryable=False)


def analyze_recording(video_path: str, session_id: str) -> dict:
    """Calls ocean-service's POST /analyze with a path inside the shared
    uploads volume (both containers mount the same policy_uploads volume —
    see docker-compose.yml — so this sends a path, not the file's bytes,
    exactly like worker.py's existing execute_process_document(file_path)
    convention for other heavy-file processing).

    Returns the parsed {"status", "model", "results", "timing"} response
    body on success. Raises OceanServiceError on any failure, with
    `.retryable` set so the caller (worker.py's Celery task) can decide
    whether to re-queue or fail permanently.
    """
    if not settings.OCEAN_SERVICE_URL:
        raise OceanServiceNotConfigured()

    def _post():
        resp = httpx.post(
            f"{settings.OCEAN_SERVICE_URL.rstrip('/')}/analyze",
            json={"video_path": video_path, "session_id": session_id},
            timeout=settings.OCEAN_SERVICE_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        return resp.json()

    try:
        return call_with_resilience(
            "ocean_service",
            _post,
            max_attempts=1,
            failure_threshold=3,
            reset_timeout=60.0,
        )
    except CircuitOpenError as e:
        raise OceanServiceError(str(e), retryable=True) from e
    except httpx.HTTPStatusError as e:
        # 4xx from ocean-service means it looked at this specific recording
        # and rejected it (corrupt file, unsupported format, no face/audio
        # detected) — retrying the same file won't fix that. 5xx is the
        # service's own failure (model crash, OOM) and may well succeed on
        # a later attempt once whatever caused it clears.
        detail = e.response.text[:500]
        retryable = e.response.status_code >= 500
        logger.error(
            "[ocean_client] session=%s ocean-service returned %s: %s",
            session_id, e.response.status_code, detail,
        )
        raise OceanServiceError(f"ocean-service error {e.response.status_code}: {detail}", retryable=retryable) from e
    except httpx.RequestError as e:
        logger.error("[ocean_client] session=%s could not reach ocean-service: %s", session_id, e)
        raise OceanServiceError(f"Could not reach ocean-service: {e}", retryable=True) from e
