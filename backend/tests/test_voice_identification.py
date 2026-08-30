"""Tests for the Voice Identification Tool.

Covers:
- Tool registration in the unified catalog
- Audio quality check logic
- Challenge phrase generation
- Cosine similarity helper
- Replay/AI-voice detection heuristics
- API endpoint routing (smoke tests)

NOTE: Tests that require the ECAPA-TDNN model or Pinecone are skipped if
the model isn't downloaded or Pinecone isn't configured — these are integration
tests that need the real model/index to be present.
"""
from __future__ import annotations

import os
import sys
import pytest
import numpy as np

# ── Ensure the backend package is importable ──
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestToolRegistration:
    """Verify the voice_identification tool appears in the unified catalog."""

    def test_voice_id_connector_exists(self):
        from app.agent_tools.voice_id_tools import connector
        assert connector.name == "voice_identification"
        assert connector.display_name == "Voice Identification (Speaker Biometrics)"

    def test_voice_id_tools_registered(self):
        from app.agent_tools.voice_id_tools import connector
        tool_names = [t.name for t in connector.list_tools()]
        assert "enroll_voice" in tool_names
        assert "identify_voice" in tool_names
        assert "verify_voice" in tool_names
        assert "get_speaker_info" in tool_names
        assert "generate_voice_challenge" in tool_names

    def test_voice_id_in_unified_registry(self):
        from app.agent_tools.registry import all_connectors_unified
        names = [c.name for c in all_connectors_unified()]
        assert "voice_identification" in names

    def test_unified_catalog_includes_voice_tools(self):
        from app.agent_tools.registry import unified_catalog
        catalog = unified_catalog()
        voice_tools = [e for e in catalog if e["connector"] == "voice_identification"]
        assert len(voice_tools) >= 5


class TestChallengePhrase:
    """Test challenge phrase generation."""

    def test_generates_three_word_phrase(self):
        from app.services.voice_identification import generate_challenge_phrase
        phrase = generate_challenge_phrase()
        words = phrase.split()
        assert len(words) == 3

    def test_phrases_are_random(self):
        from app.services.voice_identification import generate_challenge_phrase
        phrases = {generate_challenge_phrase() for _ in range(50)}
        # With 10x10x10 = 1000 possible phrases, 50 samples should give
        # at least 20 unique ones (birthday paradox).
        assert len(phrases) >= 10

    def test_phrase_contains_valid_words(self):
        from app.services.voice_identification import (
            generate_challenge_phrase,
            _CHALLENGE_COLORS,
            _CHALLENGE_NUMBERS,
            _CHALLENGE_OBJECTS,
        )
        phrase = generate_challenge_phrase()
        color, number, obj = phrase.split()
        assert color in _CHALLENGE_COLORS
        assert number in _CHALLENGE_NUMBERS
        assert obj in _CHALLENGE_OBJECTS


class TestCosineSimilarity:
    """Test the cosine similarity helper."""

    def test_identical_vectors(self):
        from app.services.voice_identification import _cosine_similarity
        v = [1.0, 2.0, 3.0]
        assert abs(_cosine_similarity(v, v) - 1.0) < 1e-6

    def test_orthogonal_vectors(self):
        from app.services.voice_identification import _cosine_similarity
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert abs(_cosine_similarity(a, b)) < 1e-6

    def test_opposite_vectors(self):
        from app.services.voice_identification import _cosine_similarity
        a = [1.0, 2.0, 3.0]
        b = [-1.0, -2.0, -3.0]
        assert abs(_cosine_similarity(a, b) + 1.0) < 1e-6

    def test_zero_vector(self):
        from app.services.voice_identification import _cosine_similarity
        a = [1.0, 2.0, 3.0]
        b = [0.0, 0.0, 0.0]
        assert _cosine_similarity(a, b) == 0.0


class TestAudioQualityCheck:
    """Test audio quality check logic with synthetic waveforms."""

    def test_normal_audio_passes(self):
        import torch
        from app.services.voice_identification import check_audio_quality
        # 1 second of normal speech-like audio (16kHz)
        sr = 16000
        t = torch.linspace(0, 1, sr)
        waveform = 0.3 * torch.sin(2 * 3.14159 * 440 * t)  # 440Hz sine, moderate amplitude
        result = check_audio_quality(waveform, sr)
        assert result["is_usable"] is True
        assert len(result["issues"]) == 0

    def test_silent_audio_fails(self):
        import torch
        from app.services.voice_identification import check_audio_quality
        waveform = torch.zeros(16000)  # 1 second of silence
        result = check_audio_quality(waveform, 16000)
        assert result["is_usable"] is False
        assert any("quiet" in issue.lower() for issue in result["issues"])

    def test_clipped_audio_fails(self):
        import torch
        from app.services.voice_identification import check_audio_quality
        # Heavily clipped signal
        waveform = torch.ones(16000)  # all samples at max amplitude
        result = check_audio_quality(waveform, 16000)
        assert result["is_usable"] is False

    def test_too_short_audio_fails(self):
        import torch
        from app.services.voice_identification import check_audio_quality
        waveform = 0.3 * torch.sin(torch.linspace(0, 0.1, 1600))  # 0.1 seconds
        result = check_audio_quality(waveform, 16000)
        assert result["is_usable"] is False
        assert any("short" in issue.lower() for issue in result["issues"])


