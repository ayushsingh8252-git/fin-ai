"""HR recruitment panel: authorization, dedup, idempotency, stage machine,
score provenance, and the upload/API flow.

Runs against a throwaway SQLite file, never the dev database, and stubs the two
AI calls (resume parsing, JD matching) so no LLM key or network is needed. What
is under test here is the recruitment layer's own guarantees, not the LLM.
"""
import os
import subprocess
import sys
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import deps, recruitment
from app.database import get_db
from app.main import app
from app.models import (
    Application, Candidate, CandidateActivity, Interview, ResumeBatch, ResumeUpload, Role, User,
    HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER,
)
from app.services import hiring_service
from app.services import recruitment_service as rs

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Fixtures ─────────────────────────────────────────────────────────────

@pytest.fixture()
def SessionFactory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'recruit.db'}", connect_args={"check_same_thread": False})
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


def make_job(db, owner=None, title=None, jd="Looking for a Python and AWS engineer.", status="open"):
    job = Role(
        id=str(uuid.uuid4()), title=title or f"Engineer {uuid.uuid4().hex[:6]}", jd_text=jd,
        must_have_skills=["Python"], created_by=owner.id if owner else None, status=status,
    )
    db.add(job)
    db.commit()
    return job


PROFILES = {}  # filename -> parsed fields the fake resume parser returns


def profile(name="Alice Johnson", email="alice@example.com", phone="+1 555 123 4567", **over):
    base = {
        "name": name, "email": email, "phone": phone, "experience": "3 Years",
        "skills": ["Python", "AWS"], "summary": "Solid backend engineer.", "ats_score": 82,
        "degraded": False, "resume_text": "Alice Johnson. Python, AWS. 3 years.",
    }
    base.update(over)
    return base


MATCH = {
    "match_score": 91, "matched_skills": ["Python", "AWS"], "missing_skills": ["Terraform"],
    "recommendation": "Strong Match", "degraded": False,
}


@pytest.fixture()
def fake_ai(monkeypatch):
    """Stub the two existing AI functions. Records calls so tests can assert
    when the (expensive) match step was or was not invoked."""
    calls = SimpleNamespace(parse=0, match=0, match_result=dict(MATCH), match_raises=None)
    PROFILES.clear()

    def parse(filename, path):
        calls.parse += 1
        return dict(PROFILES.get(filename) or profile())

    def match(candidate, requirement, role_title="the open role"):
        calls.match += 1
        if calls.match_raises:
            raise calls.match_raises
        return dict(calls.match_result)

    monkeypatch.setattr(hiring_service, "parse_resume_pdf", parse)
    monkeypatch.setattr(hiring_service, "match_candidate_to_requirement", match)
    return calls


def queue_upload(db, job, tmp_path, filename="alice.pdf", batch=None, content=b"%PDF-1.4 fake"):
    batch = batch or ResumeBatch(id=str(uuid.uuid4()), job_id=job.id, total_files=0)
    if batch not in db:
        db.add(batch)
        db.flush()
    upload_id = str(uuid.uuid4())
    path = tmp_path / f"{upload_id}_{filename}"
    path.write_bytes(content)
    up = ResumeUpload(
        id=upload_id, batch_id=batch.id, job_id=job.id, original_filename=filename,
        stored_path=str(path), status="queued",
    )
    db.add(up)
    db.commit()
    return up


def counts(db):
    return {
        "candidates": db.query(func.count(Candidate.id)).scalar(),
        "applications": db.query(func.count(Application.id)).scalar(),
        "activities": db.query(func.count(CandidateActivity.id)).scalar(),
    }


# ── Normalization & dedup ────────────────────────────────────────────────

def test_email_normalization():
    assert rs.normalize_email("  Alice@Example.COM ") == "alice@example.com"
    # Gmail ignores dots and +tags, so these are one mailbox...
    assert rs.normalize_email("a.l.i.c.e+jobs@gmail.com") == "alice@gmail.com"
    assert rs.normalize_email("alice@googlemail.com") == "alice@gmail.com"
    # ...but that is NOT assumed for other domains.
    assert rs.normalize_email("a.lice@corp.com") == "a.lice@corp.com"
    assert rs.normalize_email("alice+x@corp.com") == "alice+x@corp.com"
    for bad in (None, "", "no-at-sign", "@corp.com", "a@nodot"):
        assert rs.normalize_email(bad) is None


def test_name_and_phone_keys():
    assert rs.normalize_name("Dr. José  O'Neil") == "drjosé" + "oneil"
    assert rs.normalize_name("Al") is None  # too short to be a blocking key
    assert rs.normalize_phone("+91 (98765) 43210") == "9876543210"
    assert rs.normalize_phone("12345") is None


@pytest.mark.parametrize("text,expected", [
    ("2.4 Years", 2.4), ("3 years", 3.0), ("5+ yrs", 5.0), ("3 years 6 months", 3.5),
    ("Not specified", None), ("", None), (None, None),
    ("2 years at A, 4 years at B", None),  # ambiguous: refuse to guess
    ("Senior engineer", None),
])
def test_parse_experience_years(text, expected):
    assert rs.parse_experience_years(text) == expected


def test_find_matching_candidate_policy(db):
    c = Candidate(id="c1", email="alice@example.com", email_key="alice@example.com",
                  name="Alice Johnson", name_key="alicejohnson", phone_key="5551234567")
    db.add(c)
    db.commit()
    find = lambda **k: rs.find_matching_candidate(db, **{"email_key": None, "name_key": None, "phone_key": None, **k})

    assert find(email_key="alice@example.com").id == "c1"
    assert find(name_key="alicejohnson", phone_key="5551234567").id == "c1"   # no email: name AND phone
    assert find(name_key="alicejohnson") is None                              # a name alone never merges people
    assert find(phone_key="5551234567") is None                               # nor does a phone alone
    assert find(name_key="alicejohnson", phone_key="0000000000") is None
    assert find() is None


