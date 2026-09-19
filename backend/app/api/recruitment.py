"""HR Recruitment Panel API.

A thin composition layer. Nothing here parses a resume, scores a candidate or
decides authorization: resume/JD AI is services/hiring_service.py (called from
the Celery task), and every "may this user see/do this" question is answered
by services/recruitment_service.py, so there is exactly one place to audit.

Mounted behind the auth guard in main.py. Each endpoint additionally scopes
by role and, for hiring managers and interviewers, by job/candidate ownership.
"""
import logging
import os
import uuid
from datetime import timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..models import Application, Candidate, CandidateActivity, ResumeBatch, ResumeUpload, Role, User
from ..rate_limit import limiter
from ..services import recruitment_service as rs
from ..services.upload_safety import MAX_UPLOAD_BYTES, safe_filename
from .deps import get_current_user, require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recruitment", tags=["recruitment"])

RESUME_DIR = os.path.join("uploads", "resumes")
os.makedirs(RESUME_DIR, exist_ok=True)

MAX_FILES_PER_REQUEST = 100  # bigger batches are sent as several requests sharing one batch_id
MAX_SKILLS = 50


# ── Schemas ──────────────────────────────────────────────────────────────

def _skills_list(value: Optional[List[str]]) -> Optional[List[str]]:
    if value is None:
        return None
    if len(value) > MAX_SKILLS:
        raise ValueError(f"At most {MAX_SKILLS} skills.")
    cleaned = [s.strip() for s in value if isinstance(s, str) and s.strip()]
    if any(len(s) > 60 for s in cleaned):
        raise ValueError("A skill name is too long.")
    return cleaned


class JobIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    department: Optional[str] = Field(None, max_length=120)
    location: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=20000)
    jd_text: Optional[str] = Field(None, max_length=20000)
    min_experience_years: Optional[float] = Field(None, ge=0, le=60)
    must_have_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None
    status: Optional[str] = Field(None, pattern="^(open|draft|closed)$")

    _v_must = field_validator("must_have_skills")(_skills_list)
    _v_pref = field_validator("preferred_skills")(_skills_list)


class JobPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    department: Optional[str] = Field(None, max_length=120)
    location: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=20000)
    jd_text: Optional[str] = Field(None, max_length=20000)
    min_experience_years: Optional[float] = Field(None, ge=0, le=60)
    must_have_skills: Optional[List[str]] = None
    preferred_skills: Optional[List[str]] = None
    status: Optional[str] = Field(None, pattern="^(open|draft|closed)$")
    # Reassigning ownership is what lets a recruiter hand a job to the hiring
    # manager who should see it. hr_admin only.
    owner_user_id: Optional[str] = None

    _v_must = field_validator("must_have_skills")(_skills_list)
    _v_pref = field_validator("preferred_skills")(_skills_list)


class StageIn(BaseModel):
    stage: str
    reason: Optional[str] = Field(None, max_length=500)


class UserRoleIn(BaseModel):
    role: str


# ── Serializers ──────────────────────────────────────────────────────────

def _iso(dt) -> Optional[str]:
    """ISO-8601 in UTC, always with an explicit offset. SQLite hands back
    naive datetimes (they are stored as UTC); serialized as-is, a browser would
    read "2026-09-19T10:00:00" as the viewer's LOCAL time and every age or
    timestamp shown would be off by their timezone offset."""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _job_out(job: Role, pipeline: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    pipeline = pipeline or {}
    return {
        "id": job.id, "title": job.title, "department": job.department, "location": job.location,
        "description": job.description, "jd_text": job.jd_text,
        "min_experience_years": job.min_experience_years,
        "must_have_skills": job.must_have_skills or [], "preferred_skills": job.preferred_skills or [],
        "status": job.status, "created_by": job.created_by, "created_at": _iso(job.created_at),
        "pipeline": pipeline, "total_candidates": sum(pipeline.values()),
    }


def _candidate_out(c: Candidate, user: User) -> Dict[str, Any]:
    # Interviewers evaluate skills and experience; they have no need for
    # contact details, so those are withheld from that role entirely.
    contact_visible = user.role != models.INTERVIEWER
    return {
        "id": c.id, "name": c.name,
        "email": c.email if contact_visible else None,
        "phone": c.phone if contact_visible else None,
        "location": c.location, "current_role": c.current_role,
        "experience_text": c.experience_text, "experience_years": c.experience_years,
        "skills": (c.skills or [])[:12], "has_resume": bool(c.resume_file_path),
    }


def _application_out(app: Application, cand: Candidate, user: User) -> Dict[str, Any]:
    match = rs.score_view(app, "match_score")
    return {
        "id": app.id, "job_id": app.job_id, "stage": app.stage,
        "candidate": _candidate_out(cand, user),
        "scores": {k: rs.score_view(app, k) for k in ("ats_score", "match_score", "skill_match_score")},
        # A recommendation is only meaningful alongside a match score that exists.
        "recommendation": app.recommendation if match["value"] is not None else None,
        "analysis_status": app.analysis_status, "analysis_error": app.analysis_error,
        "created_at": _iso(app.created_at),
    }


def _upload_out(u: ResumeUpload) -> Dict[str, Any]:
    return {
        "id": u.id, "filename": u.original_filename, "status": u.status, "error": u.error,
        "candidate_id": u.candidate_id, "application_id": u.application_id, "attempts": u.attempts,
        "retryable": u.status == "failed" and bool(u.stored_path) and os.path.isfile(u.stored_path),
    }


# ── Identity & user management ───────────────────────────────────────────

@router.get("/me")
def me(user: User = Depends(get_current_user)):
    """The caller's role and permissions, read from the database, so the UI
    can hide what they cannot do without trusting a token claim."""
    return {
        "id": user.id, "email": user.email, "name": user.name,
        "role": user.role, "permissions": rs.permissions_for(user),
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db), user: User = Depends(require_role(models.HR_ADMIN))):
    rows = db.query(User).order_by(User.created_at).all()
    return {"users": [{"id": u.id, "email": u.email, "name": u.name, "role": u.role} for u in rows]}


