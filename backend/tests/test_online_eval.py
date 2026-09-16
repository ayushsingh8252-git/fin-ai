"""Online eval sampling job (services/online_eval.py) — must no-op cleanly
without Langfuse, must score heuristics on a sampled trace and push a
Langfuse score, and must not re-score the same trace on a second run within
the same lookback window (dedupe)."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.database import Base, SessionLocal, engine
from app.models import OnlineEvalResult
from app.services.online_eval import run_online_eval_once

Base.metadata.create_all(bind=engine)


def _clear_online_eval_results():
    db = SessionLocal()
    try:
        db.query(OnlineEvalResult).delete()
        db.commit()
    finally:
        db.close()


def test_run_online_eval_once_skips_without_langfuse():
    with patch("app.services.online_eval.get_langfuse", return_value=None):
        result = run_online_eval_once()
    assert result == {"status": "skipped", "reason": "langfuse_not_configured"}


def _fake_trace(trace_id: str) -> SimpleNamespace:
    return SimpleNamespace(id=trace_id, output="a real, non-empty answer", latency=2.5, input="what is the policy?")


def test_run_online_eval_once_scores_heuristics_and_dedupes():
    _clear_online_eval_results()

    fake_lf = MagicMock()

    def trace_list(*, tags, **kwargs):
        if tags == ["rag"]:
            return SimpleNamespace(data=[_fake_trace("trace-online-eval-1")])
        return SimpleNamespace(data=[])

    fake_lf.api.trace.list.side_effect = trace_list
    # No generations found -> the RAG groundedness judge check no-ops rather
    # than making a real LLM call, keeping this test hermetic.
    fake_lf.api.observations.get_many.return_value = SimpleNamespace(data=[])

    with patch("app.services.online_eval.get_langfuse", return_value=fake_lf), \
         patch("app.services.online_eval.random.random", return_value=0.0):
        first = run_online_eval_once()
        second = run_online_eval_once()

    assert first["status"] == "ok"
    assert first["sampled_by_workflow"]["rag"] == 1
    # Second run samples the trace again (still in the lookback window) but
    # must skip re-scoring it — already_scored dedupe short-circuits before
    # any heuristic runs.
    assert second["sampled_by_workflow"]["rag"] == 0

    db = SessionLocal()
    try:
        rows = db.query(OnlineEvalResult).filter(OnlineEvalResult.langfuse_trace_id == "trace-online-eval-1").all()
    finally:
        db.close()

    check_names = {row.check_name for row in rows}
    assert "has_output" in check_names
    assert "latency_ok" in check_names
    has_output_row = next(r for r in rows if r.check_name == "has_output")
    assert has_output_row.passed == "true"

    # One create_score call per persisted check on the first run only.
    scored_names = {call.kwargs["name"] for call in fake_lf.create_score.call_args_list}
    assert "online_eval.has_output" in scored_names
    assert "online_eval.latency_ok" in scored_names
