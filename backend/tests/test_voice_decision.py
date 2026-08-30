"""Tests for Central Voice Decision Engine."""
import pytest

from app.services.voice_decision import authenticate, DecisionType, VoiceDecision


class TestVoiceDecisionEngine:
    def test_low_quality_triggers_retry(self):
        dec = authenticate(
            speaker_score=0.85,
            score_margin=0.20,
            quality_usable=False,
        )
        assert dec.decision == DecisionType.RETRY
        assert dec.reason == "low_audio_quality"

    def test_replay_detected_triggers_deny(self):
        dec = authenticate(
            speaker_score=0.90,
            score_margin=0.25,
            quality_usable=True,
            spoof_result={"overall_label": "replay", "replay": {"is_replay": True, "label": "replay"}},
        )
        assert dec.decision == DecisionType.DENY
        assert dec.reason == "replay_detected"

    def test_synthetic_detected_triggers_deny(self):
        dec = authenticate(
            speaker_score=0.90,
            score_margin=0.25,
            quality_usable=True,
            spoof_result={"overall_label": "synthetic", "synthetic": {"is_synthetic": True, "label": "synthetic"}},
        )
        assert dec.decision == DecisionType.DENY
        assert dec.reason == "synthetic_detected"

    def test_challenge_failure_triggers_deny(self):
        dec = authenticate(
            speaker_score=0.90,
            score_margin=0.25,
            quality_usable=True,
            challenge_result={"match": False, "spoken": "apple", "expected": "orange"},
        )
        assert dec.decision == DecisionType.DENY
        assert dec.reason == "challenge_failed"

    def test_below_threshold_triggers_unknown_or_deny(self):
        # 1:N case -> UNKNOWN
        dec_1n = authenticate(
            speaker_score=0.45,
            score_margin=0.20,
            quality_usable=True,
            calibrated_threshold=0.70,
            is_1_to_1=False,
        )
        assert dec_1n.decision == DecisionType.UNKNOWN

        # 1:1 case -> DENY
        dec_11 = authenticate(
            speaker_score=0.45,
            score_margin=0.20,
            quality_usable=True,
            calibrated_threshold=0.70,
            is_1_to_1=True,
        )
        assert dec_11.decision == DecisionType.DENY

    def test_insufficient_margin_triggers_uncertain(self):
        dec = authenticate(
            speaker_score=0.80,
            score_margin=0.03,
            quality_usable=True,
            calibrated_threshold=0.70,
            calibrated_margin=0.10,
            is_1_to_1=False,
        )
        assert dec.decision == DecisionType.UNCERTAIN
        assert dec.reason == "insufficient_margin"

    def test_all_checks_pass_triggers_open(self):
        dec = authenticate(
            speaker_score=0.88,
            score_margin=0.22,
            quality_usable=True,
            spoof_result={"overall_label": "live", "is_spoof": False},
            challenge_result={"match": True},
            calibrated_threshold=0.70,
            calibrated_margin=0.10,
            speaker_id="spk_123",
            speaker_name="Alice",
        )
        assert dec.decision == DecisionType.OPEN
        assert dec.speaker_id == "spk_123"
        assert dec.reason == "ok"
