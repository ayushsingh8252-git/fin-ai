"""Best-effort caller identity for Langfuse session/user tagging only.

This app enforces no authentication on any route (see docs/technical-case-
study.md §7) — so there is no server-verified "who is this" for any request.
X-User-Id is therefore whatever the frontend sends: a signed-in email if one
happens to be known client-side, otherwise a persistent anonymous id it
generates itself (see frontend src/lib/llmopsIdentity.ts). Never use these
values for authorization or to gate access to anything; they exist purely so
Langfuse traces can be grouped/filtered by user and session.
"""
from dataclasses import dataclass

from fastapi import Header, Query


@dataclass(frozen=True)
class LLMOpsIdentity:
    user_id: str | None
    session_id: str | None


def get_llmops_identity(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
    # Query-string fallback for endpoints a browser's native EventSource
    # hits — EventSource can't set custom request headers, so the fraud scan
    # SSE stream sends these as ?user_id=&session_id= instead (see
    # frontend fraud-detection/page.tsx). Headers win when both are present.
    user_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> LLMOpsIdentity:
    return LLMOpsIdentity(user_id=x_user_id or user_id, session_id=x_session_id or session_id)
