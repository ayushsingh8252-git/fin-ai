"""CLI for Voice Threshold Calibration.

Usage:
    python -m scripts.calibrate_voice [--data-dir data/voice_benchmark] [--target-far 0.1] [--output models/voice_calibration.json]
"""
import os
import sys
import argparse

from app.services.voice_calibration.dataset import CalibrationDataset
from app.services.voice_calibration.calibrator import VoiceCalibrator, DEFAULT_CALIBRATION_PATH


def main():
    parser = argparse.ArgumentParser(description="Calibrate Voice Biometrics Thresholds")
    parser.add_argument("--data-dir", type=str, default="data/voice_benchmark", help="Path to voice benchmark dataset directory")
    parser.add_argument("--target-far", type=float, default=0.1, help="Target False Acceptance Rate percentage (default: 0.1%)")
    parser.add_argument("--output", type=str, default=DEFAULT_CALIBRATION_PATH, help="Path to save output calibration JSON")
    args = parser.parse_args()

    print("=" * 60)
    print("           VOICE CALIBRATION SUBSYSTEM")
    print("=" * 60)

    if os.path.exists(args.data_dir) and any(os.scandir(args.data_dir)):
        print(f"Loading real benchmark dataset from: {args.data_dir}")
        dataset = CalibrationDataset.from_directory(args.data_dir)
    else:
        print(f"Directory '{args.data_dir}' not found or empty. Using benchmark distribution generator (30 speakers, 5 enr/spk, 5 ver/spk)...")
        dataset = CalibrationDataset.generate_synthetic_benchmark(
            num_speakers=30,
            enrollment_per_speaker=5,
            verification_per_speaker=5,
            num_unknown_speakers=10,
        )

    calibrator = VoiceCalibrator(target_far_percent=args.target_far)
    result = calibrator.calibrate(dataset)
    calibrator.save(args.output)

    print("\n" + "=" * 60)
    print("               VOICE CALIBRATION REPORT")
    print("=" * 60)
    print(f"Speakers:                    {result.num_speakers}")
    print(f"Genuine trials:              {result.num_genuine_trials}")
    print(f"Impostor trials:             {result.num_impostor_trials}")
    print("-" * 60)
    print(f"EER:                         {result.eer_percent:.2f}% (threshold: {result.eer_threshold:.4f})")
    print(f"ROC-AUC:                     {result.roc_auc:.4f}")
    print(f"Operating point target FAR:  {result.target_far_percent:.2f}%")
    print(f"TAR at operating FAR:        {result.tar_at_target_far:.2f}%")
    print("-" * 60)
    print(f"Verification threshold:      {result.verification_threshold:.4f}")
    print(f"Margin threshold (1:N):      {result.margin_threshold:.4f}")
    print(f"Top-1 Accuracy (1:N):        {result.identification_1n_summary.get('top1_accuracy', 0.0):.2f}%")
    print(f"Unknown Rejection (1:N):     {result.identification_1n_summary.get('unknown_rejection_rate', 0.0):.2f}%")
    print("=" * 60)
    print(f"Saved calibration artifact to: {os.path.abspath(args.output)}\n")


if __name__ == "__main__":
    main()
