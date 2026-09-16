"""Human feedback loop — persists a thumbs up/down locally and, when
Langfuse is configured, pushes it as a score on the same trace the result
was produced under. Same fail-open convention as cost_governance.py: a
feedback write must never surface as an error to whoever clicked the button.
"""
import logging
import uuid

from ..database import SessionLocal
from ..models import FeedbackEvent
from .llmops import get_langfuse, trace_id_for

logger = logging.getLogger(__name__)

VALID_RATINGS = {"up", "down"}


def record_feedback(
    *, workflow_type: str, subject_id: str, rating: str, comment: str | None = None,
) -> FeedbackEvent:
    if rating not in VALID_RATINGS:
        raise ValueError(f"rating must be one of {sorted(VALID_RATINGS)}, got {rating!r}")

    langfuse_trace_id = trace_id_for(subject_id)
    event = FeedbackEvent(
        id=str(uuid.uuid4()),
        workflow_type=workflow_type,
        subject_id=subject_id,
        langfuse_trace_id=langfuse_trace_id,
        rating=rating,
        comment=comment,
    )

    db = SessionLocal()
    try:
        db.add(event)
        db.commit()
        db.refresh(event)
    except Exception as exc:
        logger.warning("[LLMOps] Failed to persist feedback event: %s", exc)
        db.rollback()
    finally:
        db.close()

    lf = get_langfuse()
    if lf is not None and langfuse_trace_id:
        try:
            lf.create_score(
                name="user_feedback",
                value=1.0 if rating == "up" else 0.0,
                trace_id=langfuse_trace_id,
                data_type="BOOLEAN",
                comment=comment,
                metadata={"workflow_type": workflow_type},
            )
        except Exception as exc:
            logger.warning("[LLMOps] Failed to push feedback score to Langfuse: %s", exc)

    return event
