"""LLM token streaming -> sentence buffer -> Kokoro -> WebSocket.

Proves the property the feature exists for: the first sentence's audio is
sent while the LLM is still generating the rest. LLM and Kokoro are faked
with controllable timing (network/model-free, deterministic); the real
browser run is documented in docs/kokoro-tts.md."""

import asyncio
import time
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.api import interview as interview_api
from app.config import settings
from app.main import app
from app.services import interview_service, kokoro_tts, llm_stream, tts_service
from app.services.speech_formatter import SentenceChunker


def feed_tokens(text, size=3):
    """Split text into small token-like deltas, as an LLM stream would."""
    return [text[i:i + size] for i in range(0, len(text), size)]


def chunk_stream(tokens):
    c = SentenceChunker()
    out = []
    for t in tokens:
        out.extend(c.feed(t))
    out.extend(c.flush())
    return out


# ── Sentence buffer ─────────────────────────────────────────────────────

@pytest.mark.parametrize("size", [1, 3, 7])
def test_buffer_respects_abbreviations_numbers_and_initials(size):
    text = ("Dr. Smith mentioned e.g. caching and i.e. Redis. We moved to Python 3.11 and pi is 3.14 here. "
            "Mr. J. Doe agreed; what would you change first?")
    assert chunk_stream(feed_tokens(text, size)) == [
        "Dr. Smith mentioned e.g. caching and i.e. Redis.",
        "We moved to Python 3.11 and pi is 3.14 here.",
        "Mr. J. Doe agreed;",
        "what would you change first?",
    ]


def test_buffer_never_emits_word_sized_fragments():
    out = chunk_stream(feed_tokens("That's a good approach. Can you explain how you handled scalability?", 1))
    assert out == ["That's a good approach.", "Can you explain how you handled scalability?"]
    assert chunk_stream(feed_tokens("Sure! Tell me more about it.", 2)) == ["Sure! Tell me more about it."]


def test_buffer_emits_first_sentence_before_stream_ends():
    c = SentenceChunker()
    emitted = []
    for t in feed_tokens("That's a good approach. Can you explain how you handled", 2):
        emitted.extend(c.feed(t))
    assert emitted == ["That's a good approach."]   # second sentence still incomplete


def test_buffer_ignores_empty_chunks():
    c = SentenceChunker()
    assert list(c.feed("")) == [] and list(c.flush()) == []


# ── Provider streaming (llm_stream.stream_text) ─────────────────────────

class FakeKey:
    def __init__(self, label, api_key="gsk_fake"):
        self.label, self.api_key = label, api_key


class FakeKeys:
    def __init__(self, groq=("g1", "g2"), gemini=("m1",)):
        self.keys = {"groq": [FakeKey(k) for k in groq], "gemini": [FakeKey(k, "AIza") for k in gemini]}
        self.cooled = []

    def get_next_key(self, provider, excluded_labels=None):
        for k in self.keys.get(provider, []):
            if k.label not in (excluded_labels or set()):
                return k
        return None

    def mark_cooldown(self, key, error_type=""):
        self.cooled.append(key.label)


def install(monkeypatch, groq_fn, gemini_fn=None, keys=None):
    keys = keys or FakeKeys()
    monkeypatch.setattr(llm_stream, "key_manager", keys)
    monkeypatch.setattr(llm_stream, "_groq_stream", groq_fn)
    if gemini_fn:
        monkeypatch.setattr(llm_stream, "_gemini_stream", gemini_fn)
    monkeypatch.setattr(llm_stream, "_record_cost", lambda *a, **k: None)
    return keys


async def collect(agen):
    return [x async for x in agen]


def test_stream_fails_over_before_first_token_and_cools_rate_limited_keys(monkeypatch):
    calls = []

    async def groq(api_key, model, system, prompt, usage):
        calls.append(model)
        if model == llm_stream.GROQ_MODELS[0]:
            raise llm_stream._HTTPStatusError(429, "rate limit")
        yield "never reached"

    async def gemini(api_key, model, system, prompt, usage):
        yield "Hello "
        yield "there."

    keys = install(monkeypatch, groq, gemini)
    timings = {}
    out = asyncio.run(collect(llm_stream.stream_text("p", "s", timings=timings)))
    assert "".join(out) == "Hello there."
    assert keys.cooled == ["g1", "g2"]                    # 429 -> cooldown -> next key
    assert timings["provider"] == "gemini" and "llm_first_token" in timings


