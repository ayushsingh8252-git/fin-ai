"""HR Command Center API (api/agent.py): recruitment RBAC, the HR tool
allowlist, resume attachments, and the resume path guard in hiring_tools.
No LLM or external service is called."""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import deps
from app.database import get_db
from app.main import app
from app.models import HR_ADMIN, INTERVIEWER, RECRUITER, User

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'agent.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    monkeypatch.chdir(tmp_path)  # uploads/agent is created relative to cwd
    who = {"user": None}

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[deps.get_current_user] = lambda: who["user"]
    try:
        from app.rate_limit import limiter
        limiter.reset()
    except Exception:
        pass
    c = TestClient(app)

    def as_role(role):
        who["user"] = User(id=str(uuid.uuid4()), email=f"{role}@example.com", role=role)
        return c

    yield as_role
    app.dependency_overrides.clear()


def test_interviewer_cannot_use_command_center(client):
    c = client(INTERVIEWER)
    assert c.get("/api/v1/agent/tools").status_code == 403
    assert c.post("/api/v1/agent/plan", json={"prompt": "hi"}).status_code == 403
    assert c.post("/api/v1/agent/tools/rag/query_documents/call", json={"query": "x"}).status_code == 403


def test_catalog_is_limited_to_hr_tools(client):
    tools = client(RECRUITER).get("/api/v1/agent/tools").json()["tools"]
    pairs = {(t["connector"], t["tool"]) for t in tools}
    assert ("hiring", "get_candidate_profile") in pairs
    assert ("gmail", "send_email") in pairs
    # Reading the owner's inbox / calendar and non-HR connectors are not exposed.
    assert ("gmail", "list_messages") not in pairs
    assert ("google_calendar", "delete_event") not in pairs
    assert not any(c == "github" for c, _ in pairs)


def test_non_hr_tool_call_is_forbidden(client):
    r = client(HR_ADMIN).post("/api/v1/agent/tools/github/list_repositories/call", json={})
    assert r.status_code == 403


def test_attachment_upload_and_path_guard(client):
    c = client(RECRUITER)
    r = c.post("/api/v1/agent/attachments", files={"file": ("cv.pdf", PDF, "application/pdf")})
    assert r.status_code == 200
    path = r.json()["file_path"]
    assert path.startswith("uploads/agent/") and os.path.isfile(path)

    # A file outside uploads/agent (e.g. another candidate's resume) is refused.
    os.makedirs("uploads/resumes", exist_ok=True)
    with open("uploads/resumes/other.pdf", "wb") as fh:
        fh.write(PDF)
    for bad in ("uploads/resumes/other.pdf", "uploads/agent/../resumes/other.pdf", "/etc/passwd"):
        r = c.post("/api/v1/agent/tools/hiring/get_candidate_profile/call", json={"file_path": bad})
        assert r.status_code == 400, bad


def test_attachment_rejects_non_pdf(client):
    c = client(RECRUITER)
    assert c.post("/api/v1/agent/attachments", files={"file": ("cv.txt", b"hello", "text/plain")}).status_code == 400
    assert c.post("/api/v1/agent/attachments", files={"file": ("cv.pdf", b"not a pdf", "application/pdf")}).status_code == 400


def test_empty_prompt_rejected(client):
    assert client(RECRUITER).post("/api/v1/agent/plan", json={"prompt": "   "}).status_code == 400


def test_uploaded_resume_passes_the_guard(client, monkeypatch):
    from app.agent_tools import hiring_tools
    monkeypatch.setattr(hiring_tools, "parse_resume_pdf", lambda name, path: {"name": "Parsed", "file": os.path.basename(path)})
    c = client(RECRUITER)
    path = c.post("/api/v1/agent/attachments", files={"file": ("cv.pdf", PDF, "application/pdf")}).json()["file_path"]
    r = c.post("/api/v1/agent/tools/hiring/get_candidate_profile/call", json={"file_path": path})
    assert r.status_code == 200 and r.json()["name"] == "Parsed"
