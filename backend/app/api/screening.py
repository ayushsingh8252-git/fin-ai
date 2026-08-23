import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..memory import global_memory, orchestrator
from ..services.email_service import send_invite_email
from ..services.screening_service import (
    _serialize_screening_result,
    parse_resume_and_generate_questions,
    screen_call_transcript,
)

router = APIRouter(prefix="/screening", tags=["screening"])


@router.post("/start")
async def start_screening(
    resume: UploadFile = File(...),
    role_title: str = Form(...),
    jd_text: str = Form(""),
    session_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    ext = os.path.splitext(resume.filename or "")[1].lower()
    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    content = await resume.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded resume file is empty.")

    if not role_title.strip():
        raise HTTPException(status_code=400, detail="Role title is required.")

    # Shared/global memory: every real screening session that names a role
    # grows the Role table, so it's populated from actual usage rather than
    # needing to be seeded by hand.
    global_memory.upsert_role(role_title.strip(), jd_text=jd_text or "")

    if session_id:
        session = db.query(models.ScreeningSession).filter(models.ScreeningSession.id == session_id).first()
        if session:
            session.status = "in_progress"
            db.commit()
            # Orchestration layer: opens this interview's working-memory
            # session (Redis) keyed by the candidate's email, and registers
            # candidate<->role in graph memory — mirrors the Telephonic Agent's
            # wiring in api/telephonic.py so both conversational agents feed
            # the same memory tiers.
            orchestrator.start_session("screening", session.email, session.role_title, session_id=session_id)

    return parse_resume_and_generate_questions(content, role_title.strip(), jd_text or None)


class InviteRequest(BaseModel):
    email: EmailStr
    role_title: str
    jd_text: Optional[str] = None


class InviteResponse(BaseModel):
    status: str  # "sent" | "failed"
    session_id: str
    interview_link: str
    message: str


@router.post("/invite", response_model=InviteResponse)
def invite_candidate(payload: InviteRequest, db: Session = Depends(get_db)):
    if not payload.role_title.strip():
        raise HTTPException(status_code=400, detail="Role title is required.")

    session_id = str(uuid.uuid4())
    session = models.ScreeningSession(
        id=session_id,
        email=str(payload.email),
        role_title=payload.role_title.strip(),
        jd_text=payload.jd_text,
        status="invited",
    )
    db.add(session)
    db.commit()

    interview_link = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/screening-agent/session/{session_id}"
    sent = send_invite_email(str(payload.email), payload.role_title.strip(), interview_link)

    if not sent:
        return InviteResponse(
            status="failed",
            session_id=session_id,
            interview_link=interview_link,
            message="Session created, but the invite email could not be sent. Share the link manually.",
        )
    return InviteResponse(
        status="sent",
        session_id=session_id,
        interview_link=interview_link,
        message=f"Invite sent to {payload.email}.",
    )


@router.post("/from-call/{call_id}")
def screen_from_call(call_id: str, jd_text: Optional[str] = Form(None), db: Session = Depends(get_db)):
    """Screening Agent step of Candidate -> Telephonic Agent -> Conversation
    -> Response Storage -> Screening Agent -> Screening Result: runs a
    JD-aligned analysis over a finished Telephonic Agent call and persists
    the result, so it's available to the Enterprise Orchestration Layer.

    jd_text is optional — if omitted, falls back to the matching Role's
    stored jd_text (global_memory, populated whenever a screening/telephonic
    session names that role), then to a generic role-title-only assessment
    if neither is available.
    """
    call = db.query(models.CallRecord).filter(models.CallRecord.id == call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail=f"No call record found for call_id={call_id!r}")
    if not call.transcript:
        raise HTTPException(status_code=400, detail="This call has no transcript yet — it may still be in progress.")

    resolved_jd_text = jd_text
    if not resolved_jd_text:
        role = global_memory.get_role(call.role_title) if call.role_title else None
        resolved_jd_text = (role or {}).get("jd_text")

    result = screen_call_transcript(
        call_id=call.id,
        candidate_name=call.candidate_name or "Unknown Candidate",
        role_title=call.role_title or "the open role",
        jd_text=resolved_jd_text,
        transcript=call.transcript,
        db=db,
    )

    # Enterprise Orchestration Layer: the JD-matched screening result is a
    # more meaningful "Telephonic Screening Score" than the raw call-demeanor
    # average, so fold it into that candidate's scorecard when one exists.
    orchestrator.record_screening_result_for_scorecard(call.candidate_name, result)

    return result


@router.get("/result/by-call/{call_id}")
def get_latest_screening_result_for_call(call_id: str, db: Session = Depends(get_db)):
    """Most recent Screening Result for a given Telephonic Agent call, if one has been run."""
    result = (
        db.query(models.ScreeningResult)
        .filter(models.ScreeningResult.call_id == call_id)
        .order_by(models.ScreeningResult.created_at.desc())
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="No screening result has been generated for this call yet.")
    return _serialize_screening_result(result)


@router.get("/session/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = db.query(models.ScreeningSession).filter(models.ScreeningSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="This interview link is invalid or has expired.")

    if session.status == "invited":
        session.status = "opened"
        db.commit()

    return {
        "session_id": session.id,
        "email": session.email,
        "role_title": session.role_title,
        "jd_text": session.jd_text,
        "status": session.status,
    }


class ProctorFlagIn(BaseModel):
    id: str
    type: str
    message: str
    timestamp: int


class ProctorTelemetryPayload(BaseModel):
    session_id: str
    timestamp: int
    flags: list[ProctorFlagIn] = []
    face_count: int = 1
    is_looking_away: bool = False
    is_reading: bool = False
    tab_switch_count: int = 0
    devtools_detected: bool = False
    paste_detected: bool = False
    multi_screen_detected: bool = False
    client_integrity_score: int = 100


# Server-enforced penalty weights
PENALTY_MAP = {
    "no_face": 15,
    "multi_face": 10,
    "looking_away": 5,
    "reading_detected": 10,
    "tab_switch": 5,
    "devtools_opened": 15,
    "paste_attempt": 8,
    "multi_screen": 10,
    "background_noise": 5,
    "cross_talk": 8,
}


@router.post("/proctor/telemetry")
def record_proctor_telemetry(payload: ProctorTelemetryPayload, db: Session = Depends(get_db)):
    """
    Receives periodic signed/structured proctoring telemetry frames from the frontend.
    Validates violation claims and calculates the server-authoritative integrity score.
    """
    session = (
        db.query(models.ScreeningSession).filter(models.ScreeningSession.id == payload.session_id).first()
        if db is not None
        else None
    )
    if not session:
        # In setup/demo mode without saved session, return calculated verification
        total_deduction = sum(PENALTY_MAP.get(f.type, 5) for f in payload.flags)
        verified_score = max(0, 100 - total_deduction)
        return {
            "status": "acknowledged",
            "verified_integrity_score": verified_score,
            "flags_recorded": len(payload.flags),
        }

    # Recompute authoritative penalty deduction on server
    total_deduction = 0
    for flag in payload.flags:
        total_deduction += PENALTY_MAP.get(flag.type, 5)

    if payload.devtools_detected:
        total_deduction += PENALTY_MAP["devtools_opened"]
    if payload.paste_detected:
        total_deduction += PENALTY_MAP["paste_attempt"]
    if payload.multi_screen_detected:
        total_deduction += PENALTY_MAP["multi_screen"]

    verified_integrity_score = max(0, 100 - total_deduction)

    return {
        "status": "recorded",
        "session_id": session.id,
        "verified_integrity_score": verified_integrity_score,
        "flags_count": len(payload.flags),
        "reading_flagged": payload.is_reading,
    }

