"""
The one clean interface the rest of this service (and, indirectly, the main
backend's Celery task via HTTP — see backend/app/services/ocean_client.py)
depends on: analyze_interview(video_path) -> structured dict. Nothing
outside this module ever touches oceanai/torch/opencv/mediapipe directly.

Real API usage verified against the installed oceanai==1.0.0a48 package's
own shipped test suite (test/unit_tests_fi_en.py) — see model_loader.py's
docstring for the full trail of what was verified and how.
"""
import logging
import os
import shutil
import subprocess
import time
import uuid

from . import model_loader
from .config import settings
from .exceptions import (
    InferenceError,
    ModelLoadError,
    RecordingNotFoundError,
    UnsupportedRecordingError,
)

logger = logging.getLogger(__name__)

# get_*_union_predictions filters on run.ext_, hardcoded to [".mp4"] in
# model_loader.py (matches the library's own test corpus format) — a
# browser MediaRecorder capture is webm, so every recording is transcoded
# to mp4 before OCEAN-AI ever sees it, regardless of what it arrived as.
TARGET_EXT = ".mp4"
TRAIT_COLUMNS = {
    "Openness": "openness",
    "Conscientiousness": "conscientiousness",
    "Extraversion": "extraversion",
    "Agreeableness": "agreeableness",
    "Non-Neuroticism": "non_neuroticism",
}


def _transcode_to_mp4(src_path: str, dest_path: str) -> None:
    """ffmpeg re-encode, not just a container remux — MediaRecorder's webm
    can use VP8/VP9+Opus, and OCEAN-AI's own video pipeline (opencv +
    mediapipe) and audio pipeline (librosa/opensmile) were validated by its
    authors against H.264/AAC-in-mp4 style content, not arbitrary webm
    codecs repackaged into an .mp4 container. -y overwrites; -loglevel
    error keeps stderr to genuine problems only (never logs the file's own
    path or content beyond that — see the "never log recording paths in
    detail" note in docs/behavioral-analysis.md's privacy section, which
    this deliberately does NOT violate: only ffmpeg's own error text, if
    any, is captured)."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path, "-c:v", "libx264", "-c:a", "aac", dest_path],
            capture_output=True,
            text=True,
            timeout=settings.MAX_ANALYSIS_SECONDS,
        )
    except FileNotFoundError as e:
        raise UnsupportedRecordingError("ffmpeg is not installed in this container.") from e
    except subprocess.TimeoutExpired as e:
        raise UnsupportedRecordingError("Transcoding this recording timed out.") from e

    if result.returncode != 0 or not os.path.exists(dest_path):
        raise UnsupportedRecordingError(f"Could not transcode recording to mp4: {result.stderr[:500]}")


def _extract_traits(df) -> dict:
    """df is one get_*_union_predictions call's df_files_ — exactly one row
    for our single-file corpus layout. Returns {} (not a raised error) when
    the row is missing/empty: a failed single modality must not fail the
    whole analysis — see analyze_interview's per-modality try/except, which
    is what actually decides whether that's fatal."""
    if df is None or len(df) == 0:
        return {}
    row = df.iloc[0]
    return {
        json_key: float(row[col])
        for col, json_key in TRAIT_COLUMNS.items()
        if col in df.columns and row[col] == row[col]  # last clause: skip NaN
    }


def analyze_interview(video_path: str) -> dict:
    """Runs OCEAN-AI's real audio, video, and audio+video-fusion Big-Five
    pipelines on one interview recording. Returns:

        {
            "results": {"audio": {...}, "video": {...}, "audio_video": {...}},
            "model": {"name": "OCEAN-AI", "version": "1.0.0a48"},
            "timing": {"audio_inference_ms": int, "video_inference_ms": int,
                       "fusion_inference_ms": int, "total_ms": int},
        }

    Any modality whose prediction call fails is returned as {} in `results`
    rather than failing the whole request, UNLESS all three fail, in which
    case InferenceError is raised (nothing genuinely usable came out of
    this recording). Raises RecordingNotFoundError / UnsupportedRecordingError
    / ModelLoadError / InferenceError — see exceptions.py; main.py maps each
    to a specific HTTP status so backend/app/services/ocean_client.py can
    tell retryable from permanent failures apart.
    """
    if not os.path.isfile(video_path):
        raise RecordingNotFoundError(f"No such file: {video_path!r}")

    try:
        run = model_loader.get_run()
    except ModelLoadError:
        raise  # already the right type

    total_start = time.monotonic()
    if any(c.isspace() for c in settings.ANALYSIS_WORK_DIR):
        raise InferenceError(
            f"ANALYSIS_WORK_DIR {settings.ANALYSIS_WORK_DIR!r} contains whitespace; oceanai's audio "
            "extraction shells out to ffmpeg with the path unquoted. Set a path without spaces."
        )
    work_dir = os.path.join(settings.ANALYSIS_WORK_DIR, uuid.uuid4().hex)
    # get_*_union_predictions scans run.path_to_dataset_ for SUBdirectories
    # (see model_loader.py's docstring) — one subdirectory per "sample" in
    # OCEAN-AI's own corpus-shaped design. A single recording is adapted to
    # that shape as a one-sample corpus: work_dir/sample/<file>.mp4.
    sample_dir = os.path.join(work_dir, "sample")
    os.makedirs(sample_dir, exist_ok=True)
    mp4_path = os.path.join(sample_dir, f"recording{TARGET_EXT}")

    try:
        _transcode_to_mp4(video_path, mp4_path)

        run.path_to_dataset_ = work_dir

        results = {}
        timing = {}

        t = time.monotonic()
        try:
            # No `lang` here — verified live: unlike the video/av methods,
            # get_audio_union_predictions has no such parameter (TypeError).
            ok = run.get_audio_union_predictions(depth=1, recursive=False, accuracy=False, logs=False, out=False)
            results["audio"] = _extract_traits(run.df_files_.copy()) if ok else {}
        except Exception as e:
            logger.warning("[ocean_service] audio prediction failed: %s", e)
            results["audio"] = {}
        timing["audio_inference_ms"] = int((time.monotonic() - t) * 1000)

        t = time.monotonic()
        try:
            ok = run.get_video_union_predictions(depth=1, recursive=False, lang=model_loader.LANG, accuracy=False, logs=False, out=False)
            results["video"] = _extract_traits(run.df_files_.copy()) if ok else {}
        except Exception as e:
            logger.warning("[ocean_service] video prediction failed: %s", e)
            results["video"] = {}
        timing["video_inference_ms"] = int((time.monotonic() - t) * 1000)

        t = time.monotonic()
        try:
            ok = run.get_av_union_predictions(depth=1, recursive=False, lang=model_loader.LANG, accuracy=False, logs=False, out=False)
            results["audio_video"] = _extract_traits(run.df_files_.copy()) if ok else {}
        except Exception as e:
            logger.warning("[ocean_service] audio+video fusion prediction failed: %s", e)
            results["audio_video"] = {}
        timing["fusion_inference_ms"] = int((time.monotonic() - t) * 1000)

        timing["total_ms"] = int((time.monotonic() - total_start) * 1000)

        if not results["audio"] and not results["video"] and not results["audio_video"]:
            raise InferenceError("OCEAN-AI produced no usable prediction for any modality on this recording.")

        return {
            "results": results,
            "model": {"name": "OCEAN-AI", "version": model_loader.model_version()},
            "timing": timing,
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
