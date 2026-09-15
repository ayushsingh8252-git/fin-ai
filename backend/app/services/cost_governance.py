"""Fail-open local cost ledger and budget calculation for LLM generations."""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..database import SessionLocal
from ..models import LLMCostRecord

logger = logging.getLogger(__name__)


def record_generation_cost(
    *, trace_id: str | None, provider: str, model: str,
    usage_details: dict[str, int] | None, cost_details: dict[str, float] | None,
) -> None:
    """Persist a compact measurement row. Failure must never affect an LLM call."""
    usage_details = usage_details or {}
    measured_cost = sum(cost_details.values()) if cost_details else None
    db = SessionLocal()
    try:
        db.add(LLMCostRecord(
            id=str(uuid.uuid4()),
            langfuse_trace_id=trace_id,
            provider=provider,
            model=model,
            input_tokens=usage_details.get("input_tokens"),
            output_tokens=usage_details.get("output_tokens"),
            cache_read_input_tokens=usage_details.get("cache_read_input_tokens"),
            cost_usd=measured_cost,
            cost_source="configured_rate_card" if measured_cost is not None else "unpriced",
        ))
        db.commit()
    except Exception as exc:
        logger.warning("[LLMOps] Failed to persist cost record: %s", exc)
        db.rollback()
    finally:
        db.close()


def budget_config() -> dict[str, float]:
    try:
        raw = json.loads(settings.LLM_COST_BUDGETS_JSON)
    except (TypeError, ValueError):
        logger.warning("[LLMOps] LLM_COST_BUDGETS_JSON is invalid; budgets disabled.")
        return {}
    if not isinstance(raw, dict):
        return {}
    return {key: float(value) for key, value in raw.items() if isinstance(value, (int, float)) and value >= 0}


def budget_status(spend: float, limit: float | None, warning_ratio: float) -> dict:
    if limit is None:
        return {"budget_usd": None, "spend_usd": round(spend, 6), "status": "not_configured"}
    ratio = spend / limit if limit else (1.0 if spend else 0.0)
    status = "over_budget" if ratio >= 1 else "warning" if ratio >= warning_ratio else "ok"
    return {
        "budget_usd": limit,
        "spend_usd": round(spend, 6),
        "remaining_usd": round(max(0.0, limit - spend), 6),
        "utilization": round(ratio, 4),
        "status": status,
    }


def cost_summary(db) -> dict:
    now = datetime.now(timezone.utc)
    records = db.query(LLMCostRecord).all()

    def spend_since(start: datetime) -> float:
        return sum(row.cost_usd or 0.0 for row in records if row.created_at and row.created_at >= start)

    cfg = budget_config()
    warning_ratio = cfg.get("warning_ratio", 0.8)
    daily_start = now - timedelta(days=1)
    monthly_start = now - timedelta(days=30)
    priced = [row for row in records if row.cost_usd is not None]
    return {
        "record_count": len(records),
        "priced_record_count": len(priced),
        "unpriced_record_count": len(records) - len(priced),
        "daily": budget_status(spend_since(daily_start), cfg.get("daily_usd"), warning_ratio),
        "monthly": budget_status(spend_since(monthly_start), cfg.get("monthly_usd"), warning_ratio),
        "by_model": {
            model: round(sum(row.cost_usd or 0.0 for row in records if row.model == model), 6)
            for model in sorted({row.model for row in records})
        },
    }
