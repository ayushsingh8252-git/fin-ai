"""Kokoro TTS: speech formatting, sentence chunking, provider/device
selection, cache, fallback, and the interview WebSocket's streamed audio +
barge-in. Tests marked `needs_model` run the real Kokoro model and are
skipped when its files aren't present (scripts/download_kokoro.py)."""

import asyncio
import io
import threading
import time
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import interview as interview_api
from app.config import settings
from app.main import app
from app.services import kokoro_tts, tts_service
from app.services.speech_formatter import (
    MAX_CHUNK_CHARS, SentenceChunker, format_for_speech, speech_chunks,
)

needs_model = pytest.mark.skipif(
    not (kokoro_tts._resolve(settings.KOKORO_MODEL_PATH).is_file()
         and kokoro_tts._resolve(settings.KOKORO_VOICES_PATH).is_file()),
    reason="Kokoro model files not downloaded",
)


# ── Speech formatting ───────────────────────────────────────────────────

def test_formatter_strips_markdown_code_links_and_citations():
    raw = (
        "## Next step\n**Great** answer! See [the docs](https://x.io/a) [1].\n"
        "```python\nprint('hi')\n```\nUse `pytest` for that."
    )
    out = format_for_speech(raw)
    assert out == "Next step Great answer! See the docs. Use pytest for that."


def test_formatter_drops_raw_json():
    assert format_for_speech('{"question": "x", "is_final": false}') == ""


def test_formatter_turns_bullets_into_sentences():
    out = format_for_speech("You could:\n- scale reads\n- add a cache\n1. shard writes")
    assert out == "You could: scale reads. add a cache. shard writes."


def test_formatter_expands_abbreviations_numbers_and_terms():
    out = format_for_speech("e.g. 5+ yrs of C++ and .NET, 2-3 teams, 40% faster, $120k budget")
    assert out == ("for example 5 plus years of C plus plus and dot net, 2 to 3 teams, "
                   "40 percent faster, 120 thousand dollars budget")
    assert format_for_speech("A $5 fee and a $2.5 million round.") == "A 5 dollars fee and a 2.5 million dollars round."


def test_formatter_leaves_plain_speech_alone():
    text = "Tell me about the hardest bug you fixed in your last project."
    assert format_for_speech(text) == text
    assert format_for_speech("") == ""
    # Identifiers aren't mistaken for emphasis; the underscore is read as a pause.
    assert format_for_speech("the user_id and group_id columns") == "the user id and group id columns"


# ── Sentence chunking ───────────────────────────────────────────────────

def test_chunker_merges_short_fragments_and_splits_sentences():
    text = "Sure! I can help you find candidates. Let me check the recruitment workflow."
    assert speech_chunks(text) == [
        "Sure! I can help you find candidates.",
        "Let me check the recruitment workflow.",
    ]


def test_long_single_sentence_question_splits_its_opener_at_a_clause():
    # Verbatim shape of a live interviewer question (one 124-char sentence),
    # which previously went out as one chunk -> 3.4 s to first audio.
    q = ("Could you tell me more about the databases and caching layers you've worked with, "
         "and how you decided between Postgres and Redis?")
    assert speech_chunks(q) == [
        "Could you tell me more about the databases and caching layers you've worked with,",
        "and how you decided between Postgres and Redis?",
    ]
    # Only the opener is split; later sentences keep their natural length.
    two = "Thanks. " + q
    assert speech_chunks(two)[0] == "Thanks. Could you tell me more about the databases and caching layers you've worked with,"
    # No clause break -> left whole rather than cut mid-phrase.
    whole = "Could you walk me through a recent project where you designed a backend service end to end and deployed it"
    assert speech_chunks(whole + "?") == [whole + "?"]


def test_chunker_token_stream_matches_whole_text():
    text = "Thanks for that. Could you walk me through a recent project? What was hardest about it?"
    chunker = SentenceChunker()
    streamed = []
    for token in text.replace(" ", " \x00").split("\x00"):  # word-by-word deltas
        streamed.extend(chunker.feed(token))
    first_ready_before_end = len(streamed) >= 1
    streamed.extend(chunker.flush())
    assert first_ready_before_end, "first sentence must be emitted before the stream ends"
    assert streamed == speech_chunks(text)


