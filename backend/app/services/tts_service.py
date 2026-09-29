"""Single entry point for speech synthesis (POST /tts and the interview WS).

    text -> speech_formatter (markdown/JSON/symbols -> speakable) ->
    sentence chunks -> Kokoro (services/kokoro_tts.py) -> 16-bit WAV per chunk

Fallback: if Kokoro fails to load or synthesize, the remaining text goes to
the previous provider chain (audio_service.generate_tts_audio_async:
Edge-TTS, then gTTS). Only a real Kokoro exception triggers it.

Logs carry timings and sizes only — never the spoken text, which in an
interview can include candidate details echoed back by the LLM.
"""

import asyncio
import hashlib
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from ..config import settings
from .audio_service import generate_tts_audio_async
from .kokoro_tts import SAMPLE_RATE, KokoroUnavailable, get_kokoro_service, pcm16_wav
from .speech_formatter import format_for_speech, speech_chunks

# Fixed lines the interview UI speaks verbatim. Only these are cached: they
# contain nothing candidate-specific, and caching arbitrary text would keep
# private replies in memory for no benefit (they're rarely repeated).
STATIC_PHRASES = (
    "No worries, let's move on.",
    "Sorry, I didn't catch that — could you please repeat your answer?",
    "Thank you.",
    "Please wait a moment.",
    "Hello, how can I help you?",
)
_STATIC_KEYS = {" ".join(p.lower().split()) for p in STATIC_PHRASES}


@dataclass
class TTSChunk:
    seq: int
    audio: bytes
    media_type: str
    provider: str
    duration_ms: Optional[int]  # None when the fallback's MP3 length is unknown


class _AudioCache:
    """Small in-process LRU of synthesized static phrases."""

    def __init__(self, max_items: int):
        self.max_items = max_items
        self._items: "OrderedDict[str, bytes]" = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def key(text: str, voice: str, speed: float, lang: str, model: str) -> str:
        return hashlib.sha256(f"{model}|{voice}|{speed}|{lang}|{text}".encode("utf-8")).hexdigest()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            value = self._items.get(key)
            if value is not None:
                self._items.move_to_end(key)
            return value

    def put(self, key: str, value: bytes) -> None:
        if self.max_items <= 0:
            return
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)


cache = _AudioCache(settings.TTS_CACHE_MAX_ITEMS)


def is_cacheable(text: str) -> bool:
    return " ".join((text or "").lower().split()) in _STATIC_KEYS


def _use_kokoro() -> bool:
    return settings.TTS_PROVIDER.strip().lower() == "kokoro"


def _cache_key(chunk: str) -> str:
    k = get_kokoro_service()
    return cache.key(chunk, k.voice, k.speed, k.lang, k.model_id)


def _kokoro_chunk_wav(chunk: str, cacheable: bool) -> bytes:
    if cacheable:
        hit = cache.get(_cache_key(chunk))
        if hit is not None:
            return hit
    wav = get_kokoro_service().synthesize_wav(chunk)
    if cacheable:
        cache.put(_cache_key(chunk), wav)
    return wav


def _wav_duration_ms(wav: bytes) -> int:
    return int((len(wav) - 44) / 2 / SAMPLE_RATE * 1000)


async def _fallback_chunk(text: str, seq: int) -> Optional[TTSChunk]:
    audio = await generate_tts_audio_async(text, voice=settings.TTS_EDGE_VOICE)
    if not audio:
        return None
    return TTSChunk(seq=seq, audio=audio, media_type="audio/mpeg", provider="fallback", duration_ms=None)


async def stream_speech(text: str, request_id: Optional[str] = None) -> AsyncIterator[TTSChunk]:
    """Yields audio sentence by sentence, so playback can start after the
    first sentence is synthesized instead of the whole reply. Cancelling the
    consuming task stops synthesis after the chunk in progress (barge-in)."""
    rid = request_id or uuid.uuid4().hex[:8]
    chunks = speech_chunks(text)
    if not chunks:
        return
    cacheable = is_cacheable(text)
    t0 = time.perf_counter()
    provider = "kokoro" if _use_kokoro() else "fallback"
    print(f"[TTS] request_started id={rid} chars={len(text)} chunks={len(chunks)} provider={provider}")

    first_ms: Optional[float] = None
    audio_ms = 0
    sent = 0
    for seq, chunk in enumerate(chunks):
        item: Optional[TTSChunk] = None
        if provider == "kokoro":
            try:
                wav = await asyncio.to_thread(_kokoro_chunk_wav, chunk, cacheable)
                item = TTSChunk(seq, wav, "audio/wav", "kokoro", _wav_duration_ms(wav))
            except (KokoroUnavailable, Exception) as e:
                print(f"[TTS] Kokoro failed id={rid} chunk={seq} error={type(e).__name__}: {e}")
                if not settings.TTS_FALLBACK_ENABLED:
                    raise
                print(f"[TTS] Falling back to existing provider id={rid}")
                provider = "fallback"
        if item is None:
            # Everything not yet spoken, in one request: the fallback chain
            # has per-request network latency, so one call beats N.
            item = await _fallback_chunk(" ".join(chunks[seq:]), seq)
            if item is None:
                print(f"[TTS] fallback produced no audio id={rid}")
                break
        if first_ms is None:
            first_ms = (time.perf_counter() - t0) * 1000
            print(f"[TTS] first_audio_ms={first_ms:.0f} id={rid} provider={item.provider}")
        audio_ms += item.duration_ms or 0
        sent += 1
        yield item
        if item.provider == "fallback":
            break

    device = get_kokoro_service().device if provider == "kokoro" else "n/a"
    print(
        f"[TTS] generation_ms={(time.perf_counter() - t0) * 1000:.0f} audio_duration_ms={audio_ms} "
        f"chunks_sent={sent} provider={provider} device={device} id={rid}"
    )


async def synthesize(text: str) -> Optional[TTSChunk]:
    """Whole-reply synthesis for POST /tts (response contract: one audio
    body). Concatenates the per-sentence Kokoro audio into one WAV; with the
    fallback, returns its single MP3."""
    parts: list[TTSChunk] = [c async for c in stream_speech(text)]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    if all(p.media_type == "audio/wav" for p in parts):
        import numpy as np

        pcm = b"".join(p.audio[44:] for p in parts)
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32767.0
        wav = pcm16_wav(samples)
        return TTSChunk(0, wav, "audio/wav", "kokoro", _wav_duration_ms(wav))
    # Mixed (Kokoro failed partway): WAV and MP3 can't be concatenated into
    # one valid file — redo the whole text on the fallback for a clean body.
    return await _fallback_chunk(format_for_speech(text), 0)


def preload() -> None:
    """Startup hook: load the model and pre-render the static phrases, so the
    first candidate never pays the ~2 s load. Blocking; run in a thread."""
    if not _use_kokoro():
        return
    svc = get_kokoro_service()
    svc.load()
    for phrase in STATIC_PHRASES:
        for chunk in speech_chunks(phrase):
            _kokoro_chunk_wav(chunk, cacheable=True)


def status() -> dict:
    svc = get_kokoro_service()
    return {
        "provider": settings.TTS_PROVIDER,
        "kokoro_loaded": svc.loaded,
        "device": svc.device,
        "voice": svc.voice,
        "model": svc.model_id,
        "load_ms": round(svc.load_ms) if svc.load_ms else None,
        "fallback_enabled": settings.TTS_FALLBACK_ENABLED,
    }
