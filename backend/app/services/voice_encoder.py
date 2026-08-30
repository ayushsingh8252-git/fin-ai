"""Speaker Encoder Runtime Abstraction.

Supports pluggable backends:
- PyTorch (SpeechBrain ECAPA-TDNN)
- ONNX FP32 (ONNX Runtime)
- ONNX INT8 (Quantized ONNX Runtime)
"""
from __future__ import annotations

import os
import threading
import logging
from abc import ABC, abstractmethod
from typing import List, Optional, Union
import numpy as np
import torch
import speechbrain.utils.fetching as fetching

from ..config import settings

logger = logging.getLogger("voice_encoder")

ONNX_FP32_PATH = os.path.join("models", "onnx", "ecapa.onnx")
ONNX_INT8_PATH = os.path.join("models", "onnx", "ecapa_int8.onnx")


class SpeakerEncoder(ABC):
    """Abstract speaker encoder producing 192-dimensional embeddings."""

    @property
    @abstractmethod
    def backend_name(self) -> str:
        pass

    @abstractmethod
    def embed(self, waveform: torch.Tensor, sample_rate: int = 16000) -> List[float]:
        """Extract a 192-dim speaker embedding vector from a speech waveform."""
        pass


class PyTorchSpeakerEncoder(SpeakerEncoder):
    """PyTorch / SpeechBrain ECAPA-TDNN backend."""

    def __init__(self):
        self._model = None
        self._lock = threading.Lock()

    @property
    def backend_name(self) -> str:
        return "pytorch"

    def _get_model(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from speechbrain.inference.speaker import EncoderClassifier
                    logger.info("Loading PyTorch ECAPA-TDNN speaker encoder...")
                    self._model = EncoderClassifier.from_hparams(
                        source="speechbrain/spkrec-ecapa-voxceleb",
                        savedir=".cache/speechbrain/spkrec-ecapa-voxceleb",
                        run_opts={"device": "cpu"},
                        local_strategy=fetching.LocalStrategy.COPY,
                    )
                    logger.info("PyTorch ECAPA-TDNN loaded.")
        return self._model

    def embed(self, waveform: torch.Tensor, sample_rate: int = 16000) -> List[float]:
        model = self._get_model()
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)
        with self._lock:
            emb = model.encode_batch(waveform)
        # [1, 1, 192] -> [192]
        return emb.squeeze().detach().cpu().numpy().tolist()


class ONNXSpeakerEncoder(SpeakerEncoder):
    """ONNX Runtime FP32 speaker encoder backend."""

    def __init__(self, model_path: str = ONNX_FP32_PATH):
        self.model_path = model_path
        self._session = None
        self._lock = threading.Lock()

    @property
    def backend_name(self) -> str:
        return "onnx"

    def _get_session(self):
        if self._session is None:
            with self._lock:
                if self._session is None:
                    import onnxruntime as ort
                    if not os.path.exists(self.model_path):
                        logger.info("ONNX model %s missing. Exporting from PyTorch...", self.model_path)
                        from scripts.export_voice_model import export_ecapa_onnx
                        export_ecapa_onnx(self.model_path)

                    opts = ort.SessionOptions()
                    opts.intra_op_num_threads = 2
                    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                    self._session = ort.InferenceSession(self.model_path, sess_options=opts, providers=["CPUExecutionProvider"])
                    logger.info("ONNX Runtime session initialized for %s", self.model_path)
        return self._session

    def embed(self, waveform: torch.Tensor, sample_rate: int = 16000) -> List[float]:
        session = self._get_session()
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)
        wav_np = waveform.detach().cpu().numpy().astype(np.float32)
        wav_lens = np.ones(wav_np.shape[0], dtype=np.float32)

        inputs = {
            session.get_inputs()[0].name: wav_np,
            session.get_inputs()[1].name: wav_lens,
        }
        with self._lock:
            outputs = session.run(None, inputs)

        # Output shape: [batch, 192] or [batch, 1, 192]
        emb = np.squeeze(outputs[0])
        return emb.tolist()


class QuantizedONNXSpeakerEncoder(SpeakerEncoder):
    """Quantized ONNX Runtime INT8 speaker encoder backend."""

    def __init__(self, model_path: str = ONNX_INT8_PATH):
        self.model_path = model_path
        self._session = None
        self._lock = threading.Lock()

    @property
    def backend_name(self) -> str:
        return "onnx_int8"

    def _get_session(self):
        if self._session is None:
            with self._lock:
                if self._session is None:
                    import onnxruntime as ort
                    if not os.path.exists(self.model_path):
                        logger.info("INT8 ONNX model %s missing. Quantizing from FP32...", self.model_path)
                        from scripts.quantize_voice_model import quantize_ecapa
                        quantize_ecapa(ONNX_FP32_PATH, self.model_path)

                    opts = ort.SessionOptions()
                    opts.intra_op_num_threads = 2
                    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                    self._session = ort.InferenceSession(self.model_path, sess_options=opts, providers=["CPUExecutionProvider"])
                    logger.info("Quantized INT8 ONNX Runtime session initialized for %s", self.model_path)
        return self._session

    def embed(self, waveform: torch.Tensor, sample_rate: int = 16000) -> List[float]:
        session = self._get_session()
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)
        wav_np = waveform.detach().cpu().numpy().astype(np.float32)
        wav_lens = np.ones(wav_np.shape[0], dtype=np.float32)

        inputs = {
            session.get_inputs()[0].name: wav_np,
            session.get_inputs()[1].name: wav_lens,
        }
        with self._lock:
            outputs = session.run(None, inputs)

        emb = np.squeeze(outputs[0])
        return emb.tolist()


_encoders: dict[str, SpeakerEncoder] = {}
_encoder_lock = threading.Lock()


def get_speaker_encoder(backend: Optional[str] = None) -> SpeakerEncoder:
    """Factory to get singleton speaker encoder instance based on configuration."""
    backend_key = (backend or getattr(settings, "VOICE_INFERENCE_BACKEND", "pytorch")).lower()

    if backend_key not in _encoders:
        with _encoder_lock:
            if backend_key not in _encoders:
                if backend_key in ("onnx", "onnx_fp32"):
                    _encoders[backend_key] = ONNXSpeakerEncoder()
                elif backend_key in ("onnx_int8", "int8"):
                    _encoders[backend_key] = QuantizedONNXSpeakerEncoder()
                else:
                    _encoders[backend_key] = PyTorchSpeakerEncoder()
    return _encoders[backend_key]
