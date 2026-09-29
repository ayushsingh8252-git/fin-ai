"""Self-hosted Kokoro-82M text-to-speech via kokoro-onnx.

Why kokoro-onnx and not the PyTorch `kokoro` package: the latter's English
G2P (misaki[en]) pulls in spaCy + spacy-curated-transformers and downloads
en_core_web_sm at runtime — spaCy has already crashed this backend with a
MemoryError on a low-RAM box. kokoro-onnx runs the same Kokoro-82M weights on
onnxruntime (already a backend dependency) with a bundled espeak-ng for
phonemes, so there is no system package or runtime download to manage.

One process-wide engine: the ONNX session and voice table load once (~2 s)
and every request reuses them. Output is 24 kHz mono float32, which is
encoded straight to 16-bit PCM WAV — no MP3 round trip.
"""

import io
import os
import threading
import time
import wave
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from ..config import settings

SAMPLE_RATE = 24000
_BACKEND_DIR = Path(__file__).resolve().parents[2]


class KokoroUnavailable(RuntimeError):
    """Kokoro could not be loaded (missing package/model files) — callers
    treat this as a provider failure and fall back."""


def _resolve(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else _BACKEND_DIR / p


def resolve_providers(device: str, available: list[str]) -> Tuple[list[str], str]:
    """Maps KOKORO_DEVICE to onnxruntime execution providers. Never raises:
    asking for CUDA on a CPU-only host logs a warning and runs on CPU, so a
    missing GPU can't take the voice feature (or the app) down."""
    device = (device or "auto").strip().lower()
    has_cuda = "CUDAExecutionProvider" in available
    if device in ("auto", "cuda", "gpu") and has_cuda:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"], "cuda"
    if device in ("cuda", "gpu"):
        print("[TTS] KOKORO_DEVICE=cuda but CUDAExecutionProvider is unavailable — using CPU")
    elif device not in ("auto", "cpu"):
        print(f"[TTS] Unknown KOKORO_DEVICE={device!r} — using CPU")
    return ["CPUExecutionProvider"], "cpu"


def pcm16_wav(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """float32 [-1, 1] -> 16-bit mono WAV. The browser decodes this natively
    (decodeAudioData / <audio>), so no codec runs on either side."""
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class KokoroTTSService:
    def __init__(self):
        self.voice = settings.KOKORO_VOICE
        self.lang = settings.KOKORO_LANG
        self.speed = float(settings.KOKORO_SPEED)
        self.model_path = _resolve(settings.KOKORO_MODEL_PATH)
        self.voices_path = _resolve(settings.KOKORO_VOICES_PATH)
        self.model_id = self.model_path.name
        self.device = "unloaded"
        self._kokoro = None
        self._load_lock = threading.Lock()
        # Bounds simultaneous syntheses — see KOKORO_MAX_CONCURRENCY.
        self._run_slots = threading.BoundedSemaphore(max(1, settings.KOKORO_MAX_CONCURRENCY))
        self.load_count = 0
        self.load_ms: Optional[float] = None

    @property
    def loaded(self) -> bool:
        return self._kokoro is not None

    def load(self) -> None:
        """Idempotent, thread-safe one-time load."""
        if self._kokoro is not None:
            return
        with self._load_lock:
            if self._kokoro is not None:
                return
            t0 = time.perf_counter()
            try:
                import onnxruntime as rt
                from kokoro_onnx import Kokoro
            except ImportError as e:
                raise KokoroUnavailable(f"kokoro-onnx is not installed: {e}") from e
            for p in (self.model_path, self.voices_path):
                if not p.is_file():
                    raise KokoroUnavailable(
                        f"Kokoro model file missing: {p} (run scripts/download_kokoro.py)"
                    )

            providers, device = resolve_providers(settings.KOKORO_DEVICE, rt.get_available_providers())
            opts = rt.SessionOptions()
            threads = settings.KOKORO_THREADS or min(os.cpu_count() or 1, 8)
            opts.intra_op_num_threads = threads
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = rt.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_cpu_mem_arena = settings.KOKORO_CPU_MEM_ARENA
            try:
                session = rt.InferenceSession(str(self.model_path), sess_options=opts, providers=providers)
            except Exception:
                if device != "cuda":
                    raise
                # CUDA provider present but the GPU/driver isn't usable.
                print("[TTS] CUDA session init failed — retrying on CPU")
                providers, device = ["CPUExecutionProvider"], "cpu"
                session = rt.InferenceSession(str(self.model_path), sess_options=opts, providers=providers)

            kokoro = Kokoro.from_session(session, str(self.voices_path))
            if self.voice not in kokoro.get_voices():
                raise KokoroUnavailable(f"KOKORO_VOICE={self.voice!r} is not in {self.voices_path.name}")
            # Warm-up: the first run pays graph/allocator setup (~hundreds of
            # ms); pay it here, not on a candidate's first question.
            kokoro.create("Hello.", voice=self.voice, speed=self.speed, lang=self.lang)

            self._kokoro = kokoro
            self.device = device
            self.load_count += 1
            self.load_ms = (time.perf_counter() - t0) * 1000
            print(
                f"[TTS] provider=kokoro model={self.model_id} voice={self.voice} "
                f"device={device} threads={threads} load_ms={self.load_ms:.0f}"
            )

    def synthesize_samples(self, text: str) -> np.ndarray:
        """Blocking synthesis of one chunk -> float32 samples at 24 kHz. Call
        from a worker thread (see tts_service), never the event loop."""
        text = (text or "").strip()
        if not text:
            raise ValueError("Nothing to synthesize")
        self.load()
        with self._run_slots:
            samples, sr = self._kokoro.create(text, voice=self.voice, speed=self.speed, lang=self.lang)
        if sr != SAMPLE_RATE:
            raise RuntimeError(f"Unexpected Kokoro sample rate {sr}")
        return samples

    def synthesize_wav(self, text: str) -> bytes:
        return pcm16_wav(self.synthesize_samples(text))


_service: Optional[KokoroTTSService] = None
_service_lock = threading.Lock()


def get_kokoro_service() -> KokoroTTSService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = KokoroTTSService()
    return _service
