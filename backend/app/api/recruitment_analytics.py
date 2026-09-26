"""Recruitment Analytics API — GET /api/v1/recruitment/analytics/*.

Thin wrapper over services/recruitment_analytics.py, which does the actual
aggregation. Mounted (see main.py) behind the same blanket auth guard as
every other router, then additionally gated per-endpoint by
ACTION_VIEW_ANALYTICS — hr_admin, recruiter and hiring_manager can see
workspace-wide usage numbers; interviewer cannot (same boundary
ACTION_VIEW_TIMELINE already draws for the candidate audit trail).
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..services import recruitment_analytics as analytics
from ..services import recruitment_service as rs
from .deps import get_current_user

router = APIRouter(prefix="/recruitment/analytics", tags=["recruitment-analytics"])

DaysParam = Query(default=30, ge=1, le=365)


def _require_analytics_access(user: User) -> None:
    rs.require_permission(user, rs.ACTION_VIEW_ANALYTICS)


@router.get("/overview")
def get_overview(
    days: int = DaysParam,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_analytics_access(user)
    return analytics.overview(db, days=days)


@router.get("/trends")
def get_trends(
    days: int = DaysParam,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_analytics_access(user)
    return analytics.trends(db, days=days)


@router.get("/breakdown")
def get_breakdown(
    days: int = DaysParam,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_analytics_access(user)
    return analytics.breakdown(db, days=days)


@router.get("/activity")
def get_recent_activity(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_analytics_access(user)
    return {"items": analytics.recent_activity(db, limit=limit)}
