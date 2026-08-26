"""
Sparse (keyword/BM25) retrieval over the same SQLite-mirrored corpus
local_fallback_retrieval.py already uses for its dense fallback — this is the
"sparse" half of genuine hybrid search (see retrieval.py's
retrieve_rules_and_chunks_parallel, which fuses this with the existing dense
Pinecone/local-cosine results via Reciprocal Rank Fusion).

Before this module, every retrieval path in this app — Pinecone and the local
cosine fallback alike — was 100% dense embedding similarity. Dense embeddings
blur exact tokens (acronyms, IDs, company/technology names, rare terms) into
their semantic neighborhood; BM25 scores exact term overlap directly, which
is precisely what catches "what does WACC stand for" or "find the OKR-142
ticket" style queries a pure embedding search tends to miss or under-rank.

rank_bm25 (BM25Okapi) is used rather than hand-rolled TF-IDF: it's a small,
pure-Python, dependency-free implementation of the actual BM25 ranking
function (not a cosine-similarity stand-in), so "hybrid search" here means
what it's supposed to mean.

Mirrors local_fallback_retrieval.py's structure deliberately: same
row-count-drift cache invalidation, same background-thread rebuild, same
MAX_ROWS bound (this box has previously hit a real MemoryError encoding an
~11k-row table in one pass — a bounded subset beats failing outright).
"""
import logging
import re
import threading
from threading import Lock

from rank_bm25 import BM25Okapi

from ..database import SessionLocal
from ..models import Chunk, Rule

logger = logging.getLogger(__name__)

MAX_ROWS = 4000

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Without this, BM25 scores every chunk against common words like "the",
# "is", "of" — which appear in nearly every chunk, so almost nothing gets
# filtered by bm25_search()'s score>0 check. Found live (docs/platform-
# status-audit-2026-08-26-rag-e2e-qa.md, Bug #1): an off-topic query like
# "what is the capital of France" returned real positive-score BM25
# "matches" against a resume corpus purely on stopword overlap, and
# retrieval.py's SPARSE_ONLY_SCORE=0.50 placeholder for a sparse-only hit
# sits right at CONFIDENCE_MEDIUM_THRESHOLD (0.45) — enough to measurably
# pollute CRAG's confidence signal and suppress the step-back/web-search
# escalation an irrelevant query should trigger. A short, hardcoded list
# (not a new NLP dependency) is enough — BM25's own IDF term-weighting
# already downweights common terms across the corpus; this just keeps a
# handful of near-universal function words from generating false-positive
# "matches" at all.
_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "if", "is", "are", "was", "were",
    "be", "been", "being", "of", "in", "on", "at", "to", "for", "with",
    "as", "by", "from", "this", "that", "these", "those", "it", "its",
    "do", "does", "did", "not", "no", "so", "such", "than", "then",
    "what", "which", "who", "whom", "when", "where", "why", "how",
    "i", "you", "he", "she", "we", "they", "them", "his", "her", "their",
    "will", "would", "shall", "should", "can", "could", "may", "might",
    "must", "have", "has", "had", "there", "here", "all", "any", "some",
})


def _tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall((text or "").lower()) if t not in _STOPWORDS]


_cache_lock = Lock()
_chunk_cache: dict = {"count": -1, "ids": [], "bm25": None, "meta": []}
_rule_cache: dict = {"count": -1, "ids": [], "bm25": None, "meta": []}
_building: dict[str, bool] = {"chunk": False, "rule": False}


def _rebuild_chunk_index(document_id: str | None) -> dict:
    db = SessionLocal()
    try:
        query = db.query(Chunk)
        if document_id:
            query = query.filter(Chunk.document_id == document_id)
        else:
            query = query.limit(MAX_ROWS)
        rows = query.all()
        if not rows:
            return {"count": 0, "ids": [], "bm25": None, "meta": []}

        tokenized = [_tokenize(r.content or "") for r in rows]
        meta = [
            {
                "chunk_id": r.id,
                "document_id": r.document_id,
                "page": r.page,
                "section": r.section,
                "content": (r.content or "")[:1000],
            }
            for r in rows
        ]
        return {"count": len(rows), "ids": [r.id for r in rows], "bm25": BM25Okapi(tokenized), "meta": meta}
    finally:
        db.close()