def test_db_refuses_duplicate_email_key_but_allows_many_nulls(db):
    """The DB itself is the last line of defence against a duplicate person."""
    db.add(Candidate(id="a", email_key="x@example.com"))
    db.commit()
    db.add(Candidate(id="b", email_key="x@example.com"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # Resumes with no email are common; they must not collide with each other.
    db.add_all([Candidate(id="n1", email_key=None), Candidate(id="n2", email_key=None)])
    db.commit()


# ── Activity log (the single audit trail) ────────────────────────────────

def test_record_activity_is_idempotent_on_dedupe_key(db):
    db.add(Candidate(id="c1"))
    db.commit()
    kw = dict(candidate_id="c1", event_type="candidate.resume_processed", summary="Parsed", dedupe_key="k1")
    _, created1 = rs.record_activity(db, **kw)
    db.commit()
    row2, created2 = rs.record_activity(db, **kw)
    db.commit()
    assert (created1, created2) == (True, False)
    assert db.query(func.count(CandidateActivity.id)).scalar() == 1
    assert row2.dedupe_key == "k1"


def test_activity_dedupe_key_is_enforced_by_the_database_as_a_backstop(db, SessionFactory):
    """If another transaction wins the key between our pre-check and our
    commit, the unique index refuses the second row (surfacing as an
    IntegrityError the pipeline turns into a re-run) rather than duplicating
    history. After the rollback, the same call simply returns the winner."""
    db.add(Candidate(id="c1"))
    db.commit()
    other = SessionFactory()
    rs.record_activity(other, candidate_id="c1", event_type="e", summary="theirs", dedupe_key="race")
    other.commit()

    class Blind:  # our pre-check "missed" their row
        def filter(self, *a, **k): return self
        def first(self): return None
    real_query, first_call = db.query, {"done": False}
    def query(model, *a, **k):
        if model is CandidateActivity and not first_call["done"]:
            first_call["done"] = True
            return Blind()
        return real_query(model, *a, **k)
    db.query = query
    rs.record_activity(db, candidate_id="c1", event_type="e", summary="mine", dedupe_key="race")
    db.query = real_query
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    row, created = rs.record_activity(db, candidate_id="c1", event_type="e", summary="mine", dedupe_key="race")
    assert created is False and row.summary == "theirs"
    assert db.query(func.count(CandidateActivity.id)).scalar() == 1


def test_pending_duplicate_keys_within_one_transaction_collapse(db):
    db.add(Candidate(id="c1"))
    db.commit()
    kw = dict(candidate_id="c1", event_type="e", summary="s", dedupe_key="same")
    _, first = rs.record_activity(db, **kw)
    _, second = rs.record_activity(db, **kw)   # first is still un-flushed
    db.commit()
    assert (first, second) == (True, False)
    assert db.query(func.count(CandidateActivity.id)).scalar() == 1


def test_activities_without_a_key_always_append(db):
    db.add(Candidate(id="c1"))
    db.commit()
    for _ in range(3):
        rs.record_activity(db, candidate_id="c1", event_type="candidate.shortlisted", summary="HR click")
    db.commit()
    assert db.query(func.count(CandidateActivity.id)).scalar() == 3


# ── Stage machine ────────────────────────────────────────────────────────

def make_app(db, stage="APPLIED"):
    job = make_job(db)
    cand = Candidate(id=str(uuid.uuid4()), name="Bob")
    db.add(cand)
    db.flush()
    a = Application(id=str(uuid.uuid4()), candidate_id=cand.id, job_id=job.id, stage=stage)
    db.add(a)
    db.commit()
    return a


def test_hr_can_walk_the_pipeline_and_every_step_is_audited(db):
    hr = make_user(db, RECRUITER, "Riya")
    a = make_app(db, "APPLIED")
    for target in ("SHORTLISTED", "INTERVIEW", "SELECTED", "OFFER", "HIRED"):
        rs.transition_stage(db, a, target, actor_type=rs.ACTOR_HR, actor_user=hr)
        db.commit()
    assert a.stage == "HIRED"
    rows = db.query(CandidateActivity).filter_by(application_id=a.id).order_by(CandidateActivity.created_at).all()
    assert len(rows) == 5
    assert all(r.actor_type == "hr" and r.actor_user_id == hr.id for r in rows)
    assert rows[0].event_type == "candidate.shortlisted" and rows[0].payload["from"] == "APPLIED"


@pytest.mark.parametrize("start,target", [
    ("APPLIED", "OFFER"), ("APPLIED", "HIRED"), ("SHORTLISTED", "SELECTED"),
    ("HIRED", "REJECTED"), ("PROCESSING", "SHORTLISTED"),
])
def test_illegal_transitions_are_refused_and_leave_no_trace(db, start, target):
    hr = make_user(db, RECRUITER)
    a = make_app(db, start)
    with pytest.raises(rs.InvalidTransition):
        rs.transition_stage(db, a, target, actor_type=rs.ACTOR_HR, actor_user=hr)
    db.rollback()
    assert db.get(Application, a.id).stage == start
    assert db.query(func.count(CandidateActivity.id)).scalar() == 0


def test_ai_can_never_make_a_decision(db):
    """AI recommends, HR decides: every non-human actor is refused everything
    except the automatic PROCESSING -> APPLIED."""
    a = make_app(db, "APPLIED")
    for actor in (rs.ACTOR_AI, rs.ACTOR_SYSTEM):
        for target in ("SHORTLISTED", "REJECTED", "SCREENING"):
            with pytest.raises(rs.InvalidTransition, match="Only a person"):
                rs.transition_stage(db, a, target, actor_type=actor)
    p = make_app(db, "PROCESSING")
    rs.transition_stage(db, p, "APPLIED", actor_type=rs.ACTOR_SYSTEM)  # the one allowed automatic move
    assert p.stage == "APPLIED"


def test_hr_decision_must_name_a_person(db):
    a = make_app(db, "APPLIED")
    with pytest.raises(rs.InvalidTransition, match="attributed"):
        rs.transition_stage(db, a, "SHORTLISTED", actor_type=rs.ACTOR_HR, actor_user=None)


def test_same_stage_and_unknown_stage_are_rejected(db):
    hr = make_user(db, RECRUITER)
    a = make_app(db, "APPLIED")
    with pytest.raises(rs.InvalidTransition, match="already"):
        rs.transition_stage(db, a, "APPLIED", actor_type=rs.ACTOR_HR, actor_user=hr)
    with pytest.raises(rs.InvalidTransition, match="Unknown"):
        rs.transition_stage(db, a, "PROMOTED", actor_type=rs.ACTOR_HR, actor_user=hr)


def test_concurrent_stage_change_does_not_silently_overwrite(db, SessionFactory):
    """Two people act on the same candidate. Both pass the validity check;
    only one write may land, and the other must be told rather than clobber."""
    hr1, hr2 = make_user(db, RECRUITER), make_user(db, RECRUITER)
    a = make_app(db, "APPLIED")
    session2 = SessionFactory()
    a2 = session2.get(Application, a.id)

    rs.transition_stage(db, a, "SHORTLISTED", actor_type=rs.ACTOR_HR, actor_user=hr1)
    db.commit()
    with pytest.raises(rs.InvalidTransition, match="just updated"):
        rs.transition_stage(session2, a2, "REJECTED", actor_type=rs.ACTOR_HR, actor_user=hr2)
    session2.rollback()
    assert db.get(Application, a.id).stage == "SHORTLISTED"
    assert db.query(func.count(CandidateActivity.id)).scalar() == 1  # only the winner is on the record


# ── Score provenance ─────────────────────────────────────────────────────

def test_real_llm_results_are_marked_computed():
    out = rs.build_score_update(profile(), MATCH)
    p = out["score_provenance"]
    assert (out["ats_score"], out["match_score"], out["skill_match_score"]) == (82, 91, 67)  # 2 of 3 skills
    assert p["ats_score"] == {"status": "computed", "source": "llm"}
    assert p["match_score"] == {"status": "computed", "source": "llm"}
    assert p["skill_match_score"] == {"status": "computed", "source": "derived"}
    assert out["analysis_status"] == "completed"


def test_fallback_resume_score_is_never_stored_as_a_number():
    """hiring_service returns ats_score=60 when both LLMs fail. That is a
    placeholder, so it must be stored as None / not_computed."""
    out = rs.build_score_update(profile(degraded=True, ats_score=60, summary="Automated summary unavailable"), MATCH)
    assert out["ats_score"] is None and out["ai_summary"] is None
    assert out["score_provenance"]["ats_score"]["status"] == "not_computed"
    assert out["score_provenance"]["ai_summary"]["status"] == "not_computed"
    assert out["analysis_status"] == "partial"  # match still worked, so not a total failure


def test_defaulted_scores_are_not_computed():
    out = rs.build_score_update(profile(ats_score_defaulted=True), {**MATCH, "match_score_defaulted": True})
    assert out["ats_score"] is None and out["match_score"] is None and out["skill_match_score"] is None
    assert out["analysis_status"] == "failed"


def test_keyword_fallback_match_is_kept_but_labelled_degraded():
    out = rs.build_score_update(profile(), {**MATCH, "degraded": True})
    assert out["match_score"] == 91
    assert out["score_provenance"]["match_score"]["status"] == "degraded"
    assert out["score_provenance"]["match_score"]["source"] == "deterministic"
    # The derived skill score inherits that untrustworthiness.
    assert out["score_provenance"]["skill_match_score"]["status"] == "degraded"


def test_no_match_run_says_why():
    out = rs.build_score_update(profile(), None, "This job has no description to match against.")
    assert out["match_score"] is None
    assert out["score_provenance"]["match_score"]["reason"].startswith("This job has no description")


def test_score_view_fails_closed_without_provenance():
    """A stored number with no provenance entry must be withheld, not shown."""
    a = Application(id="x", ats_score=99, score_provenance={})
    assert rs.score_view(a, "ats_score")["value"] is None
    assert rs.score_view(a, "ats_score")["status"] == "not_computed"
    a2 = Application(id="y", ats_score=80, score_provenance={"ats_score": {"status": "computed", "source": "llm"}})
    assert rs.score_view(a2, "ats_score") == {"value": 80, "status": "computed", "source": "llm", "reason": None}


def test_hiring_service_flags_fallbacks_without_changing_legacy_values(monkeypatch):
    """The provenance flags are additive: the legacy endpoint still gets its 60."""
    def boom(*a, **k): raise RuntimeError("both providers down")
    monkeypatch.setattr(hiring_service, "generate_json", boom)

    fields = hiring_service.extract_resume_fields("cv.pdf", "Jane Doe\njane@example.com\nPython")
    assert fields["degraded"] is True and fields["ats_score"] == 60
    match = hiring_service.match_candidate_to_requirement({"skills": ["Python"]}, "Need Python", "Eng")
    assert match["degraded"] is True

    monkeypatch.setattr(hiring_service, "generate_json", lambda *a, **k: {"name": "Jane", "skills": ["Python"]})
    ok = hiring_service.extract_resume_fields("cv.pdf", "Jane Doe\nPython")
    assert ok["degraded"] is False and ok["ats_score_defaulted"] is True  # model gave no usable score

    monkeypatch.setattr(hiring_service, "generate_json", lambda *a, **k: {"ats_score": 77, "skills": []})
    assert "ats_score_defaulted" not in hiring_service.extract_resume_fields("cv.pdf", "Jane Doe\nPython")
    monkeypatch.setattr(hiring_service, "generate_json", lambda *a, **k: {"match_score": 88})
    good = hiring_service.match_candidate_to_requirement({"skills": []}, "Need Python", "Eng")
    assert good["degraded"] is False and good["match_score"] == 88


def test_model_output_cannot_forge_the_degraded_flag(monkeypatch):
    """`degraded` is set from what actually happened, never from model output."""
    monkeypatch.setattr(hiring_service, "generate_json", lambda *a, **k: {"ats_score": 90, "degraded": True})
    assert hiring_service.extract_resume_fields("cv.pdf", "Jane\nPython")["degraded"] is False


# ── Resume pipeline: idempotency & retry-safety ──────────────────────────

def test_happy_path_creates_one_candidate_one_application_and_history(db, tmp_path, fake_ai):
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    result = rs.process_resume_upload(db, up.id)
    assert result["outcome"] == "parsed"

    assert counts(db)["candidates"] == 1 and counts(db)["applications"] == 1
    app_row = db.query(Application).one()
    assert app_row.stage == "APPLIED" and app_row.match_score == 91 and app_row.ats_score == 82
    cand = db.query(Candidate).one()
    assert cand.email_key == "alice@example.com" and cand.experience_years == 3.0
    persisted = db.get(ResumeUpload, up.id)
    assert cand.resume_file_path == persisted.stored_path
    assert os.path.basename(cand.resume_file_path) == f"{cand.id}_alice.pdf"
    assert os.path.isfile(cand.resume_file_path)
    events = [a.event_type for a in db.query(CandidateActivity).order_by(CandidateActivity.created_at)]
    assert set(events) == {"candidate.created", "candidate.resume_processed", "candidate.analysis_completed", "candidate.stage_changed"}
    assert db.get(ResumeUpload, up.id).status == "parsed"


def test_reprocessing_the_same_upload_creates_nothing_new(db, tmp_path, fake_ai):
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    rs.process_resume_upload(db, up.id)
    before = counts(db)

    again = rs.process_resume_upload(db, up.id)
    assert again == {"outcome": "skipped", "status": "parsed"}
    assert counts(db) == before
    assert fake_ai.parse == 1 and fake_ai.match == 1  # and no AI cost was incurred


def test_forced_replay_of_a_finished_upload_is_still_idempotent(db, tmp_path, fake_ai):
    """Simulates a retry that reaches the pipeline again after the work had
    already committed (status reset by a crash between commit and ack)."""
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    rs.process_resume_upload(db, up.id)
    before = counts(db)

    db.query(ResumeUpload).filter_by(id=up.id).update({"status": "failed"})
    db.commit()
    result = rs.process_resume_upload(db, up.id)

    assert counts(db) == before                       # no new candidate, application or history row
    assert result["status"] == "parsed"               # a replay is not reported as a "duplicate"
    assert fake_ai.match == 1                         # the match was not paid for twice


def test_crash_mid_write_rolls_back_everything_and_a_retry_succeeds(db, tmp_path, fake_ai, monkeypatch):
    """The write phase is one transaction: a failure part-way leaves NO
    candidate/application behind, so the retry cannot create a second one."""
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)

    real = rs.record_activity
    def flaky(db_, **kw):
        if kw["event_type"] == "candidate.analysis_completed":
            raise RuntimeError("db went away")
        return real(db_, **kw)
    monkeypatch.setattr(rs, "record_activity", flaky)

    with pytest.raises(RuntimeError, match="db went away"):
        rs.process_resume_upload(db, up.id)
    assert counts(db) == {"candidates": 0, "applications": 0, "activities": 0}
    failed = db.get(ResumeUpload, up.id)
    assert failed.status == "failed" and "unexpected error" in failed.error

    monkeypatch.setattr(rs, "record_activity", real)
    assert rs.process_resume_upload(db, up.id)["outcome"] == "parsed"
    assert counts(db)["candidates"] == 1 and counts(db)["applications"] == 1


def test_ai_crash_before_any_write_leaves_the_row_retryable(db, tmp_path, fake_ai):
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    fake_ai.match_raises = ConnectionError("provider timeout")
    with pytest.raises(ConnectionError):
        rs.process_resume_upload(db, up.id)
    assert counts(db)["candidates"] == 0
    assert db.get(ResumeUpload, up.id).status == "failed"

    fake_ai.match_raises = None
    assert rs.process_resume_upload(db, up.id)["outcome"] == "parsed"
    assert counts(db)["candidates"] == 1


def test_only_one_caller_wins_the_claim(db, tmp_path, fake_ai):
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    assert rs.claim_upload(db, up.id) is not None
    assert rs.claim_upload(db, up.id) is None          # already processing: a second worker backs off


def test_a_dead_worker_does_not_strand_a_file_forever(db, tmp_path, fake_ai):
    from datetime import timedelta
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    old = rs._utcnow() - rs.PROCESSING_STALE_AFTER - timedelta(minutes=1)
    db.query(ResumeUpload).filter_by(id=up.id).update({"status": "processing", "updated_at": old})
    db.commit()
    assert rs.claim_upload(db, up.id) is not None       # stale: reclaimable

    db.query(ResumeUpload).filter_by(id=up.id).update({"status": "processing", "updated_at": rs._utcnow()})
    db.commit()
    assert rs.claim_upload(db, up.id) is None           # fresh: a live worker still owns it


def test_same_person_uploaded_twice_is_a_duplicate_not_a_second_candidate(db, tmp_path, fake_ai):
    job = make_job(db)
    first = queue_upload(db, job, tmp_path, "alice.pdf")
    second = queue_upload(db, job, tmp_path, "alice-v2.pdf")
    PROFILES["alice-v2.pdf"] = profile(phone="+1 555 999 0000", location="Berlin")

    assert rs.process_resume_upload(db, first.id)["outcome"] == "parsed"
    assert rs.process_resume_upload(db, second.id)["outcome"] == "duplicate"
    assert counts(db)["candidates"] == 1 and counts(db)["applications"] == 1
    assert fake_ai.match == 1                                    # no re-scoring for a duplicate
    cand = db.query(Candidate).one()
    assert cand.location == "Berlin"                              # newer resume refreshed the profile
    assert cand.resume_file_path == db.get(ResumeUpload, second.id).stored_path
    assert os.path.basename(cand.resume_file_path) == f"{cand.id}_alice-v2.pdf"


def test_same_person_applying_to_two_jobs_is_one_candidate_two_applications(db, tmp_path, fake_ai):
    a, b = make_job(db, title="Role A"), make_job(db, title="Role B")
    rs.process_resume_upload(db, queue_upload(db, a, tmp_path).id)
    rs.process_resume_upload(db, queue_upload(db, b, tmp_path).id)
    assert counts(db)["candidates"] == 1 and counts(db)["applications"] == 2


def test_lost_race_on_candidate_insert_reruns_the_write_phase_and_adopts_the_winner(db, tmp_path, fake_ai, monkeypatch):
    """Two workers both look, both find nothing, both insert. The DB's unique
    email_key stops the second; the whole write phase must roll back and be
    re-run so it adopts the winner, leaving exactly one candidate."""
    job = make_job(db)
    db.add(Candidate(id="winner", email="alice@example.com", email_key="alice@example.com", name="Alice"))
    db.commit()

    real, seen = rs.find_matching_candidate, {"n": 0}
    def blind_twice(*a, **k):        # the pre-AI lookup and the first write-phase lookup both "miss" them
        seen["n"] += 1
        return None if seen["n"] <= 2 else real(*a, **k)
    monkeypatch.setattr(rs, "find_matching_candidate", blind_twice)

    up = queue_upload(db, job, tmp_path)
    assert rs.process_resume_upload(db, up.id)["outcome"] == "parsed"
    assert seen["n"] == 3                                   # proves the restart path actually ran
    assert counts(db)["candidates"] == 1
    assert db.query(Application).one().candidate_id == "winner"
    assert db.query(func.count(CandidateActivity.id)).filter(CandidateActivity.dedupe_key == f"resume_processed:{up.id}").scalar() == 1


def test_write_phase_gives_up_after_bounded_attempts_and_leaves_no_partial_rows(db, tmp_path, fake_ai, monkeypatch):
    job = make_job(db)
    db.add(Candidate(id="winner", email="alice@example.com", email_key="alice@example.com"))
    db.commit()
    monkeypatch.setattr(rs, "find_matching_candidate", lambda *a, **k: None)   # never adopts: always collides

    up = queue_upload(db, job, tmp_path)
    with pytest.raises(IntegrityError):
        rs.process_resume_upload(db, up.id)
    assert counts(db) == {"candidates": 1, "applications": 0, "activities": 0}  # only the pre-existing winner
    assert db.get(ResumeUpload, up.id).status == "failed"


def test_degraded_reparse_does_not_overwrite_a_known_good_name(db, tmp_path, fake_ai):
    job = make_job(db)
    a = queue_upload(db, job, tmp_path, "good.pdf")
    b = queue_upload(db, job, tmp_path, "bad.pdf")
    PROFILES["bad.pdf"] = profile(name="EXPERIENCE SUMMARY", degraded=True, ats_score=60)
    rs.process_resume_upload(db, a.id)
    rs.process_resume_upload(db, b.id)
    assert db.query(Candidate).one().name == "Alice Johnson"


def test_degraded_ai_is_stored_honestly_and_the_candidate_is_not_failed(db, tmp_path, fake_ai):
    job = make_job(db)
    PROFILES["alice.pdf"] = profile(degraded=True, ats_score=60, summary="Automated summary unavailable")
    fake_ai.match_result = {**MATCH, "degraded": True}
    rs.process_resume_upload(db, queue_upload(db, job, tmp_path).id)
    a = db.query(Application).one()
    assert a.ats_score is None and a.ai_summary is None                  # placeholder never stored
    assert a.match_score == 91 and a.score_provenance["match_score"]["status"] == "degraded"
    assert a.stage == "APPLIED"                                          # partial AI failure != failed candidate
    assert a.analysis_status == "partial"


def test_unreadable_pdf_fails_with_a_reason_and_creates_no_candidate(db, tmp_path, fake_ai):
    job = make_job(db)
    PROFILES["scan.pdf"] = profile(resume_text="   ")
    up = queue_upload(db, job, tmp_path, "scan.pdf")
    result = rs.process_resume_upload(db, up.id)
    assert result["outcome"] == "failed" and result["retryable"] is False
    assert "No readable text" in db.get(ResumeUpload, up.id).error
    assert counts(db)["candidates"] == 0


def test_missing_file_and_deleted_job_fail_cleanly(db, tmp_path, fake_ai):
    job = make_job(db)
    up = queue_upload(db, job, tmp_path)
    os.remove(up.stored_path)
    assert "missing from storage" in rs.process_resume_upload(db, up.id)["error"]

    job2 = make_job(db)
    up2 = queue_upload(db, job2, tmp_path)
    db.query(ResumeUpload).filter_by(id=up2.id).update({"job_id": job.id})
    db.query(Role).filter_by(id=job.id).delete()
    db.commit()
    assert "no longer exists" in rs.process_resume_upload(db, up2.id)["error"]


def test_job_without_a_description_records_why_no_match_was_run(db, tmp_path, fake_ai):
    job = make_job(db, jd="")
    job.must_have_skills = []
    db.commit()
    rs.process_resume_upload(db, queue_upload(db, job, tmp_path).id)
    a = db.query(Application).one()
    assert a.match_score is None and fake_ai.match == 0
    assert "no description" in a.score_provenance["match_score"]["reason"]


# ── Authorization ────────────────────────────────────────────────────────

def test_job_visibility_by_role(db):
    hr, m1, m2, iv = (make_user(db, r) for r in (RECRUITER, HIRING_MANAGER, HIRING_MANAGER, INTERVIEWER))
    j1, j2 = make_job(db, owner=m1), make_job(db, owner=m2)
    ids = lambda user: {j.id for j in db.query(Role).filter(rs.visible_jobs_filter(user)).all()}

    assert ids(hr) == {j1.id, j2.id}
    assert ids(m1) == {j1.id} and ids(m2) == {j2.id}
    assert ids(iv) == set()                                            # nothing scheduled: nothing visible
    assert ids(SimpleNamespace(role="something_else", id="x", email="x")) == set()  # unknown role fails closed


def test_hiring_manager_scope_is_enforced_in_the_sql_itself(db):
    """Not a post-hoc check: the ownership predicate is in the query, so an
    out-of-scope row is never even loaded."""
    m = make_user(db, HIRING_MANAGER)
    sql = str(db.query(Role).filter(rs.visible_jobs_filter(m)).statement.compile(compile_kwargs={"literal_binds": True}))
    assert "created_by" in sql and m.id in sql
    sql_apps = str(db.query(Application).filter(rs.visible_applications_filter(m)).statement.compile(compile_kwargs={"literal_binds": True}))
    assert "created_by" in sql_apps


def test_interviewer_sees_only_applications_they_are_scheduled_against(db):
    iv = make_user(db, INTERVIEWER)
    mine, theirs = make_app(db, "INTERVIEW"), make_app(db, "INTERVIEW")
    db.add(Interview(id="i1", application_id=mine.id, candidate_id=mine.candidate_id, job_id=mine.job_id,
                     interviewer_email=iv.email.upper()))   # case-insensitive match
    db.commit()
    seen = {a.id for a in db.query(Application).filter(rs.visible_applications_filter(iv)).all()}
    assert seen == {mine.id}
    assert rs.get_application_for_user(db, iv, mine.id).id == mine.id
    with pytest.raises(Exception) as exc:
        rs.get_application_for_user(db, iv, theirs.id)
    assert exc.value.status_code == 404                               # never confirms it exists


def test_permission_matrix():
    u = lambda r: SimpleNamespace(role=r)
    assert rs.has_permission(u(RECRUITER), rs.ACTION_UPLOAD) and rs.has_permission(u(HR_ADMIN), rs.ACTION_MANAGE_USERS)
    assert not rs.has_permission(u(RECRUITER), rs.ACTION_MANAGE_USERS)
    assert not rs.has_permission(u(HIRING_MANAGER), rs.ACTION_UPLOAD)
    assert rs.has_permission(u(HIRING_MANAGER), rs.ACTION_DECIDE)
    assert [a for a in rs.ROLE_PERMISSIONS[INTERVIEWER]] == [rs.ACTION_VIEW]
    assert not rs.has_permission(u("nope"), rs.ACTION_VIEW)


def test_require_role_dependency_and_typo_guard(db):
    guard = deps.require_role(HR_ADMIN)
    assert guard(user=SimpleNamespace(role=HR_ADMIN)).role == HR_ADMIN
    with pytest.raises(Exception) as exc:
        guard(user=SimpleNamespace(role=RECRUITER))
    assert exc.value.status_code == 403
    with pytest.raises(ValueError):
        deps.require_role("hr_admn")                                   # a typo must fail at import, not lock everyone out


def test_agents_cannot_overwrite_a_job_a_person_owns(db, monkeypatch):
    from app.memory import global_memory
    monkeypatch.setattr(global_memory, "SessionLocal", lambda: db)
    monkeypatch.setattr(db, "close", lambda: None)
    owner = make_user(db, RECRUITER)
    owned = make_job(db, owner=owner, title="Data Engineer", jd="HR wrote this JD.")
    agent_row = make_job(db, owner=None, title="Ops Analyst", jd="old agent jd")

    global_memory.upsert_role("Data Engineer", jd_text="some screening form JD")
    global_memory.upsert_role("Ops Analyst", jd_text="new agent jd")
    db.expire_all()
    assert db.get(Role, owned.id).jd_text == "HR wrote this JD."         # owned: agents may only fill blanks
    assert db.get(Role, agent_row.id).jd_text == "new agent jd"          # agent-owned: unchanged behaviour


# ── API (dependency-overridden auth, throwaway DB, fake Celery) ──────────

@pytest.fixture()
def api(SessionFactory, tmp_path, monkeypatch, fake_ai):
    monkeypatch.setattr(recruitment, "RESUME_DIR", str(tmp_path / "resumes"))
    os.makedirs(recruitment.RESUME_DIR, exist_ok=True)
    try:
        from app.rate_limit import limiter
        limiter.reset()
    except Exception:
        pass

    who = {"user": None}
    dispatched = []
    state = SimpleNamespace(broker_up=True, attempts=0)

    class FakeTask:
        @staticmethod
        def delay(upload_id):
            state.attempts += 1
            if not state.broker_up:
                raise ConnectionError("redis unreachable")
            dispatched.append(upload_id)
            return SimpleNamespace(id=f"task-{upload_id[:6]}")

    import app.worker as worker
    monkeypatch.setattr(worker, "process_resume_task", FakeTask)

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

    yield SimpleNamespace(client=client, as_user=as_user, dispatched=dispatched, state=state,
                          Session=SessionFactory, tmp=tmp_path, ai=fake_ai)
    app.dependency_overrides.clear()


PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"


def upload(client, job_id, files, batch_id=None):
    data = {"batch_id": batch_id} if batch_id else None
    return client.post(f"/api/v1/recruitment/jobs/{job_id}/resumes", data=data,
                       files=[("files", (n, c, "application/pdf")) for n, c in files])


def test_me_reports_role_and_permissions_from_the_database(api):
    s = api.Session()
    r = api.as_user(make_user(s, INTERVIEWER)).get("/api/v1/recruitment/me").json()
    assert r["role"] == "interviewer" and r["permissions"] == ["view"]


def test_only_hr_admin_can_manage_roles_and_the_last_admin_is_protected(api):
    s = api.Session()
    admin, rec = make_user(s, HR_ADMIN), make_user(s, RECRUITER)
    assert api.as_user(rec).get("/api/v1/recruitment/users").status_code == 403
    assert api.as_user(rec).patch(f"/api/v1/recruitment/users/{rec.id}/role", json={"role": "hr_admin"}).status_code == 403

    assert api.as_user(admin).patch(f"/api/v1/recruitment/users/{rec.id}/role", json={"role": "hiring_manager"}).status_code == 200
    assert api.as_user(admin).patch(f"/api/v1/recruitment/users/{rec.id}/role", json={"role": "wizard"}).status_code == 422
    last = api.as_user(admin).patch(f"/api/v1/recruitment/users/{admin.id}/role", json={"role": "recruiter"})
    assert last.status_code == 409 and "at least one HR admin" in last.json()["detail"]


def test_create_job_sets_owner_adopts_agent_rows_and_rejects_duplicates(api):
    s = api.Session()
    rec, other = make_user(s, RECRUITER), make_user(s, RECRUITER)
    adopted = make_job(s, owner=None, title="Backend Engineer", jd="agent-made")  # auto-created by a screening session
    adopted.must_have_skills = ["FastAPI"]
    adopted.preferred_skills = ["Docker"]
    s.commit()

    r = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Backend Engineer", "jd_text": "Real JD"})
    assert r.status_code == 201 and r.json()["created_by"] == rec.id and r.json()["jd_text"] == "Real JD"
    assert r.json()["must_have_skills"] == ["FastAPI"] and r.json()["preferred_skills"] == ["Docker"]
    assert s.query(func.count(Role.id)).filter(Role.title == "Backend Engineer").scalar() == 1  # adopted, not duplicated

    dup = api.as_user(other).post("/api/v1/recruitment/jobs", json={"title": "Backend Engineer"})
    assert dup.status_code == 409
    assert api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": ""}).status_code == 422
    assert api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "X", "min_experience_years": -1}).status_code == 422


