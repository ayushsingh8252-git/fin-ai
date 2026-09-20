"""Recruitment domain logic for the HR panel.

Everything here is deliberately independent of FastAPI routing and of Celery,
so the API layer and the Celery task are both thin wrappers and this module is
testable directly against a database. It does NOT reimplement any AI: resume
parsing and JD matching are the existing services/hiring_service.py functions,
called as-is.

What lives here:
  * authorization  - which jobs / applications each role may see and act on
  * normalization  - blocking keys used to recognise the same person twice
  * activity log   - CandidateActivity, the single audit trail (idempotent)
  * stage machine  - the one authoritative Application lifecycle
  * score provenance - never let a fallback value pass as a verified AI score
  * resume pipeline - the idempotent unit of work behind process_resume_task
"""
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import String, and_, cast, func, or_, select, true, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..models import (
    Application, Candidate, CandidateActivity, Interview, ResumeUpload, Role, User,
    HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER,
    STAGE_APPLIED, STAGE_PROCESSING, STAGE_SCREENING, STAGE_SHORTLISTED, STAGE_INTERVIEW,
    STAGE_SELECTED, STAGE_OFFER, STAGE_HIRED, STAGE_REJECTED, STAGE_WITHDRAWN, ALL_STAGES,
    SCORE_COMPUTED, SCORE_DEGRADED, SCORE_NOT_COMPUTED,
    SOURCE_LLM, SOURCE_DETERMINISTIC, SOURCE_DERIVED,
)

logger = logging.getLogger(__name__)

ACTOR_HR = "hr"
ACTOR_AI = "ai"
ACTOR_SYSTEM = "system"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ═════════════════════════════════════════════════════════════════════════
# Authorization
#
# Two layers, deliberately separate:
#   1. has_permission()  - may this ROLE perform this KIND of action at all
#   2. visible_*_filter() - which ROWS may this user see
# The row filters are SQL criteria applied inside the query, so an
# out-of-scope job or candidate is never loaded, not loaded-then-rejected.
# get_*_for_user() answers "not visible" with 404 (never confirming a row
# exists) and "visible but not permitted" with 403.
# ═════════════════════════════════════════════════════════════════════════

ACTION_VIEW = "view"
ACTION_CREATE_JOB = "create_job"
ACTION_EDIT_JOB = "edit_job"
ACTION_UPLOAD = "upload"
ACTION_ANALYZE = "analyze"
ACTION_DECIDE = "decide"
ACTION_MANAGE_USERS = "manage_users"
# The full history includes HR decisions (rejections, shortlisting), which an
# interviewer has no business reading.
ACTION_VIEW_TIMELINE = "view_timeline"

_ALL_HR_ACTIONS = frozenset({
    ACTION_VIEW, ACTION_CREATE_JOB, ACTION_EDIT_JOB, ACTION_UPLOAD, ACTION_ANALYZE, ACTION_DECIDE,
    ACTION_VIEW_TIMELINE,
})

ROLE_PERMISSIONS: Dict[str, frozenset] = {
    HR_ADMIN: _ALL_HR_ACTIONS | {ACTION_MANAGE_USERS},
    RECRUITER: _ALL_HR_ACTIONS,
    # A hiring manager works the jobs they own: decide and analyze on them, but
    # candidate intake (uploading resumes) stays with recruiting.
    HIRING_MANAGER: frozenset({
        ACTION_VIEW, ACTION_CREATE_JOB, ACTION_EDIT_JOB, ACTION_ANALYZE, ACTION_DECIDE, ACTION_VIEW_TIMELINE,
    }),
    # Read-only, and only for candidates they are actually scheduled to interview.
    INTERVIEWER: frozenset({ACTION_VIEW}),
}


def has_permission(user: User, action: str) -> bool:
    return action in ROLE_PERMISSIONS.get(user.role, frozenset())


def permissions_for(user: User) -> List[str]:
    return sorted(ROLE_PERMISSIONS.get(user.role, frozenset()))


def _interviewer_scope(user: User):
    """Interview rows assigned to this user, matched by email."""
    return func.lower(Interview.interviewer_email) == (user.email or "").strip().lower()


def visible_jobs_filter(user: User):
    """SQL criterion over Role for the jobs this user may see.

    hr_admin / recruiter : every job
    hiring_manager       : only jobs they created (Role.created_by)
    interviewer          : only jobs where they hold an interview
    anything else        : nothing (fail closed on an unknown/corrupt role)
    """
    if user.role in (HR_ADMIN, RECRUITER):
        return true()
    if user.role == HIRING_MANAGER:
        return Role.created_by == user.id
    if user.role == INTERVIEWER:
        return Role.id.in_(select(Interview.job_id).where(_interviewer_scope(user)))
    return Role.id.is_(None)


