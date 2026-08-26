"""
Reranking for the adaptive RAG pipeline's fused candidate set.

adaptive_rag.py used to call something named cross_encoder_rerank() that was
actually just `sorted(candidates, key=score)` — no cross-encoder, no
re-scoring, just re-using whatever score retrieval already produced. That's
`heuristic_rerank()` below, kept (and honestly named) as the default and as
the automatic fallback if the real reranker is unavailable or fails.

`cross_encoder_rerank()` is the genuine version: a real cross-encoder model
(sentence_transformers.CrossEncoder) scores each (query, candidate_text)
pair directly, which can reorder results the initial retrieval score got
wrong in a way no amount of re-sorting existing scores ever could. It is
lazy-loaded (only on first actual call, never at FastAPI startup) and gated
behind settings.ENABLE_CROSS_ENCODER_RERANK, defaulted off — this box has a
documented history of OOM crashes under memory pressure, and stacking a new
model on top of the already-loaded sentence-transformers embedding model is
exactly the kind of thing that caused it. cross-encoder/ms-marco-MiniLM-L-2-v2
is the smallest published model in that series (~17MB, 2 transformer layers)
specifically to keep that risk as low as it can be while still being real.
"""
import logging
import threading
from typing import List

from ..config import settings

logger = logging.getLogger(__name__)

CROSS_ENCODER_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-2-v2"

_cross_encoder = None
_load_lock = threading.Lock()
_load_failed = False


def heuristic_rerank(candidates: List[dict], top_n: int = 5) -> List[dict]:
    """Sorts candidates by whatever retrieval score they already carry (dense
    cosine similarity, or the RRF-fused score's cosine-equivalent field —
    see retrieval.py). Cheap, no model, always available — the safe default
    and the fallback when the cross-encoder is disabled or fails to load."""
    if not candidates:
        return []
    return sorted(candidates, key=lambda x: x.get("score", 0.0), reverse=True)[:top_n]


def _get_cross_encoder():
    global _cross_encoder, _load_failed
    if _cross_encoder is not None or _load_failed:
        return _cross_encoder
    with _load_lock:
        if _cross_encoder is not None or _load_failed:
            return _cross_encoder
        try:
            from sentence_transformers import CrossEncoder
            logger.info("[Reranking] Loading cross-encoder %s (first use, lazy)...", CROSS_ENCODER_MODEL_NAME)
            _cross_encoder = CrossEncoder(CROSS_ENCODER_MODEL_NAME, max_length=512)
            logger.info("[Reranking] Cross-encoder loaded.")
        except Exception as e:
            logger.error("[Reranking] Cross-encoder load failed, falling back to heuristic rerank: %s", e)
            _load_failed = True
            _cross_encoder = None
    return _cross_encoder


def cross_encoder_rerank(query: str, candidates: List[dict], top_n: int = 5) -> List[dict]:
    """
    Real cross-encoder reranking when settings.ENABLE_CROSS_ENCODER_RERANK is
    on; otherwise (or on any load/inference failure) falls back to
    heuristic_rerank() so a reranker problem never breaks a query.
    """
    if not candidates:
        return []
    if not settings.ENABLE_CROSS_ENCODER_RERANK:
        return heuristic_rerank(candidates, top_n)

    model = _get_cross_encoder()
    if model is None:
        return heuristic_rerank(candidates, top_n)

    try:
        pairs = [(query, c.get("content", "")[:512]) for c in candidates]
        scores = model.predict(pairs)
        ranked = sorted(zip(candidates, scores), key=lambda cs: float(cs[1]), reverse=True)
        return [c for c, _ in ranked[:top_n]]
    except Exception as e:
        logger.error("[Reranking] Cross-encoder inference failed, falling back to heuristic rerank: %s", e)
        return heuristic_rerank(candidates, top_n)
