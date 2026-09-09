import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Any, Optional, Tuple

from .retrieval import retrieve_rules_and_chunks_parallel, _query_pinecone, get_query_vector
from .llm_service import generate_json_resilient
from .llmops import trace_id_for
from .web_service import tavily_search
from .reranking import cross_encoder_rerank as _rerank_candidates
from . import live_status
from ..config import settings
from ..database import SessionLocal
from ..models import Chunk

logger = logging.getLogger(__name__)

# Quality thresholds
CONFIDENCE_HIGH_THRESHOLD = 0.70
CONFIDENCE_MEDIUM_THRESHOLD = 0.45


def _is_truthy(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)


def extract_candidate_text_and_meta(retrieved_rules: List[dict], retrieved_chunks: List[dict]) -> List[dict]:
    """
    Normalizes rules and chunks into unified candidate evidence records.
    """
    candidates = []
    
    # 1. Process rules
    for r in retrieved_rules:
        meta = r.get("metadata", {})
        rule_str = meta.get("canonical_rule") or meta.get("key_finding", "")
        if rule_str:
            score = float(r.get("score", 0.0))
            bbox = meta.get("bbox")
            page_dim = meta.get("page_dim")
            if isinstance(bbox, str):
                try: bbox = json.loads(bbox)
                except: pass
            if isinstance(page_dim, str):
                try: page_dim = json.loads(page_dim)
                except: pass

            candidates.append({
                "id": meta.get("rule_id", r.get("rule_id", "")),
                "type": "rule",
                "content": rule_str,
                "section": meta.get("section", "General"),
                "page": meta.get("page", 1),
                "document_id": meta.get("document_id"),
                "score": score,
                "bbox": bbox,
                "page_dim": page_dim
            })

    # 2. Process chunks
    db = SessionLocal()
    try:
        for c in retrieved_chunks:
            meta = c.get("metadata", {})
            chunk_id = meta.get("chunk_id", c.get("chunk_id", ""))
            content = meta.get("content", "")
            
            # Fetch full content from DB if metadata preview was truncated
            if chunk_id and len(content) >= 1000:
                db_chunk = db.query(Chunk).filter(Chunk.id == chunk_id).first()
                if db_chunk and db_chunk.content:
                    content = db_chunk.content

            if content:
                score = float(c.get("score", 0.0))
                bbox = meta.get("bbox")
                page_dim = meta.get("page_dim")
                if isinstance(bbox, str):
                    try: bbox = json.loads(bbox)
                    except: pass
                if isinstance(page_dim, str):
                    try: page_dim = json.loads(page_dim)
                    except: pass

                candidates.append({
                    "id": chunk_id,
                    "type": "chunk",
                    "content": content,
                    "section": meta.get("section", "General"),
                    "page": meta.get("page", 1),
                    "document_id": meta.get("document_id"),
                    "score": score,
                    "bbox": bbox,
                    "page_dim": page_dim,
                    "is_audio": meta.get("is_audio", False),
                    "timestamp_str": meta.get("timestamp_str", ""),
                    "start_time": meta.get("start_time"),
                    "end_time": meta.get("end_time")
                })
    finally:
        db.close()

    return candidates


