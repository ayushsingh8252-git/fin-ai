"""Voice Biometric Enrollment CLI Utility.

Enrolls speaker voiceprints for Ayush Singh into the ECAPA-TDNN database
so that voice authentication in Command Center works seamlessly.

Usage:
    # 1. Check current enrollment status
    python -m scripts.enroll_voice --status

    # 2. Enroll individual audio files
    python -m scripts.enroll_voice --files sample1.wav sample2.wav sample3.wav

    # 3. Enroll all audio files in a directory
    python -m scripts.enroll_voice --dir data/ayush_voice/

    # 4. Interactive microphone recording (records 3 samples)
    python -m scripts.enroll_voice --record

    # 5. Reset / clear existing enrollment
    python -m scripts.enroll_voice --reset
"""
from __future__ import annotations

import os
import sys
import argparse
import time
import tempfile
from typing import List

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import SessionLocal
from app.models import VoicePrint, VoiceEnrollment
from app.services.voice_identification import enroll_speaker
from app.config import settings


DEFAULT_SPEAKER_ID = "ayush_singh"
DEFAULT_SPEAKER_NAME = "Ayush Singh"
DEFAULT_EMAIL = "ayushrajput8252@gmail.com"

PROMPT_SCRIPTS = [
    "I am Ayush Singh, authorizing my voiceprint for Agentic Command Center.",
    "Ayush Singh verifying biometric authentication for autonomous AI agents.",
    "Security policy confirmed, granting system access to Ayush Singh.",
    "Voice biometric baseline calibrated for Ayush Singh.",
    "Autonomous agent orchestration authorized by Ayush Singh.",
]


def print_status(speaker_id: str = DEFAULT_SPEAKER_ID):
    db = SessionLocal()
    try:
        vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
        enrollments = db.query(VoiceEnrollment).filter(VoiceEnrollment.speaker_id == speaker_id).all()
        
        print("\n" + "=" * 64)
        print(f"       VOICE BIOMETRIC STATUS: {speaker_id.upper()}")
        print("=" * 64)
        if not vp:
            print(f"Status:            NOT ENROLLED (0 samples)")
            print(f"Required Samples:  {settings.VOICE_ID_MIN_ENROLLMENT_SAMPLES} samples required to activate")
            print("Action Needed:     Run `python -m scripts.enroll_voice --record` or `--files ...`")
        else:
            status_tag = "ACTIVE (READY)" if vp.status == "active" else f"IN PROGRESS ({vp.status})"
            print(f"Speaker Name:      {vp.speaker_name}")
            print(f"Status:            {status_tag}")
            print(f"Enrolled Samples:  {vp.enrollment_count} / min {settings.VOICE_ID_MIN_ENROLLMENT_SAMPLES} (max {settings.VOICE_ID_MAX_ENROLLMENT_SAMPLES})")
            print(f"Embedding Vector:  {'192-dim Centroid Stored' if vp.embedding else 'None'}")
            print(f"Updated At:        {vp.updated_at or vp.created_at}")
            print("-" * 64)
            print("Individual Sample History:")
            for idx, enr in enumerate(enrollments, 1):
                dur = f"{enr.speech_duration_sec:.2f}s" if enr.speech_duration_sec else "N/A"
                rms = f"{enr.audio_quality_score:.4f}" if enr.audio_quality_score else "N/A"
                print(f"  [{idx}] Sample ID: {enr.id[:8]}... | Duration: {dur} | RMS Energy: {rms} | Created: {enr.created_at}")
        print("=" * 64 + "\n")
    finally:
        db.close()


def reset_enrollment(speaker_id: str = DEFAULT_SPEAKER_ID):
    db = SessionLocal()
    try:
        db.query(VoiceEnrollment).filter(VoiceEnrollment.speaker_id == speaker_id).delete()
        db.query(VoicePrint).filter(VoicePrint.id == speaker_id).delete()
        db.commit()
        print(f"\n[OK] Successfully reset voiceprint and deleted all enrollments for '{speaker_id}'.\n")
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Failed to reset voiceprint: {e}\n")
    finally:
        db.close()


def enroll_audio_files(
    file_paths: List[str],
    speaker_id: str = DEFAULT_SPEAKER_ID,
    speaker_name: str = DEFAULT_SPEAKER_NAME,
    email: str = DEFAULT_EMAIL,
):
    valid_files = [f for f in file_paths if os.path.isfile(f)]
    if not valid_files:
        print(f"\n[ERROR] No valid audio files found in provided paths.\n")
        return

    print("\n" + "=" * 64)
    print(f"       ENROLLING {len(valid_files)} VOICE SAMPLES FOR: {speaker_name}")
    print("=" * 64)

    db = SessionLocal()
    try:
        for idx, file_path in enumerate(valid_files, 1):
            print(f"\n[{idx}/{len(valid_files)}] Processing: {os.path.basename(file_path)}")
            res = enroll_speaker(
                speaker_id=speaker_id,
                speaker_name=speaker_name,
                audio_path=file_path,
                db=db,
                email=email,
            )

            if res.get("status") == "ok":
                dur = res.get("speech_duration", 0)
                count = res.get("enrollment_count", 0)
                vp_status = res.get("voiceprint_status", "enrolling")
                print(f"  --> Extracted 192-dim ECAPA embedding (speech duration: {dur:.2f}s)")
                print(f"  --> Sample #{count} registered | Voiceprint status: {vp_status.upper()}")
            else:
                print(f"  --> [FAILED]: {res.get('message', 'Unknown error')}")
                if "detail" in res:
                    print(f"      Detail: {res['detail']}")

        print("\n" + "=" * 64)
        print("Final Enrollment Status:")
        print_status(speaker_id)
    finally:
        db.close()