def visible_applications_filter(user: User):
    """SQL criterion over Application for the rows this user may see."""
    if user.role in (HR_ADMIN, RECRUITER):
        return true()
    if user.role == HIRING_MANAGER:
        return Application.job_id.in_(select(Role.id).where(Role.created_by == user.id))
    if user.role == INTERVIEWER:
        return Application.id.in_(select(Interview.application_id).where(_interviewer_scope(user)))
    return Application.id.is_(None)


def require_permission(user: User, action: str) -> None:
    if not has_permission(user, action):
        raise HTTPException(status_code=403, detail="Your role does not have access to this action.")


def get_job_for_user(db: Session, user: User, job_id: str, action: str = ACTION_VIEW) -> Role:
    job = db.query(Role).filter(Role.id == job_id, visible_jobs_filter(user)).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    require_permission(user, action)
    return job


def get_application_for_user(db: Session, user: User, application_id: str, action: str = ACTION_VIEW) -> Application:
    app = db.query(Application).filter(Application.id == application_id, visible_applications_filter(user)).first()
    if app is None:
        raise HTTPException(status_code=404, detail="Candidate application not found.")
    require_permission(user, action)
    return app


def get_candidate_for_user(db: Session, user: User, candidate_id: str) -> Candidate:
    """A candidate is visible if at least one of their applications is."""
    visible_app = (
        select(Application.id)
        .where(Application.candidate_id == Candidate.id, visible_applications_filter(user))
        .exists()
    )
    cand = db.query(Candidate).filter(Candidate.id == candidate_id, visible_app).first()
    if cand is None:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    require_permission(user, ACTION_VIEW)
    return cand


# ═════════════════════════════════════════════════════════════════════════
# Normalization + dedup
#
# Policy: never merge on a fuzzy guess. Same normalized email is the same
# person. With no email, name AND phone must both match. A name alone never
# merges anyone, because two different people really do share a name.
# ═════════════════════════════════════════════════════════════════════════

_GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}


def normalize_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    local, _, domain = email.strip().lower().rpartition("@")
    if not local or "." not in domain:
        return None
    if domain in _GMAIL_DOMAINS:
        # Google ignores dots and +tags in the local part, so these really are
        # the same mailbox. Not applied to other domains, where they may not be.
        local = local.split("+", 1)[0].replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}" if local else None


