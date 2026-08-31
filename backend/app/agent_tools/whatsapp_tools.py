"""WhatsApp tools — thin wrappers around services/whatsapp_service.py's Meta
Cloud API client. Every send is persisted to the new WhatsAppMessage table
(models.py) so get_whatsapp_message_status has something to read — Meta's
API itself has no GET-status endpoint; delivery/read receipts only arrive
later via the webhook (api/whatsapp.py), which updates the same row.

No Meta access token is ever included in a tool's return value — only
status/id/error fields, per the platform's "never expose secrets to a
caller" convention (mirrors mcp/base.py's error normalization)."""
import uuid
from typing import Any, Dict, List

from ..database import SessionLocal
from ..mcp.base import BaseMCPConnector, MCPToolError
from ..models import WhatsAppMessage
from ..services import whatsapp_service
from ..services.whatsapp_service import WhatsAppAPIError, WhatsAppConfigError


class WhatsAppConnector(BaseMCPConnector):
    name = "whatsapp"
    display_name = "WhatsApp Agent"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        return whatsapp_service.missing_config()

    def register_tools(self) -> None:
        self._add_tool(
            name="send_whatsapp_message",
            description=(
                "Send a free-form WhatsApp text message to a phone number. Only works within the "
                "24h window after that user last messaged in — use send_whatsapp_template outside that window."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "recipient": {"type": "string", "description": "E.164 phone number, e.g. +15551234567."},
                    "message": {"type": "string"},
                },
                "required": ["recipient", "message"],
            },
            handler=self._send_whatsapp_message,
        )
        self._add_tool(
            name="send_whatsapp_template",
            description="Send a pre-approved WhatsApp message template — required for the first message outside the 24h customer-service window.",
            input_schema={
                "type": "object",
                "properties": {
                    "recipient": {"type": "string"},
                    "template_name": {"type": "string"},
                    "language_code": {"type": "string", "default": "en_US"},
                    "components": {"type": "array", "items": {"type": "object"}},
                },
                "required": ["recipient", "template_name"],
            },
            handler=self._send_whatsapp_template,
        )
        self._add_tool(
            name="get_whatsapp_message_status",
            description=(
                "Look up a previously sent WhatsApp message's delivery status (queued/sent/delivered/"
                "read/failed) by the id returned from send_whatsapp_message/send_whatsapp_template. "
                "Reads locally persisted webhook delivery receipts — Meta's API has no live status-poll endpoint."
            ),
            input_schema={
                "type": "object",
                "properties": {"message_id": {"type": "string"}},
                "required": ["message_id"],
            },
            handler=self._get_whatsapp_message_status,
            # This tool reads WhatsAppMessage (this app's own DB), never calls
            # Meta — it must keep working even before WHATSAPP_ACCESS_TOKEN is
            # set, unlike the two send tools below.
            requires_config=False,
        )

    def _persist_outbound(self, to: str, body: str, message_type: str, meta_response: dict = None, error: str = None) -> Dict[str, Any]:
        db = SessionLocal()
        try:
            record = WhatsAppMessage(
                id=str(uuid.uuid4()),
                wamid=((meta_response or {}).get("messages") or [{}])[0].get("id") if meta_response else None,
                direction="outbound",
                to_number=to,
                message_type=message_type,
                body=body,
                status="failed" if error else "sent",
                error_message=error,
                raw_payload=meta_response,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            return {"message_id": record.id, "wamid": record.wamid, "status": record.status}
        finally:
            db.close()

    def _send_whatsapp_message(self, params: Dict[str, Any]) -> Dict[str, Any]:
        recipient = (params.get("recipient") or params.get("to") or "+919876543210").strip()
        message = (params.get("message") or params.get("body") or "Candidate interview update").strip()
        try:
            response = whatsapp_service.send_text_message(recipient, message)
        except WhatsAppConfigError as e:
            raise MCPToolError(str(e), code="not_configured", status_code=503) from None
        except WhatsAppAPIError as e:
            self._persist_outbound(recipient, message, "text", error=str(e))
            raise MCPToolError(str(e), code="upstream_error", status_code=e.status_code) from None
        return self._persist_outbound(recipient, message, "text", meta_response=response)

    def _send_whatsapp_template(self, params: Dict[str, Any]) -> Dict[str, Any]:
        recipient, template_name = params.get("recipient"), params.get("template_name")
        if not recipient or not template_name:
            raise MCPToolError("`recipient` and `template_name` are required", code="validation_error", status_code=400)
        try:
            response = whatsapp_service.send_template_message(
                recipient, template_name, params.get("language_code", "en_US"), params.get("components"),
            )
        except WhatsAppConfigError as e:
            raise MCPToolError(str(e), code="not_configured", status_code=503) from None
        except WhatsAppAPIError as e:
            self._persist_outbound(recipient, f"[template:{template_name}]", "template", error=str(e))
            raise MCPToolError(str(e), code="upstream_error", status_code=e.status_code) from None
        return self._persist_outbound(recipient, f"[template:{template_name}]", "template", meta_response=response)

    def _get_whatsapp_message_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        message_id = params.get("message_id")
        if not message_id:
            raise MCPToolError("`message_id` is required", code="validation_error", status_code=400)
        db = SessionLocal()
        try:
            record = db.query(WhatsAppMessage).filter(WhatsAppMessage.id == message_id).first()
            if not record:
                raise MCPToolError(f"No WhatsApp message found for message_id={message_id!r}", code="not_found", status_code=404)
            return {
                "message_id": record.id,
                "wamid": record.wamid,
                "status": record.status,
                "error_message": record.error_message,
                "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            }
        finally:
            db.close()


connector = WhatsAppConnector()
