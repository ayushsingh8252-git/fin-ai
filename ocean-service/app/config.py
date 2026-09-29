import os
import tempfile

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PORT: int = 8100

    # Where OCEAN-AI's downloaded pretrained weights are cached. Must be a
    # persistent volume (see docker-compose.yml's ocean_weights volume) —
    # otherwise every container recreation re-downloads ~20 separate weight
    # files (see model_loader.py), which is exactly the "don't download
    # large NN weights for every interview" failure mode this is meant to
    # avoid, just moved from "every interview" to "every deploy".
    MODEL_WEIGHTS_DIR: str = os.path.normpath("./data/weights")
    LOG_DIR: str = os.path.normpath("./data/logs")

    # Shared with policy-backend/policy-celery-worker via the same Docker
    # volume (policy_uploads) — this service receives a path, not file
    # bytes, exactly like the main backend's own worker.py file-processing
    # tasks (see docs/behavioral-analysis.md).
    RECORDINGS_DIR: str = os.path.normpath("./uploads/interview_recordings")

    # Scratch dir for the per-request one-sample corpus (see
    # ocean_service.py). MUST NOT contain spaces: oceanai's own audio
    # extraction runs `ffmpeg -i {path} ...` via shell=True with the path
    # unquoted (oceanai/modules/lab/audio.py), so a space silently breaks
    # audio and audio+video fusion. Verified live on a Windows host whose
    # temp dir sits under "C:\Users\<First Last>\...". /tmp in the container.
    ANALYSIS_WORK_DIR: str = os.path.join(tempfile.gettempdir(), "ocean_analysis")

    # Safety cap so a corrupt/adversarial file can't pin a CPU worker
    # analyzing it forever — see ocean_service.py.
    MAX_ANALYSIS_SECONDS: int = 900


settings = Settings()