def normalize_name(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    key = "".join(ch for ch in name.lower() if ch.isalpha())
    return key if len(key) >= 3 else None


def normalize_phone(phone: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 7 else None


_YEARS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b", re.IGNORECASE)
_MONTHS_RE = re.compile(r"(\d+)\s*months?\b", re.IGNORECASE)


def parse_experience_years(text: Optional[str]) -> Optional[float]:
    """Years of experience from free text like "2.4 Years" or "3 years 6
    months"; None when it is ambiguous (several figures, a range, prose) —
    a wrong number is worse than none, since HR filters on this."""
    if not text:
        return None
    years = _YEARS_RE.findall(text)
    months = _MONTHS_RE.findall(text)
    if len(years) != 1 or len(months) > 1:
        return None
    total = float(years[0]) + (int(months[0]) / 12 if months else 0)
    return round(total, 2) if 0 <= total <= 60 else None


def find_matching_candidate(
    db: Session, *, email_key: Optional[str], name_key: Optional[str], phone_key: Optional[str]
) -> Optional[Candidate]:
    if email_key:
        hit = db.query(Candidate).filter(Candidate.email_key == email_key).first()
        if hit:
            return hit
    # No email match. Fall back to name AND phone, only when both are present.
    if name_key and phone_key:
        return db.query(Candidate).filter(
            Candidate.name_key == name_key, Candidate.phone_key == phone_key
        ).first()
    return None


# ═════════════════════════════════════════════════════════════════════════
# Activity log (the single audit trail)
# ═════════════════════════════════════════════════════════════════════════

def record_activity(
    db: Session,
    *,
    candidate_id: str,
    event_type: str,
    summary: str,
    actor_type: str = ACTOR_SYSTEM,
    actor_user_id: Optional[str] = None,
    application_id: Optional[str] = None,
    job_id: Optional[str] = None,
    payload: Optional[dict] = None,
    dedupe_key: Optional[str] = None,
) -> Tuple[CandidateActivity, bool]:
    """Append one CandidateActivity. Returns (row, created).

    With a dedupe_key the write is idempotent: a second call with the same key
    returns the existing row and writes nothing. That is what lets a Celery
    retry re-run a whole task without duplicating the candidate's history.
    Without a key (ordinary HR clicks, which really are distinct events) it
    always appends.

    Deliberately does NOT use SAVEPOINTs (begin_nested). On SQLite through
    pysqlite, a SAVEPOINT issued before the transaction's first write starts
    the transaction itself, and releasing it then COMMITS the outer work, which
    silently breaks the all-or-nothing guarantee callers rely on. Instead the
    unique index on dedupe_key is the backstop: a lost race surfaces as an
    IntegrityError when the caller flushes/commits, and the pipeline reacts by
    rolling the whole write phase back and re-running it (see
    _process_claimed_upload), which behaves the same on SQLite and Postgres.
    """
    if dedupe_key:
        pending = next(
            (o for o in db.new if isinstance(o, CandidateActivity) and o.dedupe_key == dedupe_key), None
        )
        if pending is not None:
            return pending, False
        existing = db.query(CandidateActivity).filter(CandidateActivity.dedupe_key == dedupe_key).first()
        if existing:
            return existing, False

    row = CandidateActivity(
        id=str(uuid.uuid4()),
        candidate_id=candidate_id,
        application_id=application_id,
        job_id=job_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_user_id=actor_user_id,
        summary=summary,
        payload=payload or {},
        dedupe_key=dedupe_key,
    )
    db.add(row)
    return row, True

# ═════════════════════════════════════════════════════════════════════════
# Stage machine
# ═════════════════════════════════════════════════════════════════════════

class InvalidTransition(ValueError):
    """Raised for a stage change the lifecycle does not allow. Subclasses
    ValueError so callers can treat it as bad input (HTTP 409/422)."""


STAGE_TRANSITIONS: Dict[str, frozenset] = {
    STAGE_PROCESSING: frozenset({STAGE_APPLIED}),
    STAGE_APPLIED: frozenset({STAGE_SCREENING, STAGE_SHORTLISTED, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_SCREENING: frozenset({STAGE_APPLIED, STAGE_SHORTLISTED, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_SHORTLISTED: frozenset({STAGE_SCREENING, STAGE_INTERVIEW, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_INTERVIEW: frozenset({STAGE_SHORTLISTED, STAGE_SELECTED, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_SELECTED: frozenset({STAGE_INTERVIEW, STAGE_OFFER, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_OFFER: frozenset({STAGE_SELECTED, STAGE_HIRED, STAGE_REJECTED, STAGE_WITHDRAWN}),
    STAGE_HIRED: frozenset({STAGE_OFFER, STAGE_APPLIED}),
    STAGE_REJECTED: frozenset({STAGE_APPLIED}),   # reopen
    STAGE_WITHDRAWN: frozenset({STAGE_APPLIED}),  # reopen
}

# The only move a non-human actor may make. "AI recommends, HR decides":
# every decision stage is HR-only, enforced here rather than trusted to callers.
_AUTOMATIC_TRANSITIONS = frozenset({(STAGE_PROCESSING, STAGE_APPLIED)})

_STAGE_EVENT = {
    STAGE_APPLIED: "candidate.stage_changed",
    STAGE_SCREENING: "candidate.screening_started",
    STAGE_SHORTLISTED: "candidate.shortlisted",
    STAGE_INTERVIEW: "candidate.interview_stage",
    STAGE_SELECTED: "candidate.selected",
    STAGE_OFFER: "candidate.offer_created",
    STAGE_HIRED: "candidate.hired",
    STAGE_REJECTED: "candidate.rejected",
    STAGE_WITHDRAWN: "candidate.withdrawn",
}

_STAGE_LABEL = {
    STAGE_PROCESSING: "Processing", STAGE_APPLIED: "Applied", STAGE_SCREENING: "Screening",
    STAGE_SHORTLISTED: "Shortlisted", STAGE_INTERVIEW: "Interview", STAGE_SELECTED: "Selected",
    STAGE_OFFER: "Offer", STAGE_HIRED: "Hired", STAGE_REJECTED: "Rejected", STAGE_WITHDRAWN: "Withdrawn",
}


def transition_stage(
    db: Session,
    application: Application,
    target: str,
    *,
    actor_type: str,
    actor_user: Optional[User] = None,
    reason: Optional[str] = None,
    dedupe_key: Optional[str] = None,
) -> CandidateActivity:
    """Move an application to `target` and record it. The ONLY place a stage
    changes. Raises InvalidTransition for anything the lifecycle forbids."""
    if target not in ALL_STAGES:
        raise InvalidTransition(f"Unknown stage {target!r}.")
    current = application.stage
    if current == target:
        raise InvalidTransition(f"Candidate is already in {_STAGE_LABEL.get(target, target)}.")
    if target not in STAGE_TRANSITIONS.get(current, frozenset()):
        raise InvalidTransition(
            f"Cannot move from {_STAGE_LABEL.get(current, current)} to {_STAGE_LABEL.get(target, target)}."
        )
    if actor_type != ACTOR_HR and (current, target) not in _AUTOMATIC_TRANSITIONS:
        raise InvalidTransition("Only a person can make this decision; AI can recommend but not decide.")
    if actor_type == ACTOR_HR and actor_user is None:
        raise InvalidTransition("An HR decision must be attributed to a signed-in user.")

    # Compare-and-set: only move the row if it is still in the stage we just
    # validated against. Two people acting on the same candidate at once would
    # otherwise both pass the check above and the second would silently
    # overwrite the first's decision.
    moved = db.execute(
        update(Application).where(Application.id == application.id, Application.stage == current)
        .values(stage=target).execution_options(synchronize_session="fetch")
    )
    if moved.rowcount != 1:
        raise InvalidTransition("This candidate was just updated by someone else. Refresh and try again.")
    application.stage = target
    who = (actor_user.name or actor_user.email) if actor_user else "System"
    summary = (
        f"{who} moved candidate to {_STAGE_LABEL[target]}"
        if actor_type == ACTOR_HR
        else f"Candidate moved to {_STAGE_LABEL[target]}"
    )
    row, _created = record_activity(
        db,
        candidate_id=application.candidate_id,
        application_id=application.id,
        job_id=application.job_id,
        event_type=_STAGE_EVENT.get(target, "candidate.stage_changed"),
        summary=summary,
        actor_type=actor_type,
        actor_user_id=actor_user.id if actor_user else None,
        payload={"from": current, "to": target, "reason": reason},
        dedupe_key=dedupe_key,
    )
    return row


# ═════════════════════════════════════════════════════════════════════════
# Score provenance
#
# The rule the whole panel rests on: a number is only shown as an AI result if
# its provenance says it was computed. build_score_update() is the single
# place that decides that, from the flags hiring_service now returns.
# ═════════════════════════════════════════════════════════════════════════

def _prov(status: str, source: Optional[str] = None, reason: Optional[str] = None) -> dict:
    entry = {"status": status, "source": source}
    if reason:
        entry["reason"] = reason
    return entry


def _clean_skills(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    out, seen = [], set()
    for item in value:
        if isinstance(item, str) and item.strip() and item.strip().lower() not in seen:
            seen.add(item.strip().lower())
            out.append(item.strip())
    return out


def build_score_update(
    fields: Dict[str, Any], match: Optional[Dict[str, Any]], match_skip_reason: Optional[str] = None
) -> Dict[str, Any]:
    """Turn hiring_service output into Application column values plus a
    provenance map. Any score that did not come from a real computation is
    stored as None with status not_computed, never as a plausible number."""
    prov: Dict[str, dict] = {}
    out: Dict[str, Any] = {}

    # ATS score + summary come from one LLM call; if it fell back, neither is real.
    resume_fell_back = bool(fields.get("degraded"))
    ats = fields.get("ats_score")
    if resume_fell_back or fields.get("ats_score_defaulted") or not isinstance(ats, int):
        out["ats_score"] = None
        prov["ats_score"] = _prov(SCORE_NOT_COMPUTED, None, "AI resume scoring was unavailable.")
    else:
        out["ats_score"] = ats
        prov["ats_score"] = _prov(SCORE_COMPUTED, SOURCE_LLM)

    summary = (fields.get("summary") or "").strip()
    if resume_fell_back or not summary:
        out["ai_summary"] = None
        prov["ai_summary"] = _prov(SCORE_NOT_COMPUTED, None, "AI summary was unavailable.")
    else:
        out["ai_summary"] = summary
        prov["ai_summary"] = _prov(SCORE_COMPUTED, SOURCE_LLM)

    # JD match
    out.update(match_score=None, recommendation=None, matched_skills=[], missing_skills=[], skill_match_score=None)
    if match is None:
        reason = match_skip_reason or "Job matching was not run."
        prov["match_score"] = _prov(SCORE_NOT_COMPUTED, None, reason)
        prov["skill_match_score"] = _prov(SCORE_NOT_COMPUTED, None, reason)
    else:
        matched = _clean_skills(match.get("matched_skills"))
        missing = _clean_skills(match.get("missing_skills"))
        out["matched_skills"], out["missing_skills"] = matched, missing
        if match.get("match_score_defaulted") or not isinstance(match.get("match_score"), int):
            reason = "AI did not return a usable match score."
            prov["match_score"] = _prov(SCORE_NOT_COMPUTED, None, reason)
            prov["skill_match_score"] = _prov(SCORE_NOT_COMPUTED, None, reason)
        else:
            degraded = bool(match.get("degraded"))
            status = SCORE_DEGRADED if degraded else SCORE_COMPUTED
            out["match_score"] = match["match_score"]
            out["recommendation"] = match.get("recommendation")
            prov["match_score"] = _prov(
                status, SOURCE_DETERMINISTIC if degraded else SOURCE_LLM,
                "Computed by keyword overlap because the AI provider was unavailable." if degraded else None,
            )
            if matched or missing:
                # Arithmetic over the lists above; inherits their trustworthiness.
                out["skill_match_score"] = round(100 * len(matched) / (len(matched) + len(missing)))
                prov["skill_match_score"] = _prov(status, SOURCE_DERIVED)
            else:
                prov["skill_match_score"] = _prov(SCORE_NOT_COMPUTED, None, "No skills to compare.")

    out["score_provenance"] = prov
    trusted = [p["status"] for k, p in prov.items() if k in ("ats_score", "match_score")]
    if all(s == SCORE_NOT_COMPUTED for s in trusted):
        out["analysis_status"], out["analysis_error"] = "failed", "AI analysis was unavailable for this resume."
    elif any(s == SCORE_NOT_COMPUTED for s in trusted):
        out["analysis_status"] = "partial"
        out["analysis_error"] = "Some AI results could not be computed."
    else:
        out["analysis_status"], out["analysis_error"] = "completed", None
    return out


def score_view(app: Application, key: str) -> Dict[str, Any]:
    """What the API exposes for one score. Fails closed: a stored value with no
    provenance entry is withheld rather than presented as verified."""
    prov = (app.score_provenance or {}).get(key)
    value = getattr(app, key, None)
    if not prov or prov.get("status") == SCORE_NOT_COMPUTED:
        return {"value": None, "status": SCORE_NOT_COMPUTED, "source": None, "reason": (prov or {}).get("reason")}
    return {"value": value, "status": prov.get("status"), "source": prov.get("source"), "reason": prov.get("reason")}


def build_requirement_text(job: Role) -> str:
    """The requirement brief handed to the existing JD matcher, composed from
    the job's own fields. No content is invented, only concatenated."""
    parts: List[str] = []
    if (job.jd_text or "").strip():
        parts.append(job.jd_text.strip())
    elif (job.description or "").strip():
        parts.append(job.description.strip())
    must = _clean_skills(job.must_have_skills)
    pref = _clean_skills(job.preferred_skills)
    if must:
        parts.append("Must-have skills: " + ", ".join(must))
    if pref:
        parts.append("Preferred skills: " + ", ".join(pref))
    if job.min_experience_years:
        parts.append(f"Minimum experience: {job.min_experience_years:g} years")
    return "\n\n".join(parts)


# ═════════════════════════════════════════════════════════════════════════
# Jobs
# ═════════════════════════════════════════════════════════════════════════

def create_job(db: Session, user: User, data: Dict[str, Any]) -> Role:
    """Create a job owned by `user`. If an agent already auto-created a role
    with this title (no owner), adopt it instead of colliding on the unique
    title: otherwise the JD the agents read and the job HR manages would be
    two different rows for the same role."""
    require_permission(user, ACTION_CREATE_JOB)
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="A job title is required.")

    existing = db.query(Role).filter(Role.title == title).first()
    if existing is not None and existing.created_by is not None:
        raise HTTPException(status_code=409, detail="A job with this title already exists.")

    job = existing or Role(id=str(uuid.uuid4()), title=title)
    job.created_by = user.id
    job.status = data.get("status") or "open"
    for field in ("department", "location", "description", "jd_text", "min_experience_years"):
        if data.get(field) is not None:
            setattr(job, field, data[field])
    # An unowned Role may have been created earlier by an existing AI service
    # and already contain its requirements.  Claiming it as a recruitment job
    # must not silently erase those requirements just because the create form
    # omitted the optional skill fields.
    if data.get("must_have_skills") is not None:
        job.must_have_skills = _clean_skills(data["must_have_skills"])
    elif existing is None:
        job.must_have_skills = []
    if data.get("preferred_skills") is not None:
        job.preferred_skills = _clean_skills(data["preferred_skills"])
    elif existing is None:
        job.preferred_skills = []
    if existing is None:
        db.add(job)
    db.commit()
    db.refresh(job)
    logger.info("[recruitment] job %s (%s) created by %s", job.id, job.title, user.email)
    return job


def pipeline_counts(db: Session, user: User, job_ids: Iterable[str]) -> Dict[str, Dict[str, int]]:
    """{job_id: {stage: n}} restricted to the applications this user may see,
    so an interviewer's counts reflect only their own candidates."""
    ids = list(job_ids)
    if not ids:
        return {}
    rows = (
        db.query(Application.job_id, Application.stage, func.count(Application.id))
        .filter(Application.job_id.in_(ids), visible_applications_filter(user))
        .group_by(Application.job_id, Application.stage)
        .all()
    )
    counts: Dict[str, Dict[str, int]] = {jid: {} for jid in ids}
    for job_id, stage, n in rows:
        counts[job_id][stage] = n
    return counts


# ═════════════════════════════════════════════════════════════════════════
# Candidate list
# ═════════════════════════════════════════════════════════════════════════

_SORTABLE = {
    "match_score": Application.match_score,
    "ats_score": Application.ats_score,
    "skill_match_score": Application.skill_match_score,
    "created_at": Application.created_at,
    "stage": Application.stage,
    "name": Candidate.name,
}
MAX_PAGE_SIZE = 100


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_applications(
    db: Session,
    user: User,
    job_id: str,
    *,
    q: Optional[str] = None,
    stages: Optional[List[str]] = None,
    min_match: Optional[int] = None,
    min_ats: Optional[int] = None,
    min_experience: Optional[float] = None,
    skills: Optional[List[str]] = None,
    location: Optional[str] = None,
    analysis_status: Optional[str] = None,
    sort: str = "match_score",
    order: str = "desc",
    page: int = 1,
    page_size: int = 25,
) -> Tuple[List[Tuple[Application, Candidate]], int]:
    """Paginated, filtered candidates for one job. Server-side everything: the
    browser never receives more than one page, so a 500-candidate job stays
    cheap. Filters are deterministic column/text predicates by design."""
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    page = max(1, page)

    query = (
        db.query(Application, Candidate)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .filter(Application.job_id == job_id, visible_applications_filter(user))
    )
    if q and q.strip():
        like = f"%{_like_escape(q.strip().lower())}%"
        query = query.filter(or_(
            func.lower(Candidate.name).like(like, escape="\\"),
            func.lower(Candidate.email).like(like, escape="\\"),
            func.lower(Candidate.current_role).like(like, escape="\\"),
            func.lower(cast(Candidate.skills, String)).like(like, escape="\\"),
        ))
    if stages:
        query = query.filter(Application.stage.in_([s for s in stages if s in ALL_STAGES]))
    # Score filters only ever match rows where a value exists, so a
    # not_computed (None) score can never satisfy "match above 80%".
    if min_match is not None:
        query = query.filter(Application.match_score >= min_match)
    if min_ats is not None:
        query = query.filter(Application.ats_score >= min_ats)
    if min_experience is not None:
        query = query.filter(Candidate.experience_years >= min_experience)
    for skill in (skills or []):
        if skill.strip():
            query = query.filter(
                func.lower(cast(Candidate.skills, String)).like(
                    f"%{_like_escape(skill.strip().lower())}%", escape="\\"
                )
            )
    if location and location.strip():
        query = query.filter(func.lower(Candidate.location).like(f"%{_like_escape(location.strip().lower())}%", escape="\\"))
    if analysis_status:
        query = query.filter(Application.analysis_status == analysis_status)

    total = query.count()
    col = _SORTABLE.get(sort, Application.match_score)
    ordered = col.desc() if order != "asc" else col.asc()
    # NULL scores sort last in both directions (portable across SQLite/Postgres).
    query = query.order_by(col.is_(None), ordered, Application.id)
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return rows, total


# ═════════════════════════════════════════════════════════════════════════
# Resume pipeline: the idempotent unit of work behind process_resume_task
# ═════════════════════════════════════════════════════════════════════════

PROCESSING_STALE_AFTER = timedelta(minutes=20)  # > Celery's 15 min hard limit, so a live task is never stolen from


class NonRetryableResumeError(Exception):
    """The upload cannot succeed however often it is retried (unreadable PDF,
    missing file, deleted job). Distinct from a transient error so the Celery
    task does not burn retries on it."""


def claim_upload(db: Session, upload_id: str) -> Optional[ResumeUpload]:
    """Atomically move an upload queued|failed -> processing. Returns the row
    only to the caller that won the claim.

    Everything below this point runs at most once per claim, which is what
    makes reprocessing safe: a duplicate dispatch, a Celery retry racing the
    original, or a user double-clicking Retry loses the claim and returns
    without touching any table. A row stuck in `processing` (the worker died)
    becomes claimable again after PROCESSING_STALE_AFTER.
    """
    now = _utcnow()
    claimable = or_(
        ResumeUpload.status.in_(("queued", "failed")),
        and_(ResumeUpload.status == "processing", ResumeUpload.updated_at < now - PROCESSING_STALE_AFTER),
    )
    result = db.execute(
        update(ResumeUpload)
        .where(ResumeUpload.id == upload_id, claimable)
        .values(status="processing", attempts=ResumeUpload.attempts + 1, error=None, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    db.expire_all()  # a bulk UPDATE bypasses the identity map; never serve a stale cached row
    if result.rowcount != 1:
        return None
    return db.get(ResumeUpload, upload_id)


def mark_upload(db: Session, upload_id: str, status: str, error: Optional[str] = None) -> None:
    db.execute(
        update(ResumeUpload).where(ResumeUpload.id == upload_id)
        .values(status=status, error=error, updated_at=_utcnow())
        .execution_options(synchronize_session=False)
    )
    db.commit()
    db.expire_all()


def process_resume_upload(db: Session, upload_id: str) -> Dict[str, Any]:
    """Process one uploaded resume end to end. Safe to call any number of times
    for the same upload_id: only the caller that wins claim_upload() does any
    work. Raises for transient failures (so Celery may retry) after recording
    the failure honestly on the row; returns a result dict otherwise."""
    upload = claim_upload(db, upload_id)
    if upload is None:
        current = db.get(ResumeUpload, upload_id)
        return {"outcome": "skipped", "status": current.status if current else "missing"}

    try:
        return _process_claimed_upload(db, upload)
    except NonRetryableResumeError as exc:
        db.rollback()
        mark_upload(db, upload_id, "failed", str(exc))
        return {"outcome": "failed", "status": "failed", "retryable": False, "error": str(exc)}
    except Exception as exc:
        db.rollback()
        mark_upload(db, upload_id, "failed", f"Processing hit an unexpected error: {exc}")
        raise


MAX_WRITE_ATTEMPTS = 3


def _process_claimed_upload(db: Session, upload: ResumeUpload) -> Dict[str, Any]:
    # Local import: hiring_service pulls in the LLM stack, which the API
    # process should not pay for just to import this module.
    from . import hiring_service

    upload_id, job_id = upload.id, upload.job_id
    filename, path = upload.original_filename, upload.stored_path

    job = db.get(Role, job_id)
    if job is None:
        raise NonRetryableResumeError("The job this resume was uploaded to no longer exists.")
    if not path or not os.path.isfile(path):
        raise NonRetryableResumeError("The uploaded file is missing from storage, so it cannot be processed.")
    requirement = build_requirement_text(job)
    job_title = job.title
    db.commit()  # end the read transaction; the LLM calls below can take a while

    # ── Existing AI: parse the resume. No DB transaction is open here. ──
    fields = hiring_service.parse_resume_pdf(filename, path)
    if not (fields.get("resume_text") or "").strip():
        raise NonRetryableResumeError(
            "No readable text could be extracted from this PDF. It may be a scan or corrupted."
        )

    email_key = normalize_email(fields.get("email"))
    name_key = normalize_name(fields.get("name"))
    phone_key = normalize_phone(fields.get("phone"))

    # ── Existing AI: match against the JD, only when a new application will exist. ──
    candidate, existing_app = _resolve_existing(db, upload_id, job_id, email_key, name_key, phone_key)
    match, skip_reason = None, None
    if existing_app is None:
        if requirement:
            match = hiring_service.match_candidate_to_requirement(
                {"name": fields.get("name"), "experience": fields.get("experience"),
                 "skills": fields.get("skills") or [], "summary": fields.get("summary"),
                 "ats_score": fields.get("ats_score")},
                requirement, job_title,
            )
        else:
            skip_reason = "This job has no description to match against."
    db.rollback()  # nothing has been written yet; drop the read transaction before the write phase

    # ── One atomic write phase. Nothing in it is visible until the single
    # commit at the end. If another worker wins a unique-index race (same
    # person, same job), the whole phase is rolled back and re-run, so the
    # second pass simply finds their rows and adopts them. ──
    last_error: Optional[Exception] = None
    for _attempt in range(MAX_WRITE_ATTEMPTS):
        try:
            return _write_phase(
                db, upload_id, job_id, filename, fields, match, skip_reason, email_key, name_key, phone_key
            )
        except IntegrityError as exc:
            db.rollback()
            last_error = exc
            logger.info("[recruitment] upload %s lost a uniqueness race, re-running write phase", upload_id)
    raise last_error  # type: ignore[misc]


def _resolve_existing(db, upload_id, job_id, email_key, name_key, phone_key):
    upload = db.get(ResumeUpload, upload_id)
    candidate = db.get(Candidate, upload.candidate_id) if upload and upload.candidate_id else None
    if candidate is None:
        candidate = find_matching_candidate(db, email_key=email_key, name_key=name_key, phone_key=phone_key)
    existing_app = None
    if candidate is not None:
        existing_app = db.query(Application).filter(
            Application.candidate_id == candidate.id, Application.job_id == job_id
        ).first()
    return candidate, existing_app


def _write_phase(db, upload_id, job_id, filename, fields, match, skip_reason, email_key, name_key, phone_key):
    upload = db.get(ResumeUpload, upload_id)
    candidate, existing_app = _resolve_existing(db, upload_id, job_id, email_key, name_key, phone_key)

    created_candidate = False
    if candidate is None:
        candidate = Candidate(id=str(uuid.uuid4()), source="bulk_upload")
        _apply_candidate_fields(candidate, fields, email_key, name_key, phone_key, upload)
        db.add(candidate)
        db.flush()  # a unique email_key violation surfaces here, before anything else is written
        created_candidate = True
    else:
        _apply_candidate_fields(candidate, fields, email_key, name_key, phone_key, upload)

    created_application = False
    application = existing_app
    if application is None:
        application = Application(id=str(uuid.uuid4()), candidate_id=candidate.id, job_id=job_id, stage=STAGE_PROCESSING)
        db.add(application)
        db.flush()  # (candidate_id, job_id) uniqueness is enforced here
        created_application = True
        for column, value in build_score_update(fields, match, skip_reason).items():
            setattr(application, column, value)

    activity_base = dict(candidate_id=candidate.id, application_id=application.id, job_id=job_id)
    if created_candidate:
        record_activity(
            db, event_type="candidate.created", actor_type=ACTOR_SYSTEM,
            summary=f"Candidate profile created from {filename}",
            dedupe_key=f"candidate_created:{candidate.id}", **activity_base,
        )
    record_activity(
        db, event_type="candidate.resume_processed", actor_type=ACTOR_AI,
        summary=(f"Resume parsed ({filename})" if created_application
                 else f"Resume re-uploaded ({filename}); profile details refreshed"),
        dedupe_key=f"resume_processed:{upload_id}", **activity_base,
    )
    if created_application:
        record_activity(
            db, event_type="candidate.analysis_completed", actor_type=ACTOR_AI,
            summary=_analysis_summary(application),
            payload={"score_provenance": application.score_provenance, "analysis_status": application.analysis_status},
            dedupe_key=f"analysis:{application.id}", **activity_base,
        )
        transition_stage(
            db, application, STAGE_APPLIED, actor_type=ACTOR_SYSTEM, dedupe_key=f"auto_applied:{application.id}",
        )

    # An upload that already produced this application and is simply being
    # replayed (a retry after a crash past the commit, a forced re-dispatch) is
    # not a duplicate of anything; only a *different* upload landing on an
    # application that already exists is.
    replay = existing_app is not None and upload.application_id == existing_app.id
    upload.candidate_id, upload.application_id = candidate.id, application.id
    upload.status = "parsed" if (created_application or replay) else "duplicate"
    upload.error = None
    upload.updated_at = _utcnow()

    # The API must retain the candidate's current resume at the stable
    # system-of-record path promised by the recruitment contract, rather than
    # the temporary upload-id path used before identity resolution.  A retry
    # after a committed write is already at this destination, so this is also
    # safe when the worker is re-delivered after its acknowledgement was lost.
    _store_candidate_resume(candidate, upload)
    db.commit()
    return {
        "outcome": upload.status, "status": upload.status,
        "candidate_id": candidate.id, "application_id": application.id,
        "created_candidate": created_candidate, "created_application": created_application,
    }


def _store_candidate_resume(candidate: Candidate, upload: ResumeUpload) -> None:
    """Move a claimed upload from its temporary path to the candidate-owned
    resume path and keep both records in sync.

    `original_filename` is sanitised before a ResumeUpload is created.  The
    candidate id is only known after parsing/deduplication, which is why the
    incoming file initially has an upload-id name.
    """
    source = upload.stored_path
    if not source:
        raise NonRetryableResumeError("The uploaded file is missing from storage, so it cannot be retained.")
    target = os.path.join(os.path.dirname(source), f"{candidate.id}_{upload.original_filename}")
    if os.path.abspath(source) != os.path.abspath(target):
        if not os.path.isfile(source):
            raise NonRetryableResumeError("The uploaded file is missing from storage, so it cannot be retained.")
        os.replace(source, target)
    upload.stored_path = target
    candidate.resume_file_path = target
    candidate.resume_filename = upload.original_filename


def _analysis_summary(app: Application) -> str:
    bits = []
    ats = score_view(app, "ats_score")
    match = score_view(app, "match_score")
    if ats["value"] is not None:
        bits.append(f"ATS score {ats['value']}%")
    if match["value"] is not None:
        tag = " (keyword match, AI unavailable)" if match["status"] == SCORE_DEGRADED else ""
        bits.append(f"JD match {match['value']}%{tag}")
    if not bits:
        return "AI analysis unavailable for this resume"
    if app.analysis_status == "partial":
        bits.append("some AI results unavailable")
    return "AI analysis completed: " + ", ".join(bits)


def _apply_candidate_fields(row: Candidate, fields, email_key, name_key, phone_key, upload) -> None:
    """Write parsed values onto a candidate, but only non-empty ones, so a
    sparse later resume never blanks out data an earlier one supplied."""
    def put(attr, value):
        if value not in (None, "", []):
            setattr(row, attr, value)

    put("email", fields.get("email"))
    row.email_key = email_key or row.email_key
    # A degraded parse derives "name" from the first line of raw text (or the
    # filename). That is fine for a brand-new profile, but must never overwrite
    # a name an earlier, properly parsed resume already established.
    if not (fields.get("degraded") and row.name):
        put("name", fields.get("name"))
        row.name_key = name_key or row.name_key
    put("phone", fields.get("phone"))
    row.phone_key = phone_key or row.phone_key
    put("location", fields.get("location"))
    put("current_role", fields.get("current_role"))
    experience = fields.get("experience")
    if experience and experience != "Not specified":
        row.experience_text = experience
        years = parse_experience_years(experience)
        if years is not None:
            row.experience_years = years
    put("skills", [s for s in (fields.get("skills") or []) if isinstance(s, str)])
    put("education", fields.get("education") if isinstance(fields.get("education"), list) else None)
    row.resume_text = fields.get("resume_text") or row.resume_text
    # The temporary upload path is promoted to the candidate-owned path by
    # _store_candidate_resume once the candidate id is known.
    row.resume_file_path = upload.stored_path
    row.resume_filename = upload.original_filename
