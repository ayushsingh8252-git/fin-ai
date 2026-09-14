"""
RAG retrieval evaluation suite (docs/platform-status-audit-2026-08-26-rag-
improvement-pass.md, section 17) — compares Dense-only vs. Hybrid vs.
Hybrid+Reranking on the same fixed question set, run in-process against
whatever document(s) are currently indexed (same pattern the pre-existing
backend/*_benchmark_results.json files used: direct calls into
retrieve_rules_and_chunks_parallel + generate_answer_with_fallback, not HTTP,
so this doesn't need a running server).

Question set covers the 7 categories the spec asks for: direct factual,
multi-hop, exact technology/acronym, numerical achievement, multi-chunk,
weak-evidence, and completely out-of-scope. Six of the nine questions here
are the same questions (or direct variants) already answered correctly in
adaptive_benchmark_results.json on 2026-08-24 against Ayush Singh's resume —
their `expect_keywords` are taken from that prior verified run's own answers,
not invented. The other three (multi-hop, weak-evidence, and a second
acronym/ID probe) have no fabricated ground truth; they're graded on
structural signals only (e.g. "did the model honestly say the info is
missing" for the weak-evidence/out-of-scope cases) rather than a keyword list
this script's author can't independently verify.

"Correctness" below means keyword/phrase presence in the generated answer,
NOT a human-graded quality score — there is no labeled ground-truth answer
set for this corpus. Treat it as a coarse regression signal, not a precision
metric.

Usage:
    venv/Scripts/python.exe scripts/evaluate_rag.py [--document-id DOC_ID] [--top-k 5]

If the corpus (or the given document) has no indexed chunks/rules, the
script reports that plainly and exits without writing a results file —
never fabricates numbers for a query that had nothing to retrieve.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import Chunk, Rule  # noqa: E402
from app.services.retrieval import retrieve_rules_and_chunks_parallel  # noqa: E402
from app.services.reasoning import generate_answer_with_fallback  # noqa: E402
from app.services.llmops import get_langfuse  # noqa: E402

LANGFUSE_DATASET_NAME = "rag-eval-questions"

MISSING_INFO_PHRASES = (
    "does not contain", "not contain", "no information", "not mention",
    "missing from document context", "not specified", "does not specify",
    "not found in", "not available in the provided",
)

QUESTIONS = [
    {
        "id": 1, "category": "direct_factual",
        "question": "What is Ayush Singh's education, college, and graduation year?",
        "expect_keywords": ["parul university"],
    },
    {
        "id": 2, "category": "multi_hop",
        "question": "Across Ayush's work at both OpenEyes and Logicmotive, what cloud/AI infrastructure did he use, and how did his role differ between the two companies?",
        "expect_keywords": ["openeyes", "logicmotive"],
    },
    {
        "id": 3, "category": "exact_technology_acronym",
        "question": "What AWS services and embedding models did Ayush work with at Logicmotive?",
        "expect_keywords": ["aws", "titan"],
    },
    {
        "id": 4, "category": "exact_technology_acronym",
        "question": "What AI systems did Ayush build at OpenEyes and what accuracy improvement was achieved?",
        "expect_keywords": ["rag"],
    },
    {
        "id": 5, "category": "numerical_achievement",
        "question": "What prize and rank did Ayush win in the PU Code Hackathon?",
        "expect_keywords": ["5,000", "5000"],
    },
    {
        "id": 6, "category": "numerical_achievement",
        "question": "What accuracy improvement did Ayush's multimodal RAG system achieve at OpenEyes?",
        "expect_keywords": ["33%", "33"],
    },
    {
        "id": 7, "category": "multi_chunk",
        "question": "Summarize Ayush's key technical skills in GenAI, backend, and DevOps.",
        "expect_keywords": ["fastapi", "docker"],
    },
    {
        "id": 8, "category": "weak_evidence",
        "question": "What formal certifications does Ayush hold, if any are mentioned?",
        "expect_missing_info": True,
    },
    {
        "id": 9, "category": "out_of_scope",
        "question": "What is Ayush's experience with Microsoft Azure Cognitive Services?",
        "expect_missing_info": True,
    },
]

MODES = [
    {"name": "dense_only", "hybrid": False, "rerank": False},
    {"name": "hybrid", "hybrid": True, "rerank": False},
    {"name": "hybrid_rerank", "hybrid": True, "rerank": True},
]


def corpus_size(document_id: str | None) -> tuple[int, int]:
    db = SessionLocal()
    try:
        chunk_q = db.query(Chunk)
        rule_q = db.query(Rule)
        if document_id:
            chunk_q = chunk_q.filter(Chunk.document_id == document_id)
            rule_q = rule_q.filter(Rule.document_id == document_id)
        return chunk_q.count(), rule_q.count()
    finally:
        db.close()


def check_correctness(answer: str, spec: dict) -> bool:
    lower = (answer or "").lower()
    if spec.get("expect_missing_info"):
        return any(p in lower for p in MISSING_INFO_PHRASES)
    keywords = spec.get("expect_keywords", [])
    return any(k.lower() in lower for k in keywords)


def run_mode(mode: dict, document_id: str | None, top_k: int) -> list[dict]:
    original_rerank_flag = settings.ENABLE_CROSS_ENCODER_RERANK
    settings.ENABLE_CROSS_ENCODER_RERANK = mode["rerank"]
    results = []
    try:
        for q in QUESTIONS:
            t0 = time.perf_counter()
            rules, chunks = retrieve_rules_and_chunks_parallel(
                q["question"], top_k=top_k, document_id=document_id, hybrid=mode["hybrid"]
            )
            t1 = time.perf_counter()
            answer_data = generate_answer_with_fallback(
                q["question"], rules, chunks, document_id=document_id
            )
            t2 = time.perf_counter()

            answer = answer_data.get("answer", "")
            results.append({
                "id": q["id"],
                "category": q["category"],
                "question": q["question"],
                "retrieval_latency_ms": round((t1 - t0) * 1000, 1),
                "reasoning_latency_ms": round((t2 - t1) * 1000, 1),
                "total_latency_ms": round((t2 - t0) * 1000, 1),
                "retrieval_mode": answer_data.get("retrieval_mode"),
                "rules_retrieved_count": len(rules),
                "chunks_retrieved_count": len(chunks),
                "source_count": len(answer_data.get("sources") or []),
                "answer": answer,
                "correct": check_correctness(answer, q),
            })
    finally:
        settings.ENABLE_CROSS_ENCODER_RERANK = original_rerank_flag
    return results


def _expected_output_for(q: dict) -> dict:
    """The part of a question spec check_correctness() actually needs, moved
    into a dataset item's expected_output so the same grading function works
    unchanged whether it's called from run_mode() (local script loop) or
    _correctness_evaluator() (Langfuse experiment) below."""
    if q.get("expect_missing_info"):
        return {"expect_missing_info": True}
    return {"expect_keywords": q.get("expect_keywords", [])}


def ensure_langfuse_dataset(lf) -> None:
    """Seeds the fixed 9-question set as a Langfuse Dataset, once. Safe to
    call on every run: create_dataset() is a no-op if the dataset already
    exists, and each item is upserted by its stable id (f"q{n}") rather than
    appended, so re-running this script never creates duplicate items."""
    try:
        lf.create_dataset(
            name=LANGFUSE_DATASET_NAME,
            description="Fixed 9-question RAG regression set (docs/platform-status-audit-2026-08-26-rag-improvement-pass.md) — dense vs hybrid vs hybrid+rerank.",
        )
    except Exception as e:
        print(f"[Langfuse] create_dataset skipped/failed (likely already exists): {e}")

    for q in QUESTIONS:
        try:
            lf.create_dataset_item(
                dataset_name=LANGFUSE_DATASET_NAME,
                id=f"q{q['id']}",
                input=q["question"],
                expected_output=_expected_output_for(q),
                metadata={"category": q["category"]},
            )
        except Exception as e:
            print(f"[Langfuse] create_dataset_item(q{q['id']}) failed: {e}")


def _make_task(mode: dict, document_id: str | None, top_k: int):
    """Task closure for one retrieval mode — runs the exact same real RAG
    pipeline call run_mode() above uses, per dataset item."""

    def task(*, item, **kwargs):
        settings.ENABLE_CROSS_ENCODER_RERANK = mode["rerank"]
        question = item.input
        rules, chunks = retrieve_rules_and_chunks_parallel(
            question, top_k=top_k, document_id=document_id, hybrid=mode["hybrid"]
        )
        answer_data = generate_answer_with_fallback(question, rules, chunks, document_id=document_id)
        return {
            "answer": answer_data.get("answer", ""),
            "retrieval_mode": answer_data.get("retrieval_mode"),
            "rules_retrieved_count": len(rules),
            "chunks_retrieved_count": len(chunks),
        }

    return task


def _correctness_evaluator(*, input, output, expected_output=None, **kwargs):
    """Same keyword/missing-info heuristic as check_correctness() above,
    adapted to Langfuse's evaluator signature — one Evaluation per item,
    aggregated by Langfuse into the run's overall correctness score."""
    from langfuse import Evaluation

    answer = output.get("answer", "") if isinstance(output, dict) else str(output)
    is_correct = check_correctness(answer, expected_output or {})
    return Evaluation(
        name="correctness",
        value=1.0 if is_correct else 0.0,
        data_type="BOOLEAN",
        comment="Matched expected keywords/missing-info phrasing" if is_correct else "Did not match expectation",
    )