def test_chunker_does_not_split_decimals_and_caps_run_ons():
    assert speech_chunks("We cut latency from 3.5 seconds to 0.8 seconds overall.") == [
        "We cut latency from 3.5 seconds to 0.8 seconds overall."
    ]
    long = ", ".join(f"clause number {i} about the system design" for i in range(12)) + "."
    parts = speech_chunks(long)
    assert len(parts) > 1 and all(len(p) <= MAX_CHUNK_CHARS for p in parts)
    assert " ".join(parts).replace(" ", "") == long.replace(" ", "")


# ── Device / provider selection ─────────────────────────────────────────

@pytest.mark.parametrize("device,available,expected", [
    ("auto", ["CUDAExecutionProvider", "CPUExecutionProvider"], "cuda"),
    ("auto", ["CPUExecutionProvider"], "cpu"),
    ("cuda", ["CPUExecutionProvider"], "cpu"),   # no GPU: falls back, never raises
    ("cpu", ["CUDAExecutionProvider", "CPUExecutionProvider"], "cpu"),
    ("tpu", ["CPUExecutionProvider"], "cpu"),
])
def test_resolve_providers(device, available, expected):
    providers, resolved = kokoro_tts.resolve_providers(device, available)
    assert resolved == expected
    assert providers[-1] == "CPUExecutionProvider"


def test_voice_config_is_read_from_settings(monkeypatch):
    monkeypatch.setattr(settings, "KOKORO_VOICE", "af_heart")
    monkeypatch.setattr(settings, "KOKORO_SPEED", 1.1)
    svc = kokoro_tts.KokoroTTSService()
    assert (svc.voice, svc.speed) == ("af_heart", 1.1)


def test_missing_model_file_raises_kokoro_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "KOKORO_MODEL_PATH", str(tmp_path / "missing.onnx"))
    with pytest.raises(kokoro_tts.KokoroUnavailable):
        kokoro_tts.KokoroTTSService().load()


def test_empty_text_is_rejected():
    with pytest.raises(ValueError):
        kokoro_tts.KokoroTTSService().synthesize_samples("   ")


def test_pcm16_wav_is_valid_24k_mono():
    wav = kokoro_tts.pcm16_wav(np.array([0.0, 0.5, -0.5, 2.0], dtype=np.float32))
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()) == (24000, 1, 2, 4)


# ── Cache ───────────────────────────────────────────────────────────────

def test_cache_is_lru_and_keyed_on_voice_speed_model():
    c = tts_service._AudioCache(max_items=2)
    k = lambda text, voice="v": c.key(text, voice, 1.0, "en-us", "m")  # noqa: E731
    assert k("hi") != k("hi", voice="other")
    c.put(k("a"), b"A"); c.put(k("b"), b"B")
    assert c.get(k("a")) == b"A"          # touch a -> b is now oldest
    c.put(k("c"), b"C")
    assert c.get(k("b")) is None and c.get(k("a")) == b"A" and c.get(k("c")) == b"C"


def test_only_static_phrases_are_cacheable():
    assert tts_service.is_cacheable("No worries,  let's move on.")
    assert not tts_service.is_cacheable("Tell me about your time at Acme Corp.")


# ── Fallback ────────────────────────────────────────────────────────────

async def _collect(text):
    return [c async for c in tts_service.stream_speech(text)]


def _fake_fallback(calls):
    async def fake(text, voice=None, lang="en"):
        calls.append(text)
        return b"ID3-fake-mp3"
    return fake


def test_kokoro_failure_falls_back_to_existing_provider(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "generate_tts_audio_async", _fake_fallback(calls))

    def boom(*a, **k):
        raise kokoro_tts.KokoroUnavailable("model missing")
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", boom)

    chunks = asyncio.run(_collect("First sentence here. Second sentence here."))
    assert [(c.provider, c.media_type) for c in chunks] == [("fallback", "audio/mpeg")]
    assert calls == ["First sentence here. Second sentence here."]  # one request for the rest


