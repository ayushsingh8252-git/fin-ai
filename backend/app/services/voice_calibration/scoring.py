"""Trial Scoring and Distribution Computation."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Callable
import numpy as np

from .dataset import TrialPair


@dataclass
class ScoreDistribution:
    """Statistical summary of similarity scores for a class of trials."""
    count: int
    mean: float
    std: float
    min_score: float
    max_score: float
    quantiles: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, float]:
        return {
            "count": self.count,
            "mean": round(self.mean, 4),
            "std": round(self.std, 4),
            "min": round(self.min_score, 4),
            "max": round(self.max_score, 4),
            **{f"p{k}": round(v, 4) for k, v in self.quantiles.items()},
        }


def cosine_similarity(a: List[float], b: List[float]) -> float:
    a_np = np.asarray(a, dtype=np.float32)
    b_np = np.asarray(b, dtype=np.float32)
    norm_a = np.linalg.norm(a_np)
    norm_b = np.linalg.norm(b_np)
    if norm_a < 1e-10 or norm_b < 1e-10:
        return 0.0
    return float(np.dot(a_np, b_np) / (norm_a * norm_b))


class TrialScorer:
    """Scores calibration trial pairs and computes genuine/impostor distributions."""

    def __init__(self, embedding_fn: Optional[Callable[[str], List[float]]] = None):
        self.embedding_fn = embedding_fn

    def compute_similarity(self, sample_a, sample_b) -> float:
        emb_a = sample_a.embedding
        if emb_a is None and self.embedding_fn and sample_a.audio_path:
            emb_a = self.embedding_fn(sample_a.audio_path)
            sample_a.embedding = emb_a

        emb_b = sample_b.embedding
        if emb_b is None and self.embedding_fn and sample_b.audio_path:
            emb_b = self.embedding_fn(sample_b.audio_path)
            sample_b.embedding = emb_b

        if emb_a is None or emb_b is None:
            raise ValueError(f"Missing embeddings for trial between {sample_a.sample_id} and {sample_b.sample_id}")

        return cosine_similarity(emb_a, emb_b)

    def score_trials(self, trials: List[TrialPair]) -> List[float]:
        scores = []
        for trial in trials:
            score = self.compute_similarity(trial.sample_a, trial.sample_b)
            scores.append(score)
        return scores

    @staticmethod
    def compute_distribution(scores: List[float]) -> ScoreDistribution:
        if not scores:
            return ScoreDistribution(count=0, mean=0.0, std=0.0, min_score=0.0, max_score=0.0)

        arr = np.array(scores, dtype=np.float64)
        quantiles = {
            "01": float(np.percentile(arr, 1)),
            "05": float(np.percentile(arr, 5)),
            "10": float(np.percentile(arr, 10)),
            "50": float(np.percentile(arr, 50)),
            "90": float(np.percentile(arr, 90)),
            "95": float(np.percentile(arr, 95)),
            "99": float(np.percentile(arr, 99)),
        }

        return ScoreDistribution(
            count=len(arr),
            mean=float(np.mean(arr)),
            std=float(np.std(arr)),
            min_score=float(np.min(arr)),
            max_score=float(np.max(arr)),
            quantiles=quantiles,
        )