def record_interactive(
    num_samples: int = 3,
    duration_per_sample: int = 4,
    speaker_id: str = DEFAULT_SPEAKER_ID,
    speaker_name: str = DEFAULT_SPEAKER_NAME,
    email: str = DEFAULT_EMAIL,
):
    try:
        import sounddevice as sd
        from scipy.io.wavfile import write as write_wav
    except ImportError:
        print("\n" + "=" * 64)
        print("[!] `sounddevice` and `scipy` are needed for live microphone recording.")
        print("    Install them with:")
        print("        pip install sounddevice scipy")
        print("\n    Alternatively, record 3 WAV files using your voice recorder / phone")
        print("    and enroll them with:")
        print("        python -m scripts.enroll_voice --files sample1.wav sample2.wav sample3.wav")
        print("=" * 64 + "\n")
        return

    print("\n" + "=" * 64)
    print(f"       INTERACTIVE VOICE ENROLLMENT: {speaker_name.upper()}")
    print("=" * 64)
    print(f"We will record {num_samples} distinct voice samples ({duration_per_sample} seconds each).")
    print("Please speak clearly in your normal speaking voice into your microphone.")
    print("-" * 64)

    temp_files = []
    sample_rate = 16000

    try:
        for i in range(num_samples):
            prompt = PROMPT_SCRIPTS[i % len(PROMPT_SCRIPTS)]
            print(f"\n[Sample {i + 1}/{num_samples}]")
            print(f"Read this sentence aloud:")
            print(f"  >>> \"{prompt}\"")
            input("Press [ENTER] when you are ready to speak...")

            print(f"[*] RECORDING for {duration_per_sample} seconds... Speak now!")
            recording = sd.rec(int(duration_per_sample * sample_rate), samplerate=sample_rate, channels=1, dtype="int16")
            sd.wait()
            print("[+] Recording captured.")

            temp_path = os.path.join(tempfile.gettempdir(), f"ayush_enroll_sample_{i + 1}_{int(time.time())}.wav")
            write_wav(temp_path, sample_rate, recording)
            temp_files.append(temp_path)

        enroll_audio_files(temp_files, speaker_id=speaker_id, speaker_name=speaker_name, email=email)
    finally:
        for tf in temp_files:
            if os.path.exists(tf):
                try:
                    os.remove(tf)
                except Exception:
                    pass


def main():
    parser = argparse.ArgumentParser(description="Voice Biometric Enrollment Tool for Ayush Singh")
    parser.add_argument("--status", action="store_true", help="Check current voiceprint enrollment status")
    parser.add_argument("--files", nargs="+", type=str, help="List of audio files to enroll (WAV, MP3, WebM, etc.)")
    parser.add_argument("--dir", type=str, help="Directory containing audio files to enroll")
    parser.add_argument("--record", action="store_true", help="Interactive live microphone recording")
    parser.add_argument("--samples", type=int, default=3, help="Number of samples for live recording (default: 3)")
    parser.add_argument("--duration", type=int, default=4, help="Duration per sample in seconds (default: 4)")
    parser.add_argument("--reset", action="store_true", help="Delete and reset existing voiceprint")
    parser.add_argument("--speaker-id", type=str, default=DEFAULT_SPEAKER_ID, help="Speaker ID (default: ayush_singh)")
    parser.add_argument("--speaker-name", type=str, default=DEFAULT_SPEAKER_NAME, help="Speaker Name (default: Ayush Singh)")
    parser.add_argument("--email", type=str, default=DEFAULT_EMAIL, help="Email address")

    args = parser.parse_args()

    if args.status:
        print_status(args.speaker_id)
        return

    if args.reset:
        reset_enrollment(args.speaker_id)
        return

    if args.files:
        enroll_audio_files(args.files, speaker_id=args.speaker_id, speaker_name=args.speaker_name, email=args.email)
        return

    if args.dir:
        if not os.path.isdir(args.dir):
            print(f"\n[ERROR] Directory not found: {args.dir}\n")
            return
        audio_exts = {".wav", ".mp3", ".m4a", ".webm", ".flac", ".ogg", ".aac"}
        files = [
            os.path.join(args.dir, f)
            for f in sorted(os.listdir(args.dir))
            if os.path.splitext(f)[1].lower() in audio_exts
        ]
        if not files:
            print(f"\n[ERROR] No supported audio files found in directory: {args.dir}\n")
            return
        enroll_audio_files(files, speaker_id=args.speaker_id, speaker_name=args.speaker_name, email=args.email)
        return

    if args.record:
        record_interactive(
            num_samples=args.samples,
            duration_per_sample=args.duration,
            speaker_id=args.speaker_id,
            speaker_name=args.speaker_name,
            email=args.email,
        )
        return

    # Default action: show status
    print_status(args.speaker_id)


if __name__ == "__main__":
    main()
