"""Tests for Voice Anti-Spoofing Subsystem."""
import pytest
import torch
import numpy as np

from app.services.voice_security import (
    SpoofLabel,
    SpoofResult,
    ReplayDetector,
    SyntheticDetector,
    SpoofPipeline,
    get_spoof_pipeline,
)


class TestVoiceSecurity:
    def test_spoof_result_structure(self):
        res = SpoofResult(
            label=SpoofLabel.LIVE,
            score=0.15,
            confidence=0.85,
            detector_name="test_det",
            details={"key": "val"},
        )
        d = res.to_dict()
        assert d["label"] == "live"
        assert d["score"] == 0.15
        assert d["confidence"] == 0.85

    def test_replay_detector_live_audio(self):
        sr = 16000
        t = torch.linspace(0, 1.0, sr)
        waveform = 0.3 * torch.sin(2 * 3.14159 * 300 * t) + 0.1 * torch.randn(len(t))
        detector = ReplayDetector()
        res = detector.predict(waveform, sr)
        assert isinstance(res, SpoofResult)
        assert res.label in (SpoofLabel.LIVE, SpoofLabel.UNKNOWN)

    def test_synthetic_detector_smooth_audio(self):
        sr = 16000
        t = torch.linspace(0, 1.0, sr)
        # Constant pitch sine wave (unnatural smoothness)
        waveform = 0.5 * torch.sin(2 * 3.14159 * 440 * t)
        detector = SyntheticDetector()
        res = detector.predict(waveform, sr)
        assert isinstance(res, SpoofResult)
        assert res.label in (SpoofLabel.SYNTHETIC, SpoofLabel.LIVE)

    def test_spoof_pipeline_integration(self):
        sr = 16000
        t = torch.linspace(0, 1.0, sr)
        waveform = 0.3 * torch.sin(2 * 3.14159 * 250 * t) + 0.05 * torch.randn(len(t))
        pipeline = get_spoof_pipeline()
        analysis = pipeline.analyze(waveform, sr)

        assert "overall_label" in analysis
        assert "is_spoof" in analysis
        assert "replay" in analysis
        assert "synthetic" in analysis
        assert analysis["overall_label"] in ["live", "replay", "synthetic", "unknown"]