def test_hiring_manager_sees_and_acts_only_on_own_jobs(api):
    s = api.Session()
    m1, m2, rec = make_user(s, HIRING_MANAGER), make_user(s, HIRING_MANAGER), make_user(s, RECRUITER)
    j1 = api.as_user(m1).post("/api/v1/recruitment/jobs", json={"title": "Job One"}).json()
    j2 = api.as_user(m2).post("/api/v1/recruitment/jobs", json={"title": "Job Two"}).json()

    assert [j["id"] for j in api.as_user(m1).get("/api/v1/recruitment/jobs").json()["jobs"]] == [j1["id"]]
    assert api.as_user(m1).get(f"/api/v1/recruitment/jobs/{j2['id']}").status_code == 404      # exists, but not theirs
    assert api.as_user(m1).get(f"/api/v1/recruitment/jobs/{j2['id']}/candidates").status_code == 404
    assert api.as_user(m1).patch(f"/api/v1/recruitment/jobs/{j2['id']}", json={"status": "closed"}).status_code == 404
    assert len(api.as_user(rec).get("/api/v1/recruitment/jobs").json()["jobs"]) == 2           # recruiter sees all

    # Owner may edit; may not upload (intake is recruiting's job); may not hand the job to someone else.
    assert api.as_user(m1).patch(f"/api/v1/recruitment/jobs/{j1['id']}", json={"location": "Pune"}).status_code == 200
    assert upload(api.as_user(m1), j1["id"], [("a.pdf", PDF)]).status_code == 403
    assert api.as_user(m1).patch(f"/api/v1/recruitment/jobs/{j1['id']}", json={"owner_user_id": m2.id}).status_code == 403


