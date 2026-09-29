"""
Shared pieces of the interview speaker monitor: pure decision helpers, the
two model calls (Silero VAD speech ratio, batched ECAPA-TDNN embeddings) and
the HR report summary. The live streaming engine is services/speaker_stream.py.

Both models are the backend's existing process-wide singletons from
voice_identification.py (Silero VAD, SpeechBrain ECAPA-TDNN) — loaded once per
process, never per chunk.
"""
import logging
import threading
from datetime import timezone
from typing import Any, Dict, List, Tuple

import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)

CANDIDATE = "CANDIDATE"
UNKNOWN = "UNKNOWN"
UNRESOLVED = "UNRESOLVED"

SAMPLE_RATE = 16000
VAD_FRAME = 512  # Silero's window at 16 kHz (32 ms)

# Silero VAD is a stateful RNN shared by every session in the process: each
# call resets its state and runs one whole window under this lock, so
# concurrent interviews can never mix their audio state.
_vad_inference_lock = threading.Lock()


def normalize(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(normalize(np.asarray(a)), normalize(np.asarray(b))))


def classify(similarity: float, high: float, low: float) -> str:
    if similarity >= high:
        return CANDIDATE
    if similarity <= low:
        return UNKNOWN
    return UNRESOLVED


def median_smooth(values: List[float], k: int = 3) -> List[float]:
    """Centered running median: one odd window can't flip a label on its own."""
    if k <= 1 or len(values) < 3:
        return list(values)
    half = k // 2
    return [float(np.median(values[max(0, i - half): i + half + 1])) for i in range(len(values))]


def assign_cluster(centroids: List[List[float]], embedding: np.ndarray, threshold: float) -> Tuple[int, bool]:
    """Index of the extra speaker this embedding belongs to; appends a new
    centroid (is_new=True) when no existing one is similar enough."""
    best_i, best = -1, -1.0
    for i, c in enumerate(centroids):
        s = cosine(np.asarray(c), embedding)
        if s > best:
            best_i, best = i, s
    if best_i >= 0 and best >= threshold:
        centroids[best_i] = normalize(np.asarray(centroids[best_i]) + normalize(embedding)).tolist()
        return best_i, False
    centroids.append(normalize(embedding).tolist())
    return len(centroids) - 1, True


# ── Model calls (existing singletons) ────────────────────────────────────

def vad_speech_ratio(window: np.ndarray) -> float:
    """Share of 32 ms frames in this window that Silero calls speech."""
    import torch
    from .voice_identification import get_vad_model

    vad = get_vad_model()
    t = torch.from_numpy(np.ascontiguousarray(window, dtype=np.float32))
    speech = total = 0
    with _vad_inference_lock:
        vad.reset_states()
        for i in range(0, len(t) - VAD_FRAME + 1, VAD_FRAME):
            total += 1
            if vad(t[i:i + VAD_FRAME], SAMPLE_RATE).item() > settings.SPEAKER_VAD_THRESHOLD:
                speech += 1
        vad.reset_states()
    return speech / total if total else 0.0


def embed_windows(windows: List[np.ndarray]) -> np.ndarray:
    """L2-normalized ECAPA embeddings, one batched call for all windows."""
    import torch
    from .voice_identification import _speaker_lock, get_speaker_model

    batch = torch.stack([torch.from_numpy(np.ascontiguousarray(w, dtype=np.float32)) for w in windows])
    model = get_speaker_model()
    with _speaker_lock:
        emb = model.encode_batch(batch).squeeze(1).detach().cpu().numpy()
    return np.stack([normalize(e) for e in emb])


# ── HR report view ────────────────────────────────────────────────────────

def _iso(dt):
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def summarize(db, session_id: str, session_completed: bool) -> Dict[str, Any]:
    """Measured stats + persisted events. Never includes embeddings."""
    from ..models import InterviewAudioEvent, InterviewSpeakerBaseline

    row = db.get(InterviewSpeakerBaseline, session_id)
    if row is None:
        return {"status": "not_enabled", "baseline_status": None, "reference_source": None,
                "stats": None, "audio_context": None, "events": []}

    baseline_status = row.status
    if baseline_status == "enrolling" and session_completed:
        row.status = baseline_status = "insufficient_baseline"
        db.commit()

    s = row.stats or {}
    classified = s.get("candidate", 0.0) + s.get("unknown", 0.0) + s.get("unresolved", 0.0)
    events = (
        db.query(InterviewAudioEvent)
        .filter(InterviewAudioEvent.session_id == session_id)
        .order_by(InterviewAudioEvent.occurred_at, InterviewAudioEvent.created_at)
        .all()
    )
    return {
        "status": "degraded" if row.status_reason else "active",
        "status_reason": row.status_reason,
        "baseline_status": baseline_status,
        "reference_source": row.reference_source,
        "stats": {
            "stream_seconds": s.get("stream", 0.0),
            "speech_seconds": s.get("speech", 0.0),
            "baseline_seconds": row.enrolled_seconds,
            "classified_seconds": round(classified, 2),
            "candidate_seconds": s.get("candidate", 0.0),
            "unknown_seconds": s.get("unknown", 0.0),
            "unresolved_seconds": s.get("unresolved", 0.0),
            "candidate_coverage_pct": round(100 * s.get("candidate", 0.0) / classified, 1) if classified else None,
            "distinct_extra_speakers": len(row.unknown_centroids or []),
            "dropped_audio_seconds": s.get("dropped", 0.0),
        },
        "audio_context": row.audio_context,
        "events": [
            {
                "event_type": e.event_type,
                "source": e.source,
                "speaker_id": e.speaker_label,
                "turn_index": e.turn_index,
                "start_seconds": e.start_seconds,
                "end_seconds": e.end_seconds,
                "duration_ms": int(e.duration_seconds * 1000) if e.duration_seconds is not None else None,
                "confidence": e.confidence,
                "details": e.details,
                "occurred_at": _iso(e.occurred_at),
            }
            for e in events
        ],
    }
