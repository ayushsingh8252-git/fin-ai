"""Telephonic Agent tools — thin wrappers around api/telephonic.py's own
route functions. `place_call`/`get_call` are plain Python functions
underneath the `@router.post`/`@router.get` decorators (FastAPI decorators
don't prevent calling them directly), so these tools import and call them
exactly as the HTTP routes do, just with a tool-owned DB session instead of
one injected via FastAPI's Depends(get_db) — zero duplicated call-placement
or call-lookup logic.

Field-name reality check: the existing `_serialize()` in api/telephonic.py
returns communication_score / relevance_score / confidence_score /
evaluation_summary and a possibly-empty `transcript` list — there is no
transcript_available or analysis_available boolean anywhere in the real
model, so get_call_status derives them here rather than assuming they exist."""
from typing import Any, Dict, List

from fastapi import HTTPException

from ..api.telephonic import PlaceCallRequest, get_call, place_call
from ..database import SessionLocal
from ..mcp.base import BaseMCPConnector, MCPToolError


class TelephonicConnector(BaseMCPConnector):
    name = "telephonic"
    display_name = "Telephonic Agent"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        from ..config import settings

        missing = []
        if not settings.TWILIO_ACCOUNT_SID:
            missing.append("TWILIO_ACCOUNT_SID")
        if not settings.TWILIO_AUTH_TOKEN:
            missing.append("TWILIO_AUTH_TOKEN")
        if not settings.TWILIO_PHONE_NUMBER:
            missing.append("TWILIO_PHONE_NUMBER")
        if not settings.PUBLIC_BASE_URL:
            missing.append("PUBLIC_BASE_URL")
        return missing

    def register_tools(self) -> None:
        self._add_tool(
            name="place_screening_call",
            description=(
                "Place a real outbound phone call via Twilio to a candidate for an AI-voice "
                "screening conversation. Costs money per call — only call this when the user has "
                "clearly asked to call/reach a specific candidate."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "The candidate's phone number in E.164 format, e.g. +15551234567."},
                    "candidate_name": {"type": "string", "default": "there"},
                    "role_title": {"type": "string", "default": "the open role"},
                },
                "required": ["to"],
            },
            handler=self._place_screening_call,
        )
        self._add_tool(
            name="get_call_status",
            description="Look up an existing screening call's current status, transcript, and evaluation scores by call_id.",
            input_schema={
                "type": "object",
                "properties": {"call_id": {"type": "string"}},
                "required": ["call_id"],
            },
            handler=self._get_call_status,
        )

    def _place_screening_call(self, params: Dict[str, Any]) -> Dict[str, Any]:
        to = params.get("to")
        if not to:
            raise MCPToolError("`to` is required", code="validation_error", status_code=400)

        payload = PlaceCallRequest(
            to=to,
            candidate_name=params.get("candidate_name", "there"),
            role_title=params.get("role_title", "the open role"),
        )
        db = SessionLocal()
        try:
            try:
                return place_call(payload, db)
            except HTTPException as e:
                raise MCPToolError(str(e.detail), code="business_logic_error", status_code=e.status_code) from None
        finally:
            db.close()

    def _get_call_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        call_id = params.get("call_id")
        if not call_id:
            raise MCPToolError("`call_id` is required", code="validation_error", status_code=400)

        db = SessionLocal()
        try:
            try:
                record = get_call(call_id, db)
            except HTTPException as e:
                raise MCPToolError(str(e.detail), code="not_found", status_code=e.status_code) from None
        finally:
            db.close()

        return {
            **record,
            "transcript_available": bool(record.get("transcript")),
            "analysis_available": record.get("communication_score") is not None,
        }


connector = TelephonicConnector()