def test_hr_admin_can_reassign_ownership_so_a_manager_can_see_the_job(api):
    s = api.Session()
    admin, rec, mgr = make_user(s, HR_ADMIN), make_user(s, RECRUITER), make_user(s, HIRING_MANAGER)
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Handed Over"}).json()
    assert api.as_user(mgr).get(f"/api/v1/recruitment/jobs/{job['id']}").status_code == 404
    assert api.as_user(admin).patch(f"/api/v1/recruitment/jobs/{job['id']}", json={"owner_user_id": mgr.id}).status_code == 200
    assert api.as_user(mgr).get(f"/api/v1/recruitment/jobs/{job['id']}").status_code == 200
    assert api.as_user(admin).patch(f"/api/v1/recruitment/jobs/{job['id']}", json={"owner_user_id": "ghost"}).status_code == 422


def test_upload_validates_content_queues_work_and_reports_real_progress(api):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Upload Job", "jd_text": "Python"}).json()

    r = upload(api.as_user(rec), job["id"], [
        ("good1.pdf", PDF), ("good2.pdf", PDF),
        ("notes.txt", b"hello"),                 # wrong extension
        ("empty.pdf", b""),                      # empty
        ("fake.pdf", b"MZ\x90\x00 not a pdf"),   # renamed executable: extension lies, content does not
        ("../../etc/evil.pdf", PDF),             # path traversal in the filename
    ])
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] == 3 and len(body["rejected"]) == 3
    reasons = {x["filename"]: x["reason"] for x in body["rejected"]}
    assert "Only PDF" in reasons["notes.txt"] and "empty" in reasons["empty.pdf"] and "not a valid PDF" in reasons["fake.pdf"]

    # Nothing escaped the resume directory, and the traversal name was neutralised.
    stored = [u["filename"] for u in body["uploads"] if u["status"] == "queued"]
    assert "evil.pdf" in stored and not os.path.exists(api.tmp / "etc")
    assert len(os.listdir(recruitment.RESUME_DIR)) == 3

    # Progress is the database's truth: nothing is processed yet, so nothing shows as done.
    st = api.as_user(rec).get(f"/api/v1/recruitment/batches/{body['batch_id']}").json()
    assert st["counts"] == {"queued": 3, "processing": 0, "parsed": 0, "duplicate": 0, "failed": 3} and st["done"] is False
    assert len(api.dispatched) == 3

    # Run the worker for real (AI stubbed) and progress moves for real.
    s2 = api.Session()
    for uid in list(api.dispatched):
        rs.process_resume_upload(s2, uid)
    st = api.as_user(rec).get(f"/api/v1/recruitment/batches/{body['batch_id']}").json()
    assert st["counts"]["queued"] == 0 and st["done"] is True
    assert st["counts"]["parsed"] + st["counts"]["duplicate"] == 3


