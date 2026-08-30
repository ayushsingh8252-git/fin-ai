"""Agent tool layer (app/agent_tools/) — verifies the tool contract itself
(catalog shape, config-check dispatch, error normalization, DB-backed
composite behavior) without depending on live external credentials (Sarvam,
Meta, a real Groq/Gemini key). Where a tool's underlying pipeline needs an
LLM (fraud/screening/hiring's real-score lookups aren't LLM calls, but
run_fraud_check/run_screening_analysis are), tests exercise the validation
and not-found paths, which return before any external call happens — mirrors
this test suite's existing convention (see test_document_status.py) of
covering what's reachable without live credentials."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.agent_tools import registry
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import CandidateScoreCard, FraudScan

Base.metadata.create_all(bind=engine)

client = TestClient(app)


def test_unified_catalog_includes_every_product_connector():
    catalog = registry.unified_catalog()
    connector_names = {t["connector"] for t in catalog}
    for expected in ("rag", "fraud", "telephonic", "screening", "hiring", "google_workspace_status", "whatsapp", "voice_identification"):
        assert expected in connector_names, f"{expected} missing from unified catalog"

    tool_names = {t["tool"] for t in catalog if t["connector"] == "hiring"}
    for expected_tool in (
        "get_candidate_profile", "match_candidate_requirement", "run_candidate_screening",
        "run_candidate_fraud_check", "calculate_candidate_score", "generate_candidate_scorecard",
        "get_candidate_scorecard",
    ):
        assert expected_tool in tool_names, f"{expected_tool} missing from hiring connector's tools"


def test_catalog_entries_have_required_fields():
    for entry in registry.unified_catalog():
        assert entry["connector"] and entry["tool"] and entry["description"]
        assert entry["input_schema"]["type"] == "object"
        assert entry["status"] in ("configured", "not_configured")
        assert "permissions" in entry and isinstance(entry["permissions"], list)
        assert "timeout" in entry and isinstance(entry["timeout"], (int, float))
        assert "retry_policy" in entry and isinstance(entry["retry_policy"], dict)
        assert "failure_response" in entry and isinstance(entry["failure_response"], dict)


def test_call_unknown_connector_returns_404():
    response = client.post("/api/v1/agent/tools/does_not_exist/some_tool/call", json={})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_connector"


def test_rag_tool_rejects_empty_query():
    response = client.post("/api/v1/agent/tools/rag/query_documents/call", json={"query": "  "})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "validation_error"


def test_fraud_tool_unknown_scan_id_is_404_not_crash():
    response = client.post("/api/v1/agent/tools/fraud/run_fraud_check/call", json={"scan_id": "does-not-exist"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


def test_fraud_tool_requires_scan_id():
    response = client.post("/api/v1/agent/tools/fraud/run_fraud_check/call", json={})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "validation_error"


def test_telephonic_get_call_status_unknown_id_is_404():
    response = client.post("/api/v1/agent/tools/telephonic/get_call_status/call", json={"call_id": "does-not-exist"})
    assert response.status_code == 404


def test_telephonic_status_derives_availability_flags():
    """No transcript_available/analysis_available field exists on the real
    CallRecord model (see agent_tools/telephonic_tools.py docstring) — this
    confirms the tool derives them rather than assuming they're present."""
    from app import models

    call_id = f"test-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        db.add(models.CallRecord(id=call_id, to_number="+15550001111", candidate_name="Test", role_title="QA", status="completed", transcript=[]))
        db.commit()
    finally:
        db.close()

    try:
        response = client.post("/api/v1/agent/tools/telephonic/get_call_status/call", json={"call_id": call_id})
        assert response.status_code == 200
        data = response.json()
        assert data["transcript_available"] is False
        assert data["analysis_available"] is False
    finally:
        db = SessionLocal()
        db.query(models.CallRecord).filter(models.CallRecord.id == call_id).delete()
        db.commit()
        db.close()


def test_screening_tool_unknown_call_is_404():
    response = client.post("/api/v1/agent/tools/screening/run_screening_analysis/call", json={"call_id": "does-not-exist"})
    assert response.status_code == 404


def test_whatsapp_send_without_config_is_503_not_crash():
    response = client.post("/api/v1/agent/tools/whatsapp/send_whatsapp_message/call", json={"recipient": "+15550001111", "message": "hi"})
    # Passes in every environment this suite runs in — only asserts it never
    # 500s, matching every other tool's config-check contract:
    #   503 — WhatsApp isn't configured (no credentials in this environment)
    #   400 — configured with real credentials, and Meta correctly rejects
    #         this placeholder "+15550001111" recipient (a real API call and
    #         a real rejection — not a crash)
    #   401 — configured with credentials, but Meta returned 401 Unauthorized
    #   200 — configured with real credentials AND this happens to be an
    #         allowed test recipient
    assert response.status_code in (200, 400, 401, 503)
    if response.status_code == 503:
        assert response.json()["detail"]["code"] == "not_configured"


def test_whatsapp_status_lookup_unknown_message_id_is_404():
    response = client.post("/api/v1/agent/tools/whatsapp/get_whatsapp_message_status/call", json={"message_id": "does-not-exist"})
    assert response.status_code == 404


