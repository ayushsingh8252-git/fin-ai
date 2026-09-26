"""Tests for HR Recruitment Panel Phases 3, 4, and 5.
Covers Fraud Scanning, Screening Invites, Interviews, Offers, Inbox, and Workflows.
"""
import os
import uuid
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import get_db
from app.main import app
from app.models import Application, Candidate, CandidateActivity, Interview, Offer, Role, User, WorkflowRun, WorkflowStep, HR_ADMIN, RECRUITER
from app.services import recruitment_service as rs


@pytest.fixture()
def SessionFactory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'recruit_phases.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture()
def db(SessionFactory):
    session = SessionFactory()
    yield session
    session.close()


def make_user(db, role=HR_ADMIN):
    u = User(id=str(uuid.uuid4()), email=f"{role}-{uuid.uuid4().hex[:6]}@example.com", name="Test Admin", role=role)
    db.add(u)
    db.commit()
    return u


def make_job(db, user):
    job = Role(
        id=str(uuid.uuid4()), title="Senior Backend Engineer", jd_text="Looking for a Python specialist.",
        must_have_skills=["Python", "FastAPI"], created_by=user.id, status="open",
    )
    db.add(job)
    db.commit()
    return job


def make_candidate_and_app(db, job, stage="PROCESSING", match_score=85):
    cand = Candidate(
        id=str(uuid.uuid4()),
        name="Alice Walker",
        email="alice@example.com",
        phone="1234567890",
        skills=["Python", "FastAPI", "PostgreSQL"],
        resume_filename="alice_resume.pdf",
    )
    db.add(cand)
    db.commit()

    application = Application(
        id=str(uuid.uuid4()),
        candidate_id=cand.id,
        job_id=job.id,
        stage=stage,
        match_score=match_score,
        ats_score=90,
        skill_match_score=80,
        score_provenance={
            "ats_score": {"status": "computed", "source": "test"},
            "match_score": {"status": "computed", "source": "test"},
            "skill_match_score": {"status": "computed", "source": "test"},
        },
        matched_skills=["Python", "FastAPI"],
        missing_skills=[],
        recommendation="Strong Match",
    )
    db.add(application)
    db.commit()
    return cand, application


@pytest.fixture()
def client(SessionFactory, db):
    from app.api import deps
    user = make_user(db)

    def _override_get_db():
        session = SessionFactory()
        try:
            yield session
        finally:
            session.close()

    def _override_current_user():
        session = SessionFactory()
        try:
            return session.get(User, user.id)
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[deps.get_current_user] = _override_current_user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_candidate_360_endpoint(client, db):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job)

    res = c.get(f"/api/v1/recruitment/applications/{application.id}/360")
    assert res.status_code == 200
    body = res.json()
    assert body["candidate"]["name"] == "Alice Walker"
    assert body["application"]["scores"]["match_score"]["value"] == 85
    assert "offers" in body
    assert isinstance(body["interviews"], list)


def test_screening_invite_endpoint(client, db, monkeypatch):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job, stage="SHORTLISTED")

    # Mock email service so no real network email is sent
    from app.services import email_service
    monkeypatch.setattr(email_service, "send_invite_email", lambda email, role, link: True)

    res = c.post(f"/api/v1/recruitment/applications/{application.id}/screening-invite", json={})
    assert res.status_code == 200
    body = res.json()
    assert "session_id" in body
    assert "interview_link" in body
    assert body["email_sent"] is True

    # Verify session link saved on application
    db.refresh(application)
    assert application.screening_session_id == body["session_id"]


def test_bulk_stage_transition(client, db):
    c, user = client
    job = make_job(db, user)
    cand1, app1 = make_candidate_and_app(db, job, stage="APPLIED")
    cand2, app2 = make_candidate_and_app(db, job, stage="APPLIED")

    res = c.post("/api/v1/recruitment/bulk/stage", json={
        "application_ids": [app1.id, app2.id],
        "stage": "SHORTLISTED",
        "reason": "Bulk shortlisting test",
    })
    assert res.status_code == 200
    body = res.json()
    assert len(body["results"]) == 2
    assert all(r["status"] == "ok" for r in body["results"])

    db.refresh(app1)
    db.refresh(app2)
    assert app1.stage == "SHORTLISTED"
    assert app2.stage == "SHORTLISTED"


def test_schedule_interview(client, db):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job, stage="SHORTLISTED")

    from datetime import datetime, timedelta, timezone
    when = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    res = c.post(f"/api/v1/recruitment/applications/{application.id}/interviews", json={
        "scheduled_at": when,
        "mode": "human",
        "interviewer_email": "interviewer@example.com",
        "add_to_calendar": False,
    })
    assert res.status_code == 200
    body = res.json()
    assert body["interview"]["status"] == "scheduled"
    # No Calendar event -> no Meet link; one is never made up client-side.
    assert body["interview"]["meet_link"] is None
    assert body["steps"]["calendar"]["status"] == "skipped"

    # Check stage auto-advanced to INTERVIEW
    db.refresh(application)
    assert application.stage == "INTERVIEW"


