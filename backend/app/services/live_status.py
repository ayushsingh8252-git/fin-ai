"""
In-memory, per-request live progress feed for the /query pipeline.

Pure UI plumbing — no RAG logic lives here, and nothing here ever influences
a query's actual retrieval/grading/generation behavior. services/trace.py
already builds one structured trace dict per request and persists it to
SQLite once the request finishes; this module makes the *same* data visible
stage-by-stage while the request is still running, so the frontend can poll
a single lightweight endpoint instead of waiting 5-30s for the full response.

A plain in-memory dict (not Redis, not the DB) is deliberate: this is
short-lived, best-effort UI state scoped to one process. Losing it on a
restart mid-request is fine — the frontend falls back to the persisted
QueryTrace row (see api/observability.py's /live/{request_id} handler)
once the request completes, and nothing about the actual answer depends on
this module ever succeeding.

Stage names are a coarser, UI-facing view over the same sections
services/trace.py already tracks:
  retrieving    -> trace["cache"]              (cache check, before retrieval)
  hybrid_search -> trace["retrieval"]["calls"]  (dense+BM25+RRF, one entry per round)
  crag          -> trace["crag"]
  adaptive      -> trace["adaptive"]
  reranking     -> trace["reranking"]
  tools_web     -> trace["web_search"]
  generating    -> final LLM synthesis call (no dedicated trace section previously;
                    added only for this live view, via update_stage() calls in
                    adaptive_rag.py right around its Step 9 synthesis call)
"""
import copy
import threading
import time

STAGE_ORDER = [
    "retrieving",
    "hybrid_search",
    "crag",
    "adaptive",
    "reranking",
    "tools_web",
    "generating",
]

_MAX_AGE_SECONDS = 600  # generous vs. even a very slow query; just bounds memory

_live: dict[str, dict] = {}
_lock = threading.Lock()


def _sweep_locked():
    cutoff = time.time() - _MAX_AGE_SECONDS
    stale = [rid for rid, entry in _live.items() if entry["started_at"] < cutoff]
    for rid in stale:
        del _live[rid]


def start(request_id: str):
    """Call once, as early as possible in the request (right after the
    request_id is known) — before that, get()/update_stage() are no-ops."""
    with _lock:
        _sweep_locked()
        _live[request_id] = {
            "request_id": request_id,
            "status": "running",
            "stages": {name: {"status": "pending", "data": None} for name in STAGE_ORDER},
            "stage_order": STAGE_ORDER,
            "final": None,
            "started_at": time.time(),
            "updated_at": time.time(),
        }


def update_stage(request_id: str, stage: str, status: str, data: dict | None = None):
    """status: "running" | "done". Silently no-ops if this request_id isn't
    tracked (start() never called, or already swept) — this is best-effort
    observability, never worth raising over or affecting the query."""
    if stage not in STAGE_ORDER:
        return
    with _lock:
        entry = _live.get(request_id)
        if entry is None:
            return
        entry["stages"][stage] = {"status": status, "data": data}
        entry["updated_at"] = time.time()


def finish(request_id: str, status: str, final: dict | None = None):
    """Marks the request done. Any stage that never got a real update stays
    accurate as "skipped" (e.g. a cache hit skips everything after
    "retrieving"; a blocked guardrail skips everything); any stage still
    "running" (no explicit "done" call, e.g. a single-shot stage) is
    resolved to "done" since the request as a whole is now complete."""
    with _lock:
        entry = _live.get(request_id)
        if entry is None:
            return
        for stage_info in entry["stages"].values():
            if stage_info["status"] == "pending":
                stage_info["status"] = "skipped"
            elif stage_info["status"] == "running":
                stage_info["status"] = "done"
        entry["status"] = status
        entry["final"] = final
        entry["updated_at"] = time.time()


def get(request_id: str) -> dict | None:
    with _lock:
        entry = _live.get(request_id)
        return copy.deepcopy(entry) if entry is not None else None


def reshape_persisted_trace(trace: dict) -> dict:
    """Best-effort fallback for when a client polls /live/{request_id} after
    the in-memory entry above has already been cleaned up (process restart,
    or a poll arriving long after completion) — reshapes the old flat
    QueryTrace.trace JSON into this module's stage-oriented view so the
    frontend has exactly one response shape to parse either way.

    Every request runs `crag` (trace["crag"]) only if it got past the
    guardrail/cache short-circuits in api/query.py, so "does trace['crag']
    have a 'grade' key" is the reliable signal for "did the adaptive
    pipeline actually run" that every later stage's skipped/done split is
    derived from — see api/query.py's post-pipeline trace assembly.
    """
    cache = trace.get("cache") or {}
    retrieval_calls = (trace.get("retrieval") or {}).get("calls") or []
    crag = trace.get("crag") or {}
    adaptive = trace.get("adaptive") or {}
    reranking = trace.get("reranking") or {}
    web_search = trace.get("web_search") or {}
    final = trace.get("final") or {}

    pipeline_ran = bool(crag.get("grade"))
    reranking_ran = "candidate_count" in reranking
    answer_produced = pipeline_ran and final.get("retrieval_mode") not in (None, "missing")

    def stage(status: str, data: dict | None):
        return {"status": status, "data": data}

    stages = {
        "retrieving": stage("done" if cache else "skipped", cache or None),
        "hybrid_search": stage("done" if retrieval_calls else "skipped", {"rounds": retrieval_calls} if retrieval_calls else None),
        "crag": stage("done" if pipeline_ran else "skipped", crag or None),
        "adaptive": stage("done" if pipeline_ran else "skipped", adaptive or None),
        "reranking": stage("done" if reranking_ran else "skipped", reranking if reranking_ran else None),
        "tools_web": stage("done" if (pipeline_ran and web_search.get("used")) else "skipped", web_search if pipeline_ran else None),
        "generating": stage("done" if answer_produced else "skipped", {"llm_attempts": trace.get("llm_attempts", [])} if pipeline_ran else None),
    }

    return {
        "request_id": trace.get("request_id"),
        "status": "ok",
        "stages": stages,
        "stage_order": STAGE_ORDER,
        "final": final,
    }