@router.patch("/users/{user_id}/role")
def set_user_role(
    user_id: str, body: UserRoleIn, db: Session = Depends(get_db),
    admin: User = Depends(require_role(models.HR_ADMIN)),
):
    if body.role not in models.USER_ROLES:
        raise HTTPException(status_code=422, detail=f"Role must be one of: {', '.join(models.USER_ROLES)}.")
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.role == models.HR_ADMIN and body.role != models.HR_ADMIN:
        admins = db.query(func.count(User.id)).filter(User.role == models.HR_ADMIN).scalar()
        if admins <= 1:
            raise HTTPException(status_code=409, detail="There must always be at least one HR admin.")
    previous, target.role = target.role, body.role
    db.commit()
    logger.info("[recruitment] %s changed role of %s: %s -> %s", admin.email, target.email, previous, body.role)
    return {"id": target.id, "email": target.email, "role": target.role}


# ── Jobs ─────────────────────────────────────────────────────────────────

@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rs.require_permission(user, rs.ACTION_VIEW)
    # Unowned rows are roles the Screening/Telephonic agents auto-created from
    # usage; they only become jobs once someone claims one via create_job().
    jobs = (
        db.query(Role)
        .filter(rs.visible_jobs_filter(user), Role.created_by.isnot(None))
        .order_by(Role.created_at.desc(), Role.title)
        .all()
    )
    counts = rs.pipeline_counts(db, user, [j.id for j in jobs])
    return {"jobs": [_job_out(j, counts.get(j.id)) for j in jobs]}