def _rebuild_rule_index(document_id: str | None) -> dict:
    db = SessionLocal()
    try:
        query = db.query(Rule)
        if document_id:
            query = query.filter(Rule.document_id == document_id)
        else:
            query = query.limit(MAX_ROWS)
        rows = query.all()
        if not rows:
            return {"count": 0, "ids": [], "bm25": None, "meta": []}

        texts = [f"{r.canonical_rule or ''} {r.condition or ''}" for r in rows]
        tokenized = [_tokenize(t) for t in texts]
        meta = [
            {
                "rule_id": r.id,
                "document_id": r.document_id,
                "canonical_rule": r.canonical_rule,
                "type": r.type,
                "page": r.page,
                "section": r.section,
            }
            for r in rows
        ]
        return {"count": len(rows), "ids": [r.id for r in rows], "bm25": BM25Okapi(tokenized), "meta": meta}
    finally:
        db.close()


def _rebuild_in_background(vector_type: str):
    def _run():
        try:
            rebuilt = _rebuild_chunk_index(None) if vector_type == "chunk" else _rebuild_rule_index(None)
            target = _chunk_cache if vector_type == "chunk" else _rule_cache
            target.update(rebuilt)
            logger.info("[Sparse Retrieval] %s BM25 index ready (%d rows).", vector_type, rebuilt["count"])
        except Exception as e:
            logger.error("[Sparse Retrieval] Background %s index build failed: %s", vector_type, e)
        finally:
            _building[vector_type] = False

    threading.Thread(target=_run, name=f"sparse-index-{vector_type}", daemon=True).start()


def _get_index(vector_type: str, document_id: str | None) -> dict:
    if document_id:
        return _rebuild_chunk_index(document_id) if vector_type == "chunk" else _rebuild_rule_index(document_id)

    cache_ref = _chunk_cache if vector_type == "chunk" else _rule_cache
    with _cache_lock:
        if _building[vector_type]:
            return cache_ref

        db = SessionLocal()
        try:
            current_count = db.query(Chunk if vector_type == "chunk" else Rule).count()
        finally:
            db.close()
        current_count = min(current_count, MAX_ROWS)

        if cache_ref["count"] != current_count:
            logger.info(
                "[Sparse Retrieval] %s index stale (%d -> %d rows), rebuilding in background...",
                vector_type, cache_ref["count"], current_count,
            )
            _building[vector_type] = True
            _rebuild_in_background(vector_type)
        return cache_ref


def prewarm_indexes():
    """Kicks off both BM25 indexes' initial build in the background — same
    startup convention as local_fallback_retrieval.prewarm_caches()."""
    for vector_type in ("chunk", "rule"):
        with _cache_lock:
            if not _building[vector_type]:
                _building[vector_type] = True
                _rebuild_in_background(vector_type)


def bm25_search(query: str, vector_type: str, top_k: int = 5, document_id: str | None = None) -> list[dict]:
    """
    Returns matches shaped like retrieval.py's Pinecone/dense-fallback matches
    ({"id", "score", "metadata"}) so callers can fuse this with dense results
    without caring which retriever produced which candidate. "score" here is
    the raw BM25 score (unbounded, NOT comparable to cosine similarity) —
    retrieval.py's fusion step is responsible for not leaking this directly
    into code that expects a 0-1 cosine-scale confidence.
    """
    try:
        index = _get_index(vector_type, document_id)
    except Exception as e:
        logger.error("[Sparse Retrieval] Index build failed (%s): %s", vector_type, e)
        return []

    if not index.get("bm25") or not query.strip():
        return []

    tokenized_query = _tokenize(query)
    if not tokenized_query:
        return []

    scores = index["bm25"].get_scores(tokenized_query)
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

    id_prefix = "chunk_" if vector_type == "chunk" else "rule_"
    results = []
    for idx in ranked:
        if scores[idx] <= 0:
            continue
        results.append({
            "id": f"{id_prefix}{index['ids'][idx]}",
            "score": float(scores[idx]),
            "metadata": {**index["meta"][idx], "vector_type": vector_type},
        })
    return results
