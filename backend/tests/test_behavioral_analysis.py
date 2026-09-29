"""OCEAN-AI behavioral analysis: recording upload, persistence, the Celery
task, the API, and RBAC. The actual OCEAN-AI model/ocean-service HTTP call is
mocked everywhere here (see services/ocean_client.py) — this suite verifies
the plumbing around it (status transitions, persistence, auth, retry), not
OCEAN-AI's own predictions. No fabricated OCEAN-AI scores are asserted as if
real; mock return values are clearly synthetic and only used to verify they
flow through to the right DB fields and API shape."""
import io
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import database, models, worker
from app.api import deps
from app.database import get_db
from app.main import app
from app.models import HR_ADMIN, INTERVIEWER, User
from app.services import ocean_client


@pytest.fixture()
def env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'behavioral.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    hr_user = User(id=str(uuid.uuid4()), email="hr@example.com", role=HR_ADMIN, name="HR")
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[deps.get_current_user] = lambda: hr_user
    try:
        from app.rate_limit import limiter
        limiter.reset()
    except Exception:
        pass

    # Recordings would otherwise land in the real repo-relative uploads/
    # dir — redirect to tmp_path so tests never touch real project files.
    import app.api.interview as interview_api
    from app.config import settings

    monkeypatch.setattr(settings, "OCEAN_SERVICE_URL", "http://ocean-service.test")
    monkeypatch.setattr(interview_api, "RECORDING_UPLOAD_DIR", str(tmp_path / "recordings"))
    import os
    os.makedirs(interview_api.RECORDING_UPLOAD_DIR, exist_ok=True)

    s = Session()
    session = models.ScreeningSession(id=str(uuid.uuid4()), email="cand@example.com", role_title="Backend Engineer", status="in_progress")
    s.add(session)
    s.commit()

    yield {"client": TestClient(app), "Session": Session, "session_id": session.id, "hr_user": hr_user}
    app.dependency_overrides.clear()


def _set_role(role: str, user: User):
    app.dependency_overrides[deps.get_current_user] = lambda: User(id=user.id, email=user.email, role=role, name=user.name)


# ── Recording upload ──────────────────────────────────────────────────────

