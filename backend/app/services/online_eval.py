"""Online evals — samples recent LIVE Langfuse traces per workflow and scores
them with cheap heuristics (all workflows) plus a coarse LLM-judge
groundedness check (RAG only, a smaller sample on top of the heuristic
sample). Complements scripts/evaluate_rag.py's offline fixed-question-set
run, which never sees real production traffic.

No-op whenever Langfuse isn't configured (get_langfuse() is None) — this
module is only ever invoked from main.py's background loop or the manual
/evals/online/run-once endpoint, never from a request's own critical path,
so there is no request to keep fast here; the fail-open convention instead
exists so one bad trace or one Langfuse API hiccup never kills the batch or
the loop that calls this repeatedly.
"""
import logging
import random
import uuid
import warnings
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..database import SessionLocal
from ..models import OnlineEvalResult
from .llmops import get_langfuse, llmops_context
from .llm_service import generate_json_resilient

logger = logging.getLogger(__name__)

WORKFLOW_TYPES = ["rag", "fraud", "interview", "screening", "telephonic"]

_GROUNDEDNESS_PROMPT = """You are a strict QA auditor for an AI system's answer. \
You will see the full prompt (including any retrieved context) given to the \
model, and the model's raw output. Judge only whether the output is a \
plausible, on-topic response consistent with the given context — not whether \
it is a perfect answer. Respond with strict JSON only: \
{{"grounded": true|false, "reason": "<one short sentence>"}}.

PROMPT GIVEN TO THE MODEL:
{prompt}

MODEL OUTPUT:
{output}
"""


def _already_scored_trace_ids(db, since: datetime) -> set[str]:
    rows = (
        db.query(OnlineEvalResult.langfuse_trace_id)
        .filter(OnlineEvalResult.check_name == "has_output", OnlineEvalResult.created_at >= since)
        .all()
    )
    return {r[0] for r in rows}


def _persist_and_score(db, lf, *, trace_id: str, workflow_type: str, check_name: str, passed: bool, score=None, detail=None):
    row = OnlineEvalResult(
        id=str(uuid.uuid4()),
        langfuse_trace_id=trace_id,
        workflow_type=workflow_type,
        check_name=check_name,
        passed="true" if passed else "false",
        score=score,
        detail=detail,
    )
    try:
        db.add(row)
        db.commit()
    except Exception as exc:
        logger.warning("[OnlineEval] Failed to persist %s/%s: %s", trace_id, check_name, exc)
        db.rollback()

    try:
        lf.create_score(
            name=f"online_eval.{check_name}",
            value=1.0 if passed else 0.0,
            trace_id=trace_id,
            data_type="BOOLEAN",
            metadata={"workflow_type": workflow_type, **(detail or {})},
        )
    except Exception as exc:
        logger.warning("[OnlineEval] Failed to push score %s/%s to Langfuse: %s", trace_id, check_name, exc)


def _run_heuristics(db, lf, trace, workflow_type: str) -> None:
    output = getattr(trace, "output", None)
    has_output = bool(output) if not isinstance(output, (dict, list)) else len(output) > 0
    _persist_and_score(db, lf, trace_id=trace.id, workflow_type=workflow_type, check_name="has_output", passed=has_output)

    latency = getattr(trace, "latency", None)
    if latency is not None:
        latency_ms = latency * 1000
        _persist_and_score(
            db, lf,
            trace_id=trace.id, workflow_type=workflow_type, check_name="latency_ok",
            passed=latency_ms <= settings.ONLINE_EVAL_LATENCY_THRESHOLD_MS,
            score=latency_ms, detail={"latency_ms": round(latency_ms, 1)},
        )

    # Coarse proxy only — the trace-level output here is whatever the root
    # span happened to set, which isn't guaranteed to be the final answer
    # (see _fetch_last_generation below for why the judge check reads
    # observations instead). Still a useful cheap signal: an unhandled
    # exception's repr reliably contains one of these markers.
    text_out = output if isinstance(output, str) else (str(output) if output else "")
    no_error_markers = not any(m in text_out.lower() for m in ("traceback", "exception", "internal server error"))
    _persist_and_score(db, lf, trace_id=trace.id, workflow_type=workflow_type, check_name="no_error_markers", passed=no_error_markers)


