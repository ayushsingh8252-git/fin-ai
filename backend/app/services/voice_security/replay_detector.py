"""Replay Attack Detector.

Evaluates acoustic playback artifacts:
- Bandwidth roll-off (loss of high-frequency content above 7kHz)
- Dynamic range compression
- High-frequency spectral flatness (speaker transducer noise floor)
"""
from __future__ import annotations

from typing import Any, Dict
import torch
import numpy as np

from .base import SpoofDetector, SpoofResult, SpoofLabel


class ReplayDetector(SpoofDetector):
    """Detects replayed acoustic speech played through secondary loudspeakers."""

    def __init__(self, threshold: float = 0.60):
        self.threshold = threshold

    def predict(self, waveform: torch.Tensor, sample_rate: int) -> SpoofResult:
        if waveform is None or (isinstance(waveform, torch.Tensor) and waveform.numel() == 0):
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="replay_detector",
                details={"reason": "empty_waveform"},
            )

        if waveform.dim() > 1:
            waveform = waveform.mean(dim=0)

        waveform_np = waveform.detach().cpu().numpy()
        if len(waveform_np) < int(0.2 * sample_rate):
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="replay_detector",
                details={"reason": "audio_too_short"},
            )

        # 1. Spectral bandwidth analysis via FFT
        fft = np.fft.rfft(waveform_np)
        magnitude = np.abs(fft)
        freqs = np.fft.rfftfreq(len(waveform_np), 1.0 / sample_rate)

        total_energy = float(np.sum(magnitude ** 2))
        if total_energy < 1e-10:
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="replay_detector",
                details={"reason": "silent_audio"},
            )

        high_freq_mask = freqs > 7000
        high_freq_energy = float(np.sum(magnitude[high_freq_mask] ** 2))
        high_freq_ratio = high_freq_energy / max(total_energy, 1e-10)

        # 2. Dynamic range (dB)
        rms = float(np.sqrt(np.mean(waveform_np ** 2)))
        peak = float(np.max(np.abs(waveform_np)))
        dynamic_range_db = float(20 * np.log10(peak / max(rms, 1e-10)))

        # 3. Spectral flatness in high frequencies
        high_mag = magnitude[high_freq_mask]
        if len(high_mag) > 0 and np.mean(high_mag) > 0:
            geometric_mean = float(np.exp(np.mean(np.log(high_mag + 1e-10))))
            arithmetic_mean = float(np.mean(high_mag))
            spectral_flatness = geometric_mean / max(arithmetic_mean, 1e-10)
        else:
            spectral_flatness = 0.0

        # Heuristic scoring
        replay_score = 0.0
        if high_freq_ratio < 0.0001:
            replay_score += 0.30
        elif high_freq_ratio < 0.001:
            replay_score += 0.15

        if dynamic_range_db < 3.0:
            replay_score += 0.35
        elif dynamic_range_db < 5.0:
            replay_score += 0.15

        if spectral_flatness > 0.75:
            replay_score += 0.35
        elif spectral_flatness > 0.60:
            replay_score += 0.15

        replay_score = min(1.0, replay_score)
        is_replay = replay_score >= self.threshold
        label = SpoofLabel.REPLAY if is_replay else SpoofLabel.LIVE

        return SpoofResult(
            label=label,
            score=round(replay_score, 4),
            confidence=round(replay_score if is_replay else (1.0 - replay_score), 4),
            detector_name="replay_detector",
            details={
                "is_replay": is_replay,
                "high_freq_ratio": round(high_freq_ratio, 6),
                "dynamic_range_db": round(dynamic_range_db, 2),
                "spectral_flatness": round(spectral_flatness, 4),
            },
        )
