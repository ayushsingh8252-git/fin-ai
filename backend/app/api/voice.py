"""Voice Identification Tool — REST API endpoints.

Backend-only API (no frontend) for speaker enrollment, identification, and
verification using ECAPA-TDNN voice biometrics.  Every endpoint accepts audio
via multipart file upload (WAV/MP3/WebM/OGG/FLAC) and returns JSON results.

Follows the same conventions as the existing api/audio.py and api/fraud.py:
- File validation via audio_service.validate_audio_format
- Temporary file handling in uploads/
- Database sessions via get_db()
"""
from __future__ import annotations

import os
import uuid
import tempfile
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import VoicePrint, VoiceEnrollment

router = APIRouter(tags=["Voice Identification"])

VOICE_UPLOAD_DIR = os.path.join("uploads", "voice")
os.makedirs(VOICE_UPLOAD_DIR, exist_ok=True)


def _save_upload(file: UploadFile) -> str:
    """Save uploaded audio to disk and return the path."""
    ext = os.path.splitext(file.filename or "audio.wav")[1].lower() or ".wav"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(VOICE_UPLOAD_DIR, filename)
    content = file.file.read()
    with open(path, "wb") as f:
        f.write(content)
    return path


def _cleanup(path: str) -> None:
    """Best-effort delete of a temporary upload."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


# ── Enrollment ───────────────────────────────────────────────────────────────

@router.post("/voice/enroll")
def enroll_voice(
    file: UploadFile = File(...),
    speaker_id: str = Form(...),
    speaker_name: str = Form(...),
    email: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload an audio sample to enroll a speaker.  3–10 samples are needed
    to build a robust voiceprint.  The response reports how many samples
    have been recorded and whether the voiceprint is now active."""
    from ..services.voice_identification import enroll_speaker

    path = _save_upload(file)
    try:
        result = enroll_speaker(speaker_id, speaker_name, path, db, email=email)
        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("message", "Enrollment failed"))
        return result
    finally:
        _cleanup(path)


# ── Identification (1:N) ────────────────────────────────────────────────────

@router.post("/voice/identify")
def identify_voice(
    file: UploadFile = File(...),
    challenge_phrase: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload an audio sample to identify the speaker from all enrolled
    voiceprints (1:N search).  Optionally include a challenge_phrase for
    anti-replay verification — the spoken words must match the phrase."""
    from ..services.voice_identification import identify_speaker

    path = _save_upload(file)
    try:
        result = identify_speaker(path, db, challenge_phrase=challenge_phrase)
        return result
    finally:
        _cleanup(path)


# ── Verification (1:1) ──────────────────────────────────────────────────────

@router.post("/voice/verify")
def verify_voice(
    file: UploadFile = File(...),
    speaker_id: str = Form(...),
    challenge_phrase: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload an audio sample and verify it against a specific speaker's
    voiceprint (1:1 comparison).  Optionally include a challenge_phrase."""
    from ..services.voice_identification import verify_speaker

    path = _save_upload(file)
    try:
        result = verify_speaker(speaker_id, path, db, challenge_phrase=challenge_phrase)
        return result
    finally:
        _cleanup(path)


# ── Challenge Phrase ─────────────────────────────────────────────────────────

@router.get("/voice/challenge")
def get_challenge_phrase():
    """Generate a random 3-word challenge phrase for the caller to speak.
    This phrase should be passed back with the audio in /voice/identify or
    /voice/verify as the `challenge_phrase` form field."""
    from ..services.voice_identification import generate_challenge_phrase
    phrase = generate_challenge_phrase()
    return {"challenge_phrase": phrase}


@router.post("/voice/challenge/verify")
def verify_challenge(
    file: UploadFile = File(...),
    speaker_id: str = Form(...),
    expected_phrase: str = Form(...),
    db: Session = Depends(get_db),
):
    """Full challenge-response verification: verify the speaker's identity
    AND check that they spoke the expected challenge phrase."""
    from ..services.voice_identification import verify_speaker

    path = _save_upload(file)
    try:
        result = verify_speaker(speaker_id, path, db, challenge_phrase=expected_phrase)
        return result
    finally:
        _cleanup(path)


# ── Speaker Management ───────────────────────────────────────────────────────

@router.get("/voice/speakers")
def list_speakers(db: Session = Depends(get_db)):
    """List all enrolled speakers with their voiceprint status."""
    speakers = db.query(VoicePrint).order_by(VoicePrint.created_at.desc()).all()
    return {
        "speakers": [
            {
                "speaker_id": s.id,
                "speaker_name": s.speaker_name,
                "email": s.email,
                "enrollment_count": s.enrollment_count,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s in speakers
        ],
        "total": len(speakers),
    }


@router.get("/voice/speakers/{speaker_id}")
def get_speaker(speaker_id: str, db: Session = Depends(get_db)):
    """Get details for a specific enrolled speaker, including enrollment
    sample metadata (but not the raw embeddings — those are large)."""
    vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
    if not vp:
        raise HTTPException(status_code=404, detail=f"Speaker '{speaker_id}' not found.")

    enrollments = (
        db.query(VoiceEnrollment)
        .filter(VoiceEnrollment.speaker_id == speaker_id)
        .order_by(VoiceEnrollment.created_at.asc())
        .all()
    )

    return {
        "speaker_id": vp.id,
        "speaker_name": vp.speaker_name,
        "email": vp.email,
        "enrollment_count": vp.enrollment_count,
        "status": vp.status,
        "embedding_dimensions": len(vp.embedding) if vp.embedding else 0,
        "created_at": vp.created_at.isoformat() if vp.created_at else None,
        "updated_at": vp.updated_at.isoformat() if vp.updated_at else None,
        "enrollments": [
            {
                "enrollment_id": e.id,
                "audio_quality_score": e.audio_quality_score,
                "speech_duration_sec": e.speech_duration_sec,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in enrollments
        ],
    }


@router.delete("/voice/speakers/{speaker_id}")
def delete_speaker(speaker_id: str, db: Session = Depends(get_db)):
    """Remove a speaker and all their enrollment data.  Also removes the
    voiceprint vector from Pinecone."""
    vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
    if not vp:
        raise HTTPException(status_code=404, detail=f"Speaker '{speaker_id}' not found.")

    # Delete enrollments first (FK constraint)
    db.query(VoiceEnrollment).filter(VoiceEnrollment.speaker_id == speaker_id).delete()
    db.delete(vp)
    db.commit()

    # Best-effort Pinecone cleanup
    try:
        from ..services.voice_identification import get_voice_pinecone_index
        from ..services.resilience import call_with_resilience
        index = get_voice_pinecone_index()
        call_with_resilience(
            "pinecone_voice_write", index.delete,
            ids=[f"speaker_{speaker_id}"],
            max_attempts=2, base_delay=0.5, max_delay=2.0,
        )
    except Exception:
        pass  # non-fatal — local DB is the source of truth

    return {"status": "deleted", "speaker_id": speaker_id}
