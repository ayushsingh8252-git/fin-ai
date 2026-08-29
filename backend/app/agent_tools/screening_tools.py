"""Screening Agent tool — thin wrapper around api/screening.py's
`screen_from_call`, which itself wraps services/screening_service.py's
`screen_call_transcript`. Called exactly like the real route (fresh DB
session instead of FastAPI's Depends(get_db)), including the same
orchestrator.record_screening_result_for_scorecard() fold-in, so a tool-
initiated screening run updates the Enterprise Orchestration scorecard the
same way a UI-initiated one does.

Field-name reality check: the real ScreeningResult shape is jd_match_score /
verdict / strengths / gaps / summary — there is no `score`, `recommendation`,
`weaknesses`, `concerns`, or `reasoning` field in the actual model, so this
tool reports the real names rather than the commonly-assumed ones."""
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from ..api.screening import screen_from_call
from ..database import SessionLocal
from ..mcp.base import BaseMCPConnector, MCPToolError


class ScreeningConnector(BaseMCPConnector):
    name = "screening"
    display_name = "Screening Agent"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        return []  # same soft-fail LLM rationale as rag_tools.py/fraud_tools.py

    def register_tools(self) -> None:
        self._add_tool(
            name="run_screening_analysis",
            description=(
                "Run a JD-aligned screening analysis over a finished Telephonic Agent call's "
                "transcript and return the candidate's fit assessment. Requires the call to have "
                "already completed (a transcript must exist) — use get_call_status first to check."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "call_id": {"type": "string", "description": "A completed telephonic call's call_id."},
                    "jd_text": {
                        "type": "string",
                        "description": "Optional job-description text to score against. Falls back to the role's stored JD, then a generic assessment.",
                    },
                },
                "required": ["call_id"],
            },
            handler=self._run_screening_analysis,
        )

    def _run_screening_analysis(self, params: Dict[str, Any]) -> Dict[str, Any]:
        call_id = params.get("call_id")
        if not call_id:
            raise MCPToolError("`call_id` is required", code="validation_error", status_code=400)

        db = SessionLocal()
        try:
            try:
                result = screen_from_call(call_id, jd_text=params.get("jd_text"), db=db)
            except HTTPException as e:
                raise MCPToolError(str(e.detail), code="business_logic_error", status_code=e.status_code) from None
        finally:
            db.close()

        return result


connector = ScreeningConnector()
