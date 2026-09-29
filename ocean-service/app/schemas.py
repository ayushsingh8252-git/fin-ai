from typing import Optional

from pydantic import BaseModel


class Traits(BaseModel):
    """OCEAN-AI's five Big-Five trait scores, each 0.0-1.0. Field names and
    the "non_neuroticism" (not "neuroticism") direction are the library's
    own output semantics, preserved deliberately — see
    docs/behavioral-analysis.md. Optional/None per-field rather than a
    required float: a model can legitimately fail to produce one trait
    (see ocean_service.py's per-head try/except) without discarding the
    other four."""

    openness: Optional[float] = None
    conscientiousness: Optional[float] = None
    extraversion: Optional[float] = None
    agreeableness: Optional[float] = None
    non_neuroticism: Optional[float] = None


class Timing(BaseModel):
    audio_inference_ms: int
    video_inference_ms: int
    fusion_inference_ms: int
    total_ms: int


class ModelInfo(BaseModel):
    name: str = "OCEAN-AI"
    version: str


class AnalyzeRequest(BaseModel):
    video_path: str
    session_id: str


class AnalyzeResponse(BaseModel):
    status: str = "completed"
    model: ModelInfo
    results: dict  # {"audio": Traits, "video": Traits, "audio_video": Traits} — see ocean_service.py
    timing: Timing


class HealthResponse(BaseModel):
    status: str  # "ok" | "loading" | "error"
    model_loaded: bool
    model_load_error: Optional[str] = None
