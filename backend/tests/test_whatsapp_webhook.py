"""WhatsApp webhook (api/whatsapp.py) and the pure parsing/verification
helpers in services/whatsapp_service.py. Route-level tests patch
handle_inbound_message so they don't depend on a live LLM key or a real
Meta send — matches this suite's existing convention of not requiring live
external credentials (see test_document_status.py)."""
import uuid

from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models import WhatsAppMessage
from app.services import whatsapp_service

client = TestClient(app)


def test_verify_webhook_challenge_pure_function(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_VERIFY_TOKEN", "my-secret-token")
    assert whatsapp_service.verify_webhook_challenge("subscribe", "my-secret-token", "challenge123") == "challenge123"
    assert whatsapp_service.verify_webhook_challenge("subscribe", "wrong-token", "challenge123") is None
    assert whatsapp_service.verify_webhook_challenge("unsubscribe", "my-secret-token", "challenge123") is None


def test_verify_webhook_challenge_rejects_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_VERIFY_TOKEN", "")
    assert whatsapp_service.verify_webhook_challenge("subscribe", "anything", "challenge123") is None


def test_get_webhook_verification_success(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_VERIFY_TOKEN", "my-secret-token")
    response = client.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "my-secret-token", "hub.challenge": "xyz789"})
    assert response.status_code == 200
    assert response.text == "xyz789"


def test_get_webhook_verification_wrong_token_is_403(monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_VERIFY_TOKEN", "my-secret-token")
    response = client.get("/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "xyz789"})
    assert response.status_code == 403


def test_parse_incoming_webhook_extracts_text_message():
    payload = {
        "entry": [{"changes": [{"value": {"messages": [
            {"id": "wamid.ABC", "from": "15550001111", "type": "text", "text": {"body": "hello"}, "timestamp": "111"}
        ]}}]}]
    }
    events = whatsapp_service.parse_incoming_webhook(payload)
    assert events == [{"message_id": "wamid.ABC", "from": "15550001111", "type": "text", "text": "hello", "timestamp": "111"}]


def test_parse_incoming_webhook_extracts_status_update():
    payload = {
        "entry": [{"changes": [{"value": {"statuses": [
            {"id": "wamid.ABC", "status": "delivered", "timestamp": "222"}
        ]}}]}]
    }
    events = whatsapp_service.parse_incoming_webhook(payload)
    assert events == [{"status_update": True, "wamid": "wamid.ABC", "status": "delivered", "timestamp": "222", "error_message": None}]


def test_parse_incoming_webhook_ignores_malformed_shape():
    """Meta's webhook must always get a fast 200 regardless of payload
    content — malformed entries must be skipped, never raise."""
    assert whatsapp_service.parse_incoming_webhook({}) == []
    assert whatsapp_service.parse_incoming_webhook({"entry": [{"changes": [{"value": {}}]}]}) == []
    assert whatsapp_service.parse_incoming_webhook({"unexpected": "shape"}) == []


def test_post_webhook_acks_200_even_with_malformed_body():
    response = client.post("/webhooks/whatsapp", content=b"not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 200


def test_post_webhook_persists_inbound_message_and_invokes_agent(monkeypatch):
    calls = []
    monkeypatch.setattr("app.api.whatsapp.handle_inbound_message", lambda frm, text: calls.append((frm, text)))

    msg_id = f"wamid.TEST-{uuid.uuid4().hex[:8]}"
    payload = {
        "entry": [{"changes": [{"value": {"messages": [
            {"id": msg_id, "from": "15550009999", "type": "text", "text": {"body": "test message"}, "timestamp": "333"}
        ]}}]}]
    }
    response = client.post("/webhooks/whatsapp", json=payload)
    assert response.status_code == 200
    assert calls == [("15550009999", "test message")]

    db = SessionLocal()
    try:
        record = db.query(WhatsAppMessage).filter(WhatsAppMessage.wamid == msg_id).first()
        assert record is not None
        assert record.direction == "inbound"
        assert record.from_number == "15550009999"
        assert record.body == "test message"
    finally:
        db.query(WhatsAppMessage).filter(WhatsAppMessage.wamid == msg_id).delete()
        db.commit()
        db.close()


def test_post_webhook_status_update_patches_existing_outbound_row(monkeypatch):
    monkeypatch.setattr("app.api.whatsapp.handle_inbound_message", lambda frm, text: None)

    wamid = f"wamid.OUT-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        db.add(WhatsAppMessage(id=str(uuid.uuid4()), wamid=wamid, direction="outbound", to_number="15550009999", status="sent"))
        db.commit()
    finally:
        db.close()

    payload = {"entry": [{"changes": [{"value": {"statuses": [{"id": wamid, "status": "delivered", "timestamp": "444"}]}}]}]}
    response = client.post("/webhooks/whatsapp", json=payload)
    assert response.status_code == 200

    db = SessionLocal()
    try:
        record = db.query(WhatsAppMessage).filter(WhatsAppMessage.wamid == wamid).first()
        assert record.status == "delivered"
    finally:
        db.query(WhatsAppMessage).filter(WhatsAppMessage.wamid == wamid).delete()
        db.commit()
        db.close()
