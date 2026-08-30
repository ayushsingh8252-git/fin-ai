"""Voice Calibrator Engine.

Fits biometric thresholds and score distribution statistics from calibration trial data,
and persists/loads calibration state to/from JSON.
"""
from __future__ import annotations

import os
import json
import time
import datetime
import logging
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, List, Tuple
import numpy as np

from .dataset import CalibrationDataset
from .scoring import TrialScorer, ScoreDistribution, cosine_similarity
from .metrics import VerificationMetrics, IdentificationMetrics
from ..voice_score import VoiceScoreNormalizer

logger = logging.getLogger("voice_calibration")

DEFAULT_CALIBRATION_PATH = os.path.join("models", "voice_calibration.json")


@dataclass
class CalibrationResult:
    model_version: str
    verification_threshold: float
    margin_threshold: float
    eer_percent: float
    eer_threshold: float
    tar_at_target_far: float
    target_far_percent: float
    roc_auc: float
    impostor_stats: Dict[str, Any]
    genuine_stats: Dict[str, Any]
    identification_1n_summary: Dict[str, Any]
    num_speakers: int
    num_genuine_trials: int
    num_impostor_trials: int
    calibration_dataset_version: str
    created_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class VoiceCalibrator:
    """Calibrates 1:1 and 1:N operating parameters and score normalization."""

    def __init__(self, target_far_percent: float = 0.1):
        self.target_far_percent = target_far_percent
        self.active_calibration: Optional[CalibrationResult] = None
        self.normalizer: Optional[VoiceScoreNormalizer] = None

    def calibrate(
        self,
        dataset: CalibrationDataset,
        model_version: str = "speechbrain-ecapa-voxceleb",
        embedding_fn=None,
    ) -> CalibrationResult:
        """Runs full calibration pipeline over genuine and impostor trials."""
        logger.info("Starting calibration on dataset: %s (%d speakers)", dataset.dataset_name, dataset.num_speakers)

        scorer = TrialScorer(embedding_fn=embedding_fn)
        genuine_trials, impostor_trials = dataset.generate_trials()

        if not genuine_trials or not impostor_trials:
            raise ValueError("Insufficient trials generated for calibration.")

        gen_scores = scorer.score_trials(genuine_trials)
        imp_scores = scorer.score_trials(impostor_trials)

        gen_dist = scorer.compute_distribution(gen_scores)
        imp_dist = scorer.compute_distribution(imp_scores)

        # 1:1 Verification Metrics
        eer_val, eer_thresh = VerificationMetrics.calculate_eer(gen_scores, imp_scores)
        tar_val, op_thresh = VerificationMetrics.calculate_tar_at_far(
            gen_scores, imp_scores, target_far_percent=self.target_far_percent
        )
        roc_auc = VerificationMetrics.calculate_roc_auc(gen_scores, imp_scores)

        # 1:N Gallery & Probe evaluation
        gallery_ids = []
        gallery_centroids = []
        probe_ids = []
        probe_embeds = []

        for spk, samples in dataset.samples_by_speaker.items():
            enr_embeds = [s.embedding for s in samples if s.sample_type == "enrollment" and s.embedding]
            if not enr_embeds:
                enr_embeds = [s.embedding for s in samples if s.embedding]
            if enr_embeds:
                centroid = np.mean(enr_embeds, axis=0)
                centroid /= np.linalg.norm(centroid)
                gallery_ids.append(spk)
                gallery_centroids.append(centroid.tolist())

            ver_samples = [s for s in samples if s.sample_type == "verification" and s.embedding]
            for s in ver_samples:
                probe_ids.append(spk)
                probe_embeds.append(s.embedding)

        # Include unknown probes
        for u_sample in dataset.unknown_samples:
            if u_sample.embedding:
                probe_ids.append(u_sample.speaker_id)
                probe_embeds.append(u_sample.embedding)

        # Calibrate margin threshold (empirically 10th percentile of true margin)
        id_1n_metrics = IdentificationMetrics.evaluate_1_to_n(
            gallery_speaker_ids=gallery_ids,
            gallery_centroids=gallery_centroids,
            probe_speaker_ids=probe_ids,
            probe_embeddings=probe_embeds,
            threshold=op_thresh,
            margin_threshold=0.10,
        )

        calibrated_margin = max(0.08, min(0.20, id_1n_metrics.get("margin_p10", 0.12)))

        result = CalibrationResult(
            model_version=model_version,
            verification_threshold=round(op_thresh, 4),
            margin_threshold=round(calibrated_margin, 4),
            eer_percent=eer_val,
            eer_threshold=eer_thresh,
            tar_at_target_far=tar_val,
            target_far_percent=self.target_far_percent,
            roc_auc=roc_auc,
            impostor_stats=imp_dist.to_dict(),
            genuine_stats=gen_dist.to_dict(),
            identification_1n_summary=id_1n_metrics,
            num_speakers=dataset.num_speakers,
            num_genuine_trials=len(genuine_trials),
            num_impostor_trials=len(impostor_trials),
            calibration_dataset_version=dataset.dataset_name,
            created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )

        self.active_calibration = result
        self.normalizer = VoiceScoreNormalizer(
            impostor_mean=imp_dist.mean,
            impostor_std=imp_dist.std,
            genuine_mean=gen_dist.mean,
            genuine_std=gen_dist.std,
        )

        return result

    def save(self, file_path: str = DEFAULT_CALIBRATION_PATH) -> None:
        if not self.active_calibration:
            raise ValueError("No active calibration to save.")
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(self.active_calibration.to_dict(), f, indent=2)
        logger.info("Saved calibration result to %s", file_path)

    def load(self, file_path: str = DEFAULT_CALIBRATION_PATH) -> Optional[CalibrationResult]:
        if not os.path.exists(file_path):
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.active_calibration = CalibrationResult(**data)
        imp = self.active_calibration.impostor_stats
        gen = self.active_calibration.genuine_stats
        self.normalizer = VoiceScoreNormalizer(
            impostor_mean=imp.get("mean", 0.30),
            impostor_std=imp.get("std", 0.12),
            genuine_mean=gen.get("mean", 0.85),
            genuine_std=gen.get("std", 0.08),
        )
        return self.active_calibration


_global_calibrator = None


def get_voice_calibrator() -> VoiceCalibrator:
    global _global_calibrator
    if _global_calibrator is None:
        _global_calibrator = VoiceCalibrator()
        # Attempt to load existing calibration file if available
        if os.path.exists(DEFAULT_CALIBRATION_PATH):
            _global_calibrator.load(DEFAULT_CALIBRATION_PATH)
        else:
            # Fallback self-calibration on standard synthetic benchmark
            ds = CalibrationDataset.generate_synthetic_benchmark(num_speakers=30)
            _global_calibrator.calibrate(ds)
    return _global_calibrator
