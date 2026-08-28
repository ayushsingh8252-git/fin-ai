"""Google Calendar MCP connector — Calendar API v3
(https://developers.google.com/calendar/api), via the shared Google
Workspace auth helper (_auth.py).

Scope: calendar.events (create/read/update/delete events, Meet
conferences) plus calendar.events.freebusy, rather than the full
`calendar` scope, since nothing here needs to change calendar *settings*
or list/create other calendars. freeBusy.query (check_availability)
rejects calendar.events alone with a 403 insufficientPermissions —
verified against the live API — so the narrower freebusy-only scope is
added on top rather than widening to the full `calendar` scope.

Google Meet is not a separate API/auth — a Meet conference is created by
asking the Calendar API to attach conferenceData to an event (see
_create_event's add_meet param and the dedicated create_meet tool),
exactly as Google's own Calendar UI does. There is no Meet-specific OAuth
scope or token; conferenceDataVersion=1 on the request is what tells
Calendar to actually provision the conference and return a real
meet.google.com URL in conferenceData.entryPoints, rather than a
client-constructed one.

Timestamps are passed through as given (RFC3339 with an explicit UTC
offset, e.g. '2026-09-01T10:00:00-07:00') — this connector never assumes
or injects UTC; the caller controls the timezone via the offset in the
ISO string.
"""
import uuid
from typing import List, Optional

from ...base import BaseMCPConnector
from ...http_util import raise_for_tool_error
from ._auth import google_api_request, google_workspace_missing_config

CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.events.freebusy"]


def _extract_meet_url(data: dict) -> Optional[str]:
    for entry in (data.get("conferenceData") or {}).get("entryPoints", []):
        if entry.get("entryPointType") == "video":
            return entry.get("uri")
    return None


