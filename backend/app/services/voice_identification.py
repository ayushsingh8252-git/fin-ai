from __future__ import annotations

"""
Voice Identification Service

This module implements the core logic for the Voice Identification Tool, 
providing capabilities for speaker enrollment, verification (1:1), and identification (1:N). 

Features:
- Voice Activity Detection (VAD) via Silero VAD
- Embedding extraction via PyTorch, ONNX FP32, or ONNX INT8 (ECAPA-TDNN 192-dim)
- Audio quality checks 
- Anti-spoofing techniques (Modular Replay detection, AI synthetic voice detection)
- Real threshold calibration & score normalization
- Central security decision engine (OPEN, DENY, RETRY, UNKNOWN, UNCERTAIN)
- Challenge-response verification
- Vector search with Pinecone and local fallback
"""

import threading
import uuid
import logging
import random
import io
import wave
import math
import os
import time
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

from ..config import settings
from ..services.resilience import call_with_resilience, CircuitOpenError
from .voice_encoder import get_speaker_encoder
from .voice_security import get_spoof_pipeline, SpoofLabel, SpoofResult
from .voice_decision import authenticate, DecisionType
from .voice_calibration.calibrator import get_voice_calibrator
from .voice_observability import log_voice_event

logger = logging.getLogger("voice_identification")

# ── ECAPA-TDNN Speaker Encoder (192-dim embeddings) ──────────────────────
_speaker_model = None
_speaker_lock = threading.Lock()

def get_speaker_model():
    """Singleton loader for SpeechBrain ECAPA-TDNN."""
    global _speaker_model
    if _speaker_model is None:
        with _speaker_lock:
            if _speaker_model is None:
                import speechbrain.utils.fetching as fetching
                from speechbrain.inference.speaker import EncoderClassifier
                logger.info("Loading ECAPA-TDNN speaker encoder...")
                _speaker_model = EncoderClassifier.from_hparams(
                    source="speechbrain/spkrec-ecapa-voxceleb",
                    savedir=".cache/speechbrain/spkrec-ecapa-voxceleb",
                    run_opts={"device": "cpu"},
                    local_strategy=fetching.LocalStrategy.COPY,
                )
                logger.info("ECAPA-TDNN loaded successfully.")
    return _speaker_model

_vad_model = None
_vad_lock = threading.Lock()

def get_vad_model():
    """Singleton loader for Silero VAD with resilient local fallback."""
    global _vad_model
    if _vad_model is None:
        with _vad_lock:
            if _vad_model is None:
                import torch
                try:
                    _vad_model, _utils = torch.hub.load(
                        repo_or_dir='snakers4/silero-vad',
                        model='silero_vad',
                        force_reload=False,
                        onnx=False,
                        trust_repo=True,
                    )
                    logger.info("Silero VAD loaded successfully.")
                except Exception as e:
                    logger.warning("Silero VAD network load failed (%s). Using resilient local VAD fallback.", e)
                    class ResilientLocalVAD:
                        def __call__(self, chunk, sample_rate):
                            rms = float(torch.sqrt(torch.mean(chunk ** 2)))
                            prob = 1.0 if rms > 0.006 else 0.0
                            return torch.tensor([prob])
                        def reset_states(self):
                            pass
                    _vad_model = ResilientLocalVAD()
    return _vad_model


def run_vad(waveform, sample_rate: int) -> Tuple[Any, float]:
    """Run Voice Activity Detection on waveform.
    Returns (speech_only_waveform, speech_duration_seconds)."""
    import torch
    vad = get_vad_model()

    if sample_rate != 16000:
        import torchaudio
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        sample_rate = 16000

    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)

    window_size = 512
    speech_probs = []
    for i in range(0, len(waveform), window_size):
        chunk = waveform[i:i + window_size]
        if len(chunk) < window_size:
            chunk = torch.nn.functional.pad(chunk, (0, window_size - len(chunk)))
        prob = vad(chunk, sample_rate).item()
        speech_probs.append((i, prob))

    speech_segments = []
    for start_idx, prob in speech_probs:
        if prob > 0.5:
            end_idx = min(start_idx + window_size, len(waveform))
            speech_segments.append(waveform[start_idx:end_idx])

    if not speech_segments:
        return torch.tensor([]), 0.0

    speech_waveform = torch.cat(speech_segments)
    speech_duration = len(speech_waveform) / sample_rate
    vad.reset_states()
    
    return speech_waveform, speech_duration

