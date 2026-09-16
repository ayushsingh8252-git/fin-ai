"""Human feedback ledger — thumbs up/down from the RAG, fraud, interview,
screening, and telephonic UIs, correlated to the same Langfuse trace the
result was produced under (see services/feedback.py)."""
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services.feedback import record_feedback

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackEventIn(BaseModel):
    workflow_type: str = Field(min_length=2, max_length=40)
    subject_id: str = Field(min_length=1, max_length=200)
    rating: Literal["up", "down"]
    comment: Optional[str] = Field(default=None, max_length=2000)


def _serialize(event: models.FeedbackEvent) -> dict:
    return {
        "id": event.id,
        "workflow_type": event.workflow_type,
        "subject_id": event.subject_id,
        "langfuse_trace_id": event.langfuse_trace_id,
        "rating": event.rating,
        "comment": event.comment,
        "created_at": event.created_at,
    }


@router.post("/events", status_code=201)
def submit_feedback(payload: FeedbackEventIn):
    try:
        event = record_feedback(
            workflow_type=payload.workflow_type,
            subject_id=payload.subject_id,
            rating=payload.rating,
            comment=payload.comment,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _serialize(event)


@router.get("/events")
def list_feedback(
    workflow_type: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(models.FeedbackEvent)
    if workflow_type:
        query = query.filter(models.FeedbackEvent.workflow_type == workflow_type)
    rows = query.order_by(models.FeedbackEvent.created_at.desc()).limit(limit).all()
    return {"events": [_serialize(row) for row in rows]}


@router.get("/summary")
def feedback_summary(
    workflow_type: Optional[str] = None,
    days: int = Query(default=30, ge=1, le=3650),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = db.query(models.FeedbackEvent).filter(models.FeedbackEvent.created_at >= since)
    if workflow_type:
        query = query.filter(models.FeedbackEvent.workflow_type == workflow_type)
    rows = query.all()

    by_workflow: dict[str, dict[str, Any]] = {}
    for row in rows:
        bucket = by_workflow.setdefault(row.workflow_type, {"up": 0, "down": 0})
        bucket[row.rating] += 1

    for bucket in by_workflow.values():
        total = bucket["up"] + bucket["down"]
        bucket["total"] = total
        bucket["helpful_rate"] = round(bucket["up"] / total, 4) if total else None

    return {
        "period_days": days,
        "workflow_type": workflow_type,
        "total_count": len(rows),
        "by_workflow": by_workflow,
    }
