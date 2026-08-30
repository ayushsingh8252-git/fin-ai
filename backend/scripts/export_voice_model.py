"""Export SpeechBrain ECAPA-TDNN model to ONNX format.

Usage:
    python -m scripts.export_voice_model [--output models/onnx/ecapa.onnx]
"""
from __future__ import annotations

import os
import sys

# Ensure UTF-8 stdout on Windows console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import argparse
import torch
import torch.nn as nn
import speechbrain.utils.fetching as fetching
from speechbrain.inference.speaker import EncoderClassifier


class ECAPATDNNWrapper(nn.Module):
    """Wrapper Module combining feature extraction, norm, and ECAPA-TDNN embedding for ONNX export."""

    def __init__(self, classifier: EncoderClassifier):
        super().__init__()
        self.compute_features = classifier.mods.compute_features
        self.mean_var_norm = classifier.mods.mean_var_norm
        self.embedding_model = classifier.mods.embedding_model

    def forward(self, wavs: torch.Tensor, wav_lens: torch.Tensor = None) -> torch.Tensor:
        # wavs: [batch, time]
        if wav_lens is None:
            wav_lens = torch.ones(wavs.shape[0], device=wavs.device)

        feats = self.compute_features(wavs)
        feats = self.mean_var_norm(feats, wav_lens)
        embeddings = self.embedding_model(feats, wav_lens)
        # Squeeze out extra dim: [batch, 1, 192] -> [batch, 192]
        return embeddings.squeeze(1)


def export_ecapa_onnx(output_path: str = "models/onnx/ecapa.onnx") -> str:
    print("Loading SpeechBrain ECAPA-TDNN model...")
    classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=".cache/speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"},
        local_strategy=fetching.LocalStrategy.COPY,
    )
    classifier.eval()

    wrapper = ECAPATDNNWrapper(classifier)
    wrapper.eval()

    # Dummy input: 2 seconds of 16kHz audio
    dummy_wav = torch.randn(1, 32000)
    dummy_lens = torch.tensor([1.0])

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    print(f"Exporting ONNX model to: {output_path}...")
    torch.onnx.export(
        wrapper,
        (dummy_wav, dummy_lens),
        output_path,
        export_params=True,
        opset_version=18,
        do_constant_folding=True,
        input_names=["waveform", "wav_lens"],
        output_names=["embedding"],
        dynamic_axes={
            "waveform": {0: "batch_size", 1: "time"},
            "wav_lens": {0: "batch_size"},
            "embedding": {0: "batch_size"},
        },
    )

    print(f"Successfully exported ECAPA-TDNN ONNX model to {output_path} (Size: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB)")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Export ECAPA-TDNN model to ONNX")
    parser.add_argument("--output", type=str, default="models/onnx/ecapa.onnx", help="Path to save ONNX model")
    args = parser.parse_args()

    export_ecapa_onnx(args.output)


if __name__ == "__main__":
    main()
