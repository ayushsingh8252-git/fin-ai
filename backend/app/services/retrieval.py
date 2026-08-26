import logging
import time
from concurrent.futures import ThreadPoolExecutor
from .detection import get_embedding_model
from .canonicalization import get_pinecone_index
from .cache import get_cached_embedding, set_cached_embedding
from .resilience import call_with_resilience, CircuitOpenError, get_breaker
from .local_fallback_retrieval import local_semantic_search
from .sparse_retrieval import bm25_search
from ..config import settings

logger = logging.getLogger(__name__)

# Standard Reciprocal Rank Fusion constant (k=60 is the value used in the
# original RRF paper and most production hybrid-search implementations —
# large enough that a single retriever's #1 result doesn't completely
# dominate fusion, small enough that rank position still matters).
RRF_K = 60

# A BM25-only hit (found by exact keyword/acronym match, but not present at
# all in the dense retriever's top_k) has no cosine-similarity score to
# report, and every downstream confidence check (CRAG grading, legacy
# reasoning's 0.45 cutoff) is calibrated against cosine similarity, not raw
# BM25 scores. Rather than fabricate a fake cosine-equivalent number, such
# candidates get this fixed placeholder — just above adaptive_rag.py's
# CONFIDENCE_MEDIUM_THRESHOLD (0.45), below its CONFIDENCE_HIGH_THRESHOLD
# (0.70) — so they're treated as "found via keyword match, worth a second
# look" (MEDIUM band) rather than silently promoted to HIGH confidence.
SPARSE_ONLY_SCORE = 0.50

def get_query_vector(query: str) -> list[float]:
    """
    Retrieves query vector from Redis cache or computes it using BAAI/bge-base-en-v1.5.
    """
    cached = get_cached_embedding(query)
    if cached:
        return cached
        
    model = get_embedding_model()
    query_vector = model.encode(query).tolist()
    set_cached_embedding(query, query_vector)
    return query_vector

def _query_pinecone_raw(vector: list[float], vector_type: str, top_k: int, document_id: str | None) -> list[dict]:
    index = get_pinecone_index()
    filter_dict = {}
    if document_id:
        filter_dict["document_id"] = {"$eq": document_id}
    if vector_type:
        filter_dict["vector_type"] = {"$eq": vector_type}

    query_args = {
        "vector": vector,
        "top_k": top_k,
        "include_metadata": True
    }
    if filter_dict:
        query_args["filter"] = filter_dict

    response = index.query(**query_args)

    matches = []
    for match in response.matches:
        matches.append({
            "id": match.id,
            "score": match.score,
            "metadata": match.metadata or {}
        })
    return matches


def _query_pinecone(vector: list[float], vector_type: str, top_k: int, document_id: str | None) -> list[dict]:
    """
    Pinecone read, protected by a circuit breaker + short retry (services/
    resilience.py). On an open breaker or exhausted retries — e.g. the known
    free-tier egress-quota 429s — falls back to local_semantic_search() over
    the same content mirrored in SQLite, instead of silently returning [],
    which is what used to push every query straight to web search regardless
    of whether the platform's own indexed content had the answer.
    """
    try:
        return call_with_resilience(
            "pinecone", _query_pinecone_raw, vector, vector_type, top_k, document_id,
            max_attempts=2, base_delay=0.3, max_delay=1.5,
        )
    except CircuitOpenError:
        logger.warning(
            "[Retrieval] Pinecone circuit open — using local fallback retrieval (vector_type=%s).", vector_type
        )
    except Exception as e:
        # Loud, diagnosable failure: a Pinecone outage must not look the same
        # as "no relevant results" in the logs, since callers silently treat
        # an empty list as a valid (if unhelpful) retrieval outcome.
        logger.error(
            "[Retrieval Error] Pinecone search failed (vector_type=%s, top_k=%s, document_id=%s): %s: %s",
            vector_type, top_k, document_id, type(e).__name__, str(e),
            exc_info=True
        )

    if vector_type in ("rule", "chunk"):
        return local_semantic_search(vector, vector_type, top_k, document_id)
    return []

def retrieve_rules(query: str, top_k: int = 5, document_id: str | None = None) -> list[dict]:
    query_vector = get_query_vector(query)
    matches = _query_pinecone(query_vector, "rule", top_k, document_id)
    
    # Fallback to general search if no vector_type tag matches yet (backwards compatibility)
    if not matches:
        matches = _query_pinecone(query_vector, None, top_k, document_id)
        
    results = []
    for m in matches:
        results.append({
            "rule_id": m["id"],
            "score": m["score"],
            "metadata": m["metadata"]
        })
    return results

