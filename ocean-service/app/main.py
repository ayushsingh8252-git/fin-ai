import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from . import model_loader, ocean_service
from .exceptions import (
    InferenceError,
    ModelLoadError,
    RecordingNotFoundError,
    UnsupportedRecordingError,
)
from .schemas import AnalyzeRequest, AnalyzeResponse, HealthResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup-time loading (task requirement: models loaded once, reused,
    # never per-request) rather than lazy-on-first-request: this container
    # has exactly one job, so there's no cost to blocking startup on it, and
    # it means the /health readiness check (used by docker-compose and by
    # backend/app/services/ocean_client.py's circuit breaker indirectly)
    # reflects real readiness instead of reporting healthy before the first
    # multi-minute cold load has even started. A load failure is logged but
    # does NOT crash the process — /health reports status="error" and
    # /analyze returns 503 until fixed, rather than the container
    # crash-looping on a transient weight-host outage at deploy time.
    try:
        logger.info("[ocean-service] loading OCEAN-AI models at startup...")
        model_loader.get_run()
        logger.info("[ocean-service] models loaded, ready to serve.")
    except ModelLoadError as e:
        logger.error("[ocean-service] startup model load failed: %s", e)
    yield


app = FastAPI(title="OCEAN-AI Behavioral Analysis Service", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health():
    if model_loader.is_loaded():
        return HealthResponse(status="ok", model_loaded=True)
    if model_loader.load_error():
        return HealthResponse(status="error", model_loaded=False, model_load_error=model_loader.load_error())
    return HealthResponse(status="loading", model_loaded=False)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    # Never logs payload.video_path's contents or the session_id alongside
    # anything else identifying — just enough to correlate a failure with a
    # backend-side retry, matching the platform's no-PII-in-logs convention
    # (see backend's services/guardrails.py).
    logger.info("[ocean-service] session=%s analyze requested", payload.session_id)
    try:
        result = ocean_service.analyze_interview(payload.video_path)
    except RecordingNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except UnsupportedRecordingError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ModelLoadError as e:
        raise HTTPException(status_code=503, detail=f"Model not ready: {e}")
    except InferenceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return AnalyzeResponse(**result)