def test_stream_mid_reply_failure_ends_reply_without_restarting(monkeypatch):
    starts = []

    async def groq(api_key, model, system, prompt, usage):
        starts.append(model)
        yield "First sentence. "
        raise RuntimeError("connection reset")

    install(monkeypatch, groq)
    out = asyncio.run(collect(llm_stream.stream_text("p", "s")))
    assert out == ["First sentence. "] and len(starts) == 1   # no second provider re-speaking


def test_stream_all_providers_failing_raises(monkeypatch):
    async def bad(api_key, model, system, prompt, usage):
        raise RuntimeError("down")
        yield  # pragma: no cover

    install(monkeypatch, bad, bad)
    with pytest.raises(llm_stream.StreamFailed):
        asyncio.run(collect(llm_stream.stream_text("p", "s")))


def test_cancelling_consumer_closes_provider_stream(monkeypatch):
    state = {"closed": False}

    async def groq(api_key, model, system, prompt, usage):
        try:
            for i in range(1000):
                yield f"token{i} "
                await asyncio.sleep(0.01)
        finally:
            state["closed"] = True

    install(monkeypatch, groq)

    async def run():
        agen = llm_stream.stream_text("p", "s")
        got = [await agen.__anext__() for _ in range(3)]
        await agen.aclose()
        return got

    assert len(asyncio.run(run())) == 3
    assert state["closed"], "the HTTP/token stream must be closed on cancellation"


# ── Interviewer turn (marker + fallback) ────────────────────────────────

def _fake_stream_text(pieces, delay=0.0):
    async def fake(prompt, system, timings=None, langfuse_trace_id=None):
        if timings is not None:
            timings["llm_first_token"] = time.perf_counter()
        for p in pieces:
            if delay:
                await asyncio.sleep(delay)
            yield p
    return fake


def run_turn(monkeypatch, pieces, history=None, max_turns=6):
    monkeypatch.setattr(llm_stream, "stream_text", _fake_stream_text(pieces))
    result = {}
    text = "".join(asyncio.run(collect(interview_service.stream_next_turn(
        history or [{"role": "candidate", "text": "hi"}], max_turns=max_turns, result=result))))
    return text, result


def test_final_marker_split_across_tokens_is_stripped(monkeypatch):
    text, result = run_turn(monkeypatch, ["[[", "EN", "D]] Thank", " you for your time."])
    assert text == "Thank you for your time." and result["is_final"] is True


def test_no_marker_and_turn_limit_forces_final(monkeypatch):
    text, result = run_turn(monkeypatch, ["Great. ", "What next?"])
    assert text == "Great. What next?" and result["is_final"] is False
    hist = [{"role": "candidate", "text": "a"}] * 3
    _, result = run_turn(monkeypatch, ["Thanks. "], history=hist, max_turns=3)
    assert result["is_final"] is True


def test_llm_failure_or_empty_reply_speaks_fallback_question(monkeypatch):
    async def failing(prompt, system, timings=None, langfuse_trace_id=None):
        raise llm_stream.StreamFailed("down")
        yield  # pragma: no cover
    monkeypatch.setattr(llm_stream, "stream_text", failing)
    result = {}
    out = asyncio.run(collect(interview_service.stream_next_turn([], result=result)))
    assert out == [interview_service.FALLBACK_QUESTION] and result["fallback"]
    text, result = run_turn(monkeypatch, ["   "])
    assert text == interview_service.FALLBACK_QUESTION and result["fallback"]


# ── Incremental TTS pipeline (overlap, order, failure, cancellation) ────

def fake_wav(chunk, cacheable):
    time.sleep(0.02 + 0.001 * (len(chunk) % 7))   # uneven synthesis times
    return kokoro_tts.pcm16_wav(np.zeros(240, dtype=np.float32))


async def slow_llm(sentences, gap, closed=None):
    try:
        for s in sentences:
            for tok in feed_tokens(s + " ", 4):
                yield tok
            await asyncio.sleep(gap)
    finally:
        if closed is not None:
            closed["closed"] = True