def check_audio_quality(waveform, sample_rate: int) -> Dict[str, Any]:
    """Check if audio is usable for speaker recognition."""
    import torch
    issues = []

    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)

    duration = len(waveform) / sample_rate
    if duration < 0.3:
        issues.append(f"Audio too short: {duration:.1f}s (need >= 0.3s)")

    rms = torch.sqrt(torch.mean(waveform ** 2)).item() if len(waveform) > 0 else 0.0
    if rms < 0.005:
        issues.append(f"Audio too quiet: RMS={rms:.4f} (need >= 0.005)")

    clip_threshold = 0.99
    clipped = (torch.abs(waveform) > clip_threshold).float().mean().item() if len(waveform) > 0 else 0.0
    if clipped > 0.05:
        issues.append(f"Audio clipping detected: {clipped*100:.1f}% of samples clipped")

    peak = torch.max(torch.abs(waveform)).item() if len(waveform) > 0 else 0.0
    crest_factor = 0.0
    if peak > 0 and rms > 0:
        crest_factor = peak / rms
        if crest_factor < 1.15:
            issues.append(f"Suspiciously flat audio (crest factor={crest_factor:.2f})")

    return {
        "is_usable": len(issues) == 0,
        "issues": issues,
        "rms_energy": round(rms, 4),
        "clipping_ratio": round(clipped, 4),
        "duration_sec": round(duration, 2),
    }

def extract_voice_embedding(audio_path: str) -> Dict[str, Any]:
    """Full pipeline: load audio → convert → VAD → quality check → ECAPA → embedding."""
    import torch
    import torchaudio

    from .audio_service import load_audio_waveform

    try:
        waveform, sample_rate = load_audio_waveform(audio_path)
    except Exception as e:
        return {"error": f"Failed to load audio: {e}"}

    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    waveform_1d = waveform.squeeze(0)

    speech_waveform, speech_duration = run_vad(waveform_1d, sample_rate)

    if speech_duration < settings.VOICE_ID_MIN_SPEECH_DURATION:
        return {
            "error": f"Insufficient speech detected: {speech_duration:.1f}s (need >= {settings.VOICE_ID_MIN_SPEECH_DURATION}s)",
            "speech_duration": speech_duration,
        }

    quality = check_audio_quality(speech_waveform, 16000)
    if not quality["is_usable"]:
        return {"error": f"Audio quality too low: {'; '.join(quality['issues'])}", "quality": quality}

    try:
        encoder = get_speaker_encoder()
        emb_list = encoder.embed(speech_waveform, sample_rate=16000)
    except Exception as e:
        return {"error": f"Speaker encoder failed: {e}"}

    return {
        "embedding": emb_list,
        "speech_duration": round(speech_duration, 2),
        "quality": quality,
    }

_voice_index = None
_voice_index_lock = threading.Lock()

def get_voice_pinecone_index():
    """Singleton for the voice-embeddings Pinecone index (192-dim, cosine)."""
    global _voice_index
    if _voice_index is None:
        with _voice_index_lock:
            if _voice_index is None:
                from pinecone import Pinecone
                pc = Pinecone(api_key=settings.PINECONE_API_KEY)
                _voice_index = pc.Index(settings.PINECONE_VOICE_INDEX_NAME)
                logger.info("Pinecone voice index '%s' connected.", settings.PINECONE_VOICE_INDEX_NAME)
    return _voice_index

def detect_replay(waveform, sample_rate: int) -> Dict[str, Any]:
    """Detect if audio was replayed through a speaker."""
    if not settings.VOICE_ID_REPLAY_DETECTION_ENABLED:
        return {"is_replay": False, "confidence": 0.0, "skipped": True}

    from .voice_security.replay_detector import ReplayDetector
    detector = ReplayDetector()
    res = detector.predict(waveform, sample_rate)
    return {
        "is_replay": res.details.get("is_replay", res.label == SpoofLabel.REPLAY),
        "confidence": res.confidence,
        "high_freq_ratio": res.details.get("high_freq_ratio", 0.0),
        "dynamic_range_db": res.details.get("dynamic_range_db", 0.0),
        "spectral_flatness": res.details.get("spectral_flatness", 0.0),
    }

