"""Voice Score Abstraction & Normalization Subsystem.

Provides:
- VoiceScore dataclass for standardized score representation
- VoiceScoreNormalizer for calibrating similarity scores without
  falsely claiming uncalibrated raw scores are posterior probabilities.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class VoiceScore:
    """Standardized representation of a speaker similarity score."""
    raw_score: float
    normalized_score: float
    threshold: float
    margin: float
    is_match: bool
    confidence_label: str = "uncertain"
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw_score": round(self.raw_score, 4),
            "normalized_score": round(self.normalized_score, 4),
            "threshold": round(self.threshold, 4),
            "margin": round(self.margin, 4),
            "is_match": self.is_match,
            "confidence_label": self.confidence_label,
            "details": self.details,
        }


class VoiceScoreNormalizer:
    """Configurable score normalizer using calibrated distribution statistics.
    
    Maps raw cosine similarities [-1.0, 1.0] into a normalized range [0.0, 1.0].
    Provides extension hooks for cohort-based normalization (Z-norm, T-norm, PLDA).
    """

    def __init__(
        self,
        impostor_mean: float = 0.30,
        impostor_std: float = 0.12,
        genuine_mean: float = 0.85,
        genuine_std: float = 0.08,
        min_score: float = -1.0,
        max_score: float = 1.0,
    ):
        self.impostor_mean = impostor_mean
        self.impostor_std = max(impostor_std, 1e-4)
        self.genuine_mean = genuine_mean
        self.genuine_std = max(genuine_std, 1e-4)
        self.min_score = min_score
        self.max_score = max_score

    def normalize(self, raw_score: float, method: str = "sigmoid") -> float:
        """Normalize raw similarity score to [0.0, 1.0].
        
        Supported methods:
        - 'linear': piecewise linear scaling around the decision threshold
        - 'sigmoid': calibrated logistic scaling centered between impostor & genuine distributions
        - 'minmax': bounded range clipping
        """
        raw_clamped = max(self.min_score, min(self.max_score, raw_score))

        if method == "sigmoid":
            # Center sigmoid midway between impostor and genuine means
            midpoint = (self.impostor_mean + self.genuine_mean) / 2.0
            scale = max((self.genuine_mean - self.impostor_mean) / 4.0, 0.05)
            z = (raw_clamped - midpoint) / scale
            # Numerically stable sigmoid
            if z >= 0:
                normalized = 1.0 / (1.0 + math.exp(-z))
            else:
                ez = math.exp(z)
                normalized = ez / (1.0 + ez)
            return float(max(0.0, min(1.0, normalized)))

        elif method == "linear":
            # Linear mapping from [impostor_mean, genuine_mean] to [0.0, 1.0]
            span = max(self.genuine_mean - self.impostor_mean, 1e-4)
            normalized = (raw_clamped - self.impostor_mean) / span
            return float(max(0.0, min(1.0, normalized)))

        else:  # minmax
            span = max(self.max_score - self.min_score, 1e-4)
            normalized = (raw_clamped - self.min_score) / span
            return float(max(0.0, min(1.0, normalized)))

    def evaluate_score(
        self,
        raw_score: float,
        threshold: float,
        runner_up_score: float = 0.0,
        margin_threshold: float = 0.15,
        method: str = "sigmoid",
    ) -> VoiceScore:
        """Create a complete VoiceScore object with normalization, thresholding, and margin check."""
        normalized = self.normalize(raw_score, method=method)
        margin = max(0.0, raw_score - runner_up_score)
        is_match = (raw_score >= threshold) and (margin >= margin_threshold)

        if is_match:
            confidence_label = "high" if raw_score >= threshold + 0.10 else "medium"
        elif raw_score >= threshold and margin < margin_threshold:
            confidence_label = "uncertain_margin"
        elif raw_score >= threshold - 0.05:
            confidence_label = "borderline"
        else:
            confidence_label = "low"

        return VoiceScore(
            raw_score=raw_score,
            normalized_score=normalized,
            threshold=threshold,
            margin=margin,
            is_match=is_match,
            confidence_label=confidence_label,
            details={
                "runner_up_score": round(runner_up_score, 4),
                "margin_threshold": margin_threshold,
                "normalization_method": method,
            },
        )
