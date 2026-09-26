"""Recruitment Analytics: RBAC, route isolation from other roles, and the
MAU / success-rate / latency / demo-data-exclusion math in
services/recruitment_analytics.py.

Runs against a throwaway SQLite file, never the dev database — same
convention as test_recruitment.py.
"""
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import deps
from app.database import get_db
from app.main import app
from app.models import (
    Application, Candidate, CandidateActivity, FraudScan, ResumeBatch,
    ResumeUpload, Role, User, WorkflowRun,
    HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER,
)
from app.services import recruitment_analytics as analytics

NOW = datetime.now(timezone.utc)


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture()
def SessionFactory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'analytics.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture()
def db(SessionFactory):
    session = SessionFactory()
    yield session
    session.close()


def make_user(db, role, name=None):
    u = User(id=str(uuid.uuid4()), email=f"{role}-{uuid.uuid4().hex[:6]}@example.com", name=name or role, role=role)
    db.add(u)
    db.commit()
    return u


def make_job(db, title=None):
    job = Role(id=str(uuid.uuid4()), title=title or f"Role {uuid.uuid4().hex[:6]}", status="open")
    db.add(job)
    db.commit()
    return job


def make_candidate(db, source="bulk_upload", name="Real Person"):
    cand = Candidate(id=str(uuid.uuid4()), name=name, email=f"{uuid.uuid4().hex[:8]}@example.com", source=source)
    db.add(cand)
    db.commit()
    return cand


def make_application(db, candidate, job):
    app_row = Application(id=str(uuid.uuid4()), candidate_id=candidate.id, job_id=job.id, stage="PROCESSING")
    db.add(app_row)
    db.commit()
    return app_row


@pytest.fixture()
def api(SessionFactory):
    who = {"user": None}

    def _db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[deps.get_current_user] = lambda: who["user"]
    client = TestClient(app)

    def as_user(user):
        who["user"] = user
        return client

    yield SimpleNamespace(client=client, as_user=as_user, Session=SessionFactory)
    app.dependency_overrides.clear()


# ── RBAC ─────────────────────────────────────────────────────────────────

