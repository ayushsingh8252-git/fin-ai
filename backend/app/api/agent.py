"""REST surface for the unified agent tool layer (agent_tools/). Mirrors
api/mcp.py's shape deliberately — same "list what's available, call one
thing directly, or let the planner compose a plan" pattern, just spanning
product features (RAG/Fraud/Telephonic/Screening/Hiring/WhatsApp) and the
pre-existing MCP connectors together instead of only the latter.

  GET  /agent/tools                              — the full unified catalog
  POST /agent/tools/{connector}/{tool}/call       — invoke one tool directly
  POST /agent/plan                                — prompt -> plan (no execution)
  POST /agent/run                                 — prompt -> plan -> executed, in one call

No auth on these routes, matching every other route in this backend today —
see the platform audit's explicit call-out that this is a real, currently-
accepted gap, not an oversight specific to this file.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..agent_tools import planner, registry
from ..agent_tools.registry import MCPToolError

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
def create_plan(payload: PromptRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="`prompt` cannot be empty.")
    return planner.build_plan(payload.prompt)


@router.post("/run")
def run_prompt(payload: PromptRequest):
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="`prompt` cannot be empty.")
    return planner.plan_and_run(payload.prompt)