def run_langfuse_experiments(document_id: str | None, top_k: int) -> None:
    """Pushes the same 3 modes to Langfuse as 3 experiment runs against the
    shared dataset — additive, never blocks the local script's own report/
    JSON output above. No-op if Langfuse isn't configured."""
    lf = get_langfuse()
    if lf is None:
        print("\n[Langfuse] Not configured — skipping experiment push (local report/JSON above is unaffected).")
        return

    original_rerank_flag = settings.ENABLE_CROSS_ENCODER_RERANK
    try:
        ensure_langfuse_dataset(lf)
        dataset = lf.get_dataset(LANGFUSE_DATASET_NAME)
        for mode in MODES:
            print(f"\n[Langfuse] Running experiment for mode: {mode['name']}...")
            result = lf.run_experiment(
                name="rag-eval",
                run_name=f"rag-eval-{mode['name']}",
                description=f"hybrid={mode['hybrid']}, rerank={mode['rerank']}",
                data=dataset.items,
                task=_make_task(mode, document_id, top_k),
                evaluators=[_correctness_evaluator],
                max_concurrency=1,  # sequential, matching run_mode()'s own for-loop above
            )
            # Not result.format() — its human-readable summary includes
            # emoji that crash on Windows' default cp1252 console encoding.
            n = len(result.item_results)
            correct = sum(
                1 for r in result.item_results
                for e in r.evaluations if e.name == "correctness" and e.value == 1.0
            )
            print(f"[Langfuse] {mode['name']}: {correct}/{n} correct")
            if result.dataset_run_url:
                print(f"[Langfuse] {mode['name']} run URL: {result.dataset_run_url}")
    except Exception as e:
        print(f"[Langfuse] Experiment push failed (local report/JSON above is unaffected): {e}")
    finally:
        settings.ENABLE_CROSS_ENCODER_RERANK = original_rerank_flag
        lf.flush()


