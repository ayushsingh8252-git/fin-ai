"""
Structured, per-request observability for the /query pipeline.

new_trace() builds one JSON-shaped dict per request, threaded through
query.py's pipeline stages (and, from there, into retrieval.py/adaptive_rag.py/
key_manager.py) as a plain mutable dict passed by reference — not a global or
contextvar. Every function that touches it is called synchronously from
query.py's own request handler (including the ThreadPoolExecutor calls deep
inside retrieval.py, which are always `.result()`-joined before their caller
returns), so there is no cross-thread visibility problem a contextvar would
be solving; a plain dict is the simplest thing that's actually correct here.

persist_trace() writes it to the query_traces table in query.py's `finally`
block, so a trace exists even when the request fails outright — a query that
crashes should still be inspectable by request_id, not disappear.

Never records: raw API keys, full prompts, or full answer text — only a
short preview. Mirrors guardrails.py's own "never log secrets" convention.
"""
import logging
import uuid

from ..database import SessionLocal
from ..models import QueryTrace

logger = logging.getLogger(__name__)


def new_trace(endpoint: str, query_text: str, document_id: str | None, top_k: int) -> dict:
    return {
        "request_id": f"req_{uuid.uuid4().hex[:16]}",
        "endpoint": endpoint,
        "query_preview": (query_text or "")[:200],
        "document_id": document_id,
        "top_k": top_k,
        "guardrails": {},
        "cache": {},
        "query_processing": {},
        "retrieval": {},
        "crag": {},
        "adaptive": {},
        "reranking": {"used": False},
        "web_search": {"used": False},
        "llm_attempts": [],
        "final": {},
    }


def persist_trace(trace: dict, status: str = "ok"):
    """Never raises — a broken trace write must not affect the actual query
    response, so any failure here is logged and swallowed."""
    request_id = trace.get("request_id")
    if not request_id:
        return

    db = SessionLocal()
    try:
        row = QueryTrace(
            request_id=request_id,
            document_id=trace.get("document_id"),
            query_text=trace.get("query_preview"),
            status=status,
            total_latency_ms=trace.get("final", {}).get("latency_ms"),
            trace=trace,
        )
        db.merge(row)
        db.commit()
    except Exception as e:
        logger.warning("[Trace] Failed to persist trace %s: %s", request_id, e)
        db.rollback()
    finally:
        db.close()
