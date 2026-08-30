"""Tests for Voice Calibration & Normalization Subsystem."""
import pytest
import numpy as np

from app.services.voice_score import VoiceScore, VoiceScoreNormalizer
from app.services.voice_calibration.dataset import CalibrationDataset, CalibrationSample, TrialPair
from app.services.voice_calibration.scoring import TrialScorer, ScoreDistribution, cosine_similarity
from app.services.voice_calibration.metrics import VerificationMetrics, IdentificationMetrics
from app.services.voice_calibration.calibrator import VoiceCalibrator


class TestScoreNormalization:
    def test_voice_score_dataclass(self):
        vs = VoiceScore(
            raw_score=0.75,
            normalized_score=0.88,
            threshold=0.70,
            margin=0.20,
            is_match=True,
            confidence_label="high",
        )
        d = vs.to_dict()
        assert d["raw_score"] == 0.75
        assert d["normalized_score"] == 0.88
        assert d["is_match"] is True
        assert d["margin"] == 0.20

    def test_normalizer_sigmoid(self):
        norm = VoiceScoreNormalizer(impostor_mean=0.2, impostor_std=0.1, genuine_mean=0.8, genuine_std=0.1)
        score_high = norm.normalize(0.85, method="sigmoid")
        score_low = norm.normalize(0.15, method="sigmoid")
        assert score_high > score_low
        assert 0.0 <= score_high <= 1.0
        assert 0.0 <= score_low <= 1.0

        vs_high = norm.evaluate_score(0.85, threshold=0.70, method="sigmoid")
        assert vs_high.is_match is True

    def test_normalizer_linear(self):
        norm = VoiceScoreNormalizer(impostor_mean=0.2, impostor_std=0.1, genuine_mean=0.8, genuine_std=0.1)
        res = norm.normalize(0.5, method="linear")
        assert 0.0 <= res <= 1.0


class TestCalibrationDataset:
    def test_synthetic_benchmark_generation(self):
        ds = CalibrationDataset.generate_synthetic_benchmark(
            num_speakers=5,
            enrollment_per_speaker=3,
            verification_per_speaker=3,
            num_unknown_speakers=2,
        )
        assert ds.num_speakers == 5
        assert len(ds.unknown_samples) == 6
        gen_trials, imp_trials = ds.generate_trials()
        assert len(gen_trials) > 0
        assert len(imp_trials) > 0


class TestBiometricMetrics:
    def test_eer_calculation(self):
        genuine_scores = [0.8, 0.85, 0.9, 0.95, 0.88, 0.92]
        impostor_scores = [0.1, 0.15, 0.2, 0.25, 0.18, 0.30]
        eer_pct, threshold = VerificationMetrics.calculate_eer(genuine_scores, impostor_scores)
        assert eer_pct < 5.0
        assert 0.25 <= threshold <= 0.80

    def test_roc_auc_calculation(self):
        genuine_scores = [0.8, 0.85, 0.9, 0.95]
        impostor_scores = [0.1, 0.2, 0.3, 0.4]
        auc = VerificationMetrics.calculate_roc_auc(genuine_scores, impostor_scores)
        assert auc == 1.0

    def test_identification_1n_metrics(self):
        gallery_ids = ["spk1", "spk2"]
        gallery_centroids = [[1.0, 0.0], [0.0, 1.0]]
        probe_ids = ["spk1", "spk2", "unknown_1"]
        probe_embeds = [[0.99, 0.01], [0.01, 0.99], [0.5, 0.5]]

        metrics = IdentificationMetrics.evaluate_1_to_n(
            gallery_speaker_ids=gallery_ids,
            gallery_centroids=gallery_centroids,
            probe_speaker_ids=probe_ids,
            probe_embeddings=probe_embeds,
            threshold=0.70,
            margin_threshold=0.10,
        )
        assert metrics["top1_accuracy"] == 100.0
        assert metrics["unknown_probes_count"] == 1
        assert metrics["known_probes_count"] == 2


class TestCalibrator:
    def test_calibrator_workflow(self, tmp_path):
        ds = CalibrationDataset.generate_synthetic_benchmark(num_speakers=4)
        calibrator = VoiceCalibrator(target_far_percent=0.1)
        res = calibrator.calibrate(ds)
        assert res.verification_threshold > 0.0
        assert res.num_speakers == 4

        # Save and load
        save_file = str(tmp_path / "cal.json")
        calibrator.save(save_file)
        new_cal = VoiceCalibrator()
        loaded = new_cal.load(save_file)
        assert loaded.verification_threshold == res.verification_threshold
