import time
from contextlib import ExitStack
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, Depends
from ..services.retrieval import retrieve_rules_and_chunks_parallel
from ..services.reasoning import generate_answer_with_fallback
from ..services.cache import get_cached_query, set_cached_query
from ..services.guardrails import check_input, check_output
from ..services.trace import new_trace, persist_trace
from ..services.llmops import observe_operation, trace_id_for, llmops_context
from ..services.llmops_identity import LLMOpsIdentity, get_llmops_identity
from ..services import live_status
from ..database import SessionLocal
from ..models import Document
from ..services.multilingual import (
    detect_language,
    get_language_name,
    translate_to_english,
    translate_from_english
)

router = APIRouter()

class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    document_id: str | None = None
    # Client-generated (frontend: crypto.randomUUID()), so the frontend can
    # start polling GET /api/v1/observability/live/{request_id} for stage
    # progress the instant this request is sent, instead of only learning
    # the request_id once the full 5-30s pipeline finishes. Opaque tracking
    # key only — length-capped, never trusted for anything else. Optional
    # so any caller that omits it gets the previous server-generated ID.
    request_id: str | None = Field(default=None, max_length=100)

@router.post("/query")
def process_query(request: QueryRequest, identity: LLMOpsIdentity = Depends(get_llmops_identity)):
    # Plain `def`, not `async def` — this function's body is entirely
    # synchronous (embedding model, Pinecone/HTTP calls, LLM calls), and
    # declaring it `async def` with no `await` inside pins the single event
    # loop thread for this request's full 5-30s duration, starving every
    # other concurrent request (including a client's own live-progress poll
    # of GET /observability/live/{request_id} for *this same* request — see
    # live_status.py). FastAPI/Starlette automatically dispatches a sync
    # `def` route to its thread pool instead, so the event loop stays free.
    # No behavior change to the pipeline itself: every call below already
    # runs synchronously either way, and the modules it touches (cache.py,
    # resilience.py's CircuitBreaker, sparse_retrieval.py/
    # local_fallback_retrieval.py's caches, key_manager.py) already guard
    # their shared state with locks for retrieval.py's own internal
    # ThreadPoolExecutor, so genuine cross-request concurrency here isn't a
    # new hazard.
    _request_start = time.perf_counter()
    trace = new_trace(
        "/api/v1/query", request.query, request.document_id, request.top_k,
        client_request_id=request.request_id,
    )
    live_status.start(trace["request_id"])
    status = "ok"
    llmops_stack = ExitStack()
    llmops_stack.enter_context(
        llmops_context(user_id=identity.user_id, session_id=identity.session_id, workflow_type="rag")
    )

    try:
        raw_query = request.query.strip()
        if not raw_query:
            raise HTTPException(status_code=400, detail="Query string cannot be empty.")

        # 0a. Input guardrail — length cap, control-char stripping, and a
        # small prompt-injection phrase blocklist. Regex-only, so this adds
        # no measurable latency to a normal query.
        with observe_operation(
            "rag.input_guardrail",
            as_type="guardrail",
            trace_id=trace_id_for(trace["request_id"]),
            input={"char_count": len(raw_query)},
        ) as observation:
            input_check = check_input(raw_query)
            if observation is not None:
                observation.update(output={"allowed": input_check.allowed, "reason": input_check.reason})
        trace["guardrails"]["input"] = {"allowed": input_check.allowed, "reason": input_check.reason}
        if not input_check.allowed:
            status = "blocked"
            live_status.finish(trace["request_id"], "blocked")
            return {
                "answer": "I can't process that request. Please rephrase your question about the platform or its policies.",
                "sources": [],
                "retrieval_mode": "blocked",
                "request_id": trace["request_id"],
            }
        raw_query = input_check.text

        # 0b. Document-readiness gate. Before this check, a document-scoped
        # query against a document that was still indexing or had failed to
        # ingest fell straight through to zero retrieval candidates, which
        # CRAG graded LOW and escalated to a live web search — returning a
        # confident, fully-formed answer about something else entirely, with
        # no indication the referenced document had no usable content at
        # all (found live via a real corrupt-PDF upload; see
        # docs/platform-status-audit-2026-08-26-rag-e2e-qa.md, Bug #3). The
        # backend's own recorded status must gate this, not just the
        # frontend's UI state, since any API caller can hit this endpoint
        # directly.
        if request.document_id:
            db = SessionLocal()
            try:
                doc = db.query(Document).filter(Document.id == request.document_id).first()
            finally:
                db.close()

            if not doc:
                doc_status, doc_error = "not_found", None
            else:
                meta = doc.metadata_ or {}
                doc_status, doc_error = meta.get("status", "uploaded"), meta.get("error")

            if doc_status != "completed":
                status = "blocked"
                if doc_status == "not_found":
                    message = "The referenced document could not be found."
                elif doc_status == "failed":
                    message = "This document failed to process" + (f": {doc_error}" if doc_error else ".") + " Retry ingestion (POST /api/v1/documents/{id}/reprocess) or re-upload it before asking questions about it."
                else:  # "uploaded" or "processing"
                    message = "This document is still being indexed. Please wait until processing completes before asking questions about it."
                trace["final"] = {
                    "blocked_reason": f"document_{doc_status}",
                    "latency_ms": round((time.perf_counter() - _request_start) * 1000, 1),
                }
                live_status.update_stage(trace["request_id"], "retrieving", "done", {"document_status": doc_status})
                live_status.finish(trace["request_id"], "blocked")
                return {
                    "answer": message,
                    "sources": [],
                    "retrieval_mode": "document_not_ready",
                    "document_status": doc_status,
                    "request_id": trace["request_id"],
                }

        # 0c. Redis Query Cache Check
        _cache_start = time.perf_counter()
        cached_result = get_cached_query(request.document_id, raw_query, request.top_k)
        trace["cache"] = {
            "enabled": True,
            "hit": cached_result is not None,
            "latency_ms": round((time.perf_counter() - _cache_start) * 1000, 1),
        }
        live_status.update_stage(trace["request_id"], "retrieving", "done", {"cache_hit": cached_result is not None})
        if cached_result:
            cached_result["request_id"] = trace["request_id"]
            live_status.finish(trace["request_id"], "ok", cached_result)
            return cached_result

        # 1. Language Detection via langdetect
        detected_lang = detect_language(raw_query)
        language_name = get_language_name(detected_lang)

        search_query = raw_query
        translated_to_english = False

        # 2. If non-English, translate query to English for vector search & reasoning
        if detected_lang != "en":
            print(f"[Multilingual Pipeline] Non-English detected ({language_name} - {detected_lang}). Translating to English...")
            search_query = translate_to_english(raw_query, detected_lang)
            translated_to_english = True
            print(f"[Multilingual Pipeline] Translated Query: '{search_query}'")

        trace["query_processing"] = {
            "detected_language": detected_lang,
            "language_name": language_name,
            "translated": translated_to_english,
        }

        # 3. Parallel Vector Retrieval for Rules AND Raw Chunks (dense +,
        # when enabled, sparse BM25 fused via RRF — see retrieval.py)
        live_status.update_stage(trace["request_id"], "hybrid_search", "running")
        with observe_operation(
            "rag.hybrid_retrieval",
            as_type="retriever",
            trace_id=trace_id_for(trace["request_id"]),
            input={"query": search_query[:200], "top_k": request.top_k, "document_id": request.document_id},
            metadata={"hybrid_search": True},
        ) as observation:
            retrieved_rules, retrieved_chunks = retrieve_rules_and_chunks_parallel(
                search_query, request.top_k, request.document_id, trace=trace
            )
            if observation is not None:
                observation.update(output={"rule_count": len(retrieved_rules), "chunk_count": len(retrieved_chunks)})

        # 4. Adaptive-Corrective Reasoning Layer (CRAG + HyDE + Step-Back + Reranking)
        answer_data = generate_answer_with_fallback(
            search_query, retrieved_rules, retrieved_chunks, document_id=request.document_id, trace=trace
        )

        # 4b. Fold the adaptive pipeline's own audit trail into the request
        # trace so CRAG/ARAG/reranking/web-search are all visible from one
        # place (GET /api/v1/observability/trace/{request_id}) without the
        # caller needing to know adaptive_rag.py's internal return shape.
        adaptive_trace = answer_data.get("adaptive_trace") or {}
        trace["crag"] = {
            "grade": adaptive_trace.get("initial_grade"),
            "confidence": adaptive_trace.get("initial_confidence"),
            "initial_candidate_count": adaptive_trace.get("initial_candidate_count"),
        }
        trace["adaptive"] = {
            "branches_executed": adaptive_trace.get("branches_executed", []),
            "step_back_triggered": adaptive_trace.get("step_back_triggered", False),
            "final_retrieval_mode": answer_data.get("retrieval_mode"),
        }
        if adaptive_trace.get("reranking"):
            trace["reranking"] = adaptive_trace["reranking"]
        trace["web_search"] = {
            "used": adaptive_trace.get("web_search_triggered", False),
            "result_count": adaptive_trace.get("web_search_result_count"),
            "latency_ms": adaptive_trace.get("web_search_latency_ms"),
        }

        # 5. Translate English answer back into user's language if non-English
        if detected_lang != "en" and answer_data.get("answer") and answer_data["answer"] != "Required info missing from document context.":
            print(f"[Multilingual Pipeline] Translating answer back into {language_name} ({detected_lang})...")
            answer_data["answer"] = translate_from_english(answer_data["answer"], detected_lang)

        # 6. Attach Multilingual Metadata
        answer_data["detected_language"] = detected_lang
        answer_data["language_name"] = language_name
        if translated_to_english:
            answer_data["original_query"] = raw_query
            answer_data["translated_query"] = search_query

        # 6b. Output guardrail — redacts anything credential/PII-shaped that
        # slipped into the generated answer (e.g. from a crawled web result).
        if answer_data.get("answer"):
            with observe_operation(
                "rag.output_guardrail",
                as_type="guardrail",
                trace_id=trace_id_for(trace["request_id"]),
                input={"char_count": len(answer_data["answer"])},
            ) as observation:
                output_check = check_output(answer_data["answer"])
                if observation is not None:
                    observation.update(output={"redaction_count": len(output_check.redactions)})
            answer_data["answer"] = output_check.text
            trace["guardrails"]["output"] = {"redactions": output_check.redactions}

        # 7. Write Result to Redis Cache
        set_cached_query(request.document_id, raw_query, answer_data, request.top_k)

        answer_data["request_id"] = trace["request_id"]
        trace["final"] = {
            "source_count": len(answer_data.get("sources") or []),
            "retrieval_mode": answer_data.get("retrieval_mode"),
            "latency_ms": round((time.perf_counter() - _request_start) * 1000, 1),
        }
        return answer_data

    except HTTPException:
        status = "error"
        raise
    except Exception as e:
        status = "error"
        trace["final"] = {
            "error": str(e),
            "latency_ms": round((time.perf_counter() - _request_start) * 1000, 1),
        }
        print(f"[Query API Error]: {str(e)}")
        raise HTTPException(status_code=500, detail={"message": str(e), "request_id": trace["request_id"]})
    finally:
        trace.setdefault("final", {}).setdefault("latency_ms", round((time.perf_counter() - _request_start) * 1000, 1))
        persist_trace(trace, status=status)
        live_status.finish(trace["request_id"], status, trace.get("final"))
        llmops_stack.close()
