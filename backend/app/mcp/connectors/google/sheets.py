"""Google Sheets MCP connector — Google Sheets API v4
(https://developers.google.com/sheets/api), via the shared Google Workspace
service-account helper (_auth.py).
"""
from typing import List

from ...base import BaseMCPConnector
from ...http_util import raise_for_tool_error
from ._auth import google_api_request, google_workspace_missing_config

SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class SheetsConnector(BaseMCPConnector):
    name = "google_sheets"
    display_name = "Google Sheets"
    category = "google_workspace"
    required_scopes = SCOPES

    def missing_config(self) -> List[str]:
        return google_workspace_missing_config()

    def register_tools(self) -> None:
        self._add_tool(
            "create_spreadsheet",
            "Create a new Google Sheet.",
            {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]},
            self._create_spreadsheet,
        )
        self._add_tool(
            "read_range",
            "Read a cell range.",
            {"type": "object", "properties": {"spreadsheet_id": {"type": "string"}, "range": {"type": "string", "description": "A1 notation, e.g. 'Sheet1!A1:C10'."}}, "required": ["spreadsheet_id", "range"]},
            self._read_range,
        )
        self._add_tool(
            "write_range",
            "Overwrite a cell range with values.",
            {
                "type": "object",
                "properties": {"spreadsheet_id": {"type": "string"}, "range": {"type": "string"}, "values": {"type": "array", "items": {"type": "array"}, "description": "Rows of cell values."}},
                "required": ["spreadsheet_id", "range", "values"],
            },
            self._write_range,
        )
        self._add_tool(
            "append_row",
            "Append a row after the last row with data in a range.",
            {
                "type": "object",
                "properties": {"spreadsheet_id": {"type": "string"}, "range": {"type": "string"}, "values": {"type": "array", "items": {}, "description": "Single row of cell values."}},
                "required": ["spreadsheet_id", "range", "values"],
            },
            self._append_row,
        )

    def _create_spreadsheet(self, params: dict) -> dict:
        resp = google_api_request("mcp_google_sheets", "POST", SHEETS_BASE, SCOPES, json={"properties": {"title": params["title"]}})
        raise_for_tool_error(resp, "Google Sheets")
        data = resp.json()
        return {"spreadsheet_id": data.get("spreadsheetId"), "title": (data.get("properties") or {}).get("title")}

    def _read_range(self, params: dict) -> dict:
        resp = google_api_request("mcp_google_sheets", "GET", f"{SHEETS_BASE}/{params['spreadsheet_id']}/values/{params['range']}", SCOPES)
        raise_for_tool_error(resp, "Google Sheets")
        return {"values": resp.json().get("values", [])}

    def _write_range(self, params: dict) -> dict:
        resp = google_api_request(
            "mcp_google_sheets", "PUT", f"{SHEETS_BASE}/{params['spreadsheet_id']}/values/{params['range']}", SCOPES,
            params={"valueInputOption": "USER_ENTERED"}, json={"values": params["values"]},
        )
        raise_for_tool_error(resp, "Google Sheets")
        data = resp.json()
        return {"updated_cells": data.get("updatedCells")}

    def _append_row(self, params: dict) -> dict:
        resp = google_api_request(
            "mcp_google_sheets", "POST", f"{SHEETS_BASE}/{params['spreadsheet_id']}/values/{params['range']}:append", SCOPES,
            params={"valueInputOption": "USER_ENTERED"}, json={"values": [params["values"]]},
        )
        raise_for_tool_error(resp, "Google Sheets")
        data = resp.json()
        return {"updates": data.get("updates")}


connector = SheetsConnector()
