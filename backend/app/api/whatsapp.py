"""Meta WhatsApp Cloud API webhook. Mounted at the app root (not /api/v1) so
the path matches exactly what's registered in the Meta App Dashboard's
webhook config: GET/POST /webhooks/whatsapp. Same root-mount convention as
api/google_oauth.py's callback route.

The POST handler acknowledges Meta immediately (Meta retries aggressively —
and eventually disables the webhook — if it doesn't see a fast 2xx) and does
all LLM/tool-calling work in a FastAPI BackgroundTask after the response is
already on the wire, per the platform spec's explicit requirement not to
block the webhook on long-running AI processing."""
import json
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Query, Request, Response

from ..database import SessionLocal
from ..models import WhatsAppMessage
from ..services import whatsapp_service
from ..services.whatsapp_agent import handle_inbound_message

logger = logging.getLogger("whatsapp_webhook")

router = APIRouter(prefix="/webhooks/whatsapp", tags=["whatsapp"])


@router.get("")
def verify_webhook(
    hub_mode: str = Query(default=None, alias="hub.mode"),
    hub_verify_token: str = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str = Query(default=None, alias="hub.challenge"),
):
    challenge = whatsapp_service.verify_webhook_challenge(hub_mode, hub_verify_token, hub_challenge)
    if challenge is None:
        return Response(status_code=403)
    # Meta expects the raw challenge string back, not JSON.
    return Response(content=challenge, media_type="text/plain")


def _record_inbound(from_number: str, message_id: str, text: str, message_type: str, raw_event: dict) -> None:
    db = SessionLocal()
    try:
        db.add(WhatsAppMessage(
            id=str(uuid.uuid4()),
            wamid=message_id,
            direction="inbound",
            from_number=from_number,
            message_type=message_type,
            body=text,
            status="received",
            raw_payload=raw_event,
        ))
        db.commit()
    finally:
        db.close()


def _apply_status_update(wamid: str, status: str, raw_event: dict) -> None:
    db = SessionLocal()
    try:
        record = db.query(WhatsAppMessage).filter(WhatsAppMessage.wamid == wamid).first()
        if record:
            record.status = status
            if raw_event.get("error_message"):
                record.error_message = raw_event["error_message"]
            record.raw_payload = raw_event
            db.commit()
    finally:
        db.close()


def _process_webhook_events(payload: dict) -> None:
    """Runs after the 200 has already been returned to Meta — see module
    docstring. Persists every event, then routes inbound text messages to the
    WhatsApp Agent for a reply."""
    events = whatsapp_service.parse_incoming_webhook(payload)
    for event in events:
        try:
            if event.get("status_update"):
                _apply_status_update(event["wamid"], event["status"], event)
                continue

            _record_inbound(event.get("from"), event.get("message_id"), event.get("text"), event.get("type", "unknown"), event)

            if event.get("type") == "text" and event.get("from") and event.get("text"):
                handle_inbound_message(event["from"], event["text"])
        except Exception as e:
            # One malformed/failing event must never take down processing of
            # the rest of the batch, or crash a background task silently.
            logger.error("[WhatsApp Webhook] Failed processing event %s: %s", event, e)


@router.post("")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    raw_body = await request.body()

    if not whatsapp_service.verify_signature(raw_body, request.headers.get("x-hub-signature-256")):
        logger.warning("[WhatsApp Webhook] Rejected POST with missing/invalid X-Hub-Signature-256.")
        return Response(status_code=403)

    try:
        payload = json.loads(raw_body)
    except Exception:
        # Still ack with 200 — a malformed body from Meta is not something
        # retrying will fix, and a non-2xx here risks Meta disabling the
        # webhook subscription after repeated failures.
        return Response(status_code=200)

    background_tasks.add_task(_process_webhook_events, payload)
    return Response(status_code=200)
