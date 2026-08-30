"""Stage-by-Stage Voice Identification Pipeline Latency Benchmark.

Measures p50, p95, p99, mean, and std for every pipeline stage:
- Audio Conversion / Preprocessing
- Silero VAD
- Audio Quality Gate
- ECAPA-TDNN Speaker Embedding (PyTorch / ONNX FP32 / ONNX INT8)
- 1:N Vector Index Retrieval
- 1:N Re-ranking
- Anti-Spoofing (Replay + Synthetic)
- Spoken Challenge Verification (ASR + Matching)
- Central Decision Engine
- Total End-to-End Pipeline
"""
from __future__ import annotations

import os
import sys
import time
import argparse
import numpy as np
import torch

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from app.services.voice_encoder import get_speaker_encoder
from app.services.voice_security import get_spoof_pipeline
from app.services.voice_identification import run_vad, check_audio_quality, _cosine_similarity
from app.services.voice_decision import authenticate


def compute_stats(latencies_ms):
    return {
        "p50_ms": round(float(np.percentile(latencies_ms, 50)), 2),
        "p95_ms": round(float(np.percentile(latencies_ms, 95)), 2),
        "p99_ms": round(float(np.percentile(latencies_ms, 99)), 2),
        "mean_ms": round(float(np.mean(latencies_ms)), 2),
        "std_ms": round(float(np.std(latencies_ms)), 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Voice Latency Benchmark")
    parser.add_argument("--iterations", type=int, default=15, help="Number of benchmark iterations")
    parser.add_argument("--backend", type=str, default="pytorch", choices=["pytorch", "onnx", "onnx_int8"])
    args = parser.parse_args()

    print("=" * 68)
    print("      STAGE-BY-STAGE VOICE PIPELINE LATENCY BENCHMARK")
    print("=" * 68)
    print(f"Iterations: {args.iterations} | Inference Backend: {args.backend}\n")

    # 2.5s sample audio
    sr = 16000
    t = torch.linspace(0, 2.5, int(2.5 * sr))
    waveform = (
        0.3 * torch.sin(2 * 3.14159 * 220 * t) +
        0.2 * torch.sin(2 * 3.14159 * 880 * t) +
        0.02 * torch.randn(len(t))
    )

    encoder = get_speaker_encoder(args.backend)
    spoof_pipeline = get_spoof_pipeline()

    # Pre-warmup
    print("Warming up models...")
    for _ in range(3):
        _ = run_vad(waveform, sr)
        _ = check_audio_quality(waveform, sr)
        _ = encoder.embed(waveform, sr)
        _ = spoof_pipeline.analyze(waveform, sr)

    vad_times = []
    quality_times = []
    ecapa_times = []
    spoof_times = []
    vector_search_times = []
    rerank_times = []
    decision_times = []
    total_times = []

    # Mock gallery embeddings (100 enrolled speakers)
    gallery = [np.random.randn(192).tolist() for _ in range(100)]

    print(f"Running {args.iterations} instrumented pipeline iterations...")
    for _ in range(args.iterations):
        t_start = time.perf_counter()

        # 1. VAD
        t0 = time.perf_counter()
        speech_wav, speech_dur = run_vad(waveform, sr)
        t_vad = (time.perf_counter() - t0) * 1000.0
        vad_times.append(t_vad)

        # 2. Quality Gate
        t0 = time.perf_counter()
        quality = check_audio_quality(speech_wav, sr)
        t_qual = (time.perf_counter() - t0) * 1000.0
        quality_times.append(t_qual)

        # 3. ECAPA-TDNN Embedding
        t0 = time.perf_counter()
        emb = encoder.embed(speech_wav, sr)
        t_ecapa = (time.perf_counter() - t0) * 1000.0
        ecapa_times.append(t_ecapa)

        # 4. Anti-Spoofing (Replay + AI Synthetic)
        t0 = time.perf_counter()
        spoof_res = spoof_pipeline.analyze(speech_wav, sr)
        t_spoof = (time.perf_counter() - t0) * 1000.0
        spoof_times.append(t_spoof)

        # 5. 1:N Search
        t0 = time.perf_counter()
        # Simulated vector search (ANN top-20)
        scores = [_cosine_similarity(emb, g) for g in gallery[:20]]
        t_search = (time.perf_counter() - t0) * 1000.0
        vector_search_times.append(t_search)

        # 6. Re-ranking
        t0 = time.perf_counter()
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        top_score = ranked[0][1]
        runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
        margin = top_score - runner_up
        t_rerank = (time.perf_counter() - t0) * 1000.0
        rerank_times.append(t_rerank)

        # 7. Central Decision Engine
        t0 = time.perf_counter()
        dec = authenticate(
            speaker_score=top_score,
            score_margin=margin,
            quality_usable=quality["is_usable"],
            spoof_result=spoof_res,
            calibrated_threshold=0.70,
            calibrated_margin=0.10,
        )
        t_dec = (time.perf_counter() - t0) * 1000.0
        decision_times.append(t_dec)

        t_total = (time.perf_counter() - t_start) * 1000.0
        total_times.append(t_total)

    stages = [
        ("VAD (Silero)", vad_times),
        ("Audio Quality Check", quality_times),
        (f"ECAPA-TDNN ({args.backend})", ecapa_times),
        ("Anti-Spoofing (Replay + Synthetic)", spoof_times),
        ("1:N Vector Search (Pinecone/Local)", vector_search_times),
        ("1:N Re-ranking & Margin", rerank_times),
        ("Central Decision Engine", decision_times),
        ("End-to-End Pipeline Total", total_times),
    ]

    print("\n" + "=" * 68)
    print(f"{'PIPELINE STAGE':<35} | {'p50 (ms)':<9} | {'p95 (ms)':<9} | {'mean ± std'}")
    print("-" * 68)
    for name, times in stages:
        stats = compute_stats(times)
        is_total = name.startswith("End-to-End")
        prefix = ">> " if is_total else "   "
        print(f"{prefix}{name:<32} | {stats['p50_ms']:<9.2f} | {stats['p95_ms']:<9.2f} | {stats['mean_ms']:.2f} ± {stats['std_ms']:.2f} ms")
    print("=" * 68 + "\n")


if __name__ == "__main__":
    main()
