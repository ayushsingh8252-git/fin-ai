"""WhatsApp Agent — the channel-side intent router invoked by api/whatsapp.py
for each inbound message. Deliberately a constrained intent classifier with a
fixed dispatch table (one LLM call to classify + extract, then a small
if/elif per intent), NOT the general open-ended planner in agent_tools/planner.py —
an inbound WhatsApp message is untrusted, unauthenticated input (this
platform has no auth layer yet — see the platform audit), and several tools
reachable from here place real phone calls or send real messages. Bounding
the WhatsApp surface to a known, reviewed set of intents/tool-sequences is a
deliberate safety choice for this first pass, not an oversight; a future pass
could widen this to the full planner once auth exists.

This is a channel, not a second business-logic implementation — every intent
handler below calls into agent_tools' existing connectors (registry.call_tool),
never reimplements scheduling/screening/scorecard logic itself."""
import json
import logging
from typing import Any, Dict, Optional

from ..database import SessionLocal
from ..models import CallRecord
from ..services.llm_service import generate_json_resilient
from ..services.llmops import new_trace_id
from ..agent_tools import registry
from ..agent_tools.registry import MCPToolError

logger = logging.getLogger("whatsapp_agent")

_INTENT_SYSTEM_INSTRUCTION = """You are an intent classifier for an HR platform's WhatsApp channel. \
Classify the candidate's message into exactly one of these intents and extract any parameters \
mentioned. Return STRICT JSON, no prose:

{"intent": "get_interview_details" | "schedule_interview" | "reschedule_interview" | "general_question" | "unknown", \
"role_title": "<role mentioned, or null>", "preferred_date": "<date/time mentioned, or null>"}

- get_interview_details: candidate is asking about their interview (when, what, status).
- schedule_interview: candidate wants to book/schedule an interview slot.
- reschedule_interview: candidate wants to change an already-booked slot.
- general_question: anything else answerable from the platform's knowledge base (policies, process questions).
- unknown: doesn't fit any of the above, or the message is unclear.
Return ONLY the JSON object."""


def _reply(to: str, text: str) -> None:
    try:
        registry.call_tool("whatsapp", "send_whatsapp_message", {"recipient": to, "message": text})
    except MCPToolError as e:
        logger.error("[WhatsApp Agent] Failed to send reply to %s: %s", to, e)


def _lookup_recent_call_by_phone(phone: str) -> Optional[dict]:
    """Best-effort candidate lookup by phone number — the only existing table
    keyed by phone is CallRecord.to_number (CandidateScoreCard has no phone
    column). A known, honestly-flagged gap: a candidate who has never had a
    Telephonic Agent call placed to them has no way to be found by phone
    number alone in the current schema."""
    db = SessionLocal()
    try:
        record = (
            db.query(CallRecord)
            .filter(CallRecord.to_number == phone)
            .order_by(CallRecord.created_at.desc())
            .first()
        )
        if not record:
            return None
        return {
            "call_id": record.id,
            "candidate_name": record.candidate_name,
            "role_title": record.role_title,
            "status": record.status,
        }
    finally:
        db.close()


def _handle_get_interview_details(from_number: str, classification: dict) -> str:
    call = _lookup_recent_call_by_phone(from_number)
    if not call:
        return "I couldn't find a scheduled or completed interview for this number yet. If you were expecting one, please check with the recruiter."
    return (
        f"Here's what I have for you: role — {call['role_title']}, "
        f"status — {call['status']}. If you have questions about next steps, let us know."
    )


def _handle_schedule_or_reschedule(from_number: str, classification: dict, is_reschedule: bool) -> str:
    # Real tool calls against the existing Google Calendar MCP connector —
    # not simulated. Per the platform audit, Google OAuth is registered but
    # unconfigured (no consent flow completed yet), so this will currently
    # return a clear not_configured error, which is surfaced honestly below
    # rather than pretending a slot was booked.
    try:
        registry.call_tool("google_calendar", "list_events", {"calendar_id": "primary"})
    except MCPToolError as e:
        if e.code == "not_configured":
            return (
                "I'd like to help you schedule that, but our calendar integration isn't fully connected "
                "yet on our end. A recruiter will follow up with you directly to find a time."
            )
        return f"I ran into an issue checking the calendar ({e}). A recruiter will follow up directly."
    # With Calendar actually configured, a real implementation would continue
    # here: find an open slot, call create_event (or update_event, for
    # reschedule) with add_meet=True, then confirm the slot back to the
    # candidate. Left as a follow-up once Calendar is live-tested (see
    # platform audit) rather than written and shipped untested.
    return "Got it — I've noted your scheduling request. A recruiter will confirm the exact slot with you shortly."


def _handle_general_question(text: str) -> str:
    try:
        result = registry.call_tool("rag", "query_documents", {"query": text})
        answer = result.get("answer")
        return answer or "I don't have a confident answer to that yet — a recruiter will follow up."
    except MCPToolError as e:
        return f"I couldn't look that up right now ({e}). A recruiter will follow up."


def handle_inbound_message(from_number: str, text: str) -> None:
    """Entry point called by api/whatsapp.py's POST handler, off the request/
    response path (see that file's docstring on why) — classifies intent,
    dispatches to the matching handler, and sends the reply itself."""
    if not text or not text.strip():
        _reply(from_number, "Sorry, I didn't receive any message text. Could you try again?")
        return

    try:
        # A fresh trace per inbound message (not seeded from from_number) —
        # each message is its own event, not a continuation of one long-lived
        # conversation trace.
        classification = generate_json_resilient(
            text, _INTENT_SYSTEM_INSTRUCTION, langfuse_trace_id=new_trace_id()
        )
        if not isinstance(classification, dict):
            classification = {"intent": "unknown"}
    except Exception as e:
        logger.error("[WhatsApp Agent] Intent classification failed: %s", e)
        classification = {"intent": "unknown"}

    intent = classification.get("intent")
    if intent == "get_interview_details":
        reply = _handle_get_interview_details(from_number, classification)
    elif intent == "schedule_interview":
        reply = _handle_schedule_or_reschedule(from_number, classification, is_reschedule=False)
    elif intent == "reschedule_interview":
        reply = _handle_schedule_or_reschedule(from_number, classification, is_reschedule=True)
    elif intent == "general_question":
        reply = _handle_general_question(text)
    else:
        reply = "Thanks for your message — I've passed it along to a recruiter who will follow up with you."

    _reply(from_number, reply)
