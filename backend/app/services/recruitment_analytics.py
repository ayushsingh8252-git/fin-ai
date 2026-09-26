"""Recruitment Analytics — aggregate usage, AI-execution and reliability
metrics behind GET /api/v1/recruitment/analytics/*.

Nothing here invents data. Every number is computed from tables that already
exist for other reasons:
  * CandidateActivity  - the HR audit trail -> who did what, when (MAU)
  * ResumeUpload       - the resume-processing pipeline -> AI executions,
                          documents processed, processing latency
  * WorkflowRun/Step    - bulk automation runs -> AI executions, latency
  * FraudScan           - fraud-detection AI runs -> AI executions
  * Interview + ScreeningSession/CallRecord - AI interview completion
  * LLMCostRecord       - real provider usage/cost (see hiring_service.py's
                          trace_id threading, added alongside this module)
  * BusinessOutcomeEvent - the existing outcomes ledger (api/outcomes.py) ->
                          time saved, if and only if something has recorded
                          a real manual baseline for a recruitment workflow

A metric with no real underlying data comes back with an explicit
`has_data: False` (or `baseline_configured: False` for time-saved) rather
than a fabricated number — api/recruitment_analytics.py passes that straight
through so the frontend can render "No data available" / "Baseline not
configured" instead of a zero that looks like a measurement.

Demo-seeded rows (services/seed_service.py tags them Candidate.source ==
"demo_seed") are excluded from every query that can reach a Candidate.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..models import (
    Application, Candidate, CandidateActivity, CallRecord, FraudScan,
    Interview, LLMCostRecord, ResumeBatch, ResumeUpload, ScreeningSession,
    User, WorkflowRun, WorkflowStep,
)
from .recruitment_service import ACTOR_HR

DEMO_SOURCE = "demo_seed"


def _not_demo() -> Any:
    return or_(Candidate.source.is_(None), Candidate.source != DEMO_SOURCE)


def period_bounds(days: int, now: Optional[datetime] = None) -> tuple[datetime, datetime, datetime]:
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    prev_since = since - timedelta(days=days)
    return now, since, prev_since


# ── Active users ────────────────────────────────────────────────────────

def _active_user_ids(db: Session, since: datetime, until: datetime) -> set:
    """Distinct user ids with meaningful recruitment activity in [since, until).

    Meaningful = a real HR decision/action (CandidateActivity, actor_type
    "hr"), a resume batch they uploaded, or a bulk workflow they triggered —
    never a Google sign-in by itself, and never an AI/system-attributed
    activity (those have no actor_user_id at all).
    """
    ids: set = set()
    hr_q = db.query(CandidateActivity.actor_user_id).filter(
        CandidateActivity.actor_type == ACTOR_HR,
        CandidateActivity.actor_user_id.isnot(None),
        CandidateActivity.created_at >= since,
        CandidateActivity.created_at <= until,
    ).distinct()
    upload_q = db.query(ResumeBatch.uploaded_by).filter(
        ResumeBatch.uploaded_by.isnot(None),
        ResumeBatch.created_at >= since,
        ResumeBatch.created_at <= until,
    ).distinct()
    workflow_q = db.query(WorkflowRun.triggered_by).filter(
        WorkflowRun.triggered_by.isnot(None),
        WorkflowRun.created_at >= since,
        WorkflowRun.created_at <= until,
    ).distinct()
    for q in (hr_q, upload_q, workflow_q):
        ids.update(row[0] for row in q.all() if row[0])
    return ids


def monthly_active_users(db: Session, days: int = 30, now: Optional[datetime] = None) -> Dict[str, Any]:
    now, since, prev_since = period_bounds(days, now)
    current = _active_user_ids(db, since, now)
    previous = _active_user_ids(db, prev_since, since)
    pct_change = round((len(current) - len(previous)) / len(previous) * 100, 1) if previous else None
    return {
        "current": len(current),
        "previous": len(previous),
        "pct_change": pct_change,
        "has_prior_period_data": bool(previous),
    }


def returning_user_rate(db: Session, days: int = 30, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Of the users active in the current period, how many were already
    active at some point before this period started. Documented here so the
    frontend tooltip can quote the exact definition:
    returning = |current_active ∩ active_before_period_start| ; rate =
    returning / |current_active|.
    """
    now, since, _ = period_bounds(days, now)
    current = _active_user_ids(db, since, now)
    if not current:
        return {"returning": 0, "new": 0, "current_active": 0, "rate_pct": None}
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    prior = _active_user_ids(db, epoch, since)
    returning = len(current & prior)
    return {
        "returning": returning,
        "new": len(current) - returning,
        "current_active": len(current),
        "rate_pct": round(returning / len(current) * 100, 1),
    }