def test_upload_recording_creates_pending_row_and_dispatches_task(env, monkeypatch):
    dispatched = []

    class FakeTask:
        @staticmethod
        def delay(session_id):
            dispatched.append(session_id)

    monkeypatch.setattr(worker, "analyze_candidate_ocean_task", FakeTask)

    res = env["client"].post(
        f"/api/v1/interview/{env['session_id']}/recording",
        files={"file": ("interview.webm", io.BytesIO(b"fake-webm-bytes"), "video/webm")},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "queued"
    assert dispatched == [env["session_id"]]

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row is not None
    assert row.status == "pending"
    assert row.recording_path
    s.close()


def test_upload_refused_when_ocean_service_not_configured(env, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "OCEAN_SERVICE_URL", "")
    res = env["client"].post(
        f"/api/v1/interview/{env['session_id']}/recording",
        files={"file": ("interview.webm", io.BytesIO(b"fake-webm-bytes"), "video/webm")},
    )
    assert res.status_code == 503
    s = env["Session"]()
    assert s.query(models.InterviewBehavioralAnalysis).count() == 0
    s.close()


def test_upload_recording_rejects_unsupported_content_type(env):
    res = env["client"].post(
        f"/api/v1/interview/{env['session_id']}/recording",
        files={"file": ("interview.txt", io.BytesIO(b"not a video"), "text/plain")},
    )
    assert res.status_code == 415


def test_upload_recording_unknown_session_404s(env):
    res = env["client"].post(
        f"/api/v1/interview/{uuid.uuid4()}/recording",
        files={"file": ("interview.webm", io.BytesIO(b"data"), "video/webm")},
    )
    assert res.status_code == 404


def test_upload_recording_empty_file_rejected(env, monkeypatch):
    monkeypatch.setattr(worker, "analyze_candidate_ocean_task", type("T", (), {"delay": staticmethod(lambda *a: None)}))
    res = env["client"].post(
        f"/api/v1/interview/{env['session_id']}/recording",
        files={"file": ("interview.webm", io.BytesIO(b""), "video/webm")},
    )
    assert res.status_code == 400


# ── GET behavioral-analysis states ────────────────────────────────────────

def test_get_behavioral_analysis_not_requested_when_no_row(env):
    res = env["client"].get(f"/api/v1/interview/{env['session_id']}/behavioral-analysis")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "not_requested"
    assert body["results"] is None


def _seed_row(env, **overrides):
    s = env["Session"]()
    overrides.setdefault("recording_path", "uploads/interview_recordings/x.mp4")
    row = models.InterviewBehavioralAnalysis(
        id=str(uuid.uuid4()),
        session_id=env["session_id"],
        status=overrides.pop("status", "pending"),
        **overrides,
    )
    s.add(row)
    s.commit()
    s.close()


def test_get_behavioral_analysis_pending(env):
    _seed_row(env, status="pending")
    res = env["client"].get(f"/api/v1/interview/{env['session_id']}/behavioral-analysis")
    assert res.status_code == 200
    assert res.json()["status"] == "pending"
    assert res.json()["results"] is None


def test_get_behavioral_analysis_failed_never_returns_fake_scores(env):
    _seed_row(env, status="failed", error_message="ocean-service unreachable")
    res = env["client"].get(f"/api/v1/interview/{env['session_id']}/behavioral-analysis")
    body = res.json()
    assert body["status"] == "failed"
    assert body["error"] == "ocean-service unreachable"
    assert body["results"] is None  # never a fabricated score on failure


def test_get_behavioral_analysis_completed_returns_real_persisted_scores(env):
    _seed_row(
        env,
        status="completed",
        audio_results={"openness": 0.6, "non_neuroticism": 0.4},
        video_results={"openness": 0.55},
        audio_video_results={"openness": 0.58, "conscientiousness": 0.7},
        model_name="OCEAN-AI",
        model_version="1.0.0a48",
        processing_completed_at=datetime.now(timezone.utc),
    )
    res = env["client"].get(f"/api/v1/interview/{env['session_id']}/behavioral-analysis")
    body = res.json()
    assert body["status"] == "completed"
    assert body["source"] == {"audio": True, "video": True, "fusion": True}
    assert body["results"]["audio"]["non_neuroticism"] == 0.4  # library's own terminology preserved, not "neuroticism"
    assert body["model"] == {"name": "OCEAN-AI", "version": "1.0.0a48"}


def test_get_behavioral_analysis_requires_auth(env):
    app.dependency_overrides.pop(deps.get_current_user, None)
    res = env["client"].get(f"/api/v1/interview/{env['session_id']}/behavioral-analysis")
    assert res.status_code == 401


# ── Retry ──────────────────────────────────────────────────────────────────

def test_retry_requires_analyze_permission_not_just_view(env):
    """INTERVIEWER only has ACTION_VIEW (read-only) — triggering a multi-minute
    re-analysis is an action, and must be forbidden for that role."""
    _seed_row(env, status="failed", error_message="boom")
    _set_role(INTERVIEWER, env["hr_user"])
    res = env["client"].post(f"/api/v1/interview/{env['session_id']}/behavioral-analysis/retry")
    assert res.status_code == 403


def test_retry_dispatches_task_and_resets_status(env, monkeypatch):
    dispatched = []
    monkeypatch.setattr(
        worker, "analyze_candidate_ocean_task",
        type("T", (), {"delay": staticmethod(lambda sid: dispatched.append(sid))}),
    )
    _seed_row(env, status="failed", error_message="boom")

    res = env["client"].post(f"/api/v1/interview/{env['session_id']}/behavioral-analysis/retry")
    assert res.status_code == 200
    assert dispatched == [env["session_id"]]

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row.status == "pending"
    assert row.error_message is None
    s.close()


def test_retry_without_existing_row_404s(env):
    res = env["client"].post(f"/api/v1/interview/{env['session_id']}/behavioral-analysis/retry")
    assert res.status_code == 404


def test_retry_while_processing_conflicts(env):
    _seed_row(env, status="processing")
    res = env["client"].post(f"/api/v1/interview/{env['session_id']}/behavioral-analysis/retry")
    assert res.status_code == 409


# ── Celery task (execute_analyze_candidate_ocean) ──────────────────────────

def test_execute_task_missing_recording_file_marks_failed_not_retryable(env, tmp_path, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", env["Session"])
    _seed_row(env, status="pending", recording_path=str(tmp_path / "does-not-exist.mp4"))

    result = worker.execute_analyze_candidate_ocean(env["session_id"])
    assert result["status"] == "error"

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row.status == "failed"
    assert "no longer exists" in row.error_message
    s.close()


def test_execute_task_success_persists_all_three_modalities(env, tmp_path, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", env["Session"])
    recording = tmp_path / "rec.mp4"
    recording.write_bytes(b"not a real video, just needs to exist")
    _seed_row(env, status="pending", recording_path=str(recording))

    fake_result = {
        "results": {
            "audio": {"openness": 0.5, "non_neuroticism": 0.5},
            "video": {"openness": 0.5, "non_neuroticism": 0.5},
            "audio_video": {"openness": 0.5, "non_neuroticism": 0.5},
        },
        "model": {"name": "OCEAN-AI", "version": "1.0.0a48"},
    }
    monkeypatch.setattr(ocean_client, "analyze_recording", lambda video_path, session_id: fake_result)

    result = worker.execute_analyze_candidate_ocean(env["session_id"])
    assert result["status"] == "success"

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row.status == "completed"
    assert row.audio_results["openness"] == 0.5
    assert row.model_version == "1.0.0a48"
    s.close()


def test_execute_task_nonretryable_service_error_marks_failed(env, tmp_path, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", env["Session"])
    recording = tmp_path / "rec.mp4"
    recording.write_bytes(b"x")
    _seed_row(env, status="pending", recording_path=str(recording))

    def _raise(video_path, session_id):
        raise ocean_client.OceanServiceError("corrupt recording", retryable=False)

    monkeypatch.setattr(ocean_client, "analyze_recording", _raise)

    result = worker.execute_analyze_candidate_ocean(env["session_id"])
    assert result["status"] == "error"

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row.status == "failed"
    assert "corrupt recording" in row.error_message
    s.close()


def test_execute_task_transient_service_error_reraises_for_celery_retry(env, tmp_path, monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", env["Session"])
    recording = tmp_path / "rec.mp4"
    recording.write_bytes(b"x")
    _seed_row(env, status="pending", recording_path=str(recording))

    def _raise(video_path, session_id):
        raise ocean_client.OceanServiceError("ocean-service unreachable", retryable=True)

    monkeypatch.setattr(ocean_client, "analyze_recording", _raise)

    with pytest.raises(ocean_client.OceanServiceError):
        worker.execute_analyze_candidate_ocean(env["session_id"])

    s = env["Session"]()
    row = s.query(models.InterviewBehavioralAnalysis).filter_by(session_id=env["session_id"]).first()
    assert row.status == "failed"
    assert "unreachable" in row.error_message
    s.close()


# ── ocean_client ────────────────────────────────────────────────────────

def test_ocean_client_raises_not_configured_when_url_unset(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "OCEAN_SERVICE_URL", "")
    with pytest.raises(ocean_client.OceanServiceNotConfigured):
        ocean_client.analyze_recording("/tmp/x.mp4", "session-1")