def detect_ai_voice(waveform, sample_rate: int) -> Dict[str, Any]:
    """Detect if audio is AI-generated / voice-cloned / synthetic speech."""
    if not settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED:
        return {"is_synthetic": False, "confidence": 0.0, "skipped": True}

    from .voice_security.synthetic_detector import SyntheticDetector
    detector = SyntheticDetector()
    res = detector.predict(waveform, sample_rate)
    return {
        "is_synthetic": res.details.get("is_synthetic", res.label == SpoofLabel.SYNTHETIC),
        "confidence": res.confidence,
        "centroid_variance": res.details.get("centroid_variance", 0.0),
        "energy_variance": res.details.get("energy_variance", 0.0),
        "zcr_variance": res.details.get("zcr_variance", 0.0),
    }

_CHALLENGE_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "black", "white", "pink", "brown"]
_CHALLENGE_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "zero"]
_CHALLENGE_OBJECTS = ["window", "apple", "table", "house", "river", "mountain", "garden", "bridge", "castle", "forest"]

def generate_challenge_phrase() -> str:
    """Generate a random 3-word challenge phrase."""
    return f"{random.choice(_CHALLENGE_COLORS)} {random.choice(_CHALLENGE_NUMBERS)} {random.choice(_CHALLENGE_OBJECTS)}"

def verify_challenge_response(audio_path: str, expected_phrase: str) -> Dict[str, Any]:
    """Transcribe audio and check if spoken words match expected phrase."""
    from .audio_service import transcribe_audio
    
    try:
        segments = transcribe_audio(audio_path)
        spoken_text = " ".join(s["text"] for s in segments).strip().lower()
    except Exception as e:
        return {"match": False, "error": f"Transcription failed: {e}", "spoken": ""}

    expected_lower = expected_phrase.lower().strip()
    
    from rapidfuzz import fuzz
    similarity = fuzz.token_sort_ratio(spoken_text, expected_lower)
    
    return {
        "match": similarity >= 70,
        "similarity": round(similarity, 1),
        "spoken": spoken_text,
        "expected": expected_lower,
    }

def enroll_speaker(
    speaker_id: str,
    speaker_name: str,
    audio_path: str,
    db,
    email: Optional[str] = None,
) -> Dict[str, Any]:
    """Enroll a voice sample for a speaker."""
    from ..models import VoicePrint, VoiceEnrollment

    result = extract_voice_embedding(audio_path)
    if "error" in result:
        return {"status": "error", "message": result["error"], "detail": result}

    embedding = result["embedding"]
    speech_duration = result["speech_duration"]
    quality = result.get("quality", {})

    voice_print = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
    if voice_print is None:
        voice_print = VoicePrint(
            id=speaker_id,
            speaker_name=speaker_name,
            email=email,
            status="enrolling",
            enrollment_count=0,
        )
        db.add(voice_print)
        db.flush()
    elif voice_print.enrollment_count >= settings.VOICE_ID_MAX_ENROLLMENT_SAMPLES:
        return {
            "status": "error",
            "message": f"Maximum enrollment samples reached ({settings.VOICE_ID_MAX_ENROLLMENT_SAMPLES}).",
        }

    enrollment_id = str(uuid.uuid4())
    enrollment = VoiceEnrollment(
        id=enrollment_id,
        speaker_id=speaker_id,
        embedding=embedding,
        audio_quality_score=quality.get("rms_energy"),
        speech_duration_sec=speech_duration,
    )
    db.add(enrollment)

    voice_print.enrollment_count = (voice_print.enrollment_count or 0) + 1
    
    all_enrollments = (
        db.query(VoiceEnrollment)
        .filter(VoiceEnrollment.speaker_id == speaker_id)
        .all()
    )
    all_embeds = [e.embedding for e in all_enrollments] + [embedding]
    centroid = np.mean(all_embeds, axis=0).tolist()
    voice_print.embedding = centroid

    if voice_print.enrollment_count >= settings.VOICE_ID_MIN_ENROLLMENT_SAMPLES:
        voice_print.status = "active"

    db.commit()

    try:
        index = get_voice_pinecone_index()
        call_with_resilience(
            "pinecone_voice_write", index.upsert,
            vectors=[{
                "id": f"speaker_{speaker_id}",
                "values": centroid,
                "metadata": {
                    "speaker_id": speaker_id,
                    "speaker_name": speaker_name,
                    "email": email or "",
                    "enrollment_count": voice_print.enrollment_count,
                    "status": voice_print.status,
                },
            }],
            max_attempts=3, base_delay=0.5, max_delay=4.0,
        )
    except (CircuitOpenError, Exception) as e:
        logger.warning("Pinecone voice upsert failed (non-fatal): %s", e)

    return {
        "status": "ok",
        "speaker_id": speaker_id,
        "enrollment_id": enrollment_id,
        "enrollment_count": voice_print.enrollment_count,
        "voiceprint_status": voice_print.status,
        "speech_duration": speech_duration,
        "quality": quality,
        "message": (
            f"Enrollment sample {voice_print.enrollment_count} recorded."
            + (f" Need {settings.VOICE_ID_MIN_ENROLLMENT_SAMPLES - voice_print.enrollment_count} more to activate."
               if voice_print.status == "enrolling" else " Voiceprint is now active.")
        ),
    }