def _reciprocal_rank_fusion(dense: list[dict], sparse: list[dict], top_k: int) -> list[dict]:
    """
    Fuses a dense (cosine) ranking and a sparse (BM25) ranking into one
    ordered candidate list via Reciprocal Rank Fusion — score = sum of
    1/(RRF_K + rank) across whichever ranking(s) a candidate appears in.
    RRF is used instead of a raw weighted-score blend because dense cosine
    similarity and BM25 scores live on incompatible, differently-distributed
    scales; RRF only needs rank position, so no scale-normalization/tuning
    is required — this is the standard, tuning-free hybrid fusion method.

    The RRF score decides which candidates survive and their order. The
    "score" field returned to callers stays in cosine-similarity terms
    (preserving every existing CRAG/legacy-reasoning confidence threshold):
    a candidate that has a real dense match keeps its cosine score;
    otherwise it was found by BM25 alone and gets SPARSE_ONLY_SCORE.
    """
    rrf_scores: dict[str, float] = {}
    meta_by_id: dict[str, dict] = {}
    dense_score_by_id: dict[str, float] = {}

    for rank, m in enumerate(dense, start=1):
        rrf_scores[m["id"]] = rrf_scores.get(m["id"], 0.0) + 1.0 / (RRF_K + rank)
        meta_by_id[m["id"]] = m["metadata"]
        dense_score_by_id[m["id"]] = m["score"]

    for rank, m in enumerate(sparse, start=1):
        rrf_scores[m["id"]] = rrf_scores.get(m["id"], 0.0) + 1.0 / (RRF_K + rank)
        meta_by_id.setdefault(m["id"], m["metadata"])

    ranked_ids = sorted(rrf_scores, key=lambda i: rrf_scores[i], reverse=True)[:top_k]

    return [
        {
            "id": mid,
            "score": dense_score_by_id.get(mid, SPARSE_ONLY_SCORE),
            "metadata": meta_by_id[mid],
            "rrf_score": rrf_scores[mid],
        }
        for mid in ranked_ids
    ]


def retrieve_rules_and_chunks_parallel(
    query: str,
    top_k: int = 5,
    document_id: str | None = None,
    hybrid: bool | None = None,
    trace: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """
    Executes parallel dense (Pinecone/local-fallback) and, when hybrid is
    enabled, sparse (BM25) search for both Rule and Chunk vector types, then
    fuses each type's dense+sparse rankings via Reciprocal Rank Fusion.
    Returns (retrieved_rules, retrieved_chunks).

    `hybrid` defaults to settings.ENABLE_HYBRID_SEARCH; overridable per-call
    so the evaluation suite (section 17) can compare dense-only vs. hybrid
    against the identical code path instead of two diverging implementations.

    `trace`, if given, gets a retrieval-diagnostics record appended under
    trace["retrieval"]["calls"] — a list rather than a single snapshot
    because CRAG's rewrite/HyDE/step-back branches can each call this again
    for the same request, and every attempt is worth keeping.
    """
    if hybrid is None:
        hybrid = settings.ENABLE_HYBRID_SEARCH

    _start = time.perf_counter()
    query_vector = get_query_vector(query)

    with ThreadPoolExecutor(max_workers=4) as executor:
        dense_rules_future = executor.submit(_query_pinecone, query_vector, "rule", top_k, document_id)
        dense_chunks_future = executor.submit(_query_pinecone, query_vector, "chunk", top_k, document_id)
        sparse_rules_future = executor.submit(bm25_search, query, "rule", top_k, document_id) if hybrid else None
        sparse_chunks_future = executor.submit(bm25_search, query, "chunk", top_k, document_id) if hybrid else None

        dense_rules = dense_rules_future.result()
        dense_chunks = dense_chunks_future.result()
        sparse_rules = sparse_rules_future.result() if sparse_rules_future else []
        sparse_chunks = sparse_chunks_future.result() if sparse_chunks_future else []

    # If vector_type was not set on older indexes, fallback to an untyped query
    if not dense_rules and not dense_chunks:
        dense_rules = _query_pinecone(query_vector, None, top_k, document_id)

    if hybrid:
        rules_matches = _reciprocal_rank_fusion(dense_rules, sparse_rules, top_k)
        chunks_matches = _reciprocal_rank_fusion(dense_chunks, sparse_chunks, top_k)
    else:
        rules_matches = dense_rules
        chunks_matches = dense_chunks

    rules = [{"rule_id": m["id"], "score": m["score"], "metadata": m["metadata"]} for m in rules_matches]
    chunks = [{"chunk_id": m["id"], "score": m["score"], "metadata": m["metadata"]} for m in chunks_matches]

    if trace is not None:
        pinecone_state = get_breaker("pinecone").state
        trace.setdefault("retrieval", {}).setdefault("calls", []).append({
            "mode": "hybrid" if hybrid else "dense",
            "dense_count": len(dense_rules) + len(dense_chunks),
            "sparse_count": len(sparse_rules) + len(sparse_chunks),
            "fused_count": len(rules_matches) + len(chunks_matches),
            "latency_ms": round((time.perf_counter() - _start) * 1000, 1),
            "pinecone_circuit_state": pinecone_state,
            "used_local_fallback": pinecone_state != "closed",
        })

    return rules, chunks
