"""REST surface for the unified agent tool layer (agent_tools/). Mirrors
api/mcp.py's shape deliberately — same "list what's available, call one
thing directly, or let the planner compose a plan" pattern, just spanning
product features (RAG/Fraud/Telephonic/Screening/Hiring/WhatsApp) and the
pre-existing MCP connectors together instead of only the latter.

  GET  /agent/tools                              — the full unified catalog
  POST /agent/tools/{connector}/{tool}/call       — invoke one tool directly
  POST /agent/plan                                — prompt -> plan (no execution)
  POST /agent/run                                 — prompt -> plan -> executed, in one call

Auth: gated at the router-registration level (main.py's `_auth_guard`, backed
by api/deps.py::get_current_user) — every route here requires a valid signed-
in session. This used to be a real, explicitly-accepted no-auth gap (this
docstring said so); it no longer is, and this is exactly the API surface the
Command Center's client-side password gate was supposed to protect but
structurally couldn't, since it never actually guarded this router.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..agent_tools import planner, registry
from ..agent_tools.registry import MCPToolError
from ..rate_limit import limiter

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/tools")
def list_tools():
    return {"tools": registry.unified_catalog()}


@router.post("/tools/{connector_name}/{tool_name}/call")
def call_tool(connector_name: str, tool_name: str, params: Optional[Dict[str, Any]] = None):
    try:
        return registry.call_tool(connector_name, tool_name, params or {})
    except MCPToolError as e:
        raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": str(e)})


class PromptRequest(BaseModel):
    prompt: str


@router.post("/plan")
@limiter.limit("10/minute")
def create_plan(request: Request, payload: PromptRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="`prompt` cannot be empty.")
    return planner.build_plan(payload.prompt)


@router.post("/run")
@limiter.limit("10/minute")
def run_prompt(request: Request, payload: PromptRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="`prompt` cannot be empty.")
    return planner.plan_and_run(payload.prompt)