def test_fallback_mid_stream_covers_only_the_unspoken_rest(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "generate_tts_audio_async", _fake_fallback(calls))
    seen = []

    def flaky(chunk, cacheable):
        seen.append(chunk)
        if len(seen) > 1:
            raise RuntimeError("onnx blew up")
        return kokoro_tts.pcm16_wav(np.zeros(2400, dtype=np.float32))
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", flaky)

    chunks = asyncio.run(_collect("One sentence is here. Two sentences are here. Three are here."))
    assert [c.provider for c in chunks] == ["kokoro", "fallback"]
    assert calls == ["Two sentences are here. Three are here."]


def test_no_fallback_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "TTS_FALLBACK_ENABLED", False)
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    with pytest.raises(RuntimeError):
        asyncio.run(_collect("Hello there, how are you today?"))


def test_provider_edge_skips_kokoro(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "TTS_PROVIDER", "edge")
    monkeypatch.setattr(tts_service, "generate_tts_audio_async", _fake_fallback(calls))
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", lambda *a: pytest.fail("kokoro must not run"))
    assert [c.provider for c in asyncio.run(_collect("Hello there, how are you today?"))] == ["fallback"]


def test_empty_or_unspeakable_text_yields_nothing():
    assert asyncio.run(_collect("")) == []
    assert asyncio.run(_collect('{"a": 1}')) == []


# ── Interview WebSocket: streamed audio + barge-in ──────────────────────

@pytest.fixture()
def ws_env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'tts.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    monkeypatch.setattr(interview_api, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(interview_api, "generate_next_turn", lambda *a, **k: {
        "question": "Thanks for sharing that. Could you walk me through your most recent backend project?",
        "is_final": False,
    })
    return TestClient(app)  # no `with`: skips the heavy lifespan warmups


def _fake_stream(n_chunks, delay):
    async def fake(text, request_id=None):
        for seq in range(n_chunks):
            await asyncio.sleep(delay)
            yield tts_service.TTSChunk(seq, kokoro_tts.pcm16_wav(np.zeros(240, dtype=np.float32)),
                                       "audio/wav", "kokoro", 10)
    return fake


def test_ws_streams_turn_text_then_ordered_audio_chunks(ws_env, monkeypatch):
    monkeypatch.setattr(tts_service, "stream_speech", _fake_stream(3, 0.01))
    with ws_env.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "history": []})
        turn = ws.receive_json()
        assert turn["type"] == "turn_result" and turn["audio_stream"] is True and turn["audio_base64"] is None
        msgs = [ws.receive_json() for _ in range(4)]
    assert [m["type"] for m in msgs] == ["tts_chunk"] * 3 + ["tts_end"]
    assert [m["seq"] for m in msgs[:3]] == [0, 1, 2]
    assert all(m["turn_id"] == turn["turn_id"] for m in msgs)
    assert msgs[-1] == {"type": "tts_end", "turn_id": turn["turn_id"], "chunks": 3, "interrupted": False}


def test_ws_barge_in_cancels_pending_audio(ws_env, monkeypatch):
    monkeypatch.setattr(tts_service, "stream_speech", _fake_stream(50, 0.1))
    with ws_env.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "history": []})
        assert ws.receive_json()["type"] == "turn_result"
        assert ws.receive_json()["type"] == "tts_chunk"
        ws.send_json({"type": "barge_in", "timestamp": 1})
        rest = []
        while True:
            m = ws.receive_json()
            rest.append(m)
            if m["type"] == "tts_end":
                break
        # The next turn still works after an interruption.
        ws.send_json({"type": "next_turn", "history": []})
        assert ws.receive_json()["type"] == "turn_result"
    ack = next(m for m in rest if m["type"] == "barge_in_ack")
    assert ack["tts_cancelled"] is True
    assert rest[-1]["interrupted"] is True
    # Old audio stopped: at most the chunk already in flight, not the other ~48.
    assert sum(m["type"] == "tts_chunk" for m in rest) <= 2