def identify_speaker(
    audio_path: str,
    db,
    challenge_phrase: Optional[str] = None,
) -> Dict[str, Any]:
    """Full 1:N speaker identification pipeline with calibrated thresholding,
    anti-spoofing, and central decision engine."""
    t0 = time.perf_counter()
    req_id = str(uuid.uuid4())
    import torch
    import torchaudio
    from ..models import VoicePrint

    # 1. Embedding extraction
    result = extract_voice_embedding(audio_path)
    if "error" in result:
        return {"decision": "error", "message": result["error"], "detail": result}

    query_embedding = result["embedding"]
    speech_dur = result["speech_duration"]
    quality = result.get("quality", {})

    # 2. 1:N Retrieval (Pinecone with local fallback)
    try:
        index = get_voice_pinecone_index()
        search_result = call_with_resilience(
            "pinecone_voice_read", index.query,
            vector=query_embedding, top_k=20, include_metadata=True,
            max_attempts=3, base_delay=0.3, max_delay=3.0,
        )
        matches = search_result.get("matches", [])
    except (CircuitOpenError, Exception) as e:
        logger.warning("Pinecone voice search failed, falling back to local: %s", e)
        matches = _local_voice_search(query_embedding, db, top_k=20)

    if not matches:
        return {"decision": "unknown", "message": "No enrolled speakers found.", "candidates": []}

    # 3. Re-rank with exact cosine similarity
    candidates = []
    for match in matches:
        metadata = match.get("metadata", {}) if isinstance(match, dict) else getattr(match, "metadata", {})
        score = match.get("score", 0) if isinstance(match, dict) else getattr(match, "score", 0)
        speaker_id = metadata.get("speaker_id", "")
        
        vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
        if vp and vp.embedding:
            score = float(_cosine_similarity(query_embedding, vp.embedding))

        candidates.append({
            "speaker_id": speaker_id,
            "speaker_name": metadata.get("speaker_name", ""),
            "score": round(score, 4),
            "status": metadata.get("status", "unknown"),
        })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    top = candidates[0]
    runner_up_score = candidates[1]["score"] if len(candidates) > 1 else 0.0
    margin = top["score"] - runner_up_score

    # 4. Anti-spoofing
    from .audio_service import load_audio_waveform
    waveform, sr = load_audio_waveform(audio_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0)
    else:
        waveform = waveform.squeeze(0)

    spoof_pipe = get_spoof_pipeline(
        replay_enabled=settings.VOICE_ID_REPLAY_DETECTION_ENABLED,
        synthetic_enabled=settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED,
    )
    spoofing_results = spoof_pipe.analyze(waveform, sr)

    # 5. Challenge phrase
    challenge_result = None
    if challenge_phrase and settings.VOICE_ID_CHALLENGE_ENABLED:
        challenge_result = verify_challenge_response(audio_path, challenge_phrase)

    # 6. Calibration thresholds
    calibrator = get_voice_calibrator()
    cal_thresh = getattr(calibrator.active_calibration, "verification_threshold", settings.VOICE_ID_SIMILARITY_THRESHOLD)
    cal_margin = getattr(calibrator.active_calibration, "margin_threshold", settings.VOICE_ID_MARGIN_THRESHOLD)

    # 7. Central Decision Engine
    decision_obj = authenticate(
        speaker_score=top["score"],
        score_margin=margin,
        quality_usable=quality.get("is_usable", True),
        spoof_result=spoofing_results,
        challenge_result=challenge_result,
        calibrated_threshold=cal_thresh,
        calibrated_margin=cal_margin,
        speaker_id=top["speaker_id"],
        speaker_name=top["speaker_name"],
        is_1_to_1=False,
    )

    t1 = time.perf_counter()
    latency_ms = (t1 - t0) * 1000.0

    # 8. Observability audit logging
    log_voice_event(
        request_id=req_id,
        model_version=settings.VOICE_MODEL_VERSION,
        inference_backend=settings.VOICE_INFERENCE_BACKEND,
        audio_duration_ms=len(waveform) / sr * 1000.0,
        speech_duration_ms=speech_dur * 1000.0,
        quality_score=quality.get("rms_energy", 0.0),
        speaker_score=top["score"],
        score_margin=margin,
        spoof_score=spoofing_results.get("overall_score", 0.0),
        decision=decision_obj.decision.value,
        latency_ms=latency_ms,
        speaker_id=top["speaker_id"],
    )

    if decision_obj.decision == DecisionType.OPEN:
        return {
            "decision": "match",
            "speaker_id": top["speaker_id"],
            "speaker_name": top["speaker_name"],
            "confidence": top["score"],
            "margin": round(margin, 4),
            "spoofing": spoofing_results,
            "challenge": challenge_result,
            "candidates": candidates[:5],
            "decision_detail": decision_obj.to_dict(),
        }
    elif decision_obj.decision == DecisionType.UNCERTAIN:
        return {
            "decision": "uncertain",
            "message": decision_obj.message,
            "top_score": top["score"],
            "runner_up_score": runner_up_score,
            "margin": round(margin, 4),
            "candidates": candidates[:5],
            "decision_detail": decision_obj.to_dict(),
        }
    elif decision_obj.decision == DecisionType.UNKNOWN:
        return {
            "decision": "unknown",
            "message": decision_obj.message,
            "top_score": top["score"],
            "candidates": candidates[:5],
            "decision_detail": decision_obj.to_dict(),
        }
    else:  # DENY / RETRY
        return {
            "decision": "denied",
            "reason": decision_obj.reason,
            "message": decision_obj.message,
            "spoofing": spoofing_results,
            "challenge": challenge_result,
            "candidate": top,
            "decision_detail": decision_obj.to_dict(),
        }

