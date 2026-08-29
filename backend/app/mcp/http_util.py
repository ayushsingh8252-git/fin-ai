"""Shared HTTP call helper for MCP connectors — every connector routes its
real API calls through here so they all get the same circuit-breaker +
retry behavior already used for Groq/Gemini/Pinecone/Tavily/Sarvam/SMTP
(see services/resilience.py), instead of each connector reinventing it.

Only network/server failures are retried — a 4xx (bad auth, bad request) is
returned as-is for the caller to turn into a clear MCPToolError, since
retrying a request Slack/Jira/GitHub already rejected can't help."""
import requests

from ..services.resilience import call_with_resilience
from .base import MCPToolError


def resilient_request(breaker_name: str, method: str, url: str, timeout: float = 15.0, **kwargs) -> requests.Response:
    def _do() -> requests.Response:
        resp = requests.request(method, url, timeout=timeout, **kwargs)
        if resp.status_code >= 500:
            resp.raise_for_status()  # only 5xx is treated as retryable
        return resp

    try:
        return call_with_resilience(breaker_name, _do, max_attempts=3, base_delay=0.4, max_delay=4.0)
    except requests.exceptions.RequestException as e:
        raise MCPToolError(f"Request to {url} failed: {e}", code="network_error", status_code=502)


def raise_for_tool_error(resp: requests.Response, connector: str) -> None:
    """Call after resilient_request when the API signals errors via a normal
    HTTP status code (most REST APIs) — Slack is the one exception (see
    connectors/slack.py, which checks its own `ok` field instead)."""
    if resp.status_code >= 400:
        raise MCPToolError(
            f"{connector} API returned {resp.status_code}: {resp.text[:300]}",
            code="upstream_error",
            status_code=502,
        )
