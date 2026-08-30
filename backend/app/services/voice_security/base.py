"""Base abstractions for Voice Anti-Spoofing and Countermeasure models."""
from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
import torch
import numpy as np


class SpoofLabel(str, Enum):
    LIVE = "live"
    REPLAY = "replay"
    SYNTHETIC = "synthetic"
    UNKNOWN = "unknown"


@dataclass
class SpoofResult:
    """Result from an anti-spoofing detector or countermeasure pipeline."""
    label: SpoofLabel
    score: float       # 0.0 (clean live) to 1.0 (definite spoof/fake)
    confidence: float  # 0.0 (low confidence) to 1.0 (high confidence)
    detector_name: str = "generic"
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "label": self.label.value if isinstance(self.label, SpoofLabel) else str(self.label),
            "score": round(self.score, 4),
            "confidence": round(self.confidence, 4),
            "detector_name": self.detector_name,
            "details": self.details,
        }


class SpoofDetector(ABC):
    """Abstract Base Class for voice anti-spoofing detectors."""

    @abstractmethod
    def predict(self, waveform: torch.Tensor, sample_rate: int) -> SpoofResult:
        """Predict whether audio is LIVE, REPLAY, SYNTHETIC, or UNKNOWN."""
        pass
