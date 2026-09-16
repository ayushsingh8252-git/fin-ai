"""Human feedback loop (services/feedback.py, api/feedback.py) — a vote must
always persist locally, and must push a Langfuse score only when Langfuse is
actually configured, mirroring test_prompt_management.py's mocking style."""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import FeedbackEvent
from app.services.feedback import record_feedback
from app.services.llmops import trace_id_for

Base.metadata.create_all(bind=engine)

client = TestClient(app)


def test_record_feedback_persists_locally_without_langfuse():
    with patch("app.services.feedback.get_langfuse", return_value=None):
        event = record_feedback(workflow_type="rag", subject_id="req-abc-1", rating="up")

    assert event.workflow_type == "rag"
    assert event.rating == "up"
    assert event.langfuse_trace_id == trace_id_for("req-abc-1")

    db = SessionLocal()
    try:
        row = db.query(FeedbackEvent).filter(FeedbackEvent.id == event.id).first()
        assert row is not None
        assert row.subject_id == "req-abc-1"
    finally:
        db.close()


def test_record_feedback_pushes_score_when_langfuse_configured():
    fake_lf = MagicMock()
    with patch("app.services.feedback.get_langfuse", return_value=fake_lf):
        record_feedback(workflow_type="fraud", subject_id="scan-xyz", rating="down", comment="wrong verdict")

    fake_lf.create_score.assert_called_once()
    _, kwargs = fake_lf.create_score.call_args
    assert kwargs["trace_id"] == trace_id_for("scan-xyz")
    assert kwargs["value"] == 0.0
    assert kwargs["name"] == "user_feedback"


def test_record_feedback_rejects_invalid_rating():
    try:
        record_feedback(workflow_type="rag", subject_id="req-1", rating="sideways")
    except ValueError:
        return
    raise AssertionError("an invalid rating must be rejected")


def test_feedback_events_endpoint_rejects_bad_rating():
    response = client.post(
        "/api/v1/feedback/events",
        json={"workflow_type": "rag", "subject_id": "req-1", "rating": "sideways"},
    )
    assert response.status_code == 422


def test_feedback_events_endpoint_persists_and_returns_trace_id():
    response = client.post(
        "/api/v1/feedback/events",
        json={"workflow_type": "interview", "subject_id": "report-77", "rating": "up"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["workflow_type"] == "interview"
    assert body["langfuse_trace_id"] == trace_id_for("report-77")