def test_unauthenticated_request_is_401(SessionFactory, monkeypatch):
    """Exercises the real get_current_user dependency (not the
    dependency_overrides used by every other test in this file) with
    ENVIRONMENT forced to "production" — this is exactly the check that
    would have caught the live dev-mode auth bypass: with ENVIRONMENT
    defaulting to "development", this same request would silently succeed
    as an hr_admin dev user instead of returning 401.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    def _db():
        s = SessionFactory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides.pop(deps.get_current_user, None)
    client = TestClient(app)
    try:
        resp = client.get("/api/v1/recruitment/analytics/overview")
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize("role", [HR_ADMIN, RECRUITER, HIRING_MANAGER])
def test_authorized_roles_can_view_analytics(api, db, role):
    user = make_user(db, role)
    client = api.as_user(user)
    resp = client.get("/api/v1/recruitment/analytics/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert "monthly_active_users" in body
    assert "ai_executions" in body


def test_interviewer_is_forbidden(api, db):
    user = make_user(db, INTERVIEWER)
    client = api.as_user(user)
    resp = client.get("/api/v1/recruitment/analytics/overview")
    assert resp.status_code == 403


def test_interviewer_is_forbidden_from_trends_and_breakdown_and_activity(api, db):
    user = make_user(db, INTERVIEWER)
    client = api.as_user(user)
    assert client.get("/api/v1/recruitment/analytics/trends").status_code == 403
    assert client.get("/api/v1/recruitment/analytics/breakdown").status_code == 403
    assert client.get("/api/v1/recruitment/analytics/activity").status_code == 403


# ── MAU ──────────────────────────────────────────────────────────────────

def test_mau_counts_first_time_user_once(db):
    user = make_user(db, RECRUITER)
    job = make_job(db)
    cand = make_candidate(db)
    app_row = make_application(db, cand, job)
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.shortlisted", actor_type="hr", actor_user_id=user.id,
        summary="Shortlisted", created_at=NOW,
    ))
    # Same user, same day, a second action — must not double count.
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.rejected", actor_type="hr", actor_user_id=user.id,
        summary="Rejected", created_at=NOW,
    ))
    db.commit()

    result = analytics.monthly_active_users(db, days=30, now=NOW)
    assert result["current"] == 1


def test_mau_excludes_ai_and_system_attributed_activity(db):
    """A resume being auto-parsed by AI must not inflate human MAU — only
    ACTOR_HR rows with a real actor_user_id count."""
    job = make_job(db)
    cand = make_candidate(db)
    app_row = make_application(db, cand, job)
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.resume_processed", actor_type="ai", actor_user_id=None,
        summary="Resume parsed", created_at=NOW,
    ))
    db.commit()

    result = analytics.monthly_active_users(db, days=30, now=NOW)
    assert result["current"] == 0


def test_mau_excludes_inactive_user_outside_window(db):
    user = make_user(db, RECRUITER)
    job = make_job(db)
    cand = make_candidate(db)
    app_row = make_application(db, cand, job)
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.shortlisted", actor_type="hr", actor_user_id=user.id,
        summary="Shortlisted", created_at=NOW - timedelta(days=45),
    ))
    db.commit()

    result = analytics.monthly_active_users(db, days=30, now=NOW)
    assert result["current"] == 0


def test_mau_counts_distinct_users_across_30_days(db):
    user = make_user(db, RECRUITER)
    job = make_job(db)
    cand = make_candidate(db)
    app_row = make_application(db, cand, job)
    for offset in (1, 10, 20, 29):
        db.add(CandidateActivity(
            id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
            event_type="candidate.shortlisted", actor_type="hr", actor_user_id=user.id,
            summary="Shortlisted", created_at=NOW - timedelta(days=offset),
        ))
    db.commit()

    result = analytics.monthly_active_users(db, days=30, now=NOW)
    assert result["current"] == 1  # same person, many actions -> one active user


def test_returning_user_rate(db):
    returning_user = make_user(db, RECRUITER)
    new_user = make_user(db, RECRUITER)
    job = make_job(db)
    cand = make_candidate(db)
    app_row = make_application(db, cand, job)
    # returning_user was active well before this period...
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.shortlisted", actor_type="hr", actor_user_id=returning_user.id,
        summary="Old activity", created_at=NOW - timedelta(days=90),
    ))
    # ...and again inside it.
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.rejected", actor_type="hr", actor_user_id=returning_user.id,
        summary="Recent activity", created_at=NOW - timedelta(days=2),
    ))
    # new_user only ever shows up inside the period.
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=cand.id, application_id=app_row.id, job_id=job.id,
        event_type="candidate.shortlisted", actor_type="hr", actor_user_id=new_user.id,
        summary="First ever action", created_at=NOW - timedelta(days=1),
    ))
    db.commit()

    result = analytics.returning_user_rate(db, days=30, now=NOW)
    assert result["current_active"] == 2
    assert result["returning"] == 1
    assert result["new"] == 1
    assert result["rate_pct"] == 50.0


# ── AI executions / success rate ────────────────────────────────────────

def test_success_rate_is_success_over_total(db):
    job = make_job(db)
    batch = ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, total_files=4)
    db.add(batch)
    db.commit()
    for status in ("parsed", "parsed", "duplicate", "failed"):
        db.add(ResumeUpload(
            id=str(uuid.uuid4()), batch_id=batch.id, job_id=job.id,
            original_filename=f"{uuid.uuid4().hex}.pdf", status=status,
            created_at=NOW, updated_at=NOW,
        ))
    db.commit()

    result = analytics.ai_executions_summary(db, NOW - timedelta(days=30), NOW + timedelta(seconds=1))
    assert result["total_executions"] == 4
    assert result["successful"] == 3
    assert result["failed"] == 1
    assert result["success_rate_pct"] == 75.0


def test_in_flight_uploads_are_not_counted_as_success_or_failure(db):
    job = make_job(db)
    batch = ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, total_files=1)
    db.add(batch)
    db.commit()
    db.add(ResumeUpload(
        id=str(uuid.uuid4()), batch_id=batch.id, job_id=job.id,
        original_filename="pending.pdf", status="processing", created_at=NOW,
    ))
    db.commit()

    result = analytics.ai_executions_summary(db, NOW - timedelta(days=1), NOW + timedelta(seconds=1))
    assert result["has_data"] is False
    assert result["total_executions"] == 0


def test_workflow_run_failure_counts_toward_failure_rate(db):
    db.add(WorkflowRun(
        id=str(uuid.uuid4()), workflow_type="fraud_check_all", title="Bulk fraud check",
        status="failed", created_at=NOW,
    ))
    db.add(WorkflowRun(
        id=str(uuid.uuid4()), workflow_type="fraud_check_all", title="Bulk fraud check",
        status="completed", created_at=NOW,
    ))
    db.commit()

    result = analytics.ai_executions_summary(db, NOW - timedelta(days=1), NOW + timedelta(seconds=1))
    assert result["total_executions"] == 2
    assert result["failed"] == 1
    assert result["failure_rate_pct"] == 50.0


# ── Demo data exclusion ──────────────────────────────────────────────────

def test_demo_seeded_fraud_scans_are_excluded_from_executions(db):
    job = make_job(db)
    real_cand = make_candidate(db, source="bulk_upload")
    demo_cand = make_candidate(db, source="demo_seed")
    real_app = make_application(db, real_cand, job)
    demo_app = make_application(db, demo_cand, job)

    real_scan = FraudScan(id=str(uuid.uuid4()), filename="r.pdf", status="complete", created_at=NOW)
    demo_scan = FraudScan(id=str(uuid.uuid4()), filename="d.pdf", status="complete", created_at=NOW)
    db.add_all([real_scan, demo_scan])
    db.commit()
    real_app.fraud_scan_id = real_scan.id
    demo_app.fraud_scan_id = demo_scan.id
    db.commit()

    result = analytics.ai_executions_summary(db, NOW - timedelta(days=1), NOW + timedelta(seconds=1))
    fraud_row = next((r for r in result["by_agent"] if r["agent"] == "Fraud Detection"), None)
    assert fraud_row is not None
    assert fraud_row["successful"] == 1  # only the real candidate's scan


def test_demo_seeded_candidates_never_appear_in_recent_activity(db):
    job = make_job(db)
    demo_cand = make_candidate(db, source="demo_seed")
    demo_app = make_application(db, demo_cand, job)
    db.add(CandidateActivity(
        id=str(uuid.uuid4()), candidate_id=demo_cand.id, application_id=demo_app.id, job_id=job.id,
        event_type="candidate.created", actor_type="system", summary="Demo candidate created", created_at=NOW,
    ))
    db.commit()

    items = analytics.recent_activity(db, limit=50)
    assert items == []


# ── Interviews / latency / documents: honest empty states ───────────────

def test_interviews_completed_is_no_data_when_nothing_marks_completion(db):
    result = analytics.interviews_completed_summary(db, NOW - timedelta(days=30), NOW)
    assert result == {"has_data": False, "completed": 0}


def test_latency_uses_resume_upload_timestamps(db):
    job = make_job(db)
    batch = ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, total_files=1)
    db.add(batch)
    db.commit()
    started = NOW - timedelta(seconds=10)
    db.add(ResumeUpload(
        id=str(uuid.uuid4()), batch_id=batch.id, job_id=job.id, original_filename="a.pdf",
        status="parsed", created_at=started, updated_at=NOW,
    ))
    db.commit()

    result = analytics.latency_summary(db, NOW - timedelta(days=1), NOW + timedelta(seconds=1))
    assert result["has_data"] is True
    assert result["sample_count"] == 1
    assert 9 <= result["avg_seconds"] <= 11


def test_documents_processed_counts_only_resolved_as_processed(db):
    job = make_job(db)
    batch = ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, total_files=3)
    db.add(batch)
    db.commit()
    for status in ("parsed", "failed", "queued"):
        db.add(ResumeUpload(
            id=str(uuid.uuid4()), batch_id=batch.id, job_id=job.id,
            original_filename=f"{status}.pdf", status=status, created_at=NOW,
        ))
    db.commit()

    result = analytics.documents_processed_summary(db, NOW - timedelta(days=1), NOW + timedelta(seconds=1))
    assert result["uploaded"] == 3
    assert result["processed"] == 1
    assert result["failed"] == 1
    assert result["in_progress"] == 1
