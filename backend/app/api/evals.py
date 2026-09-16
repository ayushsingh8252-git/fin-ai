"""Online evaluation endpoints — a manual trigger (useful in dev, where the
background loop in main.py's lifespan may have nothing configured to wake up
for) and a local pass-rate summary, mirroring api/outcomes.py's shape."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services.online_eval import run_online_eval_once

router = APIRouter(prefix="/evals", tags=["evals"])


@router.post("/online/run-once")
def run_once():
    return run_online_eval_once()


@router.get("/online/summary")
def online_eval_summary(
    workflow_type: Optional[str] = None,
    days: int = Query(default=7, ge=1, le=3650),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    query = db.query(models.OnlineEvalResult).filter(models.OnlineEvalResult.created_at >= since)
    if workflow_type:
        query = query.filter(models.OnlineEvalResult.workflow_type == workflow_type)
    rows = query.all()

    by_check: dict[str, dict[str, int]] = {}
    for row in rows:
        key = f"{row.workflow_type}.{row.check_name}"
        bucket = by_check.setdefault(key, {"passed": 0, "failed": 0})
        bucket["passed" if row.passed == "true" else "failed"] += 1

    for bucket in by_check.values():
        total = bucket["passed"] + bucket["failed"]
        bucket["total"] = total
        bucket["pass_rate"] = round(bucket["passed"] / total, 4) if total else None

    return {
        "period_days": days,
        "workflow_type": workflow_type,
        "total_count": len(rows),
        "by_check": by_check,
    }
