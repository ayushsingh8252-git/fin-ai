"""Anti-Spoofing Pipeline aggregating replay, synthetic, and countermeasure detectors."""
from __future__ import annotations

from typing import Dict, Any, List, Optional
import torch

from .base import SpoofDetector, SpoofResult, SpoofLabel
from .replay_detector import ReplayDetector
from .synthetic_detector import SyntheticDetector


class SpoofPipeline:
    """Pipelines and aggregates multiple anti-spoofing countermeasures."""

    def __init__(
        self,
        replay_detector: Optional[SpoofDetector] = None,
        synthetic_detector: Optional[SpoofDetector] = None,
        replay_enabled: bool = True,
        synthetic_enabled: bool = True,
    ):
        self.replay_detector = replay_detector or ReplayDetector()
        self.synthetic_detector = synthetic_detector or SyntheticDetector()
        self.replay_enabled = replay_enabled
        self.synthetic_enabled = synthetic_enabled

    def analyze(self, waveform: torch.Tensor, sample_rate: int) -> Dict[str, Any]:
        """Runs all enabled detectors and aggregates the final anti-spoof result.
        
        Returns:
        {
            "overall_label": SpoofLabel,
            "is_spoof": bool,
            "overall_score": float,
            "overall_confidence": float,
            "replay": SpoofResult.to_dict(),
            "synthetic": SpoofResult.to_dict(),
        }
        """
        results = {}
        is_replay = False
        is_synthetic = False

        # 1. Replay check
        if self.replay_enabled:
            replay_res = self.replay_detector.predict(waveform, sample_rate)
            results["replay"] = replay_res.to_dict()
            if replay_res.label == SpoofLabel.REPLAY:
                is_replay = True
        else:
            results["replay"] = {"label": "skipped", "score": 0.0, "confidence": 0.0}

        # 2. Synthetic voice check
        if self.synthetic_enabled:
            synthetic_res = self.synthetic_detector.predict(waveform, sample_rate)
            results["synthetic"] = synthetic_res.to_dict()
            if synthetic_res.label == SpoofLabel.SYNTHETIC:
                is_synthetic = True
        else:
            results["synthetic"] = {"label": "skipped", "score": 0.0, "confidence": 0.0}

        # Determine overall status
        if is_replay:
            overall_label = SpoofLabel.REPLAY
            overall_score = results["replay"]["score"]
            overall_conf = results["replay"]["confidence"]
            is_spoof = True
        elif is_synthetic:
            overall_label = SpoofLabel.SYNTHETIC
            overall_score = results["synthetic"]["score"]
            overall_conf = results["synthetic"]["confidence"]
            is_spoof = True
        elif (
            results.get("replay", {}).get("label") == SpoofLabel.UNKNOWN.value or
            results.get("synthetic", {}).get("label") == SpoofLabel.UNKNOWN.value
        ):
            overall_label = SpoofLabel.UNKNOWN
            overall_score = max(results.get("replay", {}).get("score", 0), results.get("synthetic", {}).get("score", 0))
            overall_conf = 0.0
            is_spoof = False
        else:
            overall_label = SpoofLabel.LIVE
            overall_score = max(results.get("replay", {}).get("score", 0), results.get("synthetic", {}).get("score", 0))
            overall_conf = min(results.get("replay", {}).get("confidence", 1), results.get("synthetic", {}).get("confidence", 1))
            is_spoof = False

        return {
            "overall_label": overall_label.value if isinstance(overall_label, SpoofLabel) else str(overall_label),
            "is_spoof": is_spoof,
            "overall_score": round(overall_score, 4),
            "overall_confidence": round(overall_conf, 4),
            "replay": results.get("replay"),
            "synthetic": results.get("synthetic"),
        }


_global_spoof_pipeline = None


def get_spoof_pipeline(replay_enabled: bool = True, synthetic_enabled: bool = True) -> SpoofPipeline:
    global _global_spoof_pipeline
    if _global_spoof_pipeline is None:
        _global_spoof_pipeline = SpoofPipeline(
            replay_enabled=replay_enabled,
            synthetic_enabled=synthetic_enabled,
        )
    return _global_spoof_pipeline