def verify_speaker(
    speaker_id: str,
    audio_path: str,
    db,
    challenge_phrase: Optional[str] = None,
) -> Dict[str, Any]:
    """1:1 verification — compare audio against a specific speaker's voiceprint."""
    t0 = time.perf_counter()
    req_id = str(uuid.uuid4())
    import torch
    import torchaudio
    from ..models import VoicePrint

    vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
    if not vp:
        return {"decision": "error", "message": f"Speaker '{speaker_id}' not found."}
    if vp.status != "active":
        return {"decision": "error", "message": f"Speaker '{speaker_id}' is not fully enrolled (status={vp.status})."}
    if not vp.embedding:
        return {"decision": "error", "message": f"Speaker '{speaker_id}' has no voiceprint embedding."}

    result = extract_voice_embedding(audio_path)
    if "error" in result:
        return {"decision": "error", "message": result["error"]}

    score = float(_cosine_similarity(result["embedding"], vp.embedding))
    speech_dur = result["speech_duration"]
    quality = result.get("quality", {})

    from .audio_service import load_audio_waveform
    waveform, sr = load_audio_waveform(audio_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0)
    else:
        waveform = waveform.squeeze(0)

    spoof_pipe = get_spoof_pipeline(
        replay_enabled=settings.VOICE_ID_REPLAY_DETECTION_ENABLED,
        synthetic_enabled=settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED,
    )
    spoofing = spoof_pipe.analyze(waveform, sr)

    challenge_result = None
    if challenge_phrase and settings.VOICE_ID_CHALLENGE_ENABLED:
        challenge_result = verify_challenge_response(audio_path, challenge_phrase)

    calibrator = get_voice_calibrator()
    cal_thresh = getattr(calibrator.active_calibration, "verification_threshold", settings.VOICE_ID_SIMILARITY_THRESHOLD)

    decision_obj = authenticate(
        speaker_score=score,
        score_margin=0.20,
        quality_usable=quality.get("is_usable", True),
        spoof_result=spoofing,
        challenge_result=challenge_result,
        calibrated_threshold=cal_thresh,
        calibrated_margin=0.0,
        speaker_id=speaker_id,
        speaker_name=vp.speaker_name,
        is_1_to_1=True,
    )

    t1 = time.perf_counter()
    latency_ms = (t1 - t0) * 1000.0

    log_voice_event(
        request_id=req_id,
        model_version=settings.VOICE_MODEL_VERSION,
        inference_backend=settings.VOICE_INFERENCE_BACKEND,
        audio_duration_ms=len(waveform) / sr * 1000.0,
        speech_duration_ms=speech_dur * 1000.0,
        quality_score=quality.get("rms_energy", 0.0),
        speaker_score=score,
        score_margin=0.0,
        spoof_score=spoofing.get("overall_score", 0.0),
        decision=decision_obj.decision.value,
        latency_ms=latency_ms,
        speaker_id=speaker_id,
    )

    if decision_obj.decision == DecisionType.OPEN:
        return {
            "decision": "match",
            "speaker_id": speaker_id,
            "speaker_name": vp.speaker_name,
            "confidence": round(score, 4),
            "spoofing": spoofing,
            "challenge": challenge_result,
            "decision_detail": decision_obj.to_dict(),
        }
    elif decision_obj.decision == DecisionType.DENY and decision_obj.reason in ("replay_detected", "synthetic_detected", "challenge_failed"):
        return {
            "decision": "denied",
            "reason": decision_obj.reason,
            "message": decision_obj.message,
            "spoofing": spoofing,
            "challenge": challenge_result,
            "decision_detail": decision_obj.to_dict(),
        }
    else:
        return {
            "decision": "no_match",
            "speaker_id": speaker_id,
            "confidence": round(score, 4),
            "threshold": cal_thresh,
            "message": f"Voice does not match '{vp.speaker_name}' (score={score:.2f} < {cal_thresh:.2f}).",
            "spoofing": spoofing,
            "decision_detail": decision_obj.to_dict(),
        }

def _cosine_similarity(a: list, b: list) -> float:
    """Compute cosine similarity between two embedding vectors."""
    a_np = np.array(a, dtype=np.float32)
    b_np = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(a_np) * np.linalg.norm(b_np)
    if denom < 1e-10:
        return 0.0
    return float(np.dot(a_np, b_np) / denom)

def _local_voice_search(query_embedding: list, db, top_k: int = 20) -> list:
    """Fallback local cosine search when Pinecone is unavailable."""
    from ..models import VoicePrint
    all_speakers = db.query(VoicePrint).filter(VoicePrint.status == "active").all()
    scored = []
    for vp in all_speakers:
        if not vp.embedding:
            continue
        score = _cosine_similarity(query_embedding, vp.embedding)
        scored.append({
            "score": score,
            "metadata": {
                "speaker_id": vp.id,
                "speaker_name": vp.speaker_name,
                "email": vp.email or "",
                "status": vp.status,
                "enrollment_count": vp.enrollment_count,
            },
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
