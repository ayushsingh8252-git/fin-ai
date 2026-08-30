"""Streaming and Incremental Voice Inference Service.

Processes 20-100ms audio chunks progressively:
Chunk -> VAD -> Rolling Speech Buffer -> Speaker Embedding -> Score -> Confidence Update

Confidence Stages:
- <1.5s speech: Insufficient speech (accumulating)
- 1.5s speech: Preliminary score
- 2.0s speech: Strong score
- >=2.5s speech: Final score
"""
from __future__ import annotations

import time
import uuid
import logging
from typing import Dict, Any, List, Optional
import torch
import numpy as np

from .voice_encoder import get_speaker_encoder, SpeakerEncoder
from .voice_security import get_spoof_pipeline
from .voice_score import VoiceScoreNormalizer
from .voice_calibration.scoring import cosine_similarity
from .voice_calibration.calibrator import get_voice_calibrator
from ..config import settings

logger = logging.getLogger("voice_streaming")


class StreamingVoiceSession:
    """Maintains active streaming state for a live audio session."""

    def __init__(
        self,
        session_id: Optional[str] = None,
        target_speaker_id: Optional[str] = None,
        min_speech_seconds: float = 1.5,
        early_exit_confidence: float = 0.88,
        backend: Optional[str] = None,
    ):
        self.session_id = session_id or str(uuid.uuid4())
        self.target_speaker_id = target_speaker_id
        self.min_speech_seconds = min_speech_seconds
        self.early_exit_confidence = early_exit_confidence

        self.encoder: SpeakerEncoder = get_speaker_encoder(backend)
        self.calibrator = get_voice_calibrator()
        self.normalizer = self.calibrator.normalizer or VoiceScoreNormalizer()

        self.audio_buffer: List[float] = []
        self.speech_buffer: List[float] = []
        self.total_received_seconds: float = 0.0
        self.total_speech_seconds: float = 0.0
        self.chunk_count: int = 0

        self.current_embedding: Optional[List[float]] = None
        self.current_score: float = 0.0
        self.current_confidence: str = "accumulating"  # 'accumulating', 'preliminary', 'strong', 'final'
        self.is_finalized: bool = False
        self.start_time: float = time.time()

    def process_chunk(
        self,
        chunk: Union[bytes, np.ndarray, torch.Tensor, List[float]],
        sample_rate: int = 16000,
        db=None,
    ) -> Dict[str, Any]:
        """Processes an incoming 20-100ms chunk of audio."""
        if self.is_finalized:
            return self.get_current_status()

        # Convert chunk to float tensor [-1.0, 1.0]
        if isinstance(chunk, bytes):
            # Assume 16-bit PCM mono
            arr = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
            wav_tensor = torch.from_numpy(arr)
        elif isinstance(chunk, (list, tuple)):
            wav_tensor = torch.tensor(chunk, dtype=torch.float32)
        elif isinstance(chunk, np.ndarray):
            wav_tensor = torch.from_numpy(chunk.astype(np.float32))
        else:
            wav_tensor = chunk.float()

        if wav_tensor.dim() > 1:
            wav_tensor = wav_tensor.mean(dim=0)

        chunk_duration = len(wav_tensor) / sample_rate
        self.total_received_seconds += chunk_duration
        self.chunk_count += 1
        self.audio_buffer.extend(wav_tensor.tolist())

        # Simple energy/VAD check on chunk
        rms = float(torch.sqrt(torch.mean(wav_tensor ** 2)))
        if rms > 0.008:
            self.speech_buffer.extend(wav_tensor.tolist())
            self.total_speech_seconds = len(self.speech_buffer) / sample_rate

        # Update confidence stage
        if self.total_speech_seconds < self.min_speech_seconds:
            self.current_confidence = "accumulating"
        elif self.total_speech_seconds < 2.0:
            self.current_confidence = "preliminary"
        elif self.total_speech_seconds < 2.5:
            self.current_confidence = "strong"
        else:
            self.current_confidence = "final"

        # If we have enough speech, compute intermediate embedding and score
        if self.total_speech_seconds >= self.min_speech_seconds:
            speech_tensor = torch.tensor(self.speech_buffer, dtype=torch.float32)
            self.current_embedding = self.encoder.embed(speech_tensor, sample_rate=sample_rate)

            # Score against target speaker if provided
            if self.target_speaker_id and db:
                from ..models import VoicePrint
                vp = db.query(VoicePrint).filter(VoicePrint.id == self.target_speaker_id).first()
                if vp and vp.embedding:
                    self.current_score = cosine_similarity(self.current_embedding, vp.embedding)

        # Check early exit conditions
        thresh = getattr(settings, "VOICE_ID_SIMILARITY_THRESHOLD", 0.70)
        can_early_exit = (
            self.current_confidence in ("strong", "final") and
            self.current_score >= thresh + 0.10 and
            self.total_speech_seconds >= 2.0
        )

        return {
            "session_id": self.session_id,
            "status": "active" if not can_early_exit else "ready_for_early_exit",
            "chunk_count": self.chunk_count,
            "received_seconds": round(self.total_received_seconds, 3),
            "speech_seconds": round(self.total_speech_seconds, 3),
            "confidence_stage": self.current_confidence,
            "current_score": round(self.current_score, 4),
            "can_early_exit": can_early_exit,
        }

    def get_current_status(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "is_finalized": self.is_finalized,
            "speech_seconds": round(self.total_speech_seconds, 3),
            "confidence_stage": self.current_confidence,
            "current_score": round(self.current_score, 4),
            "has_embedding": self.current_embedding is not None,
        }

    def finalize(self, db, challenge_phrase: Optional[str] = None) -> Dict[str, Any]:
        """Finalizes the session and runs full verification / decision engine."""
        self.is_finalized = True

        if len(self.audio_buffer) == 0:
            return {"decision": "error", "message": "No audio received during streaming session."}

        full_waveform = torch.tensor(self.audio_buffer, dtype=torch.float32)
        sample_rate = 16000

        # Run anti-spoofing
        spoof_pipeline = get_spoof_pipeline()
        spoof_res = spoof_pipeline.analyze(full_waveform, sample_rate)

        # Extract final high-quality embedding
        if self.current_embedding is None:
            if len(self.speech_buffer) >= int(0.5 * sample_rate):
                speech_tensor = torch.tensor(self.speech_buffer, dtype=torch.float32)
            else:
                speech_tensor = full_waveform
            self.current_embedding = self.encoder.embed(speech_tensor, sample_rate=sample_rate)

        # Authenticate via central decision engine
        from .voice_decision import authenticate, DecisionType
        from ..models import VoicePrint

        cal_thresh = getattr(self.calibrator.active_calibration, "verification_threshold", settings.VOICE_ID_SIMILARITY_THRESHOLD)
        cal_margin = getattr(self.calibrator.active_calibration, "margin_threshold", settings.VOICE_ID_MARGIN_THRESHOLD)

        if self.target_speaker_id:
            # 1:1 Verification
            vp = db.query(VoicePrint).filter(VoicePrint.id == self.target_speaker_id).first()
            if not vp or not vp.embedding:
                score = 0.0
                speaker_name = None
            else:
                score = cosine_similarity(self.current_embedding, vp.embedding)
                speaker_name = vp.speaker_name

            decision = authenticate(
                speaker_score=score,
                score_margin=0.20,  # 1:1 has no runner up
                quality_usable=(self.total_speech_seconds >= 0.5),
                spoof_result=spoof_res,
                calibrated_threshold=cal_thresh,
                calibrated_margin=cal_margin,
                speaker_id=self.target_speaker_id,
                speaker_name=speaker_name,
            )
        else:
            # 1:N Identification
            from .voice_identification import _local_voice_search
            matches = _local_voice_search(self.current_embedding, db, top_k=5)
            if not matches:
                top_score = 0.0
                margin = 0.0
                top_spk = None
                top_name = None
            else:
                top = matches[0]
                top_score = top["score"]
                runner_up = matches[1]["score"] if len(matches) > 1 else 0.0
                margin = top_score - runner_up
                top_spk = top.get("metadata", {}).get("speaker_id")
                top_name = top.get("metadata", {}).get("speaker_name")

            decision = authenticate(
                speaker_score=top_score,
                score_margin=margin,
                quality_usable=(self.total_speech_seconds >= 0.5),
                spoof_result=spoof_res,
                calibrated_threshold=cal_thresh,
                calibrated_margin=cal_margin,
                speaker_id=top_spk,
                speaker_name=top_name,
            )

        return {
            "session_id": self.session_id,
            "decision": decision.to_dict(),
            "speech_seconds": round(self.total_speech_seconds, 2),
            "total_seconds": round(self.total_received_seconds, 2),
            "backend": self.encoder.backend_name,
        }