def test_large_batches_are_sent_in_chunks_sharing_one_batch(api):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Chunked"}).json()
    first = upload(api.as_user(rec), job["id"], [("a.pdf", PDF)]).json()
    second = upload(api.as_user(rec), job["id"], [("b.pdf", PDF)], batch_id=first["batch_id"]).json()
    assert second["batch_id"] == first["batch_id"]
    assert api.as_user(rec).get(f"/api/v1/recruitment/batches/{first['batch_id']}").json()["total"] == 2
    other = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Elsewhere"}).json()
    assert upload(api.as_user(rec), other["id"], [("c.pdf", PDF)], batch_id=first["batch_id"]).status_code == 404

    too_many = [(f"f{i}.pdf", PDF) for i in range(recruitment.MAX_FILES_PER_REQUEST + 1)]
    assert upload(api.as_user(rec), job["id"], too_many).status_code == 413


def test_closed_jobs_refuse_uploads(api):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    job = make_job(s, owner=rec, status="closed")
    assert upload(api.as_user(rec), job.id, [("a.pdf", PDF)]).status_code == 409


def test_broker_outage_fails_files_honestly_and_fast(api):
    """A dead broker must not leave files looking queued, and must not be
    retried once per file (each attempt burns a connect timeout)."""
    s = api.Session()
    rec = make_user(s, RECRUITER)
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Outage"}).json()
    api.state.broker_up = False
    body = upload(api.as_user(rec), job["id"], [(f"f{i}.pdf", PDF) for i in range(8)]).json()

    assert api.state.attempts == 1                                       # tried once, then stopped
    assert all(u["status"] == "failed" and "task queue is unavailable" in u["error"] for u in body["uploads"])
    assert all(u["retryable"] for u in body["uploads"])                  # the files are safe; HR can retry later


