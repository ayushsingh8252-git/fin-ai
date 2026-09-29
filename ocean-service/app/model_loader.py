"""
Loads OCEAN-AI's (aimclub/OCEANAI, PyPI package `oceanai`) pretrained
Big-Five models exactly once per process and caches the resulting
oceanai.modules.lab.build.Run instance as a module-level singleton —
mirrors this platform's existing services/audio_service.py::_get_whisper_model()
convention (a lazy, lock-guarded, once-per-process heavy-model load), just
in this separate service.

Every method call and weight-URL lookup below was verified against the real
installed oceanai==1.0.0a48 package source, specifically its own shipped
test/unit_tests_fi_en.py (read directly from site-packages, not docs and not
guessed) — that file is the library's own working example of loading and
running exactly the audio / video / audio+video pipeline this service
needs. See docs/behavioral-analysis.md for the full trail.

Key facts this design depends on (all confirmed in that source, not assumed):
- `run.weights_for_big5_[modality][corpus][kind][...][disk]` is a registry
  baked into the library itself — we never hardcode a weight URL ourselves.
- `run.ext_` MUST be set before any get_*_union_predictions call, or the
  library's own _get_paths/glob step raises "wrong extension" and returns
  False (oceanai/modules/lab/audio.py's get_audio_union_predictions).
- get_audio_union_predictions / get_video_union_predictions /
  get_av_union_predictions each scan `run.path_to_dataset_` as a directory
  of subdirectories (`depth`/`recursive`), NOT a single-file argument — see
  ocean_service.py for how a single recording is adapted to that shape.
- Device selection (CPU vs CUDA) is entirely automatic inside the library
  (Core.__init__: `"cuda:0" if torch.cuda.is_available() else "cpu"`) — this
  service does nothing special for CPU-only deployment beyond installing
  the CPU-only torch wheel (see Dockerfile).
"""
import logging
import os
import threading
import time
from typing import Optional

from .config import settings
from .exceptions import ModelLoadError

logger = logging.getLogger(__name__)

_run = None
_load_lock = threading.Lock()
_load_error: Optional[str] = None
_load_seconds: Optional[float] = None

# "fi" (First Impressions V2) / "en" is the library's general-purpose,
# English-language pretrained set — the same one its own unit_tests_fi_en.py
# exercises. "googledisk" (vs. the "sberdisk" mirror) is what that same test
# uses for this corpus, and is reachable without a Russian network path.
CORPUS = "fi"
LANG = "en"
DISK = "googledisk"

TRAITS = ("openness", "conscientiousness", "extraversion", "agreeableness", "non_neuroticism")


def _b5_weight_urls(run, modality: str) -> dict:
    return {t: run.weights_for_big5_[modality][CORPUS]["b5"][t][DISK] for t in TRAITS}


def _load() -> "Run":  # noqa: F821 - Run imported lazily below
    from oceanai.modules.lab.build import Run

    os.makedirs(settings.MODEL_WEIGHTS_DIR, exist_ok=True)
    os.makedirs(settings.LOG_DIR, exist_ok=True)

    t0 = time.monotonic()
    run = Run()
    run.path_to_save_ = settings.MODEL_WEIGHTS_DIR
    run.path_to_logs_ = settings.LOG_DIR
    run.ext_ = [".mp4"]

    logger.info("[ocean model_loader] loading audio models (corpus=%s)...", CORPUS)
    run.load_audio_model_hc(out=False)
    run.load_audio_model_weights_hc(url=run.weights_for_big5_["audio"][CORPUS]["hc"][DISK], force_reload=False, out=False)
    run.load_audio_model_nn(out=False)
    run.load_audio_model_weights_nn(url=run.weights_for_big5_["audio"][CORPUS]["nn"][DISK], force_reload=False, out=False)
    run.load_audio_models_b5(out=False)
    audio_urls = _b5_weight_urls(run, "audio")
    run.load_audio_models_weights_b5(
        url_openness=audio_urls["openness"],
        url_conscientiousness=audio_urls["conscientiousness"],
        url_extraversion=audio_urls["extraversion"],
        url_agreeableness=audio_urls["agreeableness"],
        url_non_neuroticism=audio_urls["non_neuroticism"],
        force_reload=False,
        out=False,
    )

    logger.info("[ocean model_loader] loading video models (corpus=%s)...", CORPUS)
    run.load_video_model_hc(lang=LANG, out=False)
    run.load_video_model_weights_hc(url=run.weights_for_big5_["video"][CORPUS]["hc"][DISK], force_reload=False, out=False)
    run.load_video_model_deep_fe(out=False)
    run.load_video_model_weights_deep_fe(url=run.weights_for_big5_["video"][CORPUS]["fe"][DISK], force_reload=False, out=False)
    run.load_video_model_nn(out=False)
    run.load_video_model_weights_nn(url=run.weights_for_big5_["video"][CORPUS]["nn"][DISK], force_reload=False, out=False)
    run.load_video_models_b5(out=False)
    video_urls = _b5_weight_urls(run, "video")
    run.load_video_models_weights_b5(
        url_openness=video_urls["openness"],
        url_conscientiousness=video_urls["conscientiousness"],
        url_extraversion=video_urls["extraversion"],
        url_agreeableness=video_urls["agreeableness"],
        url_non_neuroticism=video_urls["non_neuroticism"],
        force_reload=False,
        out=False,
    )

    logger.info("[ocean model_loader] loading audio+video fusion heads (corpus=%s)...", CORPUS)
    run.load_av_models_b5(out=False)
    av_urls = _b5_weight_urls(run, "av")
    run.load_av_models_weights_b5(
        url_openness=av_urls["openness"],
        url_conscientiousness=av_urls["conscientiousness"],
        url_extraversion=av_urls["extraversion"],
        url_agreeableness=av_urls["agreeableness"],
        url_non_neuroticism=av_urls["non_neuroticism"],
        force_reload=False,
        out=False,
    )

    elapsed = time.monotonic() - t0
    logger.info("[ocean model_loader] all models loaded in %.1fs", elapsed)
    return run, elapsed


def get_run():
    """Returns the process-wide Run() singleton, loading it on first call
    (called eagerly from main.py's lifespan startup in normal deployment —
    see its own comment for why — but safe to call lazily too, e.g. from a
    test). Thread-safe: a second caller arriving mid-load blocks on the same
    lock rather than starting a redundant second load."""
    global _run, _load_error, _load_seconds
    if _run is not None:
        return _run
    with _load_lock:
        if _run is not None:
            return _run
        try:
            _run, _load_seconds = _load()
        except Exception as e:
            _load_error = str(e)
            logger.exception("[ocean model_loader] model load failed")
            raise ModelLoadError(str(e)) from e
        return _run


def is_loaded() -> bool:
    return _run is not None


def load_error() -> Optional[str]:
    return _load_error


def load_seconds() -> Optional[float]:
    return _load_seconds


def model_version() -> str:
    try:
        from oceanai import __release__

        return str(__release__)
    except Exception:
        return "unknown"
