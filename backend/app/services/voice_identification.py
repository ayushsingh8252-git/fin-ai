from __future__ import annotations

"""
Voice Identification Service

This module implements the core logic for the Voice Identification Tool, 
providing capabilities for speaker enrollment, verification (1:1), and identification (1:N). 

It features:
- Voice Activity Detection (VAD) via Silero VAD
- Embedding extraction via SpeechBrain (ECAPA-TDNN)
- Audio quality checks 
- Anti-spoofing techniques (Replay detection, AI voice detection)
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
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

from ..config import settings
from ..services.resilience import call_with_resilience, CircuitOpenError

logger = logging.getLogger("voice_identification")

# ── ECAPA-TDNN Speaker Encoder (192-dim embeddings) ──────────────────────
_speaker_model = None
_speaker_lock = threading.Lock()

def get_speaker_model():
    """Singleton loader for SpeechBrain ECAPA-TDNN.
    Same pattern as services/detection.py's get_embedding_model()."""
    global _speaker_model
    if _speaker_model is None:
        with _speaker_lock:
            if _speaker_model is None:  # double-check after acquiring lock
                from speechbrain.inference.speaker import EncoderClassifier
                logger.info("Loading ECAPA-TDNN speaker encoder...")
                _speaker_model = EncoderClassifier.from_hparams(
                    source="speechbrain/spkrec-ecapa-voxceleb",
                    savedir=".cache/speechbrain/spkrec-ecapa-voxceleb",
                    run_opts={"device": "cpu"},
                )
                logger.info("ECAPA-TDNN loaded successfully.")
    return _speaker_model

_vad_model = None
_vad_lock = threading.Lock()

def get_vad_model():
    """Singleton loader for Silero VAD."""
    global _vad_model
    if _vad_model is None:
        with _vad_lock:
            if _vad_model is None:
                import torch
                _vad_model, _utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    onnx=False,
                )
                logger.info("Silero VAD loaded successfully.")
    return _vad_model


def run_vad(waveform, sample_rate: int) -> Tuple[Any, float]:
    """Run Voice Activity Detection on waveform.
    Returns (speech_only_waveform, speech_duration_seconds).
    Uses Silero VAD to detect speech segments and concatenate them."""
    import torch
    vad = get_vad_model()

    # Silero VAD expects 16kHz mono
    if sample_rate != 16000:
        import torchaudio
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        sample_rate = 16000

    # Ensure 1D
    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)

    # Process in 512-sample windows (32ms at 16kHz)
    window_size = 512
    speech_probs = []
    for i in range(0, len(waveform), window_size):
        chunk = waveform[i:i + window_size]
        if len(chunk) < window_size:
            chunk = torch.nn.functional.pad(chunk, (0, window_size - len(chunk)))
        prob = vad(chunk, sample_rate).item()
        speech_probs.append((i, prob))

    # Collect speech segments (prob > 0.5)
    speech_segments = []
    for start_idx, prob in speech_probs:
        if prob > 0.5:
            end_idx = min(start_idx + window_size, len(waveform))
            speech_segments.append(waveform[start_idx:end_idx])

    if not speech_segments:
        return torch.tensor([]), 0.0

    speech_waveform = torch.cat(speech_segments)
    speech_duration = len(speech_waveform) / sample_rate
    
    # Reset VAD state for next call
    vad.reset_states()
    
    return speech_waveform, speech_duration

