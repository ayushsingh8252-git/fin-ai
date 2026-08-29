import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..database import get_db
from ..memory import global_memory, orchestrator
from ..services import sarvam_service
from ..services.hiring_service import match_candidate_to_requirement, parse_resume_pdf
from ..services.telephonic_service import generate_call_evaluation, generate_call_turn
from ..services.guardrails import check_output

router = APIRouter(prefix="/telephonic", tags=["telephonic"])

MAX_TURNS = 4

RESUME_UPLOAD_DIR = os.path.join("uploads", "telephonic")
os.makedirs(RESUME_UPLOAD_DIR, exist_ok=True)


def _serialize(record: models.CallRecord) -> dict:
    return {
        "id": record.id,
        "call_sid": record.call_sid,
        "to_number": record.to_number,
        "candidate_name": record.candidate_name,
        "role_title": record.role_title,
        "status": record.status,
        "transcript": record.transcript or [],
        "duration_sec": record.duration_sec,
        "error_message": record.error_message,
        "communication_score": record.communication_score,
        "relevance_score": record.relevance_score,
        "confidence_score": record.confidence_score,
        "evaluation_summary": record.evaluation_summary,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _dial(to: str, candidate_name: str, role_title: str, variables: Dict[str, Any], db: Session) -> dict:
    """Creates the CallRecord and places the outbound Sarvam call with the
    given agent_variables. Shared by /call (manually supplied or
    ScreeningResult-autofilled variables) and /call-with-resume (variables
    extracted straight from an uploaded resume)."""
    if not settings.PUBLIC_BASE_URL:
        raise HTTPException(
            status_code=503,
            detail=(
                "PUBLIC_BASE_URL isn't set — Sarvam needs a public HTTPS URL to post the call "
                "result back to. Set it to an ngrok URL (dev) or this backend's deployed URL."
            ),
        )

    candidate_name = (candidate_name or "there").strip() or "there"
    role_title = (role_title or "the open role").strip() or "the open role"

    # Shared/global memory: same convention as api/screening.py — every real
    # call that names a role grows the Role table from actual usage.
    global_memory.upsert_role(role_title)

    record = models.CallRecord(
        id=str(uuid.uuid4()),
        to_number=to,
        candidate_name=candidate_name,
        role_title=role_title,
        status="queued",
        transcript=[],
    )
    db.add(record)
    db.commit()

    base = settings.PUBLIC_BASE_URL.rstrip("/")
    webhook_url = f"{base}/api/v1/telephonic/sarvam/webhook?call_record_id={record.id}"
    agent_variables = sarvam_service.build_agent_variables({
        **variables,
        "candidate_name": candidate_name,
        "role_applied_for": role_title,
    })

    # Same opening line generator the agent uses turn-by-turn on other call
    # flows in this codebase, so the persona/greeting stays consistent.
    opening = generate_call_turn([], candidate_name, role_title, MAX_TURNS)
    opening_line = check_output(opening.get("question", "")).text

    try:
        response = sarvam_service.place_outbound_call(
            to_number=to,
            agent_variables=agent_variables,
            webhook_url=webhook_url,
            lead_id=record.id,
            initial_bot_message=opening_line,
        )
    except sarvam_service.SarvamConfigError as e:
        record.status = "failed"
        record.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=503, detail=str(e))
    except sarvam_service.SarvamCallError as e:
        record.status = "failed"
        record.error_message = e.detail
        db.commit()
        raise HTTPException(status_code=502, detail=f"Sarvam rejected the call: {e.detail}")
    except Exception as e:
        record.status = "failed"
        record.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Could not reach Sarvam: {e}")

    record.call_sid = sarvam_service.extract_call_id(response)
    record.status = "queued"
    record.transcript = [{"role": "agent", "text": opening_line}]
    db.commit()

    # Orchestration layer: register the candidate<->role relationship up front.
    # Sarvam owns the live turn-by-turn exchange itself, so record_turn isn't
    # called again until the webhook delivers the finished transcript in one
    # shot (see sarvam_webhook below).
    orchestrator.start_session("telephonic", record.to_number, record.role_title, session_id=record.id)
    orchestrator.record_turn(record.id, question=opening_line)

    return _serialize(record)