def test_first_audio_is_ready_while_llm_is_still_generating(monkeypatch):
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", fake_wav)
    sentences = ["That's a good approach.", "Can you explain how you handled scalability?", "What broke first?"]

    async def run():
        timings = {}
        order, first_yield_at = [], None
        async for s in tts_service.stream_speech_incremental(slow_llm(sentences, 0.3), timings=timings):
            first_yield_at = first_yield_at or time.perf_counter()
            order.append((s.chunk.seq, s.text))
        return timings, order, first_yield_at

    timings, order, first_yield_at = asyncio.run(run())
    assert [t for _, t in order] == sentences and [s for s, _ in order] == [0, 1, 2]
    assert first_yield_at < timings["llm_done"] - 0.4, "audio 1 must exist long before the LLM finishes"


def test_kokoro_failure_mid_reply_uses_fallback_for_remaining_sentences(monkeypatch):
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    n = {"calls": 0}

    def flaky(chunk, cacheable):
        n["calls"] += 1
        if n["calls"] > 1:
            raise RuntimeError("onnx failure")
        return kokoro_tts.pcm16_wav(np.zeros(240, dtype=np.float32))

    async def fb(text, voice=None, lang="en"):
        return b"ID3-mp3"

    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", flaky)
    monkeypatch.setattr(tts_service, "generate_tts_audio_async", fb)

    async def run():
        return [s async for s in tts_service.stream_speech_incremental(
            slow_llm(["One is here.", "Two is here.", "Three is here."], 0))]

    got = asyncio.run(run())
    assert [(s.chunk.provider, s.text) for s in got] == [
        ("kokoro", "One is here."), ("fallback", "Two is here."), ("fallback", "Three is here.")]


def test_closing_pipeline_cancels_llm_and_drops_queued_sentences(monkeypatch):
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", fake_wav)
    closed = {"closed": False}

    async def run():
        agen = tts_service.stream_speech_incremental(slow_llm([f"Sentence number {i} is here." for i in range(50)],
                                                              0.05, closed))
        first = await agen.__anext__()
        await agen.aclose()
        return first

    first = asyncio.run(run())
    assert first.chunk.seq == 0
    assert closed["closed"], "LLM generation must be stopped, not left running in the background"


# ── WebSocket end to end (fake LLM + fake Kokoro, real app routing) ─────

@pytest.fixture()
def ws_env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'stream.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(interview_api, "SessionLocal", Session)
    monkeypatch.setattr(settings, "TTS_PROVIDER", "kokoro")
    monkeypatch.setattr(tts_service, "_kokoro_chunk_wav", fake_wav)
    return TestClient(app), Session


def install_llm(monkeypatch, sentences, gap, closed=None):
    async def fake(history, role_title="", jd_text=None, max_turns=6, resume_context=None, result=None, timings=None):
        if result is not None:
            result.update({"is_final": False, "fallback": False})
        async for tok in slow_llm(sentences, gap, closed):
            if timings is not None:
                timings.setdefault("llm_first_token", time.perf_counter())
            yield tok
    monkeypatch.setattr(interview_api, "stream_next_turn", fake)


def read_until(ws, kind):
    msgs = []
    while True:
        m = ws.receive_json()
        msgs.append(m)
        if m["type"] == kind:
            return msgs


def test_ws_streams_audio_before_llm_finishes_and_records_full_text(ws_env, monkeypatch):
    client, Session = ws_env
    sid = str(uuid.uuid4())
    db = Session()
    db.add(models.ScreeningSession(id=sid, email="c@x.com", role_title="Eng", status="in_progress",
                                   transcript=[{"role": "interviewer", "text": "Hi, tell me about yourself."}]))
    db.commit(); db.close()
    sentences = ["That's a good approach.", "Can you explain how you handled scalability?"]
    install_llm(monkeypatch, sentences, gap=0.4)

    with client.websocket_connect(f"/api/v1/interview/ws/{sid}") as ws:
        ws.send_json({"type": "next_turn", "stream_llm": True, "history": [
            {"role": "interviewer", "text": "Hi, tell me about yourself."},
            {"role": "candidate", "text": "I build APIs."}]})
        msgs = read_until(ws, "tts_end")

    kinds = [m["type"] for m in msgs]
    assert kinds[0] == "turn_start"
    # Overlap: sentence 1's audio went out BEFORE the LLM finished (turn_result).
    assert kinds.index("tts_chunk") < kinds.index("turn_result")
    chunks = [m for m in msgs if m["type"] == "tts_chunk"]
    assert [c["seq"] for c in chunks] == [0, 1] and [c["text"] for c in chunks] == sentences
    result = next(m for m in msgs if m["type"] == "turn_result")
    assert result["question"] == " ".join(sentences) and result["streamed"] and not result["interrupted"]
    db = Session()
    stored = db.get(models.ScreeningSession, sid).transcript
    assert stored[-1] == {"role": "interviewer", "text": " ".join(sentences)}
    assert stored[-2] == {"role": "candidate", "text": "I build APIs."}
    db.close()