def check_audio_quality(waveform, sample_rate: int) -> Dict[str, Any]:
    """Check if audio is usable for speaker recognition.
    Returns {"is_usable": bool, "issues": [...], "rms_energy": float, ...}"""
    import torch
    issues = []

    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)

    # 1. Check if audio is too short
    duration = len(waveform) / sample_rate
    if duration < 0.3:
        issues.append(f"Audio too short: {duration:.1f}s (need >= 0.3s)")

    # 2. RMS energy check — is the audio too quiet?
    rms = torch.sqrt(torch.mean(waveform ** 2)).item()
    if rms < 0.005:
        issues.append(f"Audio too quiet: RMS={rms:.4f} (need >= 0.005)")

    # 3. Clipping detection — percentage of samples at max amplitude
    clip_threshold = 0.99
    clipped = (torch.abs(waveform) > clip_threshold).float().mean().item()
    if clipped > 0.05:
        issues.append(f"Audio clipping detected: {clipped*100:.1f}% of samples clipped")

    # 4. Dynamic range
    peak = torch.max(torch.abs(waveform)).item()
    if peak > 0 and rms > 0:
        crest_factor = peak / rms
        if crest_factor < 1.5:
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
    """Full pipeline: load audio → convert → VAD → quality check → ECAPA → embedding.
    Returns {"embedding": [...], "speech_duration": float, "quality": {...}} on success,
    or {"error": str, "quality": {...}} on failure."""
    import torch
    import torchaudio

    # Step 1: Convert to WAV if needed (reuse existing audio_service)
    from .audio_service import convert_to_wav
    wav_path = convert_to_wav(audio_path)

    # Step 2: Load audio
    try:
        waveform, sample_rate = torchaudio.load(wav_path)
    except Exception as e:
        return {"error": f"Failed to load audio: {e}"}

    # Ensure mono
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    waveform_1d = waveform.squeeze(0)

    # Step 3: VAD — extract speech-only regions
    speech_waveform, speech_duration = run_vad(waveform_1d, sample_rate)

    if speech_duration < settings.VOICE_ID_MIN_SPEECH_DURATION:
        return {
            "error": f"Insufficient speech detected: {speech_duration:.1f}s (need >= {settings.VOICE_ID_MIN_SPEECH_DURATION}s)",
            "speech_duration": speech_duration,
        }

    # Step 4: Quality check on speech portion
    quality = check_audio_quality(speech_waveform, 16000)  # VAD outputs 16kHz
    if not quality["is_usable"]:
        return {"error": f"Audio quality too low: {'; '.join(quality['issues'])}", "quality": quality}

    # Step 5: Extract ECAPA-TDNN embedding
    try:
        model = get_speaker_model()
        # SpeechBrain expects [batch, time] tensor
        if speech_waveform.dim() == 1:
            speech_waveform = speech_waveform.unsqueeze(0)
        with _speaker_lock:
            embedding = model.encode_batch(speech_waveform)
        # embedding shape: [1, 1, 192] → flatten to [192]
        emb_list = embedding.squeeze().detach().cpu().numpy().tolist()
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
    """Singleton for the voice-embeddings Pinecone index (192-dim, cosine).
    Separate from the policy-rules index used by RAG."""
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
    """Detect if audio was replayed through a speaker (e.g. someone playing
    a recording of the target speaker's voice through their laptop).
    
    Replayed audio has:
    - Narrower effective bandwidth (speaker frequency response rolls off)
    - Less dynamic range (speaker compression + room acoustics)
    - Higher spectral flatness in high frequencies (speaker noise floor)
    """
    import torch
    if not settings.VOICE_ID_REPLAY_DETECTION_ENABLED:
        return {"is_replay": False, "confidence": 0.0, "skipped": True}

    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)

    waveform_np = waveform.numpy()

    # 1. Spectral bandwidth analysis via FFT
    fft = np.fft.rfft(waveform_np)
    magnitude = np.abs(fft)
    freqs = np.fft.rfftfreq(len(waveform_np), 1.0 / sample_rate)

    # Energy above 7kHz vs total — replayed audio loses high-freq content
    total_energy = np.sum(magnitude ** 2)
    if total_energy < 1e-10:
        return {"is_replay": False, "confidence": 0.0, "note": "silent audio"}
    
    high_freq_mask = freqs > 7000
    high_freq_energy = np.sum(magnitude[high_freq_mask] ** 2)
    high_freq_ratio = high_freq_energy / total_energy

    # 2. Dynamic range (dB)
    rms = np.sqrt(np.mean(waveform_np ** 2))
    peak = np.max(np.abs(waveform_np))
    dynamic_range_db = 20 * np.log10(peak / max(rms, 1e-10))

    # 3. Spectral flatness in high-freq band
    high_mag = magnitude[high_freq_mask]
    if len(high_mag) > 0 and np.mean(high_mag) > 0:
        geometric_mean = np.exp(np.mean(np.log(high_mag + 1e-10)))
        arithmetic_mean = np.mean(high_mag)
        spectral_flatness = geometric_mean / max(arithmetic_mean, 1e-10)
    else:
        spectral_flatness = 0.0

    # Heuristic scoring: replay signals
    replay_score = 0.0
    if high_freq_ratio < 0.01:  # very little high-freq content
        replay_score += 0.4
    elif high_freq_ratio < 0.05:
        replay_score += 0.2
    if dynamic_range_db < 6.0:  # compressed dynamics
    if high_freq_ratio < 0.0001:  # severely band-limited (e.g. low quality telephone speaker)
        replay_score += 0.3
    elif dynamic_range_db < 10.0:
    elif high_freq_ratio < 0.001:
        replay_score += 0.15
    if spectral_flatness > 0.5:  # noisy high-freq floor
        replay_score += 0.3
    elif spectral_flatness > 0.3:
    if dynamic_range_db < 3.0:  # extreme dynamic compression
        replay_score += 0.35
    elif dynamic_range_db < 5.0:
        replay_score += 0.15
    if spectral_flatness > 0.75:  # flat noise floor in high frequencies
        replay_score += 0.35
    elif spectral_flatness > 0.60:
        replay_score += 0.15

    return {
        "is_replay": replay_score >= 0.6,
        "confidence": round(replay_score, 2),
        "high_freq_ratio": round(high_freq_ratio, 4),
        "dynamic_range_db": round(dynamic_range_db, 2),
        "spectral_flatness": round(spectral_flatness, 4),
    }

