from collections import Counter
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import QueryTrace
from ..services import live_status

router = APIRouter()


@router.get("/observability/live/{request_id}")
async def get_live_trace(request_id: str, db: Session = Depends(get_db)):
    """
    Lightweight per-request progress feed for the frontend's live execution
    trace UI — cheap in-memory lookup (services/live_status.py), not a DB
    query, while a request is still running. Falls back to the persisted
    QueryTrace row (reshaped into the same stage-oriented view) once the
    in-memory entry is gone, so the frontend can poll this single endpoint
    throughout a query's lifetime and after, without branching on which
    phase it's in. Distinct from /stats (never touched by this — that
    endpoint scans up to `limit` full trace rows and is explicitly not meant
    for per-request polling).
    """
    live = live_status.get(request_id)
    if live is not None:
        live["live"] = True
        return live

    row = db.query(QueryTrace).filter(QueryTrace.request_id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Trace not found")

    reshaped = live_status.reshape_persisted_trace(row.trace or {})
    reshaped["live"] = False
    return reshaped


@router.get("/observability/trace/{request_id}")
async def get_trace(request_id: str, db: Session = Depends(get_db)):
    """Real-time debugging: the full structured trace for one request, built
    by services/trace.py and populated across query.py's pipeline stages."""
    row = db.query(QueryTrace).filter(QueryTrace.request_id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {
        "request_id": row.request_id,
        "document_id": row.document_id,
        "status": row.status,
        "total_latency_ms": row.total_latency_ms,
        "created_at": row.created_at,
        "trace": row.trace,
    }


def _percentile(sorted_data: list[float], p: float) -> float | None:
    if not sorted_data:
        return None
    k = max(0, min(len(sorted_data) - 1, int(round(p / 100 * (len(sorted_data) - 1)))))
    return sorted_data[k]


@router.get("/observability/stats")
async def get_stats(limit: int = 500, db: Session = Depends(get_db)):
    """
    Aggregate analysis over the most recent `limit` traces: latency
    percentiles, cache hit rate, CRAG grade / adaptive branch distribution,
    fallback/web-search/reranking usage, LLM provider usage, error rate.

    Computed by scanning the last `limit` rows in Python rather than a
    rollup job or time-series store — appropriate for this app's traffic
    scale (see docs/platform-status-audit-2026-08-26-rag-improvement-pass.md);
    revisit if query volume ever makes that scan itself the bottleneck.
    """
    rows = db.query(QueryTrace).order_by(QueryTrace.created_at.desc()).limit(limit).all()
    if not rows:
        return {"sample_size": 0}

    latencies = sorted(r.total_latency_ms for r in rows if r.total_latency_ms is not None)

    crag_grades = Counter()
    adaptive_branches = Counter()
    llm_providers = Counter()
    cache_hits = 0
    cache_checked = 0
    fallback_count = 0
    web_search_count = 0
    rerank_used_count = 0
    error_count = 0
    blocked_count = 0

    for r in rows:
        t = r.trace or {}
        if r.status == "error":
            error_count += 1
        elif r.status == "blocked":
            blocked_count += 1

        grade = (t.get("crag") or {}).get("grade")
        if grade:
            crag_grades[grade] += 1

        for branch in (t.get("adaptive") or {}).get("branches_executed", []):
            adaptive_branches[branch] += 1

        cache_info = t.get("cache") or {}
        if "hit" in cache_info:
            cache_checked += 1
            if cache_info["hit"]:
                cache_hits += 1

        for call in (t.get("retrieval") or {}).get("calls", []):
            if call.get("used_local_fallback"):
                fallback_count += 1
                break

        if (t.get("web_search") or {}).get("used"):
            web_search_count += 1

        if (t.get("reranking") or {}).get("used"):
            rerank_used_count += 1

        for attempt in t.get("llm_attempts", []):
            llm_providers[attempt.get("provider", "unknown")] += 1

    n = len(rows)
    return {
        "sample_size": n,
        "latency_ms": {
            "p50": _percentile(latencies, 50),
            "p95": _percentile(latencies, 95),
            "p99": _percentile(latencies, 99),
            "avg": round(sum(latencies) / len(latencies), 1) if latencies else None,
        },
        "cache_hit_rate": round(cache_hits / cache_checked, 3) if cache_checked else None,
        "retrieval_fallback_rate": round(fallback_count / n, 3),
        "web_search_rate": round(web_search_count / n, 3),
        "reranking_usage_rate": round(rerank_used_count / n, 3),
        "error_rate": round(error_count / n, 3),
        "blocked_rate": round(blocked_count / n, 3),
        "crag_grade_distribution": dict(crag_grades),
        "adaptive_branch_distribution": dict(adaptive_branches),
        "llm_provider_attempt_counts": dict(llm_providers),
    }
