"""
Telephonic Agent — Sarvam AI outbound calling.

Unlike the Twilio path (api/telephonic.py drives every call turn itself via
telephonic_service.generate_call_turn plus Twilio's TwiML /voice and /gather
webhooks), Sarvam owns the whole call: a conversational "app" configured in
the Sarvam console (its own STT/TTS/dialog state machine) runs the entire
conversation once triggered. This backend's job is just:
  1. place the outbound call with per-candidate template variables
     (build_agent_variables + place_outbound_call), and
  2. receive the result on a webhook once the call ends
     (api/telephonic.py's POST /telephonic/sarvam/webhook), which does the
     scoring/persistence Twilio's /status webhook does for its own calls.
"""
from typing import Any, Dict, Optional

import requests

from ..config import settings
from .resilience import call_with_resilience, CircuitOpenError

OUTBOUND_PATH = "/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds"

# Every key the configured Sarvam app's agent_variables template expects.
# Defaulted to "" rather than omitted so a candidate this backend has no
# screening history for still gets a fully-templated call instead of Sarvam
# reading a literal "{{missing_variable}}" out loud.
AGENT_VARIABLE_KEYS = (
    "candidate_name",
    "candidate_strengths",
    "candidate_weaknesses",
    "gender",
    "interview_summary",
    "job_requirements",
    "notable_answers",
    "resume_summary",
    "role_applied_for",
    "screening_disposition",
)


class SarvamConfigError(Exception):
    """Raised when Sarvam isn't configured — mirrors how api/telephonic.py's
    _twilio_client() fails fast instead of silently no-op'ing."""


class SarvamCallError(Exception):
    """Sarvam rejected the outbound request outright (bad app/connection
    config, invalid number, etc.) — not a transient network failure, so this
    is marked non-retryable rather than retried like a connection timeout."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Sarvam rejected the call ({status_code}): {detail}")


def missing_config() -> list:
    missing = []
    if not settings.SARVAM_API_KEY:
        missing.append("SARVAM_API_KEY")
    if not settings.SARVAM_ORG_ID:
        missing.append("SARVAM_ORG_ID")
    if not settings.SARVAM_WORKSPACE_ID:
        missing.append("SARVAM_WORKSPACE_ID")
    if not settings.SARVAM_APP_ID:
        missing.append("SARVAM_APP_ID")
    if not settings.SARVAM_CONNECTION_ID:
        missing.append("SARVAM_CONNECTION_ID")
    if not settings.SARVAM_AGENT_PHONE_NUMBER:
        missing.append("SARVAM_AGENT_PHONE_NUMBER")
    return missing


def build_agent_variables(overrides: Dict[str, Any]) -> Dict[str, str]:
    """Fills in Sarvam's agent_variables template, defaulting anything not
    supplied by the caller (api/telephonic.py's place_call, which best-effort
    autofills from the candidate's most recent ScreeningResult) to ""."""
    return {key: str(overrides.get(key) or "") for key in AGENT_VARIABLE_KEYS}


def extract_call_id(response: Dict[str, Any]) -> Optional[str]:
    """Best-effort pull of Sarvam's own call/conversation id out of the
    outbound-create response, whichever key it comes back under."""
    if not isinstance(response, dict):
        return None
    for key in ("attempt_id", "id", "outbound_id", "call_id", "conversation_id"):
        val = response.get(key)
        if val:
            return str(val)
    data = response.get("data")
    if isinstance(data, dict):
        return extract_call_id(data)
    return None


def place_outbound_call(
    to_number: str,
    agent_variables: Dict[str, str],
    webhook_url: str,
    lead_id: str,
    initial_bot_message: Optional[str] = None,
    initial_state_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Triggers a Sarvam outbound call. Returns Sarvam's response body (see
    extract_call_id for pulling the id used to correlate the later webhook)."""
    missing = missing_config()
    if missing:
        raise SarvamConfigError(
            "Sarvam isn't configured on the backend (missing " + ", ".join(missing) + ")."
        )

    app_overrides: Dict[str, str] = {}
    if initial_bot_message:
        app_overrides["initial_bot_message"] = initial_bot_message
    state_name = initial_state_name or settings.SARVAM_INITIAL_STATE_NAME
    if state_name:
        app_overrides["initial_state_name"] = state_name

    app_config: Dict[str, Any] = {
        "app_id": settings.SARVAM_APP_ID,
        "app_version": settings.SARVAM_APP_VERSION,
        "app_type": "agent",
        "connection_config": {
            "connection_id": settings.SARVAM_CONNECTION_ID,
            "agent_phone_number": settings.SARVAM_AGENT_PHONE_NUMBER,
        },
        "agent_variables": agent_variables,
    }
    if app_overrides:
        app_config["app_overrides"] = app_overrides

    payload = {
        "app_config": app_config,
        "user_config": {"user_phone_number": to_number},
        "webhook_config": {"url": webhook_url, "metadata": {"lead_id": lead_id}},
    }

    url = settings.SARVAM_BASE_URL.rstrip("/") + OUTBOUND_PATH.format(
        org_id=settings.SARVAM_ORG_ID, workspace_id=settings.SARVAM_WORKSPACE_ID
    )

    def _create_call():
        resp = requests.post(
            url,
            headers={"Content-Type": "application/json", "X-API-Key": settings.SARVAM_API_KEY},
            json=payload,
            timeout=20,
        )
        if resp.status_code >= 400:
            raise SarvamCallError(resp.status_code, resp.text[:500])
        return resp.json()

    try:
        return call_with_resilience(
            "sarvam", _create_call,
            max_attempts=3, base_delay=0.4, max_delay=3.0,
            non_retryable=(SarvamCallError,),
        )
    except CircuitOpenError as e:
        raise SarvamCallError(502, f"Sarvam is currently unavailable, please try again shortly: {e}") from e
