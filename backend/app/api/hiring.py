import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal, get_db
from ..services.email_service import send_assignment_email
from ..services.hiring_service import (
    generate_assignment,
    match_candidate_to_requirement,
    parse_resume_pdf,
)
from ..services.upload_safety import safe_filename, MAX_UPLOAD_BYTES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hiring", tags=["hiring"])

UPLOAD_DIR = os.path.join("uploads", "hiring")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Same in-process-thread-pool pattern as api/upload.py's _ingestion_executor —
# bulk-send fans out to N real SMTP sends, each with its own retry/backoff
# inside send_assignment_email, so this keeps the triggering request fast
# while the sends happen in the background and the frontend polls for status.
_delivery_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="delivery")


@router.post("/parse-resumes")
async def parse_resumes(files: List[UploadFile] = File(...)):
    """Parses a bulk batch of resume PDFs into structured, ATS-scored candidates."""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    candidates = []
    for file in files:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext != ".pdf":
            candidates.append({
                "filename": file.filename, "status": "failed",
                "reason": "Only PDF resumes are supported.",
            })
            continue

        content = await file.read()
        if not content:
            candidates.append({"filename": file.filename, "status": "failed", "reason": "File is empty."})
            continue
        if len(content) > MAX_UPLOAD_BYTES:
            candidates.append({
                "filename": file.filename, "status": "failed",
                "reason": f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit.",
            })
            continue

        cand_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{cand_id}_{safe_filename(file.filename)}")
        with open(file_path, "wb") as f:
            f.write(content)

        try:
            fields = parse_resume_pdf(file.filename or cand_id, file_path)
        finally:
            # Resumes aren't retained beyond this pipeline run — nothing downstream
            # links back to the file on disk once parsing has produced structured fields.
            try:
                os.remove(file_path)
            except OSError:
                pass

        candidates.append({"id": cand_id, "status": "parsed", **fields})

    return {"candidates": candidates}


class MatchCandidateIn(BaseModel):
    id: str
    name: Optional[str] = None
    experience: Optional[str] = None
    skills: List[str] = []
    summary: Optional[str] = None
    ats_score: Optional[int] = None


class MatchRequest(BaseModel):
    candidates: List[MatchCandidateIn]
    requirement: str
    role_title: str = "the open role"


@router.post("/match")
async def match_requirement(request: MatchRequest):
    """Scores each parsed candidate against an HR-written requirement brief."""
    results = []
    for c in request.candidates:
        match = match_candidate_to_requirement(c.model_dump(), request.requirement, request.role_title)
        results.append({"id": c.id, **match})
    return {"results": results}


class AssignmentRequest(BaseModel):
    requirement: str
    role_title: str = "the open role"


@router.post("/assignment")
async def assignment(request: AssignmentRequest):
    """Drafts a personalized take-home assignment from an HR requirement brief."""
    return generate_assignment(request.requirement, request.role_title)


class BulkSendCandidateIn(BaseModel):
    id: str
    name: str
    email: Optional[str] = None


class AssignmentIn(BaseModel):
    title: str = "Take-Home Assignment"
    duration: str = ""
    requirements: List[str] = []
    submission: str = ""


class BulkSendRequest(BaseModel):
    candidates: List[BulkSendCandidateIn]
    role_title: str = "the open role"
    assignment: AssignmentIn


def _process_delivery(delivery_id: str, candidate_name: str, email: Optional[str], role_title: str, assignment_dict: dict) -> None:
    """Runs off the request thread (see _delivery_executor above). Every
    branch here ends in a real, persisted status — PENDING never silently
    becomes SENT without send_assignment_email() actually having returned
    ok=True."""
    db = SessionLocal()
    try:
        row = db.get(models.CandidateDeliveryStatus, delivery_id)
        if not row:
            return
        row.status = "SENDING"
        row.attempts = (row.attempts or 0) + 1
        db.commit()

        if not email:
            row.status = "FAILED"
            row.error_message = "No email address was extracted from this candidate's resume — nothing to send to."
            db.commit()
            return

        try:
            ok, error = send_assignment_email(email, candidate_name, role_title, assignment_dict)
        except Exception as e:
            ok, error = False, f"Unexpected error while sending: {e}"

        row.status = "SENT" if ok else "FAILED"
        row.error_message = None if ok else error
        db.commit()
    except Exception as e:
        logger.error("[hiring] delivery %s crashed: %s", delivery_id, e)
        try:
            row = db.get(models.CandidateDeliveryStatus, delivery_id)
            if row:
                row.status = "FAILED"
                row.error_message = f"Unexpected error: {e}"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/bulk-send")
def bulk_send_assignment(request: BulkSendRequest, db: Session = Depends(get_db)):
    """Real replacement for the old client-side 'Bulk Send Assignment'
    animation: creates one PENDING CandidateDeliveryStatus row per candidate,
    dispatches a real SMTP send for each (with its own retry/backoff), and
    returns immediately with the ids to poll via GET /bulk-send/status."""
    if not request.candidates:
        raise HTTPException(status_code=400, detail="No candidates provided.")

    delivery_ids: Dict[str, str] = {}
    for c in request.candidates:
        row = models.CandidateDeliveryStatus(
            id=str(uuid.uuid4()),
            candidate_id=c.id,
            candidate_name=c.name,
            email=c.email,
            role_title=request.role_title,
            status="PENDING",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        delivery_ids[c.id] = row.id
        _delivery_executor.submit(
            _process_delivery, row.id, c.name, c.email, request.role_title, request.assignment.model_dump()
        )

    return {"delivery_ids": delivery_ids}


@router.get("/bulk-send/status")
def bulk_send_status(candidate_ids: str, db: Session = Depends(get_db)):
    """Real per-candidate delivery status — the frontend polls this instead
    of animating a foregone 'Delivered ✓' conclusion. `candidate_ids` is a
    comma-separated list of the hiring-automation candidate ids."""
    ids = [i for i in candidate_ids.split(",") if i]
    if not ids:
        return {"statuses": []}

    rows = (
        db.query(models.CandidateDeliveryStatus)
        .filter(models.CandidateDeliveryStatus.candidate_id.in_(ids))
        .order_by(models.CandidateDeliveryStatus.created_at.desc())
        .all()
    )
    latest: Dict[str, models.CandidateDeliveryStatus] = {}
    for r in rows:
        latest.setdefault(r.candidate_id, r)  # first hit per id = most recent, given the DESC order above

    return {
        "statuses": [
            {
                "candidate_id": cid,
                "delivery_id": r.id,
                "status": r.status,
                "error": r.error_message,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for cid, r in latest.items()
        ]
    }


@router.post("/bulk-send/{delivery_id}/mark-replied")
def mark_replied(delivery_id: str, db: Session = Depends(get_db)):
    """There is no inbound-email/IMAP integration in this codebase to detect
    a candidate's reply automatically — this endpoint exists so a recruiter
    who has actually seen a reply in their own inbox can record that real
    fact, rather than the UI ever inferring or fabricating it."""
    row = db.get(models.CandidateDeliveryStatus, delivery_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"No delivery record with id {delivery_id!r}.")
    if row.status != "SENT":
        raise HTTPException(status_code=400, detail=f"Cannot mark replied — current status is {row.status!r}, not SENT.")
    row.status = "REPLIED"
    db.commit()
    return {"candidate_id": row.candidate_id, "status": row.status}
