"""Tests for Speaker Encoder Runtimes (PyTorch, ONNX, INT8)."""
import pytest
import torch
import numpy as np

from app.services.voice_encoder import (
    get_speaker_encoder,
    PyTorchSpeakerEncoder,
    ONNXSpeakerEncoder,
    QuantizedONNXSpeakerEncoder,
)
from app.services.voice_calibration.scoring import cosine_similarity


class TestSpeakerEncoder:
    def test_pytorch_encoder(self):
        encoder = get_speaker_encoder("pytorch")
        assert encoder.backend_name == "pytorch"
        wav = torch.randn(1, 16000)
        emb = encoder.embed(wav)
        assert len(emb) == 192
        assert isinstance(emb[0], float)

    def test_onnx_encoder(self):
        encoder = get_speaker_encoder("onnx")
        assert encoder.backend_name == "onnx"
        wav = torch.randn(1, 16000)
        emb = encoder.embed(wav)
        assert len(emb) == 192
        assert isinstance(emb[0], float)

    def test_onnx_int8_encoder(self):
        encoder = get_speaker_encoder("onnx_int8")
        assert encoder.backend_name == "onnx_int8"
        wav = torch.randn(1, 16000)
        emb = encoder.embed(wav)
        assert len(emb) == 192
        assert isinstance(emb[0], float)

    def test_cosine_alignment_across_backends(self):
        sr = 16000
        t = torch.linspace(0, 1.5, int(1.5 * sr))
        wav = 0.3 * torch.sin(2 * 3.14159 * 220 * t) + 0.1 * torch.randn(len(t))

        pt_enc = get_speaker_encoder("pytorch")
        onnx_enc = get_speaker_encoder("onnx")

        emb_pt = pt_enc.embed(wav)
        emb_onnx = onnx_enc.embed(wav)

        sim = cosine_similarity(emb_pt, emb_onnx)
        assert sim > 0.99  # ONNX should match PyTorch within >0.99 cosine similarity