def test_ws_barge_in_cancels_llm_queue_and_records_only_generated_text(ws_env, monkeypatch):
    client, _ = ws_env
    closed = {"closed": False}
    install_llm(monkeypatch, [f"Point number {i} is important." for i in range(40)], gap=0.15, closed=closed)
    with client.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        before = read_until(ws, "tts_chunk")
        ws.send_json({"type": "barge_in", "timestamp": 1})
        after = read_until(ws, "tts_end")
        # Session keeps working after the interruption.
        install_llm(monkeypatch, ["Okay, go ahead."], gap=0)
        ws.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        nxt = read_until(ws, "tts_end")

    turn_id = before[0]["turn_id"]
    assert next(m for m in after if m["type"] == "barge_in_ack")["tts_cancelled"] is True
    result = next(m for m in after if m["type"] == "turn_result")
    assert result["interrupted"] is True and result["is_final"] is False
    assert 0 < result["question"].count("Point number") < 10       # partial, not all 40
    assert after[-1] == {"type": "tts_end", "turn_id": turn_id, "chunks": after[-1]["chunks"], "interrupted": True}
    assert closed["closed"], "LLM generation must stop on barge-in"
    stale = [m for m in nxt if m.get("turn_id") == turn_id]
    assert stale == [], "no audio from the interrupted turn may arrive later"
    assert next(m for m in nxt if m["type"] == "turn_result")["question"] == "Okay, go ahead."


def test_ws_llm_failure_speaks_fallback_question(ws_env, monkeypatch):
    client, _ = ws_env

    async def failing(prompt, system, timings=None, langfuse_trace_id=None):
        raise llm_stream.StreamFailed("all providers down")
        yield  # pragma: no cover
    monkeypatch.setattr(llm_stream, "stream_text", failing)
    with client.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        msgs = read_until(ws, "tts_end")
    result = next(m for m in msgs if m["type"] == "turn_result")
    assert result["question"] == interview_service.FALLBACK_QUESTION
    assert any(m["type"] == "tts_chunk" for m in msgs) and "down" not in str(msgs)


def test_ws_disconnect_mid_stream_stops_llm(ws_env, monkeypatch):
    client, _ = ws_env
    closed = {"closed": False}
    install_llm(monkeypatch, [f"Sentence {i} goes here." for i in range(200)], gap=0.05, closed=closed)
    with client.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        read_until(ws, "tts_chunk")
    deadline = time.time() + 10
    while not closed["closed"] and time.time() < deadline:
        time.sleep(0.05)
    assert closed["closed"], "a closed socket must not leave the LLM generating"


def test_two_sessions_stream_independently_in_order(ws_env, monkeypatch):
    client, _ = ws_env
    install_llm(monkeypatch, ["Alpha one is here.", "Alpha two is here.", "Alpha three is here."], gap=0.05)
    with client.websocket_connect("/api/v1/interview/ws/sess-a") as a, \
            client.websocket_connect("/api/v1/interview/ws/sess-b") as b:
        a.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        b.send_json({"type": "next_turn", "stream_llm": True, "history": []})
        ma, mb = read_until(a, "tts_end"), read_until(b, "tts_end")
    for msgs in (ma, mb):
        ids = {m["turn_id"] for m in msgs if "turn_id" in m}
        assert len(ids) == 1
        assert [m["seq"] for m in msgs if m["type"] == "tts_chunk"] == [0, 1, 2]
    assert ma[0]["turn_id"] != mb[0]["turn_id"]


def test_ws_without_stream_flag_keeps_old_contract(ws_env, monkeypatch):
    client, _ = ws_env
    monkeypatch.setattr(interview_api, "generate_next_turn", lambda *a, **k: {"question": "Tell me more.", "is_final": False})
    with client.websocket_connect("/api/v1/interview/ws/demo-session") as ws:
        ws.send_json({"type": "next_turn", "history": []})
        msgs = read_until(ws, "tts_end")
    assert msgs[0]["type"] == "turn_result" and "streamed" not in msgs[0]