def detect_ai_voice(waveform, sample_rate: int) -> Dict[str, Any]:
    """Detect if audio is AI-generated / voice-cloned / synthetic speech.
    
    Synthetic speech exhibits:
    - Unnaturally smooth MFCC trajectories (low frame-to-frame variance)
    - Very stable pitch (low jitter)
    - Consistent amplitude envelope (low shimmer)
    """
    import torch
    if not settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED:
        return {"is_synthetic": False, "confidence": 0.0, "skipped": True}

    if waveform.dim() > 1:
        waveform = waveform.mean(dim=0)
    waveform_np = waveform.numpy()

    # 1. MFCC variance analysis
    # Compute simple MFCC-like features using FFT frames
    frame_length = int(0.025 * sample_rate)  # 25ms frames
    hop_length = int(0.010 * sample_rate)    # 10ms hop
    
    frame_energies = []
    spectral_centroids = []
    for start in range(0, len(waveform_np) - frame_length, hop_length):
        frame = waveform_np[start:start + frame_length]
        windowed = frame * np.hanning(len(frame))
        fft_mag = np.abs(np.fft.rfft(windowed))
        
        energy = np.sum(fft_mag ** 2)
        frame_energies.append(energy)
        
        freqs = np.fft.rfftfreq(len(windowed), 1.0 / sample_rate)
        if np.sum(fft_mag) > 0:
            centroid = np.sum(freqs * fft_mag) / np.sum(fft_mag)
            spectral_centroids.append(centroid)

    if len(frame_energies) < 10:
        return {"is_synthetic": False, "confidence": 0.0, "note": "too few frames"}

    # 2. Frame-to-frame variance of spectral centroid (proxy for MFCC smoothness)
    centroid_diffs = np.diff(spectral_centroids)
    centroid_variance = np.var(centroid_diffs)
    
    # 3. Energy variance (proxy for shimmer/amplitude jitter)
    energy_array = np.array(frame_energies)
    energy_array = energy_array / max(np.max(energy_array), 1e-10)
    energy_diffs = np.diff(energy_array)
    energy_variance = np.var(energy_diffs)

    # 4. Zero-crossing rate variance (proxy for pitch stability)
    zcr_per_frame = []
    for start in range(0, len(waveform_np) - frame_length, hop_length):
        frame = waveform_np[start:start + frame_length]
        zcr = np.sum(np.abs(np.diff(np.sign(frame)))) / (2 * len(frame))
        zcr_per_frame.append(zcr)
    zcr_variance = np.var(np.diff(zcr_per_frame)) if len(zcr_per_frame) > 1 else 0.0

    # Heuristic scoring: AI-generated speech is TOO smooth
    synthetic_score = 0.0
    if centroid_variance < 500:
        synthetic_score += 0.4
    elif centroid_variance < 2000:
        synthetic_score += 0.2
    if energy_variance < 0.0001:
        synthetic_score += 0.3
    elif energy_variance < 0.001:
        synthetic_score += 0.15
    if zcr_variance < 0.00001:
        synthetic_score += 0.3
    elif zcr_variance < 0.0001:
        synthetic_score += 0.15

    return {
        "is_synthetic": synthetic_score >= 0.6,
        "confidence": round(synthetic_score, 2),
        "centroid_variance": round(float(centroid_variance), 2),
        "energy_variance": round(float(energy_variance), 6),
        "zcr_variance": round(float(zcr_variance), 8),
    }

