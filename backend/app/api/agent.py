"""REST surface for the unified agent tool layer (agent_tools/), used by the
HR Command Center.

  GET  /agent/tools                              — the HR tool catalog, with live status
  POST /agent/tools/{connector}/{tool}/call       — invoke one HR tool directly
  POST /agent/plan                                — prompt -> plan (no execution)
  POST /agent/run                                 — prompt -> plan -> executed, in one call
  POST /agent/attachments                         — upload a resume the plan can use

Auth: every route requires a signed-in user (main.py's `_auth_guard`) AND the
existing recruitment RBAC — ACTION_ANALYZE, which hr_admin / recruiter /
hiring_manager hold and interviewer does not. The same check that guards
candidate analysis in api/recruitment.py, not a separate password.

Scope: only HR_TOOLS are planned or callable here. The registry also
holds developer/enterprise connectors (GitHub, Jira, Salesforce, SAP, ...)
that have nothing to do with hiring; exposing them to the HR planner would
let any recruiter-role user file GitHub issues or query Salesforce through a
chat box.
"""
import os
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..agent_tools import planner, registry
from ..agent_tools.registry import MCPToolError
from ..models import User
from ..rate_limit import limiter
from ..services import recruitment_service as rs
from ..services.upload_safety import MAX_UPLOAD_BYTES, safe_filename
from .deps import get_current_user

router = APIRouter(prefix="/agent", tags=["agent"])

# Tool-level, not connector-level: the Google/Gmail connectors also carry
# read/modify tools (read the inbox, list/delete calendar events) that would
# expose the platform owner's own mailbox and calendar to every recruiter.
# Left out too: tools that need an id this surface can't produce (fraud
# scan_id), and the orchestrator scorecard tools, which return a seeded
# placeholder score when no real interview exists.
HR_TOOLS = frozenset({
    ("hiring", "get_candidate_profile"),
    ("hiring", "match_candidate_requirement"),
    ("hiring", "get_resume_actionable_summary"),
    ("hiring", "generate_candidate_assignment"),
    ("background_verification", "verify_company_background"),
    ("telephonic", "place_screening_call"),
    ("telephonic", "get_call_status"),
    ("screening", "run_screening_analysis"),
    ("whatsapp", "send_whatsapp_message"),
    ("whatsapp", "get_whatsapp_message_status"),
    ("gmail", "send_email"),
    ("google_calendar", "create_meet"),
    ("google_calendar", "create_event"),
    ("google_calendar", "check_availability"),
    ("rag", "query_documents"),
    ("google_workspace_status", "get_google_integration_status"),
})

# Uploaded resumes the Command Center may hand to hiring tools. hiring_tools
# only accepts file paths under this directory (see _safe_resume_path there).
AGENT_UPLOAD_DIR = os.path.join("uploads", "agent")


def _require_hr(user: User = Depends(get_current_user)) -> User:
    rs.require_permission(user, rs.ACTION_ANALYZE)
    return user


def _hr_catalog():
    return [t for t in registry.unified_catalog() if (t["connector"], t["tool"]) in HR_TOOLS]


@router.get("/tools")
def list_tools(user: User = Depends(_require_hr)):
    return {"tools": _hr_catalog()}


@router.post("/tools/{connector_name}/{tool_name}/call")
def call_tool(
    connector_name: str,
    tool_name: str,
    params: Optional[Dict[str, Any]] = None,
    user: User = Depends(_require_hr),
):
    if (connector_name, tool_name) not in HR_TOOLS:
        raise HTTPException(status_code=403, detail=f"{connector_name}.{tool_name} is not available in the HR Command Center.")
    try:
        return registry.call_tool(connector_name, tool_name, params or {})
    except MCPToolError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": str(e)})


class Attachment(BaseModel):
    file_path: str = Field(max_length=500)
    filename: str = Field(max_length=255)


class PromptRequest(BaseModel):
    prompt: str = Field(max_length=4000)
    attachment: Optional[Attachment] = None


def _prompt_with_context(payload: PromptRequest) -> str:
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="`prompt` cannot be empty.")
    if payload.attachment:
        # Only paths this endpoint itself issued are accepted downstream
        # (hiring_tools validates the directory), so this is context, not trust.
        prompt += (
            f"\n\nThe user attached a resume named \"{payload.attachment.filename}\". "
            f"Use file_path=\"{payload.attachment.file_path}\" for any tool that needs the resume."
        )
    return prompt


@router.post("/plan")
@limiter.limit("10/minute")
def create_plan(request: Request, payload: PromptRequest, user: User = Depends(_require_hr)):
    return planner.build_plan(_prompt_with_context(payload), tools=HR_TOOLS)


@router.post("/run")
@limiter.limit("10/minute")
def run_prompt(request: Request, payload: PromptRequest, user: User = Depends(_require_hr)):
    return planner.plan_and_run(_prompt_with_context(payload), tools=HR_TOOLS)


@router.post("/attachments")
@limiter.limit("20/minute")
async def upload_attachment(request: Request, file: UploadFile = File(...), user: User = Depends(_require_hr)):
    name = safe_filename(file.filename or "resume.pdf")
    if not name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes can be attached.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That file is too large.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="That file isn't a valid PDF.")
    os.makedirs(AGENT_UPLOAD_DIR, exist_ok=True)
    path = os.path.join(AGENT_UPLOAD_DIR, f"{uuid.uuid4().hex}_{name}")
    with open(path, "wb") as fh:
        fh.write(data)
    return {"file_path": path.replace(os.sep, "/"), "filename": file.filename or name, "size": len(data)}