def test_retry_requeues_once_and_refuses_when_not_applicable(api):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": "Retry"}).json()
    api.state.broker_up = False
    up = upload(api.as_user(rec), job["id"], [("a.pdf", PDF)]).json()["uploads"][0]
    api.state.broker_up = True

    r = api.as_user(rec).post(f"/api/v1/recruitment/uploads/{up['id']}/retry")
    assert r.status_code == 200 and r.json()["status"] == "queued" and up["id"] in api.dispatched
    again = api.as_user(rec).post(f"/api/v1/recruitment/uploads/{up['id']}/retry")
    assert again.status_code == 409                                      # already queued: not a second dispatch
    assert api.dispatched.count(up["id"]) == 1
    assert api.as_user(rec).post("/api/v1/recruitment/uploads/nope/retry").status_code == 404

    rejected = upload(api.as_user(rec), job["id"], [("x.txt", b"hi")]).json()["uploads"][0]
    assert api.as_user(rec).post(f"/api/v1/recruitment/uploads/{rejected['id']}/retry").status_code == 409  # no stored file


def seed_processed(api, rec, title="Pipeline Job", files=("alice.pdf",)):
    job = api.as_user(rec).post("/api/v1/recruitment/jobs", json={"title": title, "jd_text": "Python and AWS"}).json()
    body = upload(api.as_user(rec), job["id"], [(f, PDF) for f in files]).json()
    s = api.Session()
    for uid in list(api.dispatched):
        rs.process_resume_upload(s, uid)
    api.dispatched.clear()
    return job, body