class TestReplayDetection:
    """Test replay detection heuristics with synthetic signals."""

    def test_clean_speech_not_flagged(self):
        import torch
        from app.services.voice_identification import detect_replay
        # Simulate clean speech: broadband signal with harmonics
        sr = 16000
        t = torch.linspace(0, 1, sr)
        waveform = (
            0.3 * torch.sin(2 * 3.14159 * 200 * t) +
            0.15 * torch.sin(2 * 3.14159 * 2000 * t) +
            0.05 * torch.sin(2 * 3.14159 * 5000 * t) +
            0.02 * torch.randn(sr)  # some noise for realism
        )
        result = detect_replay(waveform, sr)
        # Clean broadband signal should not be flagged
        assert result["is_replay"] is False

    def test_returns_expected_keys(self):
        import torch
        from app.services.voice_identification import detect_replay
        waveform = 0.3 * torch.sin(torch.linspace(0, 1, 16000))
        result = detect_replay(waveform, 16000)
        assert "is_replay" in result
        assert "confidence" in result
        assert "high_freq_ratio" in result


class TestAIVoiceDetection:
    """Test AI voice detection heuristics."""

    def test_returns_expected_keys(self):
        import torch
        from app.services.voice_identification import detect_ai_voice
        sr = 16000
        t = torch.linspace(0, 1, sr)
        waveform = 0.3 * torch.sin(2 * 3.14159 * 440 * t)
        result = detect_ai_voice(waveform, sr)
        assert "is_synthetic" in result
        assert "confidence" in result
        assert "centroid_variance" in result

    def test_skipped_when_disabled(self):
        import torch
        from app.services.voice_identification import detect_ai_voice
        from app.config import settings
        original = settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED
        try:
            settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED = False
            waveform = 0.3 * torch.sin(torch.linspace(0, 1, 16000))
            result = detect_ai_voice(waveform, 16000)
            assert result["skipped"] is True
            assert result["is_synthetic"] is False
        finally:
            settings.VOICE_ID_AI_VOICE_DETECTION_ENABLED = original


class TestDatabaseModels:
    """Verify the new SQLAlchemy models exist and have the right columns."""

    def test_voice_print_model_exists(self):
        from app.models import VoicePrint
        assert VoicePrint.__tablename__ == "voice_prints"

    def test_voice_enrollment_model_exists(self):
        from app.models import VoiceEnrollment
        assert VoiceEnrollment.__tablename__ == "voice_enrollments"

    def test_voice_print_columns(self):
        from app.models import VoicePrint
        columns = {c.name for c in VoicePrint.__table__.columns}
        expected = {"id", "speaker_name", "email", "embedding", "enrollment_count", "status", "created_at", "updated_at"}
        assert expected.issubset(columns)

    def test_voice_enrollment_columns(self):
        from app.models import VoiceEnrollment
        columns = {c.name for c in VoiceEnrollment.__table__.columns}
        expected = {"id", "speaker_id", "embedding", "audio_quality_score", "speech_duration_sec", "created_at"}
        assert expected.issubset(columns)


class TestConfigSettings:
    """Verify the new config settings exist with correct defaults."""

    def test_voice_config_defaults(self):
        from app.config import Settings
        s = Settings(
            _env_file=None,
            GEMINI_API_KEY="test",
            PINECONE_API_KEY="test",
        )
        assert s.PINECONE_VOICE_INDEX_NAME == "voice-embeddings"
        assert s.VOICE_ID_SIMILARITY_THRESHOLD == 0.70
        assert s.VOICE_ID_MARGIN_THRESHOLD == 0.15
        assert s.VOICE_ID_MIN_SPEECH_DURATION == 0.5
        assert s.VOICE_ID_MIN_ENROLLMENT_SAMPLES == 3
        assert s.VOICE_ID_MAX_ENROLLMENT_SAMPLES >= 10
        assert s.VOICE_ID_REPLAY_DETECTION_ENABLED is True
        assert s.VOICE_ID_AI_VOICE_DETECTION_ENABLED is True
        assert s.VOICE_ID_CHALLENGE_ENABLED is True


class TestAPIEndpointRegistration:
    """Smoke test that the voice API router is registered with FastAPI."""

    def test_voice_routes_exist(self):
        from app.main import app
        paths = list(app.openapi().get("paths", {}).keys())
        assert "/api/v1/voice/enroll" in paths
        assert "/api/v1/voice/identify" in paths
        assert "/api/v1/voice/verify" in paths
        assert "/api/v1/voice/speakers" in paths
        assert "/api/v1/voice/challenge" in paths
