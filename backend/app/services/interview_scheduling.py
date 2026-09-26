"""Recruitment interview scheduling — one flow for all three interview modes.

  ai_screening  a ScreeningSession + a candidate link to the AI interview
                room (/screening-agent/session/{id}); no sign-in needed.
  telephonic    a Sarvam outbound call to the candidate's phone, placed now
                or queued on Celery for the scheduled time.
  human         a panel interview; the Google Meet link comes from the real
                Calendar event (never generated client-side).

Every external step reports what actually happened. A Calendar event is
"created" only when the Calendar API returned one; a call is "placed" only
when Sarvam accepted it. Failures are persisted on Interview.status_detail
so the recruiter sees them, instead of a record that silently says
"scheduled".
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .. import models

logger = logging.getLogger(__name__)

# A telephonic interview scheduled at most this far ahead is dialled
# immediately, in the request, rather than queued.
DIAL_NOW_WINDOW = timedelta(minutes=2)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def interview_link(frontend_base_url: str, session_id: str) -> str:
    return f"{frontend_base_url.rstrip('/')}/screening-agent/session/{session_id}"


def create_calendar_event(
    *,
    summary: str,
    description: str,
    start: datetime,
    duration_minutes: int,
    attendee_emails: List[str],
    add_meet: bool,
) -> Dict[str, Any]:
    """Creates a real event on the connected Google account's primary
    calendar. Returns {"status": "created", event_id, html_link, meet_url}
    or {"status": "failed", "error"} — never a made-up event."""
    from ..mcp import registry
    from ..mcp.base import MCPToolError

    start = _aware(start)
    end = start + timedelta(minutes=duration_minutes)
    connector = registry.get("google_calendar")
    if connector is None:
        return {"status": "failed", "error": "The Google Calendar connector isn't available."}
    try:
        res = connector.call_tool("create_event", {
            "calendar_id": "primary",
            "summary": summary,
            "description": description,
            "start_iso": start.isoformat(),
            "end_iso": end.isoformat(),
            "attendee_emails": [e for e in attendee_emails if e],
            "add_meet": add_meet,
        })
    except MCPToolError as e:
        logger.warning("[scheduling] calendar event not created: %s", e)
        return {"status": "failed", "error": str(e)}
    if not res.get("id"):
        return {"status": "failed", "error": "Google Calendar returned no event id."}
    return {
        "status": "created",
        "event_id": res.get("id"),
        "html_link": res.get("html_link"),
        "meet_url": res.get("meet_url"),
    }


def dial_interview(db: Session, interview_id: str) -> Dict[str, Any]:
    """Places the Sarvam call for a telephonic Interview — shared by the
    scheduling request (call now) and the Celery task (scheduled time).

    Idempotent: only an Interview still in "scheduled" with no call yet is
    dialled, and it's moved to "dialing" before the provider request, so a
    redelivered Celery task can't ring the candidate twice."""
    from fastapi import HTTPException

    from ..api import telephonic

    iv = db.get(models.Interview, interview_id)
    if iv is None:
        return {"status": "missing"}
    if iv.mode != "telephonic" or iv.status != "scheduled" or iv.call_record_id:
        return {"status": "skipped", "interview_status": iv.status}

    cand = db.get(models.Candidate, iv.candidate_id)
    job = db.get(models.Role, iv.job_id)
    if not cand or not cand.phone:
        iv.status = "failed"
        iv.status_detail = "The candidate has no phone number on file, so no call was placed."
        db.commit()
        return {"status": "failed", "detail": iv.status_detail}

    iv.status = "dialing"
    db.commit()

    variables = {
        "resume_summary": cand.summary or "",
        "job_requirements": (job.jd_text if job else "") or "",
    }
    try:
        record = telephonic._dial(cand.phone, cand.name or "", job.title if job else "", variables, db)
    except HTTPException as e:
        iv.status = "failed"
        iv.status_detail = str(e.detail)
        db.commit()
        return {"status": "failed", "detail": iv.status_detail, "http_status": e.status_code}
    except Exception as e:  # provider/network failure outside _dial's own handling
        logger.exception("[scheduling] dial failed for interview %s", interview_id)
        iv.status = "failed"
        iv.status_detail = f"The call could not be placed: {e}"
        db.commit()
        return {"status": "failed", "detail": iv.status_detail}

    iv.call_record_id = record["id"]
    iv.status = "in_progress"
    iv.status_detail = "Call accepted by the telephony provider; waiting for the call result."
    db.commit()
    return {"status": "placed", "call_record_id": record["id"]}


def sync_from_call(db: Session, call_record: models.CallRecord) -> None:
    """Called from the Sarvam webhook: reflect a finished call on the
    Interview it belongs to. Only a completed call with candidate speech
    counts as a completed interview."""
    terminal = {"completed", "no-answer", "busy", "failed", "canceled"}
    if call_record.status not in terminal:
        return
    now = datetime.now(timezone.utc)
    for iv in db.query(models.Interview).filter(models.Interview.call_record_id == call_record.id):
        spoke = any(t.get("role") == "candidate" for t in (call_record.transcript or []))
        if call_record.status == "completed" and spoke:
            iv.status = "completed"
            iv.completed_at = now
            iv.status_detail = None
        else:
            iv.status = "failed"
            reason = call_record.error_message or call_record.status
            iv.status_detail = f"The call ended without an interview ({reason})."
    db.commit()


def queue_telephonic(interview_id: str, eta: datetime) -> Optional[str]:
    """Queue the call for its scheduled time. Returns an error message if
    the task couldn't be queued (the caller records it), else None."""
    try:
        from ..worker import place_interview_call_task

        place_interview_call_task.apply_async(args=[interview_id], eta=_aware(eta))
        return None
    except Exception as e:
        logger.warning("[scheduling] could not queue call for interview %s: %s", interview_id, e)
        return f"The call couldn't be queued for the scheduled time (task queue unavailable: {e})."
