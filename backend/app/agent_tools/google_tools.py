"""Google Workspace status tool. Gmail/Calendar/Sheets/Docs/Drive are NOT
re-wrapped here — they already exist as real, fully-implemented MCP
connectors (app/mcp/connectors/google/*.py, each making genuine Graph-style
Google API calls, not stubs) and are already independently callable via the
existing POST /api/v1/mcp/connectors/{name}/tools/{tool}/call surface. This
file's only job is the one genuinely missing piece: a single, honest
readiness check across all five connectors (Part 9 of the product spec) — it
introspects BaseMCPConnector.missing_config()/is_configured() rather than
guessing, so it never reports an integration as working without a real
config check.

Google Meet is not a separate connector — app/mcp/connectors/google/calendar.py's
`create_meet` tool already provisions a real Google Meet link via the
Calendar API's conferenceData mechanism, so Meet's readiness is identical to
Calendar's and reported under the "meet" key by reusing that same
connector's status.

get_google_integration_status reports configuration/availability but does
NOT make a live test call to Google — see the platform audit for why: the
one missing credential (GOOGLE_OAUTH_REFRESH_TOKEN) can only be obtained by a
human completing the /auth/google/login consent flow in a browser, which
this tool cannot do on its own."""
from typing import Any, Dict, List

from ..mcp import registry as mcp_registry
from ..mcp.base import BaseMCPConnector


_CONNECTOR_KEYS = {
    "gmail": "gmail",
    "calendar": "google_calendar",
    "meet": "google_calendar",  # Meet's readiness == Calendar's; see module docstring
    "sheets": "google_sheets",
    "docs": "google_docs",
    "drive": "google_drive",
}


class GoogleStatusConnector(BaseMCPConnector):
    name = "google_workspace_status"
    display_name = "Google Workspace (status)"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        return []  # this connector only introspects others' status; it has none of its own

    def register_tools(self) -> None:
        self._add_tool(
            name="get_google_integration_status",
            description=(
                "Report whether Google OAuth and each Google Workspace tool (Gmail, Calendar, Meet, "
                "Sheets, Docs) are actually configured — never claims an integration works without "
                "checking its real credential state."
            ),
            input_schema={"type": "object", "properties": {}},
            handler=self._get_google_integration_status,
        )

    def _get_google_integration_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        mcp_registry.ensure_bootstrapped()

        status: Dict[str, Any] = {}
        oauth_ready = True
        for label, connector_name in _CONNECTOR_KEYS.items():
            connector = mcp_registry.get(connector_name)
            if connector is None:
                status[label] = {"configured": False, "available": False, "missing_config": [f"connector '{connector_name}' not registered"]}
                oauth_ready = False
                continue
            missing = connector.missing_config()
            status[label] = {
                "configured": len(missing) == 0,
                "available": len(missing) == 0,
                "missing_config": missing,
            }
            if missing:
                oauth_ready = False

        return {
            "oauth": {"configured": oauth_ready},
            **status,
        }


connector = GoogleStatusConnector()