class PlaceCallRequest(BaseModel):
    to: str
    candidate_name: str = "there"
    role_title: str = "the open role"
    # Sarvam agent_variables overrides — auto-filled from the candidate's most
    # recent ScreeningResult when omitted (see _autofill_sarvam_variables),
    # but a caller that already has this data (the hiring pipeline, an MCP
    # tool call) can pass it directly. To fill these from an uploaded resume
    # instead, use POST /call-with-resume.
    gender: Optional[str] = None
    resume_summary: Optional[str] = None
    job_requirements: Optional[str] = None
    candidate_strengths: Optional[str] = None
    candidate_weaknesses: Optional[str] = None
    interview_summary: Optional[str] = None
    notable_answers: Optional[str] = None
    screening_disposition: Optional[str] = None


def _autofill_sarvam_variables(payload: PlaceCallRequest, db: Session) -> Dict[str, Any]:
    """Best-effort fill of Sarvam's agent_variables from the candidate's most
    recent ScreeningResult (telephonic or interview screen) and the role's
    stored JD, for any field the caller hasn't already supplied explicitly."""
    result = None
    if not all([
        payload.candidate_strengths, payload.candidate_weaknesses,
        payload.interview_summary, payload.screening_disposition, payload.job_requirements,
    ]):
        result = (
            db.query(models.ScreeningResult)
            .filter(models.ScreeningResult.candidate_name == payload.candidate_name)
            .order_by(models.ScreeningResult.created_at.desc())
            .first()
        )
    role = db.query(models.Role).filter(models.Role.title == payload.role_title).first()

    return {
        "gender": payload.gender,
        "resume_summary": payload.resume_summary,
        "job_requirements": payload.job_requirements or (result.jd_text_used if result else None) or (role.jd_text if role else None),
        "candidate_strengths": payload.candidate_strengths or (", ".join(result.strengths) if result and result.strengths else None),
        "candidate_weaknesses": payload.candidate_weaknesses or (", ".join(result.gaps) if result and result.gaps else None),
        "interview_summary": payload.interview_summary or (result.summary if result else None),
        "screening_disposition": payload.screening_disposition or (result.verdict if result else None),
        "notable_answers": payload.notable_answers,
    }


@router.post("/call")
def place_call(payload: PlaceCallRequest, db: Session = Depends(get_db)):
    variables = _autofill_sarvam_variables(payload, db)
    return _dial(payload.to, payload.candidate_name, payload.role_title, variables, db)