def fast_crag_grader(
    query: str,
    candidates: List[dict],
    trace_sink: Optional[list] = None,
    langfuse_trace_id: Optional[str] = None,
) -> Tuple[str, float, List[dict]]:
    """
    CRAG Grader: Evaluates candidate relevance against the user query.
    Returns (classification, confidence_score, graded_candidates).
    Classification is one of: 'HIGH', 'MEDIUM', 'LOW'.
    """
    if not candidates:
        return "LOW", 0.0, []

    # Calculate max raw vector similarity
    max_raw_score = max(c.get("score", 0.0) for c in candidates)

    # Prepare compact candidate snippet for fast evaluation
    snippets = []
    for idx, c in enumerate(candidates[:5]):
        text_snippet = c["content"][:250].replace("\n", " ")
        snippets.append(f"[{idx}] (Score: {c['score']:.2f}): {text_snippet}")

    context_str = "\n".join(snippets)

    prompt = f"""
    You are a fast precision Retrieval Grader (CRAG). Evaluate if the retrieved context contains relevant information to answer the user query.

    User Query: "{query}"

    Retrieved Context Snippets:
    {context_str}

    Evaluate whether the context directly answers (HIGH), partially answers/needs keyword refinement (MEDIUM), or is unrelated/irrelevant (LOW).
    
    Return ONLY a JSON object:
    {{
      "grade": "HIGH" | "MEDIUM" | "LOW",
      "confidence": 0.85,
      "reason": "Brief explanation"
    }}
    """

    try:
        grade_res = generate_json_resilient(
            prompt, max_attempts=2, trace_sink=trace_sink, langfuse_trace_id=langfuse_trace_id
        )
        if isinstance(grade_res, dict):
            grade = str(grade_res.get("grade", "")).upper()
            conf = float(grade_res.get("confidence", max_raw_score))
            if grade in ("HIGH", "MEDIUM", "LOW"):
                return grade, conf, candidates
    except Exception as e:
        logger.warning(f"[CRAG Grader Warning]: LLM grading fallback: {e}")

    # Heuristic fallback if LLM grader times out
    if max_raw_score >= CONFIDENCE_HIGH_THRESHOLD:
        return "HIGH", max_raw_score, candidates
    elif max_raw_score >= CONFIDENCE_MEDIUM_THRESHOLD:
        return "MEDIUM", max_raw_score, candidates
    else:
        return "LOW", max_raw_score, candidates


def generate_query_rewrite(
    query: str, trace_sink: Optional[list] = None, langfuse_trace_id: Optional[str] = None
) -> str:
    """
    Generates a crisp, keyword-optimized search query.
    """
    prompt = f"""
    You are a search query optimizer. Rewrite the user query into 2 to 4 precise keywords and terms optimized for vector and keyword search.

    User Query: "{query}"

    Return ONLY JSON:
    {{
      "rewritten_query": "concise search query with essential terms"
    }}
    """
    try:
        res = generate_json_resilient(
            prompt, max_attempts=2, trace_sink=trace_sink, langfuse_trace_id=langfuse_trace_id
        )
        if isinstance(res, dict) and res.get("rewritten_query"):
            return res["rewritten_query"].strip()
    except Exception as e:
        logger.warning(f"[Query Rewrite Warning]: {e}")
    return query


def generate_hyde_document(
    query: str, trace_sink: Optional[list] = None, langfuse_trace_id: Optional[str] = None
) -> str:
    """
    Generates a synthetic hypothetical document passage (HyDE).
    """
    prompt = f"""
    Write a concise, hypothetical 2-sentence formal policy/document excerpt that directly answers the following question.
    Do not add conversational intro, write only the passage text.

    Question: "{query}"

    Return ONLY JSON:
    {{
      "hypothetical_passage": "formal factual statement answering the question"
    }}
    """
    try:
        res = generate_json_resilient(
            prompt, max_attempts=2, trace_sink=trace_sink, langfuse_trace_id=langfuse_trace_id
        )
        if isinstance(res, dict) and res.get("hypothetical_passage"):
            return res["hypothetical_passage"].strip()
    except Exception as e:
        logger.warning(f"[HyDE Generation Warning]: {e}")
    return query


def generate_step_back_query(
    query: str, trace_sink: Optional[list] = None, langfuse_trace_id: Optional[str] = None
) -> str:
    """
    Generates a broader high-level principle question (Step-Back Prompting).
    """
    prompt = f"""
    You are an expert at Step-Back Prompting. Given a specific user question, generate a broader, high-level principle or overarching category question that encompasses it.

    Specific Question: "{query}"

    Return ONLY JSON:
    {{
      "step_back_query": "broader principle or overarching topic question"
    }}
    """
    try:
        res = generate_json_resilient(
            prompt, max_attempts=2, trace_sink=trace_sink, langfuse_trace_id=langfuse_trace_id
        )
        if isinstance(res, dict) and res.get("step_back_query"):
            return res["step_back_query"].strip()
    except Exception as e:
        logger.warning(f"[Step-Back Warning]: {e}")
    return query


