"""Synthetic and AI Deepfake Voice Detector.

Evaluates acoustic & neural synthesis artifacts:
- Frame-to-frame spectral centroid trajectory variance (MFCC trajectory unnatural smoothness)
- Energy variance (low natural amplitude shimmer)
- Zero-crossing rate variance (pitch jitter consistency)
- Pluggable neural countermeasure model interface (ASVspoof models)
"""
from __future__ import annotations

from typing import Any, Dict, Optional
import torch
import numpy as np

from .base import SpoofDetector, SpoofResult, SpoofLabel


class SyntheticDetector(SpoofDetector):
    """Detects AI-generated, synthetic, and voice-cloned speech."""

    def __init__(self, threshold: float = 0.60, countermeasure_model=None):
        self.threshold = threshold
        self.countermeasure_model = countermeasure_model

    def predict(self, waveform: torch.Tensor, sample_rate: int) -> SpoofResult:
        if waveform is None or (isinstance(waveform, torch.Tensor) and waveform.numel() == 0):
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="synthetic_detector",
                details={"reason": "empty_waveform"},
            )

        if waveform.dim() > 1:
            waveform = waveform.mean(dim=0)

        waveform_np = waveform.detach().cpu().numpy()
        if len(waveform_np) < int(0.3 * sample_rate):
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="synthetic_detector",
                details={"reason": "audio_too_short"},
            )

        # Pluggable ASVspoof neural model if provided
        if self.countermeasure_model is not None:
            try:
                cm_score = self.countermeasure_model(waveform, sample_rate)
                is_synth = cm_score >= self.threshold
                return SpoofResult(
                    label=SpoofLabel.SYNTHETIC if is_synth else SpoofLabel.LIVE,
                    score=round(float(cm_score), 4),
                    confidence=round(float(cm_score if is_synth else (1.0 - cm_score)), 4),
                    detector_name="neural_countermeasure",
                    details={"model": "asvspoof_cm"},
                )
            except Exception:
                pass  # Fall back to spectral/temporal baseline

        # Baseline spectral / temporal analysis
        frame_length = int(0.025 * sample_rate)  # 25ms
        hop_length = int(0.010 * sample_rate)    # 10ms

        frame_energies = []
        spectral_centroids = []
        for start in range(0, len(waveform_np) - frame_length, hop_length):
            frame = waveform_np[start:start + frame_length]
            windowed = frame * np.hanning(len(frame))
            fft_mag = np.abs(np.fft.rfft(windowed))

            energy = float(np.sum(fft_mag ** 2))
            frame_energies.append(energy)

            freqs = np.fft.rfftfreq(len(windowed), 1.0 / sample_rate)
            mag_sum = float(np.sum(fft_mag))
            if mag_sum > 1e-10:
                centroid = float(np.sum(freqs * fft_mag) / mag_sum)
                spectral_centroids.append(centroid)

        if len(frame_energies) < 10 or len(spectral_centroids) < 10:
            return SpoofResult(
                label=SpoofLabel.UNKNOWN,
                score=0.0,
                confidence=0.0,
                detector_name="synthetic_detector",
                details={"reason": "too_few_frames"},
            )

        # Variance of spectral centroid diffs
        centroid_diffs = np.diff(spectral_centroids)
        centroid_variance = float(np.var(centroid_diffs))

        # Normalized energy variance
        energy_array = np.array(frame_energies)
        max_energy = np.max(energy_array)
        if max_energy > 1e-10:
            energy_array = energy_array / max_energy
        energy_variance = float(np.var(np.diff(energy_array)))

        # Zero-crossing rate variance
        zcr_per_frame = []
        for start in range(0, len(waveform_np) - frame_length, hop_length):
            frame = waveform_np[start:start + frame_length]
            zcr = float(np.sum(np.abs(np.diff(np.sign(frame)))) / (2 * len(frame)))
            zcr_per_frame.append(zcr)
        zcr_variance = float(np.var(np.diff(zcr_per_frame))) if len(zcr_per_frame) > 1 else 0.0

        # Heuristic scoring
        synthetic_score = 0.0
        if centroid_variance < 500:
            synthetic_score += 0.40
        elif centroid_variance < 2000:
            synthetic_score += 0.20

        if energy_variance < 0.0001:
            synthetic_score += 0.30
        elif energy_variance < 0.001:
            synthetic_score += 0.15

        if zcr_variance < 0.00001:
            synthetic_score += 0.30
        elif zcr_variance < 0.0001:
            synthetic_score += 0.15

        synthetic_score = min(1.0, synthetic_score)
        is_synthetic = synthetic_score >= self.threshold
        label = SpoofLabel.SYNTHETIC if is_synthetic else SpoofLabel.LIVE

        return SpoofResult(
            label=label,
            score=round(synthetic_score, 4),
            confidence=round(synthetic_score if is_synthetic else (1.0 - synthetic_score), 4),
            detector_name="synthetic_detector",
            details={
                "is_synthetic": is_synthetic,
                "centroid_variance": round(centroid_variance, 2),
                "energy_variance": round(energy_variance, 6),
                "zcr_variance": round(zcr_variance, 8),
            },
        )
