"""Typed exceptions for the OCEAN-AI service layer — never let a raw
oceanai/torch/opencv exception reach main.py's route handlers un-typed, so
each failure mode maps to one deliberate HTTP status (see main.py)."""


class OceanServiceError(Exception):
    """Base class for every error this service raises on purpose."""


class ModelLoadError(OceanServiceError):
    """Model weights failed to download/initialize (network failure, a
    corrupted cached weight file, insufficient memory during load). Distinct
    from InferenceError: this means the service itself isn't usable yet,
    not that one specific recording failed."""


class RecordingNotFoundError(OceanServiceError):
    """The given video_path doesn't exist on this container's filesystem —
    almost always means the shared uploads volume isn't mounted the same
    way in both containers, or the caller passed a stale path."""


class UnsupportedRecordingError(OceanServiceError):
    """The recording exists but OCEAN-AI's pipeline can't use it: wrong
    container format, zero-duration, no readable video/audio stream. Not
    retryable — the same file will fail the same way every time."""


class InferenceError(OceanServiceError):
    """A specific analysis run failed after models were already loaded
    (e.g. a corrupt frame mid-file, an out-of-memory during one file's
    inference). Retryable — the same file might succeed on a re-run once
    whatever transient condition (memory pressure, etc.) clears."""
