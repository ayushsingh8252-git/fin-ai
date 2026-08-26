"""services/retrieval.py's Reciprocal Rank Fusion, services/sparse_retrieval.py's
tokenizer, and services/adaptive_rag.py's evidence validator — all pure
functions, no Pinecone/embedding-model/DB dependency, so these run fast
everywhere."""
from app.services.retrieval import _reciprocal_rank_fusion, SPARSE_ONLY_SCORE
from app.services.sparse_retrieval import _tokenize
from app.services.adaptive_rag import validate_evidence


def _match(id_, score, content="x"):
    return {"id": id_, "score": score, "metadata": {"content": content}}


def test_candidate_in_both_rankings_outranks_single_ranking_candidate():
    dense = [_match("a", 0.9), _match("b", 0.6)]
    sparse = [_match("b", 12.0), _match("c", 8.0)]

    fused = _reciprocal_rank_fusion(dense, sparse, top_k=5)
    fused_ids = [m["id"] for m in fused]

    # "b" appears in both rankings (rank 2 dense, rank 1 sparse) so it should
    # be fused ahead of "a" and "c", which each appear in only one ranking.
    assert fused_ids[0] == "b"


def test_dense_score_preserved_for_downstream_thresholds():
    dense = [_match("a", 0.82)]
    sparse = []
    fused = _reciprocal_rank_fusion(dense, sparse, top_k=5)
    assert fused[0]["score"] == 0.82


def test_sparse_only_candidate_gets_placeholder_not_fabricated_cosine_score():
    dense = []
    sparse = [_match("x", 15.7)]  # raw BM25 score, not a 0-1 cosine value
    fused = _reciprocal_rank_fusion(dense, sparse, top_k=5)
    assert fused[0]["score"] == SPARSE_ONLY_SCORE


def test_top_k_respected():
    dense = [_match(str(i), 1.0 - i * 0.01) for i in range(10)]
    fused = _reciprocal_rank_fusion(dense, [], top_k=3)
    assert len(fused) == 3


def test_tokenize_strips_stopwords():
    """Bug #1 (docs/platform-status-audit-2026-08-26-rag-e2e-qa.md): an
    off-topic query like "what is the capital of France" was returning real
    BM25 "matches" against any corpus purely on stopword overlap."""
    tokens = _tokenize("What is the capital of France?")
    assert tokens == ["capital", "france"]
    assert "the" not in tokens and "is" not in tokens and "of" not in tokens


def test_tokenize_keeps_real_content_words():
    tokens = _tokenize("Pinecone and FastAPI for retrieval pipelines")
    assert "pinecone" in tokens
    assert "fastapi" in tokens
    assert "retrieval" in tokens
    assert "and" not in tokens and "for" not in tokens


def test_validate_evidence_trusts_crag_high_over_raw_score_gate():
    """Bug #2 (same report): CRAG graded evidence HIGH/0.92 from actually
    reading the text, but a low-scoring candidate (naturally common on short
    documents) got rejected by the independent raw-cosine >=0.45 gate,
    producing a false "missing" without ever calling the LLM to answer."""
    low_score_candidates = [
        {"id": "a", "score": 0.446, "content": "Priya Sharma, Senior Data Engineer"},
        {"id": "b", "score": 0.418, "content": "Skills: Apache Spark, data pipelines"},
    ]
    valid, candidates = validate_evidence("What is the work experience?", low_score_candidates, crag_grade="HIGH")
    assert valid is True
    assert candidates == low_score_candidates


def test_validate_evidence_still_rejects_low_score_without_high_grade():
    low_score_candidates = [{"id": "a", "score": 0.3, "content": "unrelated text"}]
    valid, _ = validate_evidence("query", low_score_candidates, crag_grade="LOW")
    assert valid is False