def test_ws_tts_failure_ends_stream_without_leaking_errors(ws_env, monkeypatch):
    async def broken(text, request_id=None):
        raise RuntimeError("internal onnx path /secret/model.onnx")
        yield  # pragma: no cover
    monkeypatch.setattr(tts_service, "stream_speech", broken)
    with ws_env.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "history": []})
        assert ws.receive_json()["type"] == "turn_result"
        end = ws.receive_json()
    assert end["type"] == "tts_end" and end["error"] == "tts_unavailable"
    assert "secret" not in str(end)


def test_tts_http_endpoint_keeps_contract(ws_env, monkeypatch):
    async def fake_synth(text):
        return tts_service.TTSChunk(0, b"RIFF....WAVE", "audio/wav", "kokoro", 100)
    monkeypatch.setattr(tts_service, "synthesize", fake_synth)
    r = ws_env.post("/api/v1/tts", json={"text": "Hello there.", "language": "en",
                                          "voice": "en-US-AndrewMultilingualNeural"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert ws_env.post("/api/v1/tts", json={"text": "  "}).status_code == 400


# ── Real model ──────────────────────────────────────────────────────────

@needs_model
def test_real_kokoro_loads_once_under_concurrent_requests(monkeypatch):
    monkeypatch.setattr(settings, "KOKORO_DEVICE", "auto")
    svc = kokoro_tts.KokoroTTSService()
    results, errors = [], []

    def worker():
        try:
            results.append(svc.synthesize_wav("Concurrent request check."))
        except Exception as e:  # pragma: no cover - surfaced by the assert
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors and len(results) == 4
    assert svc.load_count == 1
    assert svc.device in ("cpu", "cuda")
    with wave.open(io.BytesIO(results[0])) as w:
        assert w.getframerate() == 24000 and w.getnframes() > 24000 * 0.5


@needs_model
def test_real_kokoro_streams_first_chunk_before_full_reply(monkeypatch):
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    tts_service.get_kokoro_service().load()
    text = ("Thanks for that. Could you walk me through a recent project where you designed "
            "a backend service end to end? What trade-offs did you make along the way?")

    async def run():
        t0 = time.perf_counter()
        stamps = []
        async for c in tts_service.stream_speech(text):
            assert c.provider == "kokoro" and c.media_type == "audio/wav"
            stamps.append(time.perf_counter() - t0)
        return stamps

    stamps = asyncio.run(run())
    assert len(stamps) == 3
    assert stamps[0] < stamps[-1] * 0.8   # audio was available well before the end


@needs_model
def test_speech_to_agent_to_kokoro_roundtrip(tmp_path, ws_env, monkeypatch):
    """User speech -> STT (faster-whisper) -> agent -> Kokoro -> audio.
    The 'user' is Kokoro itself (no microphone in CI); the agent's LLM is
    stubbed (ws_env) so the test is deterministic and makes no network call."""
    pytest.importorskip("faster_whisper")
    from app.services.audio_service import transcribe_audio

    svc = tts_service.get_kokoro_service()
    wav_path = tmp_path / "answer.wav"
    wav_path.write_bytes(svc.synthesize_wav("I have five years of experience building Python services."))
    transcript = " ".join(s["text"] for s in transcribe_audio(str(wav_path))).lower()
    assert "python" in transcript and "experience" in transcript

    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    with ws_env.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "history": [
            {"role": "interviewer", "text": "Tell me about yourself."},
            {"role": "candidate", "text": transcript},
        ]})
        assert ws.receive_json()["type"] == "turn_result"
        msgs = []
        while not msgs or msgs[-1]["type"] != "tts_end":
            msgs.append(ws.receive_json())
    chunks = [m for m in msgs if m["type"] == "tts_chunk"]
    assert len(chunks) >= 2 and all(c["mime"] == "audio/wav" for c in chunks)
    assert msgs[-1]["interrupted"] is False
