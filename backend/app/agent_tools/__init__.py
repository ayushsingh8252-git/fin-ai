"""Agent tool layer — thin, agent-callable wrappers around this platform's
existing product features (RAG, Fraud, Telephonic, Screening, Hiring,
WhatsApp), plus a status check over the existing Google Workspace MCP
connectors.

Deliberately reuses app/mcp/base.py's `BaseMCPConnector` / `ToolDefinition` /
`MCPToolError` contract rather than inventing a second one — these connectors
aren't literally MCP (Model Context Protocol) integrations to third-party
SaaS the way app/mcp/connectors/ are, but the same shape (name + description +
JSON-schema input + a handler, config-checked and error-normalized dispatch)
applies identically, so there's exactly one tool-calling contract in the
codebase, not two competing ones.

Every handler in this package calls into the *existing* business-logic
function it wraps (api/query.py::process_query, api/fraud.py's run_scan,
api/telephonic.py's place_call/get_call, services/screening_service.py,
services/hiring_service.py, memory/orchestrator.py) rather than
reimplementing any of it — see each module's own docstring for exactly which
function is being wrapped.
"""