def execute_secondary_search(
    search_text: str, document_id: Optional[str] = None, top_k: int = 5, trace: Optional[dict] = None
) -> List[dict]:
    """
    Executes parallel search for a given search query or hypothetical passage.
    """
    rules, chunks = retrieve_rules_and_chunks_parallel(search_text, top_k=top_k, document_id=document_id, trace=trace)
    return extract_candidate_text_and_meta(rules, chunks)


def merge_and_deduplicate_candidates(candidate_pools: List[List[dict]]) -> List[dict]:
    """
    Merges multiple candidate pools, deduplicating by ID and normalized text.
    """
    seen_ids = set()
    seen_texts = set()
    merged = []

    for pool in candidate_pools:
        for item in pool:
            item_id = item.get("id")
            content_norm = item.get("content", "").strip()[:100]

            if item_id and item_id in seen_ids:
                continue
            if content_norm and content_norm in seen_texts:
                continue

            if item_id:
                seen_ids.add(item_id)
            if content_norm:
                seen_texts.add(content_norm)

            merged.append(item)

    return merged


# cross_encoder_rerank used to just be `sorted(candidates, key=score)` under
# a name that promised a real cross-encoder — see services/reranking.py for
# the actual implementation (a genuine lazy/opt-in CrossEncoder model, with
# automatic fallback to that same score-sort when it's off or unavailable).
cross_encoder_rerank = _rerank_candidates


def validate_evidence(query: str, top_candidates: List[dict], crag_grade: Optional[str] = None) -> Tuple[bool, List[dict]]:
    """
    Evidence Validator: Checks if the top candidate evidence actually supports answering the question.

    `crag_grade`, when "HIGH", short-circuits the raw-score check. Real bug
    found live (docs/platform-status-audit-2026-08-26-rag-e2e-qa.md, Bug #2):
    fast_crag_grader() is an LLM reading the actual candidate text end to
    end, and can correctly judge evidence HIGH-confidence relevant even when
    its raw cosine similarity sits under 0.45 (naturally common on short
    documents) — this second, independent, purely numeric gate was
    silently discarding that already-validated evidence and returning a
    false "missing" without ever calling the LLM to answer. For the HIGH
    branch specifically, top_candidates here is the same initial_candidates
    CRAG already graded (no additional search runs for HIGH — see
    execute_adaptive_rag_pipeline's branching), so trusting that grade isn't
    extending trust to a different or expanded candidate set. MEDIUM/LOW
    grades keep the original raw-score gate unchanged.
    """
    if not top_candidates:
        return False, []

    if crag_grade == "HIGH":
        return True, top_candidates

    # If top candidate score is sufficiently high, evidence is valid
    if any(c.get("score", 0.0) >= 0.45 for c in top_candidates):
        return True, top_candidates

    return False, top_candidates