_CHALLENGE_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "black", "white", "pink", "brown"]
_CHALLENGE_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "zero"]
_CHALLENGE_OBJECTS = ["window", "apple", "table", "house", "river", "mountain", "garden", "bridge", "castle", "forest"]

def generate_challenge_phrase() -> str:
    """Generate a random 3-word challenge phrase.
    Each request gets a unique phrase so old recordings can't be reused."""
    return f"{random.choice(_CHALLENGE_COLORS)} {random.choice(_CHALLENGE_NUMBERS)} {random.choice(_CHALLENGE_OBJECTS)}"


def verify_challenge_response(audio_path: str, expected_phrase: str) -> Dict[str, Any]:
    """Transcribe audio and check if the spoken words match the expected phrase.
    Uses the existing Faster-Whisper pipeline from audio_service.py."""
    from .audio_service import transcribe_audio
    
    try:
        segments = transcribe_audio(audio_path)
        spoken_text = " ".join(s["text"] for s in segments).strip().lower()
    except Exception as e:
        return {"match": False, "error": f"Transcription failed: {e}", "spoken": ""}

    expected_lower = expected_phrase.lower().strip()
    
    # Fuzzy match — allow minor transcription differences
    from rapidfuzz import fuzz
    similarity = fuzz.token_sort_ratio(spoken_text, expected_lower)
    
    return {
        "match": similarity >= 70,  # 70% token sort ratio threshold
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
    """Enroll a voice sample for a speaker. Multiple samples (3-10) build a
    robust voiceprint. The centroid embedding is upserted to Pinecone once
    enough samples have been collected."""
    from ..models import VoicePrint, VoiceEnrollment

    # Step 1: Extract embedding from audio
    result = extract_voice_embedding(audio_path)
    if "error" in result:
        return {"status": "error", "message": result["error"], "detail": result}

    embedding = result["embedding"]
    speech_duration = result["speech_duration"]
    quality = result.get("quality", {})

    # Step 2: Get or create VoicePrint record
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

    # Step 3: Store individual enrollment sample
    enrollment_id = str(uuid.uuid4())
    enrollment = VoiceEnrollment(
        id=enrollment_id,
        speaker_id=speaker_id,
        embedding=embedding,
        audio_quality_score=quality.get("rms_energy"),
        speech_duration_sec=speech_duration,
    )
    db.add(enrollment)

    # Step 4: Update enrollment count and recompute centroid
    voice_print.enrollment_count = (voice_print.enrollment_count or 0) + 1
    
    # Fetch all embeddings for this speaker to compute centroid
    all_enrollments = (
        db.query(VoiceEnrollment)
        .filter(VoiceEnrollment.speaker_id == speaker_id)
        .all()
    )
    # Include the new one (not yet committed)
    all_embeds = [e.embedding for e in all_enrollments] + [embedding]
    centroid = np.mean(all_embeds, axis=0).tolist()
    voice_print.embedding = centroid

    # Step 5: Activate if enough samples
    if voice_print.enrollment_count >= settings.VOICE_ID_MIN_ENROLLMENT_SAMPLES:
        voice_print.status = "active"

    db.commit()

    # Step 6: Upsert centroid to Pinecone (best-effort)
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
    """Full identification pipeline:
    1. Extract embedding
    2. Pinecone 1:N search
    3. Re-rank top candidates
    4. Threshold + margin check
    5. Anti-spoofing (replay + AI voice)
    6. Challenge phrase verification (optional)
    7. Final decision
    """
    import torch
    import torchaudio
    from ..models import VoicePrint

    # ── Step 1: Extract embedding ──
    result = extract_voice_embedding(audio_path)
    if "error" in result:
        return {"decision": "error", "message": result["error"], "detail": result}

    query_embedding = result["embedding"]

    # ── Step 2: Pinecone 1:N search ──
    try:
        index = get_voice_pinecone_index()
        search_result = call_with_resilience(
            "pinecone_voice_read", index.query,
            vector=query_embedding, top_k=20, include_metadata=True,
            max_attempts=3, base_delay=0.3, max_delay=3.0,
        )
        matches = search_result.get("matches", [])
    except (CircuitOpenError, Exception) as e:
        # Fallback: local SQLite cosine search
        logger.warning("Pinecone voice search failed, falling back to local: %s", e)
        matches = _local_voice_search(query_embedding, db, top_k=20)

    if not matches:
        return {"decision": "unknown", "message": "No enrolled speakers found.", "candidates": []}

    # ── Step 3: Re-rank with precise cosine similarity ──
    candidates = []
    for match in matches:
        metadata = match.get("metadata", {}) if isinstance(match, dict) else getattr(match, "metadata", {})
        score = match.get("score", 0) if isinstance(match, dict) else getattr(match, "score", 0)
        speaker_id = metadata.get("speaker_id", "")
        
        # Optionally recompute score from stored centroid for precision
        vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
        if vp and vp.embedding:
            score = float(_cosine_similarity(query_embedding, vp.embedding))

        candidates.append({
            "speaker_id": speaker_id,
            "speaker_name": metadata.get("speaker_name", ""),
            "score": round(score, 4),
            "status": metadata.get("status", "unknown"),
        })

    # Sort by score descending
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # ── Step 4: Threshold + margin check ──
    top = candidates[0]
    runner_up_score = candidates[1]["score"] if len(candidates) > 1 else 0.0
    margin = top["score"] - runner_up_score

    if top["score"] < settings.VOICE_ID_SIMILARITY_THRESHOLD:
        return {
            "decision": "unknown",
            "message": f"No match above threshold ({settings.VOICE_ID_SIMILARITY_THRESHOLD}).",
            "top_score": top["score"],
            "candidates": candidates[:5],
        }

    if margin < settings.VOICE_ID_MARGIN_THRESHOLD:
        return {
            "decision": "uncertain",
            "message": f"Ambiguous match: margin={margin:.2f} < {settings.VOICE_ID_MARGIN_THRESHOLD}. Retry with clearer audio.",
            "top_score": top["score"],
            "runner_up_score": runner_up_score,
            "margin": round(margin, 4),
            "candidates": candidates[:5],
        }

    # Only proceed with active voiceprints
    if top.get("status") != "active":
        return {
            "decision": "unknown",
            "message": f"Best match '{top['speaker_name']}' is not fully enrolled (status={top['status']}).",
            "candidates": candidates[:5],
        }

    # ── Step 5: Anti-spoofing checks ──
    spoofing_results = {}
    
    # Load audio for anti-spoofing analysis
    from .audio_service import convert_to_wav
    wav_path = convert_to_wav(audio_path)
    waveform, sr = torchaudio.load(wav_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0)
    else:
        waveform = waveform.squeeze(0)

    replay_result = detect_replay(waveform, sr)
    spoofing_results["replay"] = replay_result
    if replay_result.get("is_replay"):
        return {
            "decision": "denied",
            "reason": "replay_detected",
            "message": f"Replay attack detected (confidence={replay_result['confidence']}).",
            "spoofing": spoofing_results,
            "candidate": top,
        }

    ai_result = detect_ai_voice(waveform, sr)
    spoofing_results["ai_voice"] = ai_result
    if ai_result.get("is_synthetic"):
        return {
            "decision": "denied",
            "reason": "synthetic_voice_detected",
            "message": f"AI-generated voice detected (confidence={ai_result['confidence']}).",
            "spoofing": spoofing_results,
            "candidate": top,
        }

    # ── Step 6: Challenge phrase verification (if provided) ──
    challenge_result = None
    if challenge_phrase and settings.VOICE_ID_CHALLENGE_ENABLED:
        challenge_result = verify_challenge_response(audio_path, challenge_phrase)
        if not challenge_result.get("match"):
            return {
                "decision": "denied",
                "reason": "challenge_failed",
                "message": f"Challenge phrase mismatch. Expected '{challenge_phrase}', heard '{challenge_result.get('spoken', '')}'.",
                "challenge": challenge_result,
                "candidate": top,
            }

    # ── Step 7: MATCH ──
    return {
        "decision": "match",
        "speaker_id": top["speaker_id"],
        "speaker_name": top["speaker_name"],
        "confidence": top["score"],
        "margin": round(margin, 4),
        "spoofing": spoofing_results,
        "challenge": challenge_result,
        "candidates": candidates[:5],
    }

def verify_speaker(
    speaker_id: str,
    audio_path: str,
    db,
    challenge_phrase: Optional[str] = None,
) -> Dict[str, Any]:
    """1:1 verification — compare audio against a specific speaker's voiceprint."""
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

    # Anti-spoofing
    from .audio_service import convert_to_wav
    wav_path = convert_to_wav(audio_path)
    waveform, sr = torchaudio.load(wav_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0)
    else:
        waveform = waveform.squeeze(0)

    spoofing = {}
    replay_result = detect_replay(waveform, sr)
    spoofing["replay"] = replay_result
    if replay_result.get("is_replay"):
        return {"decision": "denied", "reason": "replay_detected", "message": "Replay attack detected.", "spoofing": spoofing}

    ai_result = detect_ai_voice(waveform, sr)
    spoofing["ai_voice"] = ai_result
    if ai_result.get("is_synthetic"):
        return {"decision": "denied", "reason": "synthetic_voice_detected", "message": "Synthetic voice detected.", "spoofing": spoofing}

    # Challenge
    challenge_result = None
    if challenge_phrase and settings.VOICE_ID_CHALLENGE_ENABLED:
        challenge_result = verify_challenge_response(audio_path, challenge_phrase)
        if not challenge_result.get("match"):
            return {"decision": "denied", "reason": "challenge_failed", "challenge": challenge_result}

    if score >= settings.VOICE_ID_SIMILARITY_THRESHOLD:
        return {
            "decision": "match",
            "speaker_id": speaker_id,
            "speaker_name": vp.speaker_name,
            "confidence": round(score, 4),
            "spoofing": spoofing,
            "challenge": challenge_result,
        }
    else:
        return {
            "decision": "no_match",
            "speaker_id": speaker_id,
            "confidence": round(score, 4),
            "threshold": settings.VOICE_ID_SIMILARITY_THRESHOLD,
            "message": f"Voice does not match '{vp.speaker_name}' (score={score:.2f} < {settings.VOICE_ID_SIMILARITY_THRESHOLD}).",
            "spoofing": spoofing,
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
