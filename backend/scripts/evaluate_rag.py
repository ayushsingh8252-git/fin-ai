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


if __name__ == "__main__":
    main()