@router.post("/jobs", status_code=201)
def create_job(body: JobIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = rs.create_job(db, user, body.model_dump())
    return _job_out(job, {})


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = rs.get_job_for_user(db, user, job_id, rs.ACTION_VIEW)
    return _job_out(job, rs.pipeline_counts(db, user, [job.id]).get(job.id))


@router.patch("/jobs/{job_id}")
def update_job(job_id: str, body: JobPatch, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    job = rs.get_job_for_user(db, user, job_id, rs.ACTION_EDIT_JOB)
    changes = body.model_dump(exclude_unset=True)

    owner_id = changes.pop("owner_user_id", None)
    if owner_id is not None:
        rs.require_permission(user, rs.ACTION_MANAGE_USERS)
        if db.get(User, owner_id) is None:
            raise HTTPException(status_code=422, detail="That user does not exist.")
        job.created_by = owner_id

    for field in ("must_have_skills", "preferred_skills"):
        if field in changes:
            changes[field] = changes[field] or []
    for field, value in changes.items():
        setattr(job, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A job with this title already exists.")
    db.refresh(job)
    return _job_out(job, rs.pipeline_counts(db, user, [job.id]).get(job.id))


# ── Resume upload ────────────────────────────────────────────────────────

def _looks_like_pdf(content: bytes) -> bool:
    # The spec allows the header anywhere in the first 1024 bytes. This is a
    # content check, so a renamed .exe cannot pass on its extension alone.
    return b"%PDF-" in content[:1024]


def _dispatch(db: Session, upload: ResumeUpload) -> bool:
    """Queue processing for one upload. On a broker failure the row is marked
    failed with the real reason: never left looking queued for work that was
    not actually queued (same convention as api/upload.py)."""
    from ..worker import process_resume_task

    try:
        result = process_resume_task.delay(upload.id)
        upload.task_id = result.id
        db.commit()
        return True
    except Exception as exc:
        logger.error("[recruitment] upload %s could not be queued: %s", upload.id, exc)
        upload.status = "failed"
        upload.error = f"Could not queue for processing: the task queue is unavailable. ({exc})"
        db.commit()
        return False


@router.post("/jobs/{job_id}/resumes")
@limiter.limit("30/minute")
async def upload_resumes(
    request: Request,
    job_id: str,
    files: List[UploadFile] = File(...),
    batch_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Accept resumes for a job and queue them for processing. Returns as soon
    as the files are stored and queued; nothing is parsed in this request.

    Pass the returned batch_id back to add more files to the same batch, which
    is how a large batch is sent in several requests (nginx caps one request
    body at 25MB)."""
    job = rs.get_job_for_user(db, user, job_id, rs.ACTION_UPLOAD)
    if job.status == "closed":
        raise HTTPException(status_code=409, detail="This job is closed and no longer accepts resumes.")
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=413,
            detail=f"Send at most {MAX_FILES_PER_REQUEST} files per request; use the returned batch_id to add more.",
        )

    if batch_id:
        batch = db.query(ResumeBatch).filter(ResumeBatch.id == batch_id, ResumeBatch.job_id == job.id).first()
        if batch is None:
            raise HTTPException(status_code=404, detail="Batch not found for this job.")
    else:
        batch = ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, uploaded_by=user.id, total_files=0)
        db.add(batch)
        db.flush()

    rows: List[ResumeUpload] = []
    for f in files:
        upload_id = str(uuid.uuid4())
        name = safe_filename(f.filename)
        reason, stored = None, None

        if os.path.splitext(name)[1].lower() != ".pdf":
            reason = "Only PDF resumes are supported."
        else:
            content = await f.read()
            if not content:
                reason = "The file is empty."
            elif len(content) > MAX_UPLOAD_BYTES:
                reason = f"The file exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit."
            elif not _looks_like_pdf(content):
                reason = "This file is not a valid PDF."
            else:
                stored = os.path.join(RESUME_DIR, f"{upload_id}_{name}")
                with open(stored, "wb") as out:
                    out.write(content)

        rows.append(ResumeUpload(
            id=upload_id, batch_id=batch.id, job_id=job.id, original_filename=name, stored_path=stored,
            status="failed" if reason else "queued", error=reason,
        ))
    db.add_all(rows)
    batch.total_files = (batch.total_files or 0) + len(rows)
    db.commit()

    # If the broker is down the first .delay() burns its connect timeout; do not
    # repeat that for every remaining file, fail them straight away instead.
    broker_up = True
    for row in rows:
        if row.status != "queued":
            continue
        if broker_up:
            broker_up = _dispatch(db, row)
        else:
            row.status = "failed"
            row.error = "Could not queue for processing: the task queue is unavailable."
            db.commit()

    return {
        "batch_id": batch.id,
        "accepted": sum(1 for r in rows if r.status == "queued"),
        "rejected": [{"filename": r.original_filename, "reason": r.error} for r in rows if r.status == "failed"],
        "uploads": [_upload_out(r) for r in rows],
    }


@router.get("/batches/{batch_id}")
def batch_status(
    batch_id: str,
    include_parsed: bool = Query(False, description="Also list files that finished successfully."),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Real progress for an upload batch: counts are a GROUP BY over the
    per-file status rows the worker updates, so a stalled or dead worker shows
    files still queued instead of an animation implying progress."""
    batch = db.get(ResumeBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found.")
    rs.get_job_for_user(db, user, batch.job_id, rs.ACTION_UPLOAD)

    counts = {s: 0 for s in ("queued", "processing", "parsed", "duplicate", "failed")}
    for status, n in db.query(ResumeUpload.status, func.count(ResumeUpload.id)).filter(
        ResumeUpload.batch_id == batch_id
    ).group_by(ResumeUpload.status):
        counts[status] = n

    listed = db.query(ResumeUpload).filter(ResumeUpload.batch_id == batch_id)
    if not include_parsed:
        listed = listed.filter(ResumeUpload.status != "parsed")
    oldest_queued = (
        db.query(func.min(ResumeUpload.updated_at))
        .filter(ResumeUpload.batch_id == batch_id, ResumeUpload.status == "queued")
        .scalar()
    )
    total = sum(counts.values())
    return {
        "batch_id": batch_id, "job_id": batch.job_id, "total": total, "counts": counts,
        "done": counts["queued"] + counts["processing"] == 0,
        "oldest_queued_at": _iso(oldest_queued),
        "uploads": [_upload_out(u) for u in listed.order_by(ResumeUpload.created_at, ResumeUpload.id)],
    }


@router.post("/uploads/{upload_id}/retry")
def retry_upload(upload_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    upload = db.get(ResumeUpload, upload_id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found.")
    rs.get_job_for_user(db, user, upload.job_id, rs.ACTION_UPLOAD)
    if upload.status != "failed":
        raise HTTPException(status_code=409, detail="Only files that failed can be retried.")
    if not upload.stored_path or not os.path.isfile(upload.stored_path):
        raise HTTPException(status_code=409, detail="The original file is no longer available; please upload it again.")

    # Compare-and-set, so a double-click queues the work once.
    claimed = db.execute(
        update(ResumeUpload).where(ResumeUpload.id == upload_id, ResumeUpload.status == "failed")
        .values(status="queued", error=None)
    )
    db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(status_code=409, detail="This file is already being retried.")
    db.refresh(upload)
    _dispatch(db, upload)
    db.refresh(upload)
    return _upload_out(upload)


# ── Candidates ───────────────────────────────────────────────────────────

def _csv(value: Optional[str]) -> Optional[List[str]]:
    return [p.strip() for p in value.split(",") if p.strip()] if value else None


@router.get("/jobs/{job_id}/candidates")
def list_candidates(
    job_id: str,
    q: Optional[str] = Query(None, max_length=100),
    stage: Optional[str] = Query(None, description="Comma-separated stages."),
    min_match: Optional[int] = Query(None, ge=0, le=100),
    min_ats: Optional[int] = Query(None, ge=0, le=100),
    min_experience: Optional[float] = Query(None, ge=0, le=60),
    skills: Optional[str] = Query(None, description="Comma-separated; a candidate must have all of them."),
    location: Optional[str] = Query(None, max_length=100),
    analysis_status: Optional[str] = Query(None, pattern="^(pending|running|completed|partial|failed)$"),
    sort: str = Query("match_score", pattern="^(match_score|ats_score|skill_match_score|created_at|stage|name)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=rs.MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = rs.get_job_for_user(db, user, job_id, rs.ACTION_VIEW)
    rows, total = rs.list_applications(
        db, user, job.id, q=q, stages=_csv(stage), min_match=min_match, min_ats=min_ats,
        min_experience=min_experience, skills=_csv(skills), location=location,
        analysis_status=analysis_status, sort=sort, order=order, page=page, page_size=page_size,
    )
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_application_out(app, cand, user) for app, cand in rows],
    }


@router.post("/applications/{application_id}/stage")
def set_stage(
    application_id: str, body: StageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """An HR decision. AI never calls this: the stage machine refuses any
    non-human actor everything except the automatic PROCESSING -> APPLIED."""
    app = rs.get_application_for_user(db, user, application_id, rs.ACTION_DECIDE)
    try:
        rs.transition_stage(db, app, body.stage, actor_type=rs.ACTOR_HR, actor_user=user, reason=body.reason)
    except rs.InvalidTransition as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    db.commit()
    cand = db.get(Candidate, app.candidate_id)
    return _application_out(app, cand, user)


@router.get("/applications/{application_id}/activity")
def application_activity(
    application_id: str, limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    app = rs.get_application_for_user(db, user, application_id, rs.ACTION_VIEW_TIMELINE)
    rows = (
        db.query(CandidateActivity)
        .filter(CandidateActivity.application_id == app.id)
        .order_by(CandidateActivity.created_at.desc(), CandidateActivity.id)
        .limit(limit)
        .all()
    )
    return {"items": [{
        "id": a.id, "event_type": a.event_type, "summary": a.summary, "actor_type": a.actor_type,
        "actor_user_id": a.actor_user_id, "payload": a.payload or {}, "created_at": _iso(a.created_at),
    } for a in rows]}


@router.get("/candidates/{candidate_id}/resume")
def download_resume(candidate_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Authorized resume download. Resumes are deliberately NOT reachable
    through the generic /uploads/ route (see main.py), because that route only
    checks that someone is signed in, not that they may see this candidate."""
    cand = rs.get_candidate_for_user(db, user, candidate_id)
    root = os.path.abspath(RESUME_DIR)
    path = os.path.abspath(cand.resume_file_path or "")
    if not cand.resume_file_path or os.path.commonpath([path, root]) != root or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Resume file not found.")
    return FileResponse(path, media_type="application/pdf", filename=cand.resume_filename or "resume.pdf")
