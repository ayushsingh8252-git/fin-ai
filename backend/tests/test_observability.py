"""services/trace.py + api/observability.py — trace persistence and lookup,
independent of the actual /query pipeline (no LLM/Pinecone calls needed)."""
from fastapi.testclient import TestClient

from app.main import app
from app.services.trace import new_trace, persist_trace

client = TestClient(app)


def test_trace_lookup_404_for_unknown_request_id():
    response = client.get("/api/v1/observability/trace/req_does_not_exist")
    assert response.status_code == 404


def test_trace_persist_and_lookup_roundtrip():
    trace = new_trace("/api/v1/query", "what is the refund policy?", document_id="doc-123", top_k=5)
    trace["crag"] = {"grade": "HIGH", "confidence": 0.9}
    trace["final"] = {"latency_ms": 123.4, "source_count": 2}
    persist_trace(trace, status="ok")

    response = client.get(f"/api/v1/observability/trace/{trace['request_id']}")
    assert response.status_code == 200
    data = response.json()
    assert data["request_id"] == trace["request_id"]
    assert data["status"] == "ok"
    assert data["document_id"] == "doc-123"
    assert data["trace"]["crag"]["grade"] == "HIGH"


def test_stats_endpoint_returns_shape_with_no_data_or_more():
    response = client.get("/api/v1/observability/stats?limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "sample_size" in data