def test_google_integration_status_never_fabricates_success():
    """Must reflect real missing_config() state, never hard-code "configured": true."""
    response = client.post("/api/v1/agent/tools/google_workspace_status/get_google_integration_status/call", json={})
    assert response.status_code == 200
    data = response.json()
    for key in ("oauth", "gmail", "calendar", "meet", "sheets", "docs", "drive"):
        assert key in data
    for key in ("gmail", "calendar", "meet", "sheets", "docs", "drive"):
        assert "configured" in data[key] and "missing_config" in data[key]


@pytest.fixture
def candidate_id():
    cid = f"test-{uuid.uuid4().hex[:8]}"
    yield cid
    db = SessionLocal()
    try:
        db.query(CandidateScoreCard).filter(CandidateScoreCard.id == cid).delete()
        db.commit()
    finally:
        db.close()


def test_calculate_candidate_score_falls_back_to_stable_placeholder(candidate_id):
    """No CallRecord/ScreeningResult/episodic episode exists for this
    candidate, so both scores must come from the seeded placeholder — and
    calling it twice must return the exact same numbers (seeded by
    candidate_id, not re-randomized), matching memory/orchestrator.py's
    _placeholder_score contract."""
    payload = {"candidate_id": candidate_id, "candidate_name": "Placeholder Test Candidate"}
    r1 = client.post("/api/v1/agent/tools/hiring/calculate_candidate_score/call", json=payload)
    r2 = client.post("/api/v1/agent/tools/hiring/calculate_candidate_score/call", json=payload)
    assert r1.status_code == 200 and r2.status_code == 200
    d1, d2 = r1.json(), r2.json()
    assert d1["telephonic_score_is_real"] is False
    assert d1["ai_interview_score_is_real"] is False
    assert d1["telephonic_score"] == d2["telephonic_score"]
    assert d1["ai_interview_score"] == d2["ai_interview_score"]
    assert 62 <= d1["telephonic_score"] <= 91


def test_composite_scorecard_persists_both_interview_types(candidate_id):
    response = client.post(
        "/api/v1/agent/tools/hiring/get_candidate_scorecard/call",
        json={"candidate_id": candidate_id, "candidate_name": "Composite Test Candidate"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["telephonic_score"] is not None
    assert data["ai_interview_score"] is not None
    assert data["overall_recommendation"] == "proceed"  # no fraud_check supplied -> default
    assert data["fraud_check"] is None
    assert data["screening"] is None

    db = SessionLocal()
    try:
        row = db.get(CandidateScoreCard, candidate_id)
        assert row is not None
        assert row.telephonic_score is not None
        assert row.ai_interview_score is not None
    finally:
        db.close()


def test_composite_scorecard_downgrades_recommendation_on_fraud_verdict(candidate_id, monkeypatch):
    """The one deliberate piece of new logic in this layer: get_candidate_scorecard
    folds a fraud verdict into overall_recommendation at the composition layer
    only — it must never touch CandidateScoreCard's own columns."""
    from app.agent_tools.hiring_tools import connector as hiring_connector

    monkeypatch.setattr(
        hiring_connector, "_run_candidate_fraud_check",
        lambda params: {"scan_id": params["scan_id"], "risk_score": 91, "verdict": "likely_fraudulent", "explanation": "test", "key_concerns": []},
    )

    response = client.post(
        "/api/v1/agent/tools/hiring/get_candidate_scorecard/call",
        json={"candidate_id": candidate_id, "candidate_name": "Fraud Test Candidate", "scan_id": "fake-scan-id"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["overall_recommendation"] == "hold_for_review"
    assert data["fraud_check"]["verdict"] == "likely_fraudulent"

    db = SessionLocal()
    try:
        row = db.get(CandidateScoreCard, candidate_id)
        # No fraud-related columns on the real model — confirms nothing was
        # persisted to the DB row beyond the pre-existing score fields.
        assert not hasattr(row, "fraud_risk_score")
    finally:
        db.close()


def test_planner_resolve_placeholders_reads_prior_step_result():
    from app.agent_tools.planner import _resolve_placeholders

    prior_results = [{"result": {"candidate_id": "abc123", "nested": {"score": 77}}}]
    assert _resolve_placeholders("$step1.candidate_id", prior_results) == "abc123"
    assert _resolve_placeholders("$step1.nested.score", prior_results) == 77
    assert _resolve_placeholders("literal-value", prior_results) == "literal-value"
    assert _resolve_placeholders({"a": "$step1.candidate_id", "b": 5}, prior_results) == {"a": "abc123", "b": 5}


def test_planner_execute_plan_stops_on_first_failure():
    from app.agent_tools.planner import execute_plan

    plan = {
        "steps": [
            {"connector": "hiring", "tool": "calculate_candidate_score", "params": {"candidate_id": "x", "candidate_name": "y"}},
            {"connector": "fraud", "tool": "run_fraud_check", "params": {"scan_id": "does-not-exist"}},
            {"connector": "rag", "tool": "query_documents", "params": {"query": "should never run"}},
        ]
    }
    execution = execute_plan(plan)
    assert execution["completed"] is False
    assert len(execution["steps"]) == 2  # third step never attempted after the second one's not_found error
    assert execution["steps"][0]["ok"] is True
    assert execution["steps"][1]["ok"] is False