def execute_adaptive_rag_pipeline(
    query: str,
    initial_rules: List[dict],
    initial_chunks: List[dict],
    document_id: Optional[str] = None,
    top_k: int = 5,
    trace: Optional[dict] = None
) -> dict:
    """
    Executes the complete Adaptive-Corrective RAG workflow:
    1. Hybrid Candidate Aggregation
    2. Fast CRAG Grader (HIGH / MEDIUM / LOW)
    3. Branching Execution:
       - HIGH -> Rerank
       - MEDIUM -> Rewrite -> Search Again
       - LOW -> HyDE -> Search Again
    4. Still Weak Check -> Step-Back -> Search Again
    5. Still No Evidence Check -> Official Web Search (Tavily)
    6. Merge + Deduplicate Candidate Pools
    7. Cross-Encoder Reranker -> Top 3-5
    8. Evidence Validator
    9. Final LLM Generation

    `trace`, if given, is the caller's request-level observability dict (see
    services/trace.py) — this function both reads from it (llm_attempts sink,
    passed down to every LLM call) and writes into it (crag/adaptive/
    reranking/web_search sections), so a caller inspecting `trace` afterward
    sees this whole pipeline's behavior without needing to re-derive it from
    the returned adaptive_trace/sources fields.
    """
    llm_sink = trace.setdefault("llm_attempts", []) if trace is not None else None
    langfuse_trace_id = trace_id_for(trace.get("request_id")) if trace is not None else None

    # Live-progress mirror only (see services/live_status.py) — every call
    # below is a thin, additive republish of a value this function already
    # computes into audit_trace/trace; none of it changes grading,
    # thresholds, branching, or candidate selection.
    _live_request_id = trace.get("request_id") if trace is not None else None

    def _stage(name: str, status: str, data: Optional[dict] = None):
        if _live_request_id:
            live_status.update_stage(_live_request_id, name, status, data)

    audit_trace = {
        "initial_grade": None,
        "initial_confidence": 0.0,
        "branches_executed": [],
        "step_back_triggered": False,
        "web_search_triggered": False
    }

    # Step 1: Initial Candidates
    initial_candidates = extract_candidate_text_and_meta(initial_rules, initial_chunks)
    candidate_pools = [initial_candidates]

    # Step 2: Fast CRAG Grader
    grade, confidence, _ = fast_crag_grader(
        query, initial_candidates, trace_sink=llm_sink, langfuse_trace_id=langfuse_trace_id
    )
    audit_trace["initial_grade"] = grade
    audit_trace["initial_confidence"] = confidence
    audit_trace["initial_candidate_count"] = len(initial_candidates)
    _stage("crag", "done", {"grade": grade, "confidence": confidence, "candidate_count": len(initial_candidates)})

    # Step 3: Branching Execution
    if grade == "HIGH":
        audit_trace["branches_executed"].append("HIGH_DIRECT_RERANK")

    elif grade == "MEDIUM":
        audit_trace["branches_executed"].append("MEDIUM_REWRITE_SEARCH")
        rewritten_query = generate_query_rewrite(query, trace_sink=llm_sink, langfuse_trace_id=langfuse_trace_id)
        secondary_candidates = execute_secondary_search(rewritten_query, document_id=document_id, top_k=top_k, trace=trace)
        candidate_pools.append(secondary_candidates)

    else:  # LOW
        audit_trace["branches_executed"].append("LOW_HYDE_SEARCH")
        hyde_passage = generate_hyde_document(query, trace_sink=llm_sink, langfuse_trace_id=langfuse_trace_id)
        blended_search = f"{query}\n{hyde_passage}"
        secondary_candidates = execute_secondary_search(blended_search, document_id=document_id, top_k=top_k, trace=trace)
        candidate_pools.append(secondary_candidates)

    _stage("adaptive", "running", {"branches_executed": list(audit_trace["branches_executed"])})

    # Step 4: Still Weak Check -> Step-Back Prompting
    merged_so_far = merge_and_deduplicate_candidates(candidate_pools)
    max_score = max((c.get("score", 0.0) for c in merged_so_far), default=0.0)

    if max_score < CONFIDENCE_MEDIUM_THRESHOLD and grade != "HIGH":
        audit_trace["step_back_triggered"] = True
        step_back_q = generate_step_back_query(query, trace_sink=llm_sink, langfuse_trace_id=langfuse_trace_id)
        step_back_candidates = execute_secondary_search(step_back_q, document_id=document_id, top_k=top_k, trace=trace)
        candidate_pools.append(step_back_candidates)
        merged_so_far = merge_and_deduplicate_candidates(candidate_pools)
        max_score = max((c.get("score", 0.0) for c in merged_so_far), default=0.0)
        _stage("adaptive", "running", {"branches_executed": list(audit_trace["branches_executed"]), "step_back_triggered": True})

    # Step 5: Still No Evidence Check -> Web Search
    web_sources = []
    if max_score < 0.40:
        audit_trace["web_search_triggered"] = True
        _web_start = time.perf_counter()
        web_results = tavily_search(query)
        audit_trace["web_search_result_count"] = len(web_results) if web_results else 0
        audit_trace["web_search_latency_ms"] = round((time.perf_counter() - _web_start) * 1000, 1)
        _stage("tools_web", "done", {
            "used": True,
            "result_count": audit_trace["web_search_result_count"],
            "latency_ms": audit_trace["web_search_latency_ms"],
        })
        if web_results:
            for wr in web_results:
                web_sources.append({"title": wr.get("title", "Web Source"), "url": wr.get("url", "")})
                candidate_pools.append([{
                    "id": wr.get("url", ""),
                    "type": "web",
                    "content": f"[Web Result - {wr.get('title')}]: {wr.get('content', '')[:600]}",
                    "section": "Web",
                    "page": 1,
                    "document_id": "web",
                    "score": 0.50,
                    "bbox": None,
                    "page_dim": None
                }])

    # Step 6: Merge + Deduplicate
    all_candidates = merge_and_deduplicate_candidates(candidate_pools)

    # Step 7: Cross-Encoder Reranker (Top 3–5)
    _rerank_start = time.perf_counter()
    top_candidates = cross_encoder_rerank(query, all_candidates, top_n=5)
    audit_trace["reranking"] = {
        "used": settings.ENABLE_CROSS_ENCODER_RERANK,
        "candidate_count": len(all_candidates),
        "reranked_count": len(top_candidates),
        "latency_ms": round((time.perf_counter() - _rerank_start) * 1000, 1),
    }
    _stage("reranking", "done", audit_trace["reranking"])

    # Step 8: Evidence Validator
    has_valid_evidence, validated_candidates = validate_evidence(query, top_candidates, crag_grade=grade)

    # If no evidence found anywhere, declare missing info
    if not has_valid_evidence and not web_sources:
        return {
            "answer": "Required info missing from document context.",
            "sources": [],
            "retrieval_mode": "missing",
            "adaptive_trace": audit_trace
        }

    # Step 9: Final LLM Synthesis
    context_blocks = []
    sources = []

    for c in validated_candidates:
        context_blocks.append(f"- [{c.get('type', 'doc').upper()} - Section: {c.get('section', 'General')}, Page {c.get('page', 1)}]: {c.get('content')}")
        if c.get("type") == "web":
            continue
        sources.append({
            "document_id": c.get("document_id"),
            "page": c.get("page"),
            "bbox": c.get("bbox"),
            "page_dim": c.get("page_dim"),
            "is_audio": c.get("is_audio", False),
            "timestamp_str": c.get("timestamp_str", ""),
            "start_time": c.get("start_time"),
            "end_time": c.get("end_time")
        })

    if web_sources:
        sources.extend(web_sources)

    context_str = "\n\n".join(context_blocks)

    synthesis_prompt = f"""
    You are an AI Document & Policy Assistant. Answer the user question based strictly and comprehensively on the verified evidence context below.

    User Question: "{query}"

    Verified Evidence Context:
    {context_str}

    Instructions:
    1. Provide an accurate, complete, and well-structured answer based on the verified context.
    2. If information is explicitly missing, state so clearly.
    3. Return ONLY a JSON object:
    {{
      "has_info": true,
      "answer": "Your detailed, direct answer"
    }}
    """

    _stage("generating", "running")
    try:
        final_res = generate_json_resilient(
            synthesis_prompt, max_attempts=2, trace_sink=llm_sink, langfuse_trace_id=langfuse_trace_id
        )
        if isinstance(final_res, dict):
            answer_text = str(final_res.get("answer", "")).strip()
            if answer_text and "required info missing" not in answer_text.lower():
                mode = "web" if audit_trace["web_search_triggered"] else ("rules" if any(c.get("type") == "rule" for c in validated_candidates) else "chunks")
                _stage("generating", "done", {"retrieval_mode": mode})
                return {
                    "answer": answer_text,
                    "sources": sources,
                    "retrieval_mode": mode,
                    "adaptive_trace": audit_trace
                }
    except Exception as e:
        logger.error(f"[Adaptive Synthesis Error]: {e}")

    # Fallback to direct top candidate text if LLM formatting fails
    if validated_candidates:
        _stage("generating", "done", {"retrieval_mode": "chunks", "fallback": "top_candidate_text"})
        return {
            "answer": validated_candidates[0]["content"][:350],
            "sources": sources,
            "retrieval_mode": "chunks",
            "adaptive_trace": audit_trace
        }

    _stage("generating", "done", {"retrieval_mode": "missing", "llm_synthesis_failed": True})
    return {
        "answer": "Required info missing from document context.",
        "sources": [],
        "retrieval_mode": "missing",
        "adaptive_trace": audit_trace
    }