@router.post("/call-with-resume")
async def call_with_resume(
    file: UploadFile = File(...),
    to: str = Form(...),
    candidate_name: Optional[str] = Form(None),
    role_title: str = Form("the open role"),
    job_requirement: Optional[str] = Form(None),
    gender: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Places a Sarvam screening call whose agent_variables are extracted
    straight from an uploaded resume, reusing the same resume-parsing and
    requirement-matching tools the Agentic Hiring Pipeline already uses
    (services/hiring_service.py's parse_resume_pdf / match_candidate_to_requirement)
    rather than a separate extraction pipeline for this agent."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    cand_id = str(uuid.uuid4())
    file_path = os.path.join(RESUME_UPLOAD_DIR, f"{cand_id}_{file.filename}")
    with open(file_path, "wb") as f:
        f.write(content)
    try:
        fields = parse_resume_pdf(file.filename or cand_id, file_path)
    finally:
        # Same convention as api/hiring.py's parse_resumes — the resume isn't
        # retained beyond this pipeline run.
        try:
            os.remove(file_path)
        except OSError:
            pass

    requirement = job_requirement
    if not requirement:
        role = db.query(models.Role).filter(models.Role.title == role_title).first()
        requirement = role.jd_text if role else None

    match = match_candidate_to_requirement(fields, requirement, role_title) if requirement else None

    matched_skills = ", ".join(match.get("matched_skills") or []) if match else ""
    strengths = matched_skills or ", ".join(fields.get("skills") or [])
    weaknesses = ", ".join(match.get("missing_skills") or []) if match else None

    variables = {
        "gender": gender,
        "resume_summary": fields.get("summary"),
        "job_requirements": requirement,
        "candidate_strengths": strengths or None,
        "candidate_weaknesses": weaknesses,
        "screening_disposition": match.get("recommendation") if match else None,
    }

    resolved_name = (candidate_name or fields.get("name") or "there").strip() or "there"
    result = _dial(to, resolved_name, role_title, variables, db)
    return {
        **result,
        "resume_extraction": {
            "name": fields.get("name"),
            "email": fields.get("email"),
            "phone": fields.get("phone"),
            "experience": fields.get("experience"),
            "skills": fields.get("skills"),
            "ats_score": fields.get("ats_score"),
            "match": match,
        },
    }


@router.get("/calls")
def list_calls(db: Session = Depends(get_db)):
    records = db.query(models.CallRecord).order_by(models.CallRecord.created_at.desc()).limit(50).all()
    return [_serialize(r) for r in records]


@router.get("/calls/{call_id}")
def get_call(call_id: str, db: Session = Depends(get_db)):
    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Call not found")
    return _serialize(record)


_SARVAM_STATUS_MAP = {
    "initiated": "initiated",
    "queued": "queued",
    "ringing": "ringing",
    "in_progress": "in-progress",
    "in-progress": "in-progress",
    "answered": "in-progress",
    "completed": "completed",
    "success": "completed",
    "ended": "completed",
    "no_answer": "no-answer",
    "no-answer": "no-answer",
    "not_answered": "no-answer",
    "unanswered": "no-answer",
    "busy": "busy",
    "failed": "failed",
    "error": "failed",
    "canceled": "canceled",
    "cancelled": "canceled",
}
_SARVAM_TERMINAL_STATUSES = ("completed", "no-answer", "busy", "failed", "canceled")


def _normalize_sarvam_status(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    return _SARVAM_STATUS_MAP.get(str(raw).strip().lower(), str(raw).strip().lower())


def _normalize_sarvam_transcript(raw: Any) -> List[dict]:
    """Sarvam's outbound webhook doesn't have a documented transcript shape
    available here, so this normalizes defensively across the field names
    conversational-voice webhooks commonly use rather than assuming one exact
    shape. If the real payload uses different keys, this is the place to
    adjust once an actual webhook has been observed."""
    if not isinstance(raw, list):
        return []
    turns = []
    for turn in raw:
        if not isinstance(turn, dict):
            continue
        speaker = str(turn.get("role") or turn.get("speaker") or turn.get("from") or "").strip().lower()
        role = "agent" if speaker in ("agent", "bot", "assistant", "ai") else "candidate"
        text = str(turn.get("text") or turn.get("message") or turn.get("content") or "").strip()
        if text:
            turns.append({"role": role, "text": text})
    return turns


@router.post("/sarvam/webhook")
async def sarvam_webhook(call_record_id: str, request: Request, db: Session = Depends(get_db)):
    """Sarvam's outbound-call result callback (webhook_config.url passed in
    place_outbound_call above, metadata.lead_id carries call_record_id as a
    backup). Scores the transcript once the call ends and closes the
    orchestrator session — Sarvam delivers the whole call in one shot at the
    end rather than turn-by-turn, so there's nothing analogous to per-turn
    webhooks for this provider."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}

    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_record_id).first()
    if not record:
        lead_id = (body.get("metadata") or {}).get("lead_id")
        if lead_id:
            record = db.query(models.CallRecord).filter(models.CallRecord.id == lead_id).first()
    if not record:
        return Response(status_code=204)

    raw_status = body.get("status") or body.get("call_status") or body.get("event")
    status = _normalize_sarvam_status(raw_status) or record.status
    record.status = status

    duration = body.get("duration_sec") or body.get("call_duration") or body.get("duration")
    try:
        if duration is not None:
            record.duration_sec = int(duration)
    except (TypeError, ValueError):
        pass

    transcript = _normalize_sarvam_transcript(body.get("transcript") or body.get("messages"))
    if transcript:
        record.transcript = transcript

    error_message = body.get("error") or body.get("error_message")
    if error_message:
        record.error_message = str(error_message)

    db.commit()

    terminal = status in _SARVAM_TERMINAL_STATUSES
    if terminal and record.communication_score is None:
        current_transcript = record.transcript or []
        if any(t.get("role") == "candidate" for t in current_transcript):
            evaluation = generate_call_evaluation(current_transcript, record.role_title)
            record.communication_score = evaluation.get("communication_score")
            record.relevance_score = evaluation.get("relevance_score")
            record.confidence_score = evaluation.get("confidence_score")
            record.evaluation_summary = evaluation.get("summary")
            db.commit()

    if terminal:
        orchestrator.end_session(
            record.id,
            scores={
                "communication_score": record.communication_score,
                "relevance_score": record.relevance_score,
                "confidence_score": record.confidence_score,
            },
            summary=record.evaluation_summary,
            transcript_override=record.transcript or [],
        )

    return Response(status_code=204)