def test_offer_lifecycle(client, db):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job, stage="SHORTLISTED")

    # 1. Create offer
    res = c.post(f"/api/v1/recruitment/applications/{application.id}/offers", json={
        "salary": 140000.0,
        "currency": "USD",
        "equity": "0.5%",
        "start_date": "2026-10-01",
        "notes": "Relocation bonus included",
    })
    assert res.status_code == 200
    offer_data = res.json()
    assert offer_data["salary"] == 140000.0
    assert offer_data["status"] == "draft"
    offer_id = offer_data["id"]

    db.refresh(application)
    assert application.stage == "OFFER"

    # 2. List offers
    res_list = c.get(f"/api/v1/recruitment/applications/{application.id}/offers")
    assert res_list.status_code == 200
    assert len(res_list.json()["items"]) == 1

    # 3. Accept offer -> advances to HIRED
    res_patch = c.patch(f"/api/v1/recruitment/offers/{offer_id}", json={"status": "accepted"})
    assert res_patch.status_code == 200
    assert res_patch.json()["status"] == "accepted"

    db.refresh(application)
    assert application.stage == "HIRED"


def test_inbox_endpoint(client, db):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job, stage="PROCESSING", match_score=85)

    res = c.get("/api/v1/recruitment/inbox")
    assert res.status_code == 200
    body = res.json()
    assert body["total_count"] >= 1
    high_match_items = [i for i in body["items"] if i["category"] == "high_match"]
    assert len(high_match_items) >= 1
    assert high_match_items[0]["application_id"] == application.id


def test_workflows_templates_and_run(client, db):
    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job, stage="PROCESSING", match_score=90)

    # 1. Templates
    res_tmpl = c.get("/api/v1/recruitment/workflows/templates")
    assert res_tmpl.status_code == 200
    templates = res_tmpl.json()["templates"]
    assert len(templates) >= 3

    # 2. Trigger auto_shortlist
    res_run = c.post("/api/v1/recruitment/workflows/runs", json={
        "template_id": "auto_shortlist",
        "job_id": job.id,
        "parameters": {"min_score": 75},
    })
    assert res_run.status_code == 200
    run_body = res_run.json()
    assert run_body["status"] == "completed"
    assert run_body["completed_steps"] == run_body["total_steps"]

    # Verify application got auto-shortlisted
    db.refresh(application)
    assert application.stage == "SHORTLISTED"

    # 3. List runs
    res_runs = c.get(f"/api/v1/recruitment/workflows/runs?job_id={job.id}")
    assert res_runs.status_code == 200
    assert len(res_runs.json()["runs"]) >= 1


def test_whatsapp_messaging_lifecycle(client, db, monkeypatch):
    from app.services import whatsapp_service
    monkeypatch.setattr(whatsapp_service, "send_text_message", lambda to, body: {"messages": [{"id": "wamid.test.123"}]})

    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job)

    # 1. Send WhatsApp message
    res_send = c.post(f"/api/v1/recruitment/applications/{application.id}/whatsapp", json={
        "message": "Hello! Your application for Senior Backend Engineer has been received.",
    })
    assert res_send.status_code == 200
    body = res_send.json()
    assert "1234567890" in body["to_number"]
    assert "Hello!" in body["body"]
    assert body["status"] in ("sent", "queued")

    # 2. Retrieve WhatsApp messages
    res_get = c.get(f"/api/v1/recruitment/applications/{application.id}/whatsapp")
    assert res_get.status_code == 200
    items = res_get.json()["items"]
    assert len(items) >= 1
    assert "1234567890" in items[0]["to_number"]

    # 3. Check candidate 360 includes whatsapp_messages
    res_360 = c.get(f"/api/v1/recruitment/applications/{application.id}/360")
    assert res_360.status_code == 200
    assert "whatsapp_messages" in res_360.json()
    assert len(res_360.json()["whatsapp_messages"]) >= 1


def test_telephonic_call_lifecycle(client, db, monkeypatch):
    from app.api import telephonic
    monkeypatch.setattr(telephonic, "_dial", lambda **kw: None)

    c, user = client
    job = make_job(db, user)
    cand, application = make_candidate_and_app(db, job)

    # 1. Trigger telephonic screening call
    res_call = c.post(f"/api/v1/recruitment/applications/{application.id}/telephonic", json={
        "objective": "screening",
    })
    assert res_call.status_code == 200
    call_body = res_call.json()
    assert "1234567890" in call_body["to_number"]
    assert call_body["status"] in ("completed", "in-progress", "queued")

    # 2. Retrieve telephonic calls
    res_get = c.get(f"/api/v1/recruitment/applications/{application.id}/telephonic")
    assert res_get.status_code == 200
    items = res_get.json()["items"]
    assert len(items) >= 1
    assert "1234567890" in items[0]["to_number"]

    # 3. Check candidate 360 includes telephonic_calls
    res_360 = c.get(f"/api/v1/recruitment/applications/{application.id}/360")
    assert res_360.status_code == 200
    assert "telephonic_calls" in res_360.json()
    assert len(res_360.json()["telephonic_calls"]) >= 1

