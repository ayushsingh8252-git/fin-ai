"""Compare PyTorch, ONNX, and INT8 Inference Backends.

Usage:
    python -m scripts.compare_inference
"""
from __future__ import annotations

import time
import torch
import numpy as np

from app.services.voice_encoder import get_speaker_encoder
from app.services.voice_calibration.scoring import cosine_similarity


def benchmark_encoder(encoder, waveform, num_warmup: int = 3, num_trials: int = 15):
    # Warmup
    for _ in range(num_warmup):
        _ = encoder.embed(waveform)

    times = []
    emb = None
    for _ in range(num_trials):
        t0 = time.perf_counter()
        emb = encoder.embed(waveform)
        t1 = time.perf_counter()
        times.append((t1 - t0) * 1000.0)

    avg_ms = float(np.mean(times))
    std_ms = float(np.std(times))
    p95_ms = float(np.percentile(times, 95))
    return emb, avg_ms, std_ms, p95_ms


def main():
    print("=" * 65)
    print("      VOICE SPEAKER ENCODER BACKEND INFERENCE COMPARISON")
    print("=" * 65)

    # 2.5 seconds of simulated 16kHz speech waveform
    sr = 16000
    t = torch.linspace(0, 2.5, int(2.5 * sr))
    waveform = (
        0.3 * torch.sin(2 * 3.14159 * 220 * t) +
        0.2 * torch.sin(2 * 3.14159 * 880 * t) +
        0.1 * torch.sin(2 * 3.14159 * 2500 * t) +
        0.02 * torch.randn(len(t))
    )

    print("Benchmarking PyTorch baseline...")
    pytorch_encoder = get_speaker_encoder("pytorch")
    emb_pt, pt_avg, pt_std, pt_p95 = benchmark_encoder(pytorch_encoder, waveform)

    print("Benchmarking ONNX FP32...")
    onnx_encoder = get_speaker_encoder("onnx")
    emb_onnx, onnx_avg, onnx_std, onnx_p95 = benchmark_encoder(onnx_encoder, waveform)

    print("Benchmarking ONNX INT8...")
    int8_encoder = get_speaker_encoder("onnx_int8")
    emb_int8, int8_avg, int8_std, int8_p95 = benchmark_encoder(int8_encoder, waveform)

    # Similarities
    sim_pt_onnx = cosine_similarity(emb_pt, emb_onnx)
    sim_pt_int8 = cosine_similarity(emb_pt, emb_int8)
    sim_onnx_int8 = cosine_similarity(emb_onnx, emb_int8)

    print("\n" + "=" * 65)
    print("                    INFERENCE REPORT")
    print("=" * 65)
    print("Embedding Cosine Similarities (Alignment to Baseline):")
    print(f"  PyTorch vs ONNX FP32:      {sim_pt_onnx:.6f}")
    print(f"  PyTorch vs ONNX INT8:      {sim_pt_int8:.6f}")
    print(f"  ONNX FP32 vs ONNX INT8:    {sim_onnx_int8:.6f}")
    print("-" * 65)
    print("Latency Benchmark (2.5s speech input):")
    print(f"  PyTorch Baseline:          {pt_avg:.2f} ms  (std: {pt_std:.2f} ms, p95: {pt_p95:.2f} ms)")
    print(f"  ONNX FP32:                 {onnx_avg:.2f} ms  (std: {onnx_std:.2f} ms, p95: {onnx_p95:.2f} ms) -> Speedup: {pt_avg / max(onnx_avg, 1e-3):.2f}x")
    print(f"  ONNX INT8:                 {int8_avg:.2f} ms  (std: {int8_std:.2f} ms, p95: {int8_p95:.2f} ms) -> Speedup: {pt_avg / max(int8_avg, 1e-3):.2f}x")
    print("=" * 65)


if __name__ == "__main__":
    main()
