"""Voice Biometrics Structured Observability and Audit Logging.

Provides privacy-preserving traceable audit events without logging raw audio or raw vector embeddings.
"""
from __future__ import annotations

import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("voice_audit")


def log_voice_event(
    request_id: str,
    model_version: str,
    inference_backend: str,
    audio_duration_ms: float,
    speech_duration_ms: float,
    quality_score: float,
    speaker_score: float,
    score_margin: float,
    spoof_score: float,
    decision: str,
    latency_ms: float,
    speaker_id: Optional[str] = None,
    extra_details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Logs structured telemetry for a voice verification / identification transaction."""
    event = {
        "event_type": "voice_biometric_verification",
        "request_id": request_id,
        "model_version": model_version,
        "inference_backend": inference_backend,
        "speaker_id": speaker_id,
        "audio_duration_ms": round(audio_duration_ms, 1),
        "speech_duration_ms": round(speech_duration_ms, 1),
        "quality_score": round(quality_score, 4),
        "speaker_score": round(speaker_score, 4),
        "score_margin": round(score_margin, 4),
        "spoof_score": round(spoof_score, 4),
        "decision": decision,
        "latency_ms": round(latency_ms, 2),
    }
    if extra_details:
        event["extra"] = extra_details

    logger.info("VOICE_EVENT: %s", json.dumps(event))
    return event
