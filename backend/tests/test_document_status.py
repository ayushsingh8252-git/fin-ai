"""
Ingestion status state machine (uploaded -> processing -> completed/failed),
and the idempotent reprocess endpoint — see api/upload.py, api/rules.py,
worker.py. Exercises the DB/API layer directly (creating Document/Chunk/Rule
rows without running real parsing/embedding/LLM calls) so these run fast and
don't need Pinecone/Groq/Gemini credentials or a loaded embedding model.
"""
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import Document, Chunk, Rule

client = TestClient(app)


@pytest.fixture
def doc_id():
    """Creates a bare Document row (no metadata_) and cleans it up after."""
    doc_id = f"test-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        db.add(Document(id=doc_id, name="test.txt"))
        db.commit()
        yield doc_id
    finally:
        db.query(Rule).filter(Rule.document_id == doc_id).delete()
        db.query(Chunk).filter(Chunk.document_id == doc_id).delete()
        db.query(Document).filter(Document.id == doc_id).delete()
        db.commit()
        db.close()


def test_status_defaults_to_uploaded_not_completed(doc_id):
    """A Document row with no metadata_.status yet (the split-second window
    before the ingestion thread sets "processing") must never report
    "completed" — that was the exact race-condition bug this test guards."""
    response = client.get(f"/api/v1/rules?document_id={doc_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "uploaded"
    assert data["rules"] == []


def test_status_reflects_metadata(doc_id):
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        doc.metadata_ = {"status": "failed", "error": "parse error: corrupt PDF"}
        db.commit()
    finally:
        db.close()

    response = client.get(f"/api/v1/rules?document_id={doc_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "failed"
    assert data["error"] == "parse error: corrupt PDF"


def test_query_blocked_for_unready_document(doc_id):
    """The document-readiness gate in api/query.py (fixed 2026-08-26 after a
    live QA pass found it missing — docs/platform-status-audit-2026-08-26-
    rag-e2e-qa.md, Bug #3): a document-scoped query against a document that
    isn't "completed" must be refused with a clear, honest message instead
    of silently falling through retrieval into a web-search-sourced answer
    that never mentions the document has no usable content. This returns
    before any retrieval/LLM call happens, so it's safe to run without
    Pinecone/Groq/Gemini credentials."""
    response = client.post("/api/v1/query", json={"query": "What does this document say?", "document_id": doc_id})
    assert response.status_code == 200
    data = response.json()
    assert data["retrieval_mode"] == "document_not_ready"
    assert data["document_status"] == "uploaded"
    assert data["sources"] == []
    assert "indexed" in data["answer"].lower() or "process" in data["answer"].lower()


def test_query_blocked_with_failed_reason_surfaced(doc_id):
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        doc.metadata_ = {"status": "failed", "error": "Failed to parse PDF: corrupt file"}
        db.commit()
    finally:
        db.close()

    response = client.post("/api/v1/query", json={"query": "What does this document say?", "document_id": doc_id})
    assert response.status_code == 200
    data = response.json()
    assert data["retrieval_mode"] == "document_not_ready"
    assert data["document_status"] == "failed"
    assert "corrupt file" in data["answer"]


def test_query_blocked_for_nonexistent_document():
    response = client.post("/api/v1/query", json={"query": "anything", "document_id": "totally-fake-doc-id"})
    assert response.status_code == 200
    data = response.json()
    assert data["retrieval_mode"] == "document_not_ready"
    assert data["document_status"] == "not_found"


def test_reprocess_missing_document_404():
    response = client.post("/api/v1/documents/does-not-exist/reprocess")
    assert response.status_code == 404


def test_reprocess_without_file_path_400s_and_preserves_data(doc_id):
    """A document uploaded before file_path was persisted in metadata_ (or
    whose file was deleted from disk) can't be safely reprocessed — this must
    fail loudly with a 400 and leave existing chunks/rules untouched, not
    silently delete them and then discover there's nothing to rebuild from."""
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        doc.metadata_ = {"status": "failed"}
        db.add(Chunk(id=f"{doc_id}-c1", document_id=doc_id, page=1, section="General", content="hello world"))
        db.commit()
    finally:
        db.close()

    response = client.post(f"/api/v1/documents/{doc_id}/reprocess")
    assert response.status_code == 400

    db = SessionLocal()
    try:
        remaining = db.query(Chunk).filter(Chunk.document_id == doc_id).count()
        assert remaining == 1, "existing chunk must survive a rejected reprocess request"
    finally:
        db.close()
