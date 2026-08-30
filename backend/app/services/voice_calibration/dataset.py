"""Dataset and Trial Generation for Voice Calibration."""
from __future__ import annotations

import os
import glob
import random
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
import numpy as np


@dataclass
class CalibrationSample:
    speaker_id: str
    sample_id: str
    audio_path: Optional[str] = None
    embedding: Optional[List[float]] = None
    sample_type: str = "verification"  # 'enrollment' or 'verification'
    condition: str = "clean"           # 'clean', 'noisy', 'replayed', etc.


@dataclass
class TrialPair:
    sample_a: CalibrationSample
    sample_b: CalibrationSample
    is_genuine: bool


class CalibrationDataset:
    """Manages audio samples and generates genuine and impostor trial pairs."""

    def __init__(self, dataset_name: str = "voice_benchmark_v1"):
        self.dataset_name = dataset_name
        self.samples_by_speaker: Dict[str, List[CalibrationSample]] = {}
        self.unknown_samples: List[CalibrationSample] = []

    def add_sample(self, sample: CalibrationSample, is_enrolled: bool = True) -> None:
        if is_enrolled:
            if sample.speaker_id not in self.samples_by_speaker:
                self.samples_by_speaker[sample.speaker_id] = []
            self.samples_by_speaker[sample.speaker_id].append(sample)
        else:
            self.unknown_samples.append(sample)

    @property
    def speaker_ids(self) -> List[str]:
        return list(self.samples_by_speaker.keys())

    @property
    def num_speakers(self) -> int:
        return len(self.samples_by_speaker)

    @property
    def total_enrolled_samples(self) -> int:
        return sum(len(samples) for samples in self.samples_by_speaker.values())

    @classmethod
    def from_directory(cls, base_dir: str) -> CalibrationDataset:
        """Loads dataset from structure:
        base_dir/
            speaker_001/
                enrollment/*.wav
                verification/*.wav
            speaker_002/
                ...
            unknown/
                *.wav
        """
        dataset = cls(dataset_name=os.path.basename(base_dir))
        if not os.path.exists(base_dir):
            return dataset

        for entry in os.scandir(base_dir):
            if not entry.is_dir():
                continue
            speaker_id = entry.name
            if speaker_id.lower() == "unknown":
                # Unknown speakers for rejection tests
                for wav in glob.glob(os.path.join(entry.path, "**", "*.wav"), recursive=True):
                    sample = CalibrationSample(
                        speaker_id="unknown_" + os.path.splitext(os.path.basename(wav))[0],
                        sample_id=os.path.basename(wav),
                        audio_path=wav,
                        sample_type="verification",
                    )
                    dataset.add_sample(sample, is_enrolled=False)
            else:
                for sample_type in ("enrollment", "verification"):
                    type_dir = os.path.join(entry.path, sample_type)
                    if os.path.exists(type_dir):
                        for wav in glob.glob(os.path.join(type_dir, "*.wav")):
                            sample = CalibrationSample(
                                speaker_id=speaker_id,
                                sample_id=f"{speaker_id}_{sample_type}_{os.path.basename(wav)}",
                                audio_path=wav,
                                sample_type=sample_type,
                            )
                            dataset.add_sample(sample, is_enrolled=True)

        return dataset

    @classmethod
    def generate_synthetic_benchmark(
        cls,
        num_speakers: int = 30,
        enrollment_per_speaker: int = 5,
        verification_per_speaker: int = 5,
        num_unknown_speakers: int = 10,
        embedding_dim: int = 192,
        seed: int = 42,
    ) -> CalibrationDataset:
        """Generates realistic synthetic 192-dim speaker embeddings for testing & calibration benchmarks."""
        rng = np.random.RandomState(seed)
        dataset = cls(dataset_name=f"synthetic_benchmark_{num_speakers}spk")

        # Generate base centroids for known speakers
        for s_idx in range(num_speakers):
            speaker_id = f"speaker_{s_idx+1:03d}"
            base_centroid = rng.randn(embedding_dim)
            base_centroid /= np.linalg.norm(base_centroid)

            # Enrollment samples (intra-speaker variation ~ std=0.08)
            for e_idx in range(enrollment_per_speaker):
                noise = rng.randn(embedding_dim) * 0.08
                emb = base_centroid + noise
                emb /= np.linalg.norm(emb)
                sample = CalibrationSample(
                    speaker_id=speaker_id,
                    sample_id=f"{speaker_id}_enr_{e_idx+1:02d}",
                    embedding=emb.tolist(),
                    sample_type="enrollment",
                )
                dataset.add_sample(sample, is_enrolled=True)

            # Verification samples (intra-speaker variation ~ std=0.10)
            for v_idx in range(verification_per_speaker):
                noise = rng.randn(embedding_dim) * 0.10
                emb = base_centroid + noise
                emb /= np.linalg.norm(emb)
                sample = CalibrationSample(
                    speaker_id=speaker_id,
                    sample_id=f"{speaker_id}_ver_{v_idx+1:02d}",
                    embedding=emb.tolist(),
                    sample_type="verification",
                )
                dataset.add_sample(sample, is_enrolled=True)

        # Unknown speakers (for unknown rejection testing)
        for u_idx in range(num_unknown_speakers):
            speaker_id = f"unknown_{u_idx+1:03d}"
            base_centroid = rng.randn(embedding_dim)
            base_centroid /= np.linalg.norm(base_centroid)
            for v_idx in range(verification_per_speaker):
                noise = rng.randn(embedding_dim) * 0.10
                emb = base_centroid + noise
                emb /= np.linalg.norm(emb)
                sample = CalibrationSample(
                    speaker_id=speaker_id,
                    sample_id=f"{speaker_id}_ver_{v_idx+1:02d}",
                    embedding=emb.tolist(),
                    sample_type="verification",
                )
                dataset.add_sample(sample, is_enrolled=False)

        return dataset

    def generate_trials(
        self,
        max_impostors_per_genuine: int = 10,
        seed: int = 42,
    ) -> Tuple[List[TrialPair], List[TrialPair]]:
        """Generates genuine and impostor trial pairs:
        Genuine: enrollment(A) -> verification(A)
        Impostor: enrollment(A) -> verification(B)
        """
        rng = random.Random(seed)
        genuine_trials: List[TrialPair] = []
        impostor_trials: List[TrialPair] = []

        speakers = list(self.samples_by_speaker.keys())

        # Genuine trials
        for spk, samples in self.samples_by_speaker.items():
            enr_samples = [s for s in samples if s.sample_type == "enrollment"] or samples[:len(samples)//2]
            ver_samples = [s for s in samples if s.sample_type == "verification"] or samples[len(samples)//2:]
            if not enr_samples or not ver_samples:
                continue

            for enr in enr_samples:
                for ver in ver_samples:
                    if enr.sample_id != ver.sample_id:
                        genuine_trials.append(TrialPair(sample_a=enr, sample_b=ver, is_genuine=True))

        # Impostor trials
        for i, spk_a in enumerate(speakers):
            enr_a = [s for s in self.samples_by_speaker[spk_a] if s.sample_type == "enrollment"] or self.samples_by_speaker[spk_a]
            other_speakers = [s for s in speakers if s != spk_a]
            if not other_speakers:
                continue

            for enr in enr_a:
                # Sample negative speakers
                sampled_others = rng.sample(other_speakers, min(len(other_speakers), max_impostors_per_genuine))
                for spk_b in sampled_others:
                    ver_b = [s for s in self.samples_by_speaker[spk_b] if s.sample_type == "verification"] or self.samples_by_speaker[spk_b]
                    for ver in ver_b[:2]:  # take up to 2 samples per negative speaker
                        impostor_trials.append(TrialPair(sample_a=enr, sample_b=ver, is_genuine=False))

        return genuine_trials, impostor_trials