def test_candidate_list_is_paginated_filterable_and_provenance_aware(api):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    for name, email, skills, ats in [
        ("a.pdf", "ann@x.com", ["Python", "AWS"], 90), ("b.pdf", "bob@x.com", ["Java"], 70), ("c.pdf", "cy@x.com", ["Python"], 60),
    ]:
        PROFILES[name] = profile(name=name[0].upper() * 4 + " Person", email=email, phone=None, skills=skills, ats_score=ats)
    job, _ = seed_processed(api, rec, files=("a.pdf", "b.pdf", "c.pdf"))
    base = f"/api/v1/recruitment/jobs/{job['id']}/candidates"
    get = lambda qs="": api.as_user(rec).get(base + qs).json()

    assert get()["total"] == 3
    assert get("?page_size=2")["total"] == 3 and len(get("?page_size=2")["items"]) == 2
    assert len(get("?page=2&page_size=2")["items"]) == 1
    assert {i["candidate"]["email"] for i in get("?skills=python")["items"]} == {"ann@x.com", "cy@x.com"}
    assert get("?skills=python,aws")["total"] == 1
    assert get("?min_ats=80")["total"] == 1
    assert get("?stage=APPLIED")["total"] == 3 and get("?stage=SHORTLISTED")["total"] == 0
    assert get("?q=bob")["total"] == 1
    assert get("?q=%25")["total"] == 0                       # a literal % is not a wildcard
    assert [i["scores"]["ats_score"]["value"] for i in get("?sort=ats_score&order=asc")["items"]] == [60, 70, 90]
    assert api.as_user(rec).get(base + "?page_size=101").status_code == 422   # bounded: no 500-row dumps
    assert api.as_user(rec).get(base + "?sort=password").status_code == 422   # sort is a whitelist

    item = get()["items"][0]
    assert item["scores"]["match_score"] == {"value": 91, "status": "computed", "source": "llm", "reason": None}


def test_not_computed_scores_never_satisfy_a_score_filter(api, fake_ai):
    s = api.Session()
    rec = make_user(s, RECRUITER)
    PROFILES["alice.pdf"] = profile(degraded=True, ats_score=60)     # ATS placeholder gets dropped
    job, _ = seed_processed(api, rec)
    base = f"/api/v1/recruitment/jobs/{job['id']}/candidates"
    assert api.as_user(rec).get(base + "?min_ats=0").json()["total"] == 0       # None is not >= 0
    item = api.as_user(rec).get(base).json()["items"][0]
    assert item["scores"]["ats_score"]["value"] is None and item["scores"]["ats_score"]["status"] == "not_computed"


def test_hr_stage_decision_is_recorded_with_who_and_conflicts_are_reported(api):
    s = api.Session()
    rec = make_user(s, RECRUITER, "Riya Recruiter")
    job, _ = seed_processed(api, rec)
    item = api.as_user(rec).get(f"/api/v1/recruitment/jobs/{job['id']}/candidates").json()["items"][0]

    ok = api.as_user(rec).post(f"/api/v1/recruitment/applications/{item['id']}/stage", json={"stage": "SHORTLISTED", "reason": "Strong Python"})
    assert ok.status_code == 200 and ok.json()["stage"] == "SHORTLISTED"
    bad = api.as_user(rec).post(f"/api/v1/recruitment/applications/{item['id']}/stage", json={"stage": "HIRED"})
    assert bad.status_code == 409 and "Cannot move" in bad.json()["detail"]

    log = api.as_user(rec).get(f"/api/v1/recruitment/applications/{item['id']}/activity").json()["items"]
    decision = next(a for a in log if a["event_type"] == "candidate.shortlisted")
    assert decision["actor_type"] == "hr" and decision["actor_user_id"] == rec.id
    assert decision["payload"] == {"from": "APPLIED", "to": "SHORTLISTED", "reason": "Strong Python"}
    assert "Riya Recruiter" in decision["summary"]
    assert any(a["actor_type"] == "ai" for a in log)                    # AI work is on the same timeline, labelled as AI