def _fetch_last_generation(lf, trace_id: str):
    """The trace-level input/output (from the Trace list endpoint) reflects
    whichever observation happens to be this trace's root span — for this
    app that's usually an early guardrail/retrieval span, not the final LLM
    call. The actual prompt+answer live on the trace's GENERATION
    observation(s) instead, so the judge check reads those directly."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            resp = lf.api.observations.get_many(trace_id=trace_id, type="GENERATION", fields="core,io", limit=10)
    except Exception as exc:
        logger.warning("[OnlineEval] Failed to fetch generations for trace %s: %s", trace_id, exc)
        return None
    generations = [g for g in resp.data if g.input and g.output]
    if not generations:
        return None
    return max(generations, key=lambda g: g.start_time)


def _run_groundedness_judge(db, lf, trace, workflow_type: str) -> None:
    generation = _fetch_last_generation(lf, trace.id)
    if generation is None:
        return
    prompt = generation.input.get("prompt") if isinstance(generation.input, dict) else generation.input
    output = generation.output
    if not prompt or not output:
        return

    try:
        with llmops_context(workflow_type="online_eval"):
            result = generate_json_resilient(
                _GROUNDEDNESS_PROMPT.format(prompt=str(prompt)[:4000], output=str(output)[:2000]),
                "You are a JSON-only QA auditor. Respond with strict JSON and nothing else.",
                prompt_metadata={"eval": True, "check_name": "groundedness_judge"},
            )
    except Exception as exc:
        logger.warning("[OnlineEval] groundedness_judge call failed for trace %s: %s", trace.id, exc)
        return

    passed = bool(result.get("grounded")) if isinstance(result, dict) else False
    detail = {"reason": result.get("reason")} if isinstance(result, dict) else None
    _persist_and_score(db, lf, trace_id=trace.id, workflow_type=workflow_type, check_name="groundedness_judge", passed=passed, detail=detail)


def run_online_eval_once() -> dict:
    lf = get_langfuse()
    if lf is None:
        return {"status": "skipped", "reason": "langfuse_not_configured"}

    since_dt = datetime.now(timezone.utc) - timedelta(seconds=settings.ONLINE_EVAL_LOOKBACK_SECONDS)
    db = SessionLocal()
    sampled_by_workflow: dict[str, int] = {}
    try:
        already_scored = _already_scored_trace_ids(db, since_dt)

        for workflow_type in WORKFLOW_TYPES:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    traces = lf.api.trace.list(tags=[workflow_type], from_timestamp=since_dt, limit=50).data
            except Exception as exc:
                logger.warning("[OnlineEval] Failed to list traces for workflow=%s: %s", workflow_type, exc)
                continue

            candidates = [t for t in traces if t.id not in already_scored]
            sampled = [t for t in candidates if random.random() < settings.ONLINE_EVAL_SAMPLE_RATE]
            sampled_by_workflow[workflow_type] = len(sampled)

            for trace in sampled:
                try:
                    _run_heuristics(db, lf, trace, workflow_type)
                except Exception as exc:
                    logger.warning("[OnlineEval] heuristics failed for trace %s: %s", trace.id, exc)

                if workflow_type == "rag" and random.random() < settings.ONLINE_EVAL_JUDGE_SAMPLE_RATE:
                    try:
                        _run_groundedness_judge(db, lf, trace, workflow_type)
                    except Exception as exc:
                        logger.warning("[OnlineEval] groundedness_judge errored for trace %s: %s", trace.id, exc)
    finally:
        db.close()

    return {"status": "ok", "sampled_by_workflow": sampled_by_workflow}
