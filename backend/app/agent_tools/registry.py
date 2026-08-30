"""Registry of this platform's own product-feature tool connectors (RAG,
Fraud, Telephonic, Screening, Hiring, Google-status, WhatsApp), plus a
unified view that merges them with the pre-existing external MCP connectors
(mcp/registry.py — Slack, Teams, Jira, GitHub, Salesforce, SAP, SharePoint,
Google Workspace) into one catalog. This is the single list an AI planner
(agent_tools/planner.py) or the WhatsApp agent (services/whatsapp_agent.py)
calls against — "an agent calls a tool" always goes through the same
config-checked, logged, error-normalized BaseMCPConnector.call_tool() used
everywhere else in this codebase, whether the tool wraps a product feature or
a third-party SaaS API.

Mirrors mcp/registry.py's own bootstrap pattern deliberately (deferred
import, module-level `connector` instance per file) rather than inventing a
different one."""
from typing import Dict, List, Optional

from ..mcp import registry as mcp_registry
from ..mcp.base import BaseMCPConnector, MCPToolError

_connectors: Dict[str, BaseMCPConnector] = {}
_bootstrapped = False


def register(connector: BaseMCPConnector) -> None:
    _connectors[connector.name] = connector


def get(name: str) -> Optional[BaseMCPConnector]:
    ensure_bootstrapped()
    return _connectors.get(name)


def all_connectors() -> List[BaseMCPConnector]:
    """This package's own connectors only — product features + Google status."""
    ensure_bootstrapped()
    return list(_connectors.values())


def ensure_bootstrapped() -> None:
    global _bootstrapped
    if _bootstrapped:
        return
    _bootstrapped = True

    from . import fraud_tools, google_tools, hiring_tools, rag_tools, screening_tools, telephonic_tools, verification_tools, whatsapp_tools, voice_id_tools

    for module in (rag_tools, fraud_tools, telephonic_tools, screening_tools, hiring_tools, google_tools, whatsapp_tools, verification_tools, voice_id_tools):
        register(module.connector)


def all_connectors_unified() -> List[BaseMCPConnector]:
    """Every connector a planner can choose from: this package's product
    tools plus every pre-existing external MCP connector, in one list."""
    ensure_bootstrapped()
    mcp_registry.ensure_bootstrapped()
    return all_connectors() + mcp_registry.all_connectors()


def get_unified(name: str) -> Optional[BaseMCPConnector]:
    ensure_bootstrapped()
    mcp_registry.ensure_bootstrapped()
    return _connectors.get(name) or mcp_registry.get(name)


def call_tool(connector_name: str, tool_name: str, params: Optional[dict] = None) -> dict:
    """Single entry point a planner/executor uses to invoke any tool by
    (connector_name, tool_name) regardless of which registry it lives in."""
    connector = get_unified(connector_name)
    if connector is None:
        raise MCPToolError(f"Unknown tool connector '{connector_name}'", code="unknown_connector", status_code=404)
    return connector.call_tool(tool_name, params or {})


def unified_catalog() -> List[dict]:
    """Flat, LLM-prompt-ready catalog: one entry per (connector, tool) with
    enough info for a planner to choose correctly — status is included so an
    unconfigured tool (e.g. WhatsApp before WHATSAPP_ACCESS_TOKEN is set) is
    visibly unavailable rather than silently offered."""
    catalog = []
    for connector in all_connectors_unified():
        info = connector.info()
        for tool in info.tools:
            catalog.append({
                "connector": info.name,
                "connector_display_name": info.display_name,
                "tool": tool["name"],
                "description": tool["description"],
                "input_schema": tool["input_schema"],
                "output_schema": tool.get("output_schema"),
                "permissions": tool.get("permissions") or info.required_scopes,
                "timeout": tool.get("timeout", 15.0),
                "retry_policy": tool.get("retry_policy"),
                "failure_response": tool.get("failure_response"),
                "status": info.status,
            })
    return catalog