def active_users_trend(db: Session, since: datetime, until: datetime) -> List[Dict[str, Any]]:
    per_day: Dict[str, set] = defaultdict(set)
    sources = [
        (CandidateActivity.created_at, CandidateActivity.actor_user_id,
         [CandidateActivity.actor_type == ACTOR_HR, CandidateActivity.actor_user_id.isnot(None)]),
        (ResumeBatch.created_at, ResumeBatch.uploaded_by, [ResumeBatch.uploaded_by.isnot(None)]),
        (WorkflowRun.created_at, WorkflowRun.triggered_by, [WorkflowRun.triggered_by.isnot(None)]),
    ]
    for ts_col, id_col, extra in sources:
        q = db.query(func.date(ts_col), id_col).filter(ts_col >= since, ts_col <= until, *extra)
        for day, uid in q.all():
            if day and uid:
                per_day[day].add(uid)
    return [{"date": d, "active_users": len(ids)} for d, ids in sorted(per_day.items())]


# ── AI executions ───────────────────────────────────────────────────────

_RESUME_TERMINAL = ("parsed", "duplicate", "failed")


def _resume_upload_stats(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    rows = (
        db.query(ResumeUpload.status, func.count())
        .filter(ResumeUpload.created_at >= since, ResumeUpload.created_at <= until)
        .group_by(ResumeUpload.status)
        .all()
    )
    counts = {status: n for status, n in rows}
    success = counts.get("parsed", 0) + counts.get("duplicate", 0)
    failed = counts.get("failed", 0)
    in_flight = counts.get("queued", 0) + counts.get("processing", 0)
    return {
        "success": success, "failed": failed, "in_flight": in_flight,
        "total_uploaded": sum(counts.values()), "by_status": counts,
    }


def _fraud_scan_status_counts(db: Session, since: datetime, until: datetime) -> Dict[str, int]:
    rows = (
        db.query(FraudScan.status, func.count())
        .join(Application, Application.fraud_scan_id == FraudScan.id)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .filter(_not_demo(), FraudScan.created_at >= since, FraudScan.created_at <= until)
        .group_by(FraudScan.status)
        .all()
    )
    return {status: n for status, n in rows}


def ai_executions_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    resume = _resume_upload_stats(db, since, until)
    wf_rows = (
        db.query(WorkflowRun.workflow_type, WorkflowRun.status, func.count())
        .filter(WorkflowRun.created_at >= since, WorkflowRun.created_at <= until)
        .group_by(WorkflowRun.workflow_type, WorkflowRun.status)
        .all()
    )
    fraud = _fraud_scan_status_counts(db, since, until)

    total_success = resume["success"]
    total_failed = resume["failed"]
    by_agent: List[Dict[str, Any]] = []
    if resume["success"] or resume["failed"]:
        by_agent.append({"agent": "Resume Parsing & Matching", "successful": resume["success"], "failed": resume["failed"]})

    wf_agg: Dict[str, Dict[str, int]] = defaultdict(lambda: {"successful": 0, "failed": 0})
    for wf_type, status, n in wf_rows:
        if status == "completed":
            wf_agg[wf_type]["successful"] += n
            total_success += n
        elif status == "failed":
            wf_agg[wf_type]["failed"] += n
            total_failed += n
    for wf_type, agg in wf_agg.items():
        by_agent.append({"agent": f"Workflow: {wf_type}", **agg})

    fraud_success = fraud.get("complete", 0)
    fraud_failed = fraud.get("error", 0)
    if fraud_success or fraud_failed:
        by_agent.append({"agent": "Fraud Detection", "successful": fraud_success, "failed": fraud_failed})
        total_success += fraud_success
        total_failed += fraud_failed

    total = total_success + total_failed
    return {
        "has_data": total > 0,
        "total_executions": total,
        "successful": total_success,
        "failed": total_failed,
        "success_rate_pct": round(total_success / total * 100, 1) if total else None,
        "failure_rate_pct": round(total_failed / total * 100, 1) if total else None,
        "by_agent": by_agent,
    }


def executions_trend(db: Session, since: datetime, until: datetime) -> List[Dict[str, Any]]:
    per_day: Dict[str, Dict[str, int]] = defaultdict(lambda: {"successful": 0, "failed": 0})

    def _bucket(rows, success_values, failed_values):
        for day, status in rows:
            if not day:
                continue
            if status in success_values:
                per_day[day]["successful"] += 1
            elif status in failed_values:
                per_day[day]["failed"] += 1

    _bucket(
        db.query(func.date(ResumeUpload.created_at), ResumeUpload.status)
        .filter(ResumeUpload.created_at >= since, ResumeUpload.created_at <= until).all(),
        {"parsed", "duplicate"}, {"failed"},
    )
    _bucket(
        db.query(func.date(WorkflowRun.created_at), WorkflowRun.status)
        .filter(WorkflowRun.created_at >= since, WorkflowRun.created_at <= until).all(),
        {"completed"}, {"failed"},
    )
    _bucket(
        db.query(func.date(FraudScan.created_at), FraudScan.status)
        .join(Application, Application.fraud_scan_id == FraudScan.id)
        .join(Candidate, Candidate.id == Application.candidate_id)
        .filter(_not_demo(), FraudScan.created_at >= since, FraudScan.created_at <= until).all(),
        {"complete"}, {"error"},
    )
    return [{"date": d, **counts} for d, counts in sorted(per_day.items())]


# ── Documents / resumes processed ───────────────────────────────────────

def documents_processed_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    resume = _resume_upload_stats(db, since, until)
    return {
        "has_data": resume["total_uploaded"] > 0,
        "uploaded": resume["total_uploaded"],
        "processed": resume["success"],
        "failed": resume["failed"],
        "in_progress": resume["in_flight"],
    }


# ── Latency ──────────────────────────────────────────────────────────────

def latency_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    """Real, measured durations — not fabricated. "Resume Processing" is the
    full pipeline (queue wait + parse + match), from ResumeUpload's own
    created_at/updated_at, since no isolated LLM-call timer is persisted
    anywhere today. Workflow step durations use WorkflowStep's explicit
    started_at/completed_at, which is a pure execution timer.
    """
    samples: List[tuple] = []

    for created, updated in db.query(ResumeUpload.created_at, ResumeUpload.updated_at).filter(
        ResumeUpload.created_at >= since, ResumeUpload.created_at <= until,
        ResumeUpload.status.in_(_RESUME_TERMINAL),
    ):
        if created and updated:
            secs = (updated - created).total_seconds()
            if secs >= 0:
                samples.append(("Resume Processing", secs))

    step_rows = (
        db.query(WorkflowStep.started_at, WorkflowStep.completed_at, WorkflowRun.workflow_type)
        .join(WorkflowRun, WorkflowRun.id == WorkflowStep.run_id)
        .filter(
            WorkflowRun.created_at >= since, WorkflowRun.created_at <= until,
            WorkflowStep.started_at.isnot(None), WorkflowStep.completed_at.isnot(None),
        )
        .all()
    )
    for started, completed, wf_type in step_rows:
        secs = (completed - started).total_seconds()
        if secs >= 0:
            samples.append((f"Workflow: {wf_type}", secs))

    if not samples:
        return {"has_data": False}

    all_secs = sorted(s for _, s in samples)

    def _pct(p: float) -> float:
        idx = min(len(all_secs) - 1, int(len(all_secs) * p))
        return round(all_secs[idx], 2)

    by_label: Dict[str, List[float]] = defaultdict(list)
    for label, secs in samples:
        by_label[label].append(secs)

    breakdown = []
    for label, vals in by_label.items():
        vals.sort()
        breakdown.append({
            "label": label,
            "sample_count": len(vals),
            "avg_seconds": round(sum(vals) / len(vals), 2),
            "p50_seconds": round(vals[len(vals) // 2], 2),
        })

    return {
        "has_data": True,
        "sample_count": len(all_secs),
        "avg_seconds": round(sum(all_secs) / len(all_secs), 2),
        "p50_seconds": _pct(0.50),
        "p95_seconds": _pct(0.95),
        "by_agent": breakdown,
    }


# ── AI interviews completed ─────────────────────────────────────────────

def interviews_completed_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    """Only Interview rows whose linked AI session (ScreeningSession for
    ai_screening mode, CallRecord for telephonic mode) has actually reached
    its own COMPLETED status — matches the spec's "use the application's
    existing definition of COMPLETED, never interview creation/scheduling".
    Interview.status itself never leaves "scheduled" in the current
    scheduling flow (api/recruitment.py::schedule_interview), so this counts
    0 until a completion flow writes to screening_session_id/call_record_id
    — an honest "No data available" rather than counting a page visit.
    """
    total = (
        db.query(Interview.id)
        .join(Candidate, Candidate.id == Interview.candidate_id)
        .outerjoin(ScreeningSession, ScreeningSession.id == Interview.screening_session_id)
        .outerjoin(CallRecord, CallRecord.id == Interview.call_record_id)
        .filter(
            _not_demo(),
            Interview.created_at >= since, Interview.created_at <= until,
            or_(ScreeningSession.status == "completed", CallRecord.status == "completed"),
        )
        .count()
    )
    return {"has_data": total > 0, "completed": total}


# ── AI cost per execution ────────────────────────────────────────────────

def ai_cost_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    """Real provider cost, attributed via the deterministic trace id every
    resume-processing execution now carries (see
    recruitment_service._process_claimed_upload and
    services/llmops.py::trace_id_for). Returns has_data: False with a
    `reason` rather than a fabricated $0 whenever attribution isn't
    possible — see each branch below for exactly why.
    """
    from .llmops import trace_id_for

    upload_ids = [r[0] for r in db.query(ResumeUpload.id).filter(
        ResumeUpload.created_at >= since, ResumeUpload.created_at <= until,
    ).all()]
    trace_ids = {trace_id_for(uid) for uid in upload_ids}
    trace_ids.discard(None)
    if not trace_ids:
        return {"has_data": False, "reason": "no_executions"}

    rows = db.query(LLMCostRecord.langfuse_trace_id, LLMCostRecord.cost_usd).filter(
        LLMCostRecord.langfuse_trace_id.in_(trace_ids)
    ).all()
    if not rows:
        return {"has_data": False, "reason": "not_yet_instrumented"}

    priced_trace_ids = {tid for tid, cost in rows if cost is not None}
    if not priced_trace_ids:
        return {"has_data": False, "reason": "unpriced"}

    total_cost = sum(cost for _, cost in rows if cost is not None)
    executions_with_cost = len(priced_trace_ids)
    return {
        "has_data": True,
        "total_cost_usd": round(total_cost, 4),
        "executions_with_cost": executions_with_cost,
        "cost_per_execution_usd": round(total_cost / executions_with_cost, 6),
    }


# ── Time saved (existing outcomes ledger) ───────────────────────────────

def time_saved_summary(db: Session, since: datetime, until: datetime) -> Dict[str, Any]:
    """Reads the existing BusinessOutcomeEvent ledger (api/outcomes.py),
    scoped to workflow_type values prefixed "recruitment." — a convention,
    not a table, so recruitment workflows can start posting to the existing
    POST /outcomes/events endpoint whenever a validated manual baseline is
    available. Nothing in this codebase does that yet, so this honestly
    returns baseline_configured: False today.
    """
    rows = db.query(models.BusinessOutcomeEvent).filter(
        models.BusinessOutcomeEvent.workflow_type.like("recruitment.%"),
        models.BusinessOutcomeEvent.created_at >= since,
        models.BusinessOutcomeEvent.created_at <= until,
    ).all()
    measured = [r for r in rows if r.manual_baseline_minutes is not None and r.human_active_minutes is not None]
    if not measured:
        return {"baseline_configured": False}

    manual_total = sum(r.manual_baseline_minutes for r in measured)
    active_total = sum(r.human_active_minutes for r in measured)
    saved_minutes = sum(max(0.0, r.manual_baseline_minutes - r.human_active_minutes) for r in measured)
    return {
        "baseline_configured": True,
        "sample_count": len(measured),
        "manual_baseline_minutes_avg": round(manual_total / len(measured), 1),
        "agenticflow_minutes_avg": round(active_total / len(measured), 1),
        "time_saved_minutes_total": round(saved_minutes, 1),
        "pct_reduction": round(saved_minutes / manual_total * 100, 1) if manual_total else None,
    }


# ── Recent activity ─────────────────────────────────────────────────────

def recent_activity(db: Session, limit: int = 50) -> List[Dict[str, Any]]:
    rows = (
        db.query(CandidateActivity, User)
        .join(Candidate, Candidate.id == CandidateActivity.candidate_id)
        .outerjoin(User, User.id == CandidateActivity.actor_user_id)
        .filter(_not_demo())
        .order_by(CandidateActivity.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for activity, user in rows:
        payload = activity.payload or {}
        if activity.actor_type == ACTOR_HR:
            actor_label = (user.name or user.email) if user else "HR"
        elif activity.actor_type == "ai":
            actor_label = "AI Agent"
        else:
            actor_label = "System"
        out.append({
            "id": activity.id,
            "time": activity.created_at.isoformat() if activity.created_at else None,
            "user": actor_label,
            "activity": activity.summary,
            "workflow": activity.event_type,
            "status": payload.get("status"),
        })
    return out


# ── Overview (composed) ─────────────────────────────────────────────────

def overview(db: Session, days: int = 30, now: Optional[datetime] = None) -> Dict[str, Any]:
    now, since, _ = period_bounds(days, now)
    mau = monthly_active_users(db, days=30, now=now)
    wau = monthly_active_users(db, days=7, now=now)
    returning = returning_user_rate(db, days=days, now=now)
    executions = ai_executions_summary(db, since, now)
    documents = documents_processed_summary(db, since, now)
    latency = latency_summary(db, since, now)
    interviews = interviews_completed_summary(db, since, now)
    cost = ai_cost_summary(db, since, now)
    time_saved = time_saved_summary(db, since, now)
    registered_users = db.query(func.count(User.id)).scalar() or 0

    return {
        "period_days": days,
        "registered_users": registered_users,
        "monthly_active_users": mau,
        "weekly_active_users": wau,
        "returning_users": returning,
        "ai_executions": executions,
        "documents_processed": documents,
        "latency": latency,
        "interviews_completed": interviews,
        "ai_cost": cost,
        "time_saved": time_saved,
    }


def trends(db: Session, days: int = 30, now: Optional[datetime] = None) -> Dict[str, Any]:
    now, since, _ = period_bounds(days, now)
    return {
        "period_days": days,
        "active_users": active_users_trend(db, since, now),
        "executions": executions_trend(db, since, now),
    }


def breakdown(db: Session, days: int = 30, now: Optional[datetime] = None) -> Dict[str, Any]:
    now, since, _ = period_bounds(days, now)
    return {
        "period_days": days,
        "by_agent": ai_executions_summary(db, since, now)["by_agent"],
        "documents": documents_processed_summary(db, since, now),
        "interviews": interviews_completed_summary(db, since, now),
    }