def test_interviewer_is_read_only_scoped_and_redacted(api):
    s = api.Session()
    rec, iv = make_user(s, RECRUITER), make_user(s, INTERVIEWER)
    job, _ = seed_processed(api, rec, files=("alice.pdf", "bob.pdf"))
    PROFILES.update({"bob.pdf": profile(name="Bob Brown", email="bob@example.com", phone=None)})
    items = api.as_user(rec).get(f"/api/v1/recruitment/jobs/{job['id']}/candidates").json()["items"]
    mine = items[0]

    assert api.as_user(iv).get("/api/v1/recruitment/jobs").json()["jobs"] == []         # nothing scheduled yet
    assert api.as_user(iv).get(f"/api/v1/recruitment/applications/{mine['id']}/activity").status_code == 404

    s.add(Interview(id="iv1", application_id=mine["id"], candidate_id=mine["candidate"]["id"], job_id=job["id"], interviewer_email=iv.email))
    s.commit()
    listing = api.as_user(iv).get(f"/api/v1/recruitment/jobs/{job['id']}/candidates").json()
    assert [i["id"] for i in listing["items"]] == [mine["id"]]                           # only their own candidate
    assert listing["items"][0]["candidate"]["email"] is None and listing["items"][0]["candidate"]["phone"] is None
    assert api.as_user(iv).get("/api/v1/recruitment/jobs").json()["jobs"][0]["total_candidates"] == 1

    assert api.as_user(iv).post(f"/api/v1/recruitment/applications/{mine['id']}/stage", json={"stage": "REJECTED"}).status_code == 403
    assert api.as_user(iv).get(f"/api/v1/recruitment/applications/{mine['id']}/activity").status_code == 403  # HR decision history is not theirs
    assert upload(api.as_user(iv), job["id"], [("z.pdf", PDF)]).status_code == 403


def test_resume_download_is_authorized_per_candidate_and_the_generic_route_is_closed(api, monkeypatch):
    s = api.Session()
    rec, iv = make_user(s, RECRUITER), make_user(s, INTERVIEWER)
    job, _ = seed_processed(api, rec)
    item = api.as_user(rec).get(f"/api/v1/recruitment/jobs/{job['id']}/candidates").json()["items"][0]
    cid = item["candidate"]["id"]

    r = api.as_user(rec).get(f"/api/v1/recruitment/candidates/{cid}/resume")
    assert r.status_code == 200 and r.content.startswith(b"%PDF-") and r.headers["content-type"] == "application/pdf"
    assert api.as_user(iv).get(f"/api/v1/recruitment/candidates/{cid}/resume").status_code == 404   # not scheduled with them

    # The generic uploads route only checks "signed in", so it must not serve resumes at all.
    import app.main as main_mod
    uploads_root = str(api.tmp / "uploads")
    os.makedirs(os.path.join(uploads_root, "resumes"), exist_ok=True)
    open(os.path.join(uploads_root, "resumes", "x.pdf"), "wb").write(PDF)
    open(os.path.join(uploads_root, "public.txt"), "w").write("ok")
    monkeypatch.setattr(main_mod, "UPLOADS_ROOT", uploads_root)
    assert api.as_user(iv).get("/uploads/public.txt").status_code == 200              # other uploads unaffected
    assert api.as_user(iv).get("/uploads/resumes/x.pdf").status_code == 404
    assert api.as_user(iv).get("/uploads/resumes/../resumes/x.pdf").status_code == 404


def test_unauthenticated_requests_are_rejected(monkeypatch):
    """No dependency overrides here: the real auth guard applies to the whole router in production."""
    from app.config import settings
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    app.dependency_overrides.clear()
    c = TestClient(app)
    for method, path in [("get", "/api/v1/recruitment/jobs"), ("get", "/api/v1/recruitment/me"),
                         ("post", "/api/v1/recruitment/jobs/x/resumes"), ("get", "/api/v1/recruitment/batches/x")]:
        assert getattr(c, method)(path).status_code == 401, path


def test_timestamps_are_serialized_as_utc_with_an_offset():
    """SQLite returns naive datetimes; without an explicit offset a browser
    would read them as local time."""
    from datetime import datetime, timezone as tz
    assert recruitment._iso(datetime(2026, 9, 19, 10, 0, 0)).endswith("+00:00")
    assert recruitment._iso(datetime(2026, 9, 19, 10, 0, 0, tzinfo=tz.utc)).endswith("+00:00")
    assert recruitment._iso(None) is None


# ── Migration ────────────────────────────────────────────────────────────

def test_migration_upgrades_an_old_database_and_is_safe_to_rerun(tmp_path):
    """Builds a database in the shape it had BEFORE this feature (no role column,
    no recruitment tables), then runs the real alembic migration against it."""
    import sqlite3
    db_path = str(tmp_path / "old.db").replace("\\", "/")
    engine = create_engine(f"sqlite:///{db_path}")
    models.Base.metadata.create_all(engine)
    engine.dispose()
    con = sqlite3.connect(db_path)
    for t in ("interviews", "candidate_activities", "resume_uploads", "resume_batches", "applications", "candidates", "roles", "users"):
        con.execute(f"drop table {t}")
    con.execute("create table users (id varchar primary key, email varchar not null, name varchar, picture varchar, login_count integer, created_at datetime, last_login_at datetime)")
    con.execute("create table roles (id varchar primary key, title varchar, department varchar, jd_text text, must_have_skills json, created_at datetime, updated_at datetime)")
    con.execute("insert into users(id,email) values('u1','old@example.com')")
    con.execute("insert into roles(id,title) values('r1','Legacy Role')")
    con.commit(); con.close()

    env = dict(os.environ, DATABASE_URL=f"sqlite:///{db_path}")
    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR, env=env, capture_output=True, text=True)

    assert alembic("stamp", "a4d7e392c815").returncode == 0
    up = alembic("upgrade", "head")
    assert up.returncode == 0, up.stderr[-800:]
    assert alembic("upgrade", "head").returncode == 0                                  # re-run: no-op, not a crash

    con = sqlite3.connect(db_path)
    tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
    assert {"candidates", "applications", "resume_batches", "resume_uploads", "candidate_activities", "interviews"} <= tables
    assert con.execute("select role from users where id='u1'").fetchone()[0] == "recruiter"   # existing accounts keep full access
    assert con.execute("select status from roles where id='r1'").fetchone()[0] == "draft"
    con.close()
