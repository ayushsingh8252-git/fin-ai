"""
MCP (Model Context Protocol) integration layer — enterprise tool connectors
this platform's agents can call as MCP-style tools: Microsoft Teams, Slack,
Jira, GitHub, Salesforce, SAP, SharePoint, and Google Workspace (Gmail,
Drive, Calendar, Docs, Sheets).

Same "empty config default + a clear error when unconfigured" convention as
Sarvam (services/sarvam_service.py) — a connector without real
credentials configured is not a fake integration, it's the real integration
honestly reporting that it isn't wired up yet, rather than fabricating a
response. Real HTTP calls only ever happen once `missing_config()` is empty.

Each connector:
  - declares which env vars it needs (`missing_config()`) and the minimum
    OAuth/API scopes it actually requires (`required_scopes`), so nothing
    over-requests permissions
  - exposes a small, fixed set of ToolDefinitions (name/description/JSON
    input schema) so a caller — the REST layer in api/mcp.py, or this app's
    own agents — can discover what it can do without reading the source
  - implements each tool as a plain `params -> dict` handler registered via
    `_add_tool`; this base class wraps dispatch with the config check,
    structured logging, and error normalization every connector shares
"""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("mcp")


class MCPToolError(Exception):
    """Raised by a connector's tool implementation. `code` lets callers (the
    REST layer, an LLM tool-calling loop) branch on failure kind without
    string-matching the message; `status_code` is what api/mcp.py returns."""

    def __init__(self, message: str, code: str = "tool_error", status_code: int = 502):
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class NotConfiguredError(MCPToolError):
    def __init__(self, connector: str, missing: List[str]):
        self.missing = missing
        super().__init__(
            f"{connector} is not configured — missing: {', '.join(missing)}",
            code="not_configured",
            status_code=503,
        )


class UnknownToolError(MCPToolError):
    def __init__(self, connector: str, tool_name: str):
        super().__init__(f"Unknown tool '{tool_name}' for connector '{connector}'", code="unknown_tool", status_code=404)


@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: Dict[str, Any]  # JSON Schema: {"type": "object", "properties": {...}, "required": [...]}
    # False only for a tool that reads purely local/already-persisted data and
    # never calls out to the connector's external service — e.g. a message-
    # status lookup that reads this app's own DB rather than the vendor API.
    # Defaults True so every pre-existing connector's behavior is unchanged.
    requires_config: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


@dataclass
class ConnectorInfo:
    name: str
    display_name: str
    category: str
    status: str  # "configured" | "not_configured"
    missing_config: List[str]
    required_scopes: List[str]
    tools: List[Dict[str, Any]]


class BaseMCPConnector(ABC):
    """Subclass, set name/display_name/category/required_scopes, implement
    register_tools() (calling self._add_tool for each) and missing_config()."""

    name: str
    display_name: str
    category: str
    required_scopes: List[str] = []

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}
        self._handlers: Dict[str, Callable[[dict], dict]] = {}
        self.register_tools()

    @abstractmethod
    def register_tools(self) -> None:
        """Populate this connector's tools via self._add_tool(...)."""

    @abstractmethod
    def missing_config(self) -> List[str]:
        """Env var names this connector needs that are currently unset —
        empty list means fully configured and safe to make real calls."""

    def _add_tool(
        self,
        name: str,
        description: str,
        input_schema: Dict[str, Any],
        handler: Callable[[dict], dict],
        requires_config: bool = True,
    ) -> None:
        self._tools[name] = ToolDefinition(name=name, description=description, input_schema=input_schema, requires_config=requires_config)
        self._handlers[name] = handler

    def is_configured(self) -> bool:
        return len(self.missing_config()) == 0

    def list_tools(self) -> List[ToolDefinition]:
        return list(self._tools.values())

    def info(self) -> ConnectorInfo:
        missing = self.missing_config()
        return ConnectorInfo(
            name=self.name,
            display_name=self.display_name,
            category=self.category,
            status="configured" if not missing else "not_configured",
            missing_config=missing,
            required_scopes=self.required_scopes,
            tools=[t.to_dict() for t in self.list_tools()],
        )

    def call_tool(self, tool_name: str, params: Optional[dict] = None) -> dict:
        """Config-checked, logged, error-normalized dispatch — every
        connector's REST/agent entry point should go through this rather
        than calling a handler directly."""
        if tool_name not in self._handlers:
            raise UnknownToolError(self.name, tool_name)

        if self._tools[tool_name].requires_config:
            missing = self.missing_config()
            if missing:
                logger.warning("[MCP:%s] '%s' blocked — missing config: %s", self.name, tool_name, missing)
                raise NotConfiguredError(self.display_name, missing)

        started = time.monotonic()
        try:
            result = self._handlers[tool_name](params or {})
            logger.info("[MCP:%s] '%s' ok (%.0fms)", self.name, tool_name, (time.monotonic() - started) * 1000)
            return result if isinstance(result, dict) else {"result": result}
        except MCPToolError:
            logger.error("[MCP:%s] '%s' failed after %.0fms", self.name, tool_name, (time.monotonic() - started) * 1000)
            raise
        except Exception as e:
            logger.error("[MCP:%s] '%s' failed after %.0fms: %s", self.name, tool_name, (time.monotonic() - started) * 1000, e)
            raise MCPToolError(f"{self.display_name} tool '{tool_name}' failed: {e}", code="upstream_error", status_code=502)
