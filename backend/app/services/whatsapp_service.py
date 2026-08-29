"""Meta WhatsApp Cloud API client — the one place that actually talks to
graph.facebook.com. Mirrors api/telephonic.py's `_twilio_client()` convention:
missing config raises a clear, typed error rather than the call silently
no-oping or fabricating a response.

Meta's Cloud API is send-only over HTTP — there is no GET endpoint to poll a
message's delivery state. Delivery/read receipts arrive later as asynchronous
`statuses` events on the webhook (api/whatsapp.py), which is why
`get_whatsapp_message_status` (agent_tools/whatsapp_tools.py) reads the local
`WhatsAppMessage` table instead of calling Meta again.

No new pip dependency — plain `urllib.request`, same convention as
services/llm_service.py's `_call_grok_groq_api`.
"""
import json
import logging
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from ..config import settings
from .resilience import call_with_resilience

logger = logging.getLogger("whatsapp")


class WhatsAppConfigError(Exception):
    """Raised when WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID aren't set."""


class WhatsAppAPIError(Exception):
    """Raised when Meta's Graph API rejects a request (4xx/5xx with an error body)."""

    def __init__(self, message: str, status_code: int = 502, meta_error: Optional[dict] = None):
        self.status_code = status_code
        self.meta_error = meta_error or {}
        super().__init__(message)


def missing_config() -> List[str]:
    missing = []
    if not settings.WHATSAPP_ACCESS_TOKEN:
        missing.append("WHATSAPP_ACCESS_TOKEN")
    if not settings.WHATSAPP_PHONE_NUMBER_ID:
        missing.append("WHATSAPP_PHONE_NUMBER_ID")
    return missing


def is_configured() -> bool:
    return len(missing_config()) == 0


def _require_configured() -> None:
    missing = missing_config()
    if missing:
        raise WhatsAppConfigError(f"WhatsApp isn't configured — missing: {', '.join(missing)}")


def _graph_url(path: str) -> str:
    return f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{path}"


def _post(path: str, payload: dict) -> dict:
    url = _graph_url(path)
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }

    def _do_request() -> dict:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else "{}"
            try:
                parsed = json.loads(error_body)
            except json.JSONDecodeError:
                parsed = {"raw": error_body}
            # Meta's own error payloads (rate limits, invalid recipient, expired
            # token, template not approved, ...) are not transient network
            # failures — retrying them can't help, so surface immediately
            # rather than burning the retry budget.
            raise WhatsAppAPIError(
                f"WhatsApp API rejected the request ({e.code}): {parsed.get('error', {}).get('message', error_body)}",
                status_code=e.code,
                meta_error=parsed.get("error", {}),
            ) from None

    return call_with_resilience(
        "whatsapp", _do_request,
        max_attempts=3, base_delay=0.4, max_delay=3.0,
        non_retryable=(WhatsAppAPIError,),
    )


def send_text_message(to: str, body: str, preview_url: bool = False) -> dict:
    """Sends a free-form text message. Meta only allows this within the 24h
    "customer service window" after the user last messaged in — outside that
    window, use send_template_message instead. Returns Meta's raw response,
    which includes `messages[0]["id"]` (the wamid) on success."""
    _require_configured()
    if not to or not body:
        raise ValueError("`to` and `body` are required")
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": body, "preview_url": preview_url},
    }
    return _post(f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages", payload)


def send_template_message(
    to: str,
    template_name: str,
    language_code: str = "en_US",
    components: Optional[List[Dict[str, Any]]] = None,
) -> dict:
    """Sends a pre-approved message template — the only message type Meta
    allows outside the 24h customer-service window (e.g. the first message to
    a candidate who hasn't messaged in yet). `components` follows Meta's
    template-component schema (header/body/button parameters) and is passed
    through unmodified; the template itself must already be approved in the
    Meta Business Manager."""
    _require_configured()
    if not to or not template_name:
        raise ValueError("`to` and `template_name` are required")
    template: Dict[str, Any] = {"name": template_name, "language": {"code": language_code}}
    if components:
        template["components"] = components
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": template,
    }
    return _post(f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages", payload)


def verify_webhook_challenge(mode: Optional[str], token: Optional[str], challenge: Optional[str]) -> Optional[str]:
    """GET /webhooks/whatsapp verification logic, kept here (not in api/whatsapp.py)
    so it's unit-testable without spinning up FastAPI. Returns the challenge
    string to echo back on success, or None if verification should be
    rejected (caller returns 403)."""
    if not settings.WHATSAPP_VERIFY_TOKEN:
        logger.warning("[WhatsApp] Webhook verification attempted but WHATSAPP_VERIFY_TOKEN isn't set.")
        return None
    if mode == "subscribe" and token == settings.WHATSAPP_VERIFY_TOKEN:
        return challenge
    return None


def parse_incoming_webhook(payload: dict) -> List[Dict[str, Any]]:
    """Extracts a flat list of inbound message events from Meta's nested
    webhook payload shape (entry[].changes[].value.messages[]). Each event:
    {message_id, from, type, text, timestamp}. Also handles the value.statuses[]
    shape (delivery/read receipts for messages *this app* sent) by returning
    them as {status_update: True, wamid, status, timestamp} entries instead —
    callers branch on the `status_update` key. Malformed/unexpected shapes are
    skipped rather than raising, since Meta's webhook must always get a fast
    200 regardless of payload content."""
    events: List[Dict[str, Any]] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {}) or {}

            for msg in value.get("messages", []) or []:
                msg_type = msg.get("type", "unknown")
                text = None
                if msg_type == "text":
                    text = (msg.get("text") or {}).get("body")
                elif msg_type in ("button", "interactive"):
                    text = (
                        (msg.get("button") or {}).get("text")
                        or (msg.get("interactive") or {}).get("button_reply", {}).get("title")
                        or (msg.get("interactive") or {}).get("list_reply", {}).get("title")
                    )
                events.append({
                    "message_id": msg.get("id"),
                    "from": msg.get("from"),
                    "type": msg_type,
                    "text": text,
                    "timestamp": msg.get("timestamp"),
                })

            for status in value.get("statuses", []) or []:
                events.append({
                    "status_update": True,
                    "wamid": status.get("id"),
                    "status": status.get("status"),
                    "timestamp": status.get("timestamp"),
                })

    return events
