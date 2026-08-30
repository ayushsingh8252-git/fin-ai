"""Tests for Streaming Voice Inference Session."""
import pytest
import torch
import numpy as np

from app.services.voice_streaming import StreamingVoiceSession


class TestVoiceStreaming:
    def test_streaming_session_lifecycle(self):
        session = StreamingVoiceSession(min_speech_seconds=1.0)
        assert session.current_confidence == "accumulating"
        assert session.total_speech_seconds == 0.0

        # Feed 10 chunks of 100ms
        sr = 16000
        chunk_len = int(0.1 * sr)
        for i in range(10):
            chunk = 0.2 * np.sin(2 * np.pi * 300 * np.linspace(0, 0.1, chunk_len)) + 0.05 * np.random.randn(chunk_len)
            res = session.process_chunk(chunk, sample_rate=sr)
            assert res["session_id"] == session.session_id

        assert session.total_received_seconds == pytest.approx(1.0, 0.01)
        assert session.current_confidence in ["preliminary", "strong", "final", "accumulating"]

    def test_streaming_status(self):
        session = StreamingVoiceSession()
        status = session.get_current_status()
        assert "session_id" in status
        assert "confidence_stage" in status
        assert status["is_finalized"] is False
