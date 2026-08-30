"""Local Voice Inference Subsystem.

Enables on-device / local edge speaker feature extraction:
Audio -> Local VAD -> Quality Gate -> Local ONNX/INT8 ECAPA -> 192-dim Embedding

Security Guarantees:
- Raw audio never leaves the client when local inference is active.
- Server-side credentials (e.g. Pinecone API keys) are NEVER sent to the client.
"""
from __future__ import annotations

import os
import logging
from typing import Dict, Any, List, Optional, Union
import torch
import numpy as np

from .voice_encoder import get_speaker_encoder, SpeakerEncoder
from ..config import settings

logger = logging.getLogger("voice_local")


class LocalVoiceProcessor:
    """Processes audio locally on edge device or client session to extract voiceprint embeddings."""

    def __init__(
        self,
        encoder_backend: Optional[str] = None,
        min_speech_duration: float = 0.5,
    ):
        backend = encoder_backend or getattr(settings, "VOICE_INFERENCE_BACKEND", "onnx")
        self.encoder: SpeakerEncoder = get_speaker_encoder(backend)
        self.min_speech_duration = min_speech_duration

    def process_local_audio(
        self,
        waveform: torch.Tensor,
        sample_rate: int = 16000,
    ) -> Dict[str, Any]:
        """Runs local VAD, quality gate, and on-device embedding extraction."""
        from .voice_identification import run_vad, check_audio_quality

        if waveform.dim() > 1:
            waveform = waveform.mean(dim=0)

        # 1. Local VAD
        speech_waveform, speech_duration = run_vad(waveform, sample_rate)
        if speech_duration < self.min_speech_duration:
            return {
                "success": False,
                "error": f"Insufficient speech detected: {speech_duration:.2f}s (need >= {self.min_speech_duration}s)",
                "speech_duration": round(speech_duration, 2),
            }

        # 2. Local Quality check
        quality = check_audio_quality(speech_waveform, 16000)
        if not quality.get("is_usable"):
            return {
                "success": False,
                "error": f"Audio quality too low: {'; '.join(quality.get('issues', []))}",
                "quality": quality,
            }

        # 3. Local embedding extraction
        embedding = self.encoder.embed(speech_waveform, sample_rate=16000)

        return {
            "success": True,
            "embedding": embedding,
            "embedding_dim": len(embedding),
            "speech_duration": round(speech_duration, 2),
            "quality": quality,
            "backend": self.encoder.backend_name,
        }


_global_local_processor = None


def get_local_voice_processor() -> LocalVoiceProcessor:
    global _global_local_processor
    if _global_local_processor is None:
        _global_local_processor = LocalVoiceProcessor()
    return _global_local_processor