class CalendarConnector(BaseMCPConnector):
    name = "google_calendar"
    display_name = "Google Calendar"
    category = "google_workspace"
    required_scopes = SCOPES

    def missing_config(self) -> List[str]:
        return google_workspace_missing_config()

    def register_tools(self) -> None:
        self._add_tool(
            "create_event",
            "Create a calendar event. Set add_meet=true to attach a real Google Meet conference.",
            {
                "type": "object",
                "properties": {
                    "calendar_id": {"type": "string", "description": "Usually 'primary'."},
                    "summary": {"type": "string"},
                    "start_iso": {"type": "string", "description": "RFC3339 datetime with timezone offset, e.g. '2026-09-01T10:00:00-07:00'."},
                    "end_iso": {"type": "string"},
                    "attendee_emails": {"type": "array", "items": {"type": "string"}},
                    "add_meet": {"type": "boolean", "description": "Attach a Google Meet conference to this event."},
                },
                "required": ["calendar_id", "summary", "start_iso", "end_iso"],
            },
            self._create_event,
        )
        self._add_tool(
            "create_meet",
            "Create a calendar event with a Google Meet conference attached, returning the real meet.google.com URL.",
            {
                "type": "object",
                "properties": {
                    "calendar_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "start_iso": {"type": "string"},
                    "end_iso": {"type": "string"},
                    "attendee_emails": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["calendar_id", "summary", "start_iso", "end_iso"],
            },
            self._create_meet,
        )
        self._add_tool(
            "list_events",
            "List events in a time window.",
            {
                "type": "object",
                "properties": {"calendar_id": {"type": "string"}, "time_min_iso": {"type": "string"}, "time_max_iso": {"type": "string"}},
                "required": ["calendar_id"],
            },
            self._list_events,
        )
        self._add_tool(
            "get_event",
            "Fetch a single event by id.",
            {"type": "object", "properties": {"calendar_id": {"type": "string"}, "event_id": {"type": "string"}}, "required": ["calendar_id", "event_id"]},
            self._get_event,
        )
        self._add_tool(
            "update_event",
            "Update fields on an existing event — only the fields provided are changed.",
            {
                "type": "object",
                "properties": {
                    "calendar_id": {"type": "string"},
                    "event_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "start_iso": {"type": "string"},
                    "end_iso": {"type": "string"},
                    "attendee_emails": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["calendar_id", "event_id"],
            },
            self._update_event,
        )
        self._add_tool(
            "delete_event",
            "Delete an event.",
            {"type": "object", "properties": {"calendar_id": {"type": "string"}, "event_id": {"type": "string"}}, "required": ["calendar_id", "event_id"]},
            self._delete_event,
        )
        self._add_tool(
            "check_availability",
            "Free/busy check across one or more calendars in a time window.",
            {
                "type": "object",
                "properties": {
                    "calendar_ids": {"type": "array", "items": {"type": "string"}, "description": "Defaults to ['primary']."},
                    "time_min_iso": {"type": "string"},
                    "time_max_iso": {"type": "string"},
                },
                "required": ["time_min_iso", "time_max_iso"],
            },
            self._check_availability,
        )

    def _event_body(self, params: dict) -> dict:
        body = {
            "summary": params["summary"],
            "start": {"dateTime": params["start_iso"]},
            "end": {"dateTime": params["end_iso"]},
        }
        if params.get("attendee_emails"):
            body["attendees"] = [{"email": e} for e in params["attendee_emails"]]
        return body

    def _create_event(self, params: dict) -> dict:
        body = self._event_body(params)
        request_kwargs = {"json": body}
        if params.get("add_meet"):
            body["conferenceData"] = {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            }
            request_kwargs["params"] = {"conferenceDataVersion": 1}
        resp = google_api_request(
            "mcp_google_calendar", "POST", f"{CALENDAR_BASE}/calendars/{params['calendar_id']}/events", SCOPES,
            **request_kwargs,
        )
        raise_for_tool_error(resp, "Google Calendar")
        data = resp.json()
        result = {"id": data.get("id"), "html_link": data.get("htmlLink")}
        if params.get("add_meet"):
            result["meet_url"] = _extract_meet_url(data)
        return result

    def _create_meet(self, params: dict) -> dict:
        result = self._create_event({**params, "add_meet": True})
        return {"event_id": result["id"], "calendar_url": result["html_link"], "meet_url": result.get("meet_url")}

    def _list_events(self, params: dict) -> dict:
        query = {"singleEvents": True, "orderBy": "startTime"}
        if params.get("time_min_iso"):
            query["timeMin"] = params["time_min_iso"]
        if params.get("time_max_iso"):
            query["timeMax"] = params["time_max_iso"]
        resp = google_api_request("mcp_google_calendar", "GET", f"{CALENDAR_BASE}/calendars/{params['calendar_id']}/events", SCOPES, params=query)
        raise_for_tool_error(resp, "Google Calendar")
        events = [{"id": e["id"], "summary": e.get("summary"), "start": e.get("start"), "end": e.get("end")} for e in resp.json().get("items", [])]
        return {"events": events}

    def _get_event(self, params: dict) -> dict:
        resp = google_api_request("mcp_google_calendar", "GET", f"{CALENDAR_BASE}/calendars/{params['calendar_id']}/events/{params['event_id']}", SCOPES)
        raise_for_tool_error(resp, "Google Calendar")
        data = resp.json()
        return {
            "id": data.get("id"),
            "summary": data.get("summary"),
            "start": data.get("start"),
            "end": data.get("end"),
            "attendees": data.get("attendees", []),
            "html_link": data.get("htmlLink"),
            "meet_url": _extract_meet_url(data),
            "status": data.get("status"),
        }

    def _update_event(self, params: dict) -> dict:
        body = {}
        if "summary" in params:
            body["summary"] = params["summary"]
        if "start_iso" in params:
            body["start"] = {"dateTime": params["start_iso"]}
        if "end_iso" in params:
            body["end"] = {"dateTime": params["end_iso"]}
        if "attendee_emails" in params:
            body["attendees"] = [{"email": e} for e in params["attendee_emails"]]
        resp = google_api_request(
            "mcp_google_calendar", "PATCH", f"{CALENDAR_BASE}/calendars/{params['calendar_id']}/events/{params['event_id']}", SCOPES,
            json=body,
        )
        raise_for_tool_error(resp, "Google Calendar")
        data = resp.json()
        return {"id": data.get("id"), "summary": data.get("summary"), "start": data.get("start"), "end": data.get("end")}

    def _delete_event(self, params: dict) -> dict:
        resp = google_api_request("mcp_google_calendar", "DELETE", f"{CALENDAR_BASE}/calendars/{params['calendar_id']}/events/{params['event_id']}", SCOPES)
        if resp.status_code not in (200, 204):
            raise_for_tool_error(resp, "Google Calendar")
        return {"deleted": True}

    def _check_availability(self, params: dict) -> dict:
        calendar_ids = params.get("calendar_ids") or ["primary"]
        body = {
            "timeMin": params["time_min_iso"],
            "timeMax": params["time_max_iso"],
            "items": [{"id": cid} for cid in calendar_ids],
        }
        resp = google_api_request("mcp_google_calendar", "POST", f"{CALENDAR_BASE}/freeBusy", SCOPES, json=body)
        raise_for_tool_error(resp, "Google Calendar")
        data = resp.json()
        calendars = {
            cid: {"busy": info.get("busy", []), "errors": info.get("errors")}
            for cid, info in (data.get("calendars") or {}).items()
        }
        return {"calendars": calendars}


connector = CalendarConnector()
