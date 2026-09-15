"""Business-impact ledger for proving workflow savings with measured data."""
from datetime import datetime, timedelta, timezone
import uuid
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/outcomes", tags=["outcomes"])


class OutcomeEventIn(BaseModel):
    workflow_type: str = Field(min_length=2, max_length=80)
    workflow_id: str = Field(min_length=1, max_length=160)
    langfuse_trace_id: Optional[str] = Field(default=None, max_length=64)
    status: Literal["completed", "failed", "blocked", "cancelled"] = "completed"
    automated: bool = False
    manual_baseline_minutes: Optional[float] = Field(default=None, ge=0, le=24 * 60)
    human_active_minutes: Optional[float] = Field(default=None, ge=0, le=24 * 60)
    labor_cost_per_hour_usd: Optional[float] = Field(default=None, ge=0)
    ai_cost_usd: Optional[float] = Field(default=None, ge=0)
    review_outcome: Optional[Literal["accepted", "rework", "rejected"]] = None
    required_rework: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


def _serialize(event: models.BusinessOutcomeEvent) -> dict:
    return {
        "id": event.id,
        "workflow_type": event.workflow_type,
        "workflow_id": event.workflow_id,
        "langfuse_trace_id": event.langfuse_trace_id,
        "status": event.status,
        "automated": event.automated == "true",
        "manual_baseline_minutes": event.manual_baseline_minutes,
        "human_active_minutes": event.human_active_minutes,
        "labor_cost_per_hour_usd": event.labor_cost_per_hour_usd,
        "ai_cost_usd": event.ai_cost_usd,
        "review_outcome": event.review_outcome,
        "required_rework": event.required_rework == "true",
        "metadata": event.metadata_ or {},
        "created_at": event.created_at,
    }


@router.post("/events", status_code=201)
def record_outcome(payload: OutcomeEventIn, db: Session = Depends(get_db)):
    event = models.BusinessOutcomeEvent(
        id=str(uuid.uuid4()),
        workflow_type=payload.workflow_type,
        workflow_id=payload.workflow_id,
        langfuse_trace_id=payload.langfuse_trace_id,
        status=payload.status,
        automated="true" if payload.automated else "false",
        manual_baseline_minutes=payload.manual_baseline_minutes,
        human_active_minutes=payload.human_active_minutes,
        labor_cost_per_hour_usd=payload.labor_cost_per_hour_usd,
        ai_cost_usd=payload.ai_cost_usd,
        review_outcome=payload.review_outcome,
        required_rework="true" if payload.required_rework else "false",
        metadata_=payload.metadata,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize(event)


@router.get("/events")
def list_outcomes(
    workflow_type: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(models.BusinessOutcomeEvent)
    if workflow_type:
        query = query.filter(models.BusinessOutcomeEvent.workflow_type == workflow_type)
    rows = query.order_by(models.BusinessOutcomeEvent.created_at.desc()).limit(limit).all()
    return {"events": [_serialize(row) for row in rows]}


@router.get("/summary")
def outcome_summary(
    workflow_type: Optional[str] = None,
    days: int = Query(default=30, ge=1, le=3650),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = db.query(models.BusinessOutcomeEvent).filter(models.BusinessOutcomeEvent.created_at >= since)
    if workflow_type:
        query = query.filter(models.BusinessOutcomeEvent.workflow_type == workflow_type)
    rows = query.all()

    completed = [row for row in rows if row.status == "completed"]
    automated = [row for row in completed if row.automated == "true"]
    reviewed = [row for row in completed if row.review_outcome]
    measured_time = [
        row for row in completed
        if row.manual_baseline_minutes is not None and row.human_active_minutes is not None
    ]
    saved_minutes = sum(max(0.0, row.manual_baseline_minutes - row.human_active_minutes) for row in measured_time)
    gross_labor_savings = sum(
        max(0.0, row.manual_baseline_minutes - row.human_active_minutes)
        * (row.labor_cost_per_hour_usd or 0.0) / 60
        for row in measured_time
    )
    ai_cost = sum(row.ai_cost_usd or 0.0 for row in completed)
    accepted = sum(row.review_outcome == "accepted" for row in reviewed)
    rework = sum(row.required_rework == "true" or row.review_outcome == "rework" for row in completed)

    return {
        "period_days": days,
        "workflow_type": workflow_type,
        "event_count": len(rows),
        "completed_count": len(completed),
        "automated_completed_count": len(automated),
        "automation_rate": round(len(automated) / len(completed), 4) if completed else None,
        "measured_time_event_count": len(measured_time),
        "human_hours_saved": round(saved_minutes / 60, 2),
        "gross_labor_savings_usd": round(gross_labor_savings, 4),
        "ai_cost_usd": round(ai_cost, 4),
        "net_savings_usd": round(gross_labor_savings - ai_cost, 4),
        "reviewed_count": len(reviewed),
        "review_acceptance_rate": round(accepted / len(reviewed), 4) if reviewed else None,
        "rework_rate": round(rework / len(completed), 4) if completed else None,
    }