def main():
    parser = argparse.ArgumentParser(description="Compare dense-only vs. hybrid vs. hybrid+rerank retrieval.")
    parser.add_argument("--document-id", default=None, help="Scope to one document_id (default: whole corpus)")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "hybrid_search_evaluation_results.json"))
    args = parser.parse_args()

    n_chunks, n_rules = corpus_size(args.document_id)
    if n_chunks == 0 and n_rules == 0:
        print(f"Not executed: no indexed chunks/rules found (document_id={args.document_id!r}). "
              f"Ingest a document first (see scripts/ingest_local_document.py or POST /api/v1/upload).")
        sys.exit(1)

    print(f"Corpus: {n_chunks} chunks, {n_rules} rules (document_id={args.document_id!r})")

    report = {"document_id": args.document_id, "top_k": args.top_k, "corpus": {"chunks": n_chunks, "rules": n_rules}, "modes": {}}

    for mode in MODES:
        print(f"\n=== Running mode: {mode['name']} (hybrid={mode['hybrid']}, rerank={mode['rerank']}) ===")
        mode_results = run_mode(mode, args.document_id, args.top_k)
        for r in mode_results:
            print(f"  [{r['id']}] {r['category']:<24} correct={r['correct']!s:<5} "
                  f"latency={r['total_latency_ms']:>8.1f}ms  grade_mode={r['retrieval_mode']}")
        n = len(mode_results)
        correct = sum(1 for r in mode_results if r["correct"])
        avg_latency = round(sum(r["total_latency_ms"] for r in mode_results) / n, 1) if n else None
        report["modes"][mode["name"]] = {
            "results": mode_results,
            "summary": {
                "correct_count": correct,
                "total_count": n,
                "correctness_rate": round(correct / n, 3) if n else None,
                "avg_total_latency_ms": avg_latency,
            },
        }

    print("\n=== Summary ===")
    for mode_name, mode_report in report["modes"].items():
        s = mode_report["summary"]
        print(f"{mode_name:<15} correctness={s['correctness_rate']}  avg_latency_ms={s['avg_total_latency_ms']}")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {args.out}")

    run_langfuse_experiments(args.document_id, args.top_k)


if __name__ == "__main__":
    main()
