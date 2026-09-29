"""Interview speaker monitor (services/speaker_stream.py + speaker_monitor.py).

Unit tests drive the real state machine with deterministic stand-ins for the
two models: each synthetic "voice" is a constant PCM level, the fake VAD
calls non-zero audio speech, and the fake embedder maps each level to a fixed
ECAPA-like vector. test_real_models_* runs the real Silero VAD + ECAPA-TDNN
on real speech from two different people and is skipped unless
SPEAKER_TEST_AUDIO_DIR points at spk1.wav / spk2.wav (16 kHz mono) — the
clips used during development are third-party and not committed."""
import os
import time
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import database, models
from app.api import deps
from app.config import settings
from app.database import get_db
from app.main import app
from app.models import HR_ADMIN, User
from app.services import interview_live, speaker_monitor as sm, speaker_stream as ss

SR = 16000
RNG = np.random.default_rng(11)
DIM = 192
VOICES = {i: sm.normalize(RNG.normal(size=DIM)) for i in range(1, 5)}  # 1 = candidate
LEVEL = {i: i * 0.05 for i in VOICES}  # PCM amplitude that encodes each voice


def fake_vad(window):
    return float(np.mean(np.abs(window) > 1e-4))


def fake_embed(windows):
    out = []
    for w in windows:
        vals = np.round(np.abs(w[np.abs(w) > 1e-4]) / 0.05).astype(int)
        voice = int(np.bincount(vals).argmax()) if len(vals) else 1
        noise = sm.normalize(np.random.default_rng(int(voice * 1000 + len(out))).normal(size=DIM))
        out.append(sm.normalize(VOICES[voice] + 0.25 * noise))
    return np.stack(out)


def pcm(spec):
    """spec: list of (voice or None for silence, seconds) -> int16 bytes."""
    parts = []
    for voice, secs in spec:
        n = int(secs * SR)
        parts.append(np.zeros(n) if voice is None else np.full(n, LEVEL[voice]))
    return (np.concatenate(parts) * 32767).astype("<i2").tobytes()


def session(reference=True, **kw):
    return ss.SpeakerStreamSession(
        session_id=kw.pop("session_id", "s1"),
        reference=VOICES[1] if reference else None,
        reference_source="voiceprint" if reference else None,
        vad_fn=kw.pop("vad_fn", fake_vad), embed_fn=kw.pop("embed_fn", fake_embed), **kw,
    )


def run(s, spec, chunk_seconds=0.25):
    """Feed audio in real-time-sized chunks, processing as the manager would."""
    events = []
    data = pcm(spec)
    step = int(chunk_seconds * SR) * 2
    for i in range(0, len(data), step):
        s.add_pcm(data[i:i + step])
        if s.ready():
            events += s.process()
    return events


def names(events):
    return [e["event"] for e in events if e["event"] not in ss.LIVE_ONLY]


def find(events, name):
    return [e for e in events if e["event"] == name]


# ── Pure helpers ────────────────────────────────────────────────────────

def test_classify_thresholds():
    assert sm.classify(0.9, 0.45, 0.25) == sm.CANDIDATE
    assert sm.classify(0.1, 0.45, 0.25) == sm.UNKNOWN
    assert sm.classify(0.35, 0.45, 0.25) == sm.UNRESOLVED
    assert sm.classify(0.45, 0.45, 0.25) == sm.CANDIDATE
    assert sm.classify(0.25, 0.45, 0.25) == sm.UNKNOWN


def test_live_measured_similarities_classify_correctly_with_defaults():
    """Per-window similarities measured on real speech (candidate's held-out
    speech, then a different real person) land on the right side of the
    configured defaults."""
    hi, lo = settings.SPEAKER_CANDIDATE_THRESHOLD, settings.SPEAKER_UNKNOWN_THRESHOLD
    assert all(sm.classify(s, hi, lo) == sm.CANDIDATE for s in [0.37, 0.37, 0.48, 0.52])
    assert all(sm.classify(s, hi, lo) == sm.UNKNOWN for s in [0.04, -0.03, 0.03, -0.07, 0.01, 0.02, 0.06])


def test_cluster_assignment_separates_two_extra_speakers():
    cents = []
    assert sm.assign_cluster(cents, VOICES[2], 0.45) == (0, True)
    assert sm.assign_cluster(cents, VOICES[2], 0.45) == (0, False)
    assert sm.assign_cluster(cents, VOICES[3], 0.45) == (1, True)


# ── State machine ───────────────────────────────────────────────────────

def test_candidate_only_confirms_candidate_and_no_multi_speaker_event():
    ev = run(session(), [(1, 8), (None, 2)])
    assert names(ev).count(ss.CANDIDATE_SPEAKER_CONFIRMED) == 1
    assert not find(ev, ss.MULTIPLE_SPEAKERS_DETECTED) and not find(ev, ss.UNKNOWN_SPEAKER_STARTED)
    assert find(ev, ss.SPEECH_STARTED) and find(ev, ss.SPEECH_ENDED)


def test_second_speaker_detected_then_cleared_when_they_stop():
    s = session()
    ev = run(s, [(1, 4), (2, 6), (1, 4)])
    started = find(ev, ss.UNKNOWN_SPEAKER_STARTED)[0]
    detected = find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)[0]
    ended = find(ev, ss.UNKNOWN_SPEAKER_ENDED)[0]
    cleared = find(ev, ss.MULTIPLE_SPEAKERS_CLEARED)[0]
    assert detected["speakers_detected"] == 2 and detected["additional_speakers"] == 1 and detected["candidate_present"]
    assert started["speaker_id"] == detected["speaker_id"] == "speaker_2"
    assert 3.0 <= started["stream_seconds"] <= 4.5          # other voice starts at 4.0s
    assert 5000 <= ended["duration_ms"] <= 7000             # ~6s of other voice
    assert cleared["additional_speakers"] == 1
    assert names(ev).index(ss.MULTIPLE_SPEAKERS_DETECTED) < names(ev).index(ss.MULTIPLE_SPEAKERS_CLEARED)
    assert s.audio_context()["additional_speaker_detected"] is False


def test_short_foreign_fragment_never_creates_an_event():
    ev = run(session(), [(1, 4), (2, 1.0), (1, 4)])
    assert not find(ev, ss.UNKNOWN_SPEAKER_STARTED) and not find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)


def test_third_speaker_increases_additional_speaker_count():
    ev = run(session(), [(1, 4), (2, 4), (3, 4), (1, 4)])
    counts = [e["additional_speakers"] for e in find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)]
    assert counts == [1, 2]
    assert find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)[-1]["speakers_detected"] == 3
    assert {e["speaker_id"] for e in find(ev, ss.UNKNOWN_SPEAKER_STARTED)} == {"speaker_2", "speaker_3"}
    assert len(find(ev, ss.MULTIPLE_SPEAKERS_CLEARED)) == 1


def test_unknown_speaker_alone_is_not_reported_as_multiple_speakers():
    ev = run(session(), [(2, 5)])
    started = find(ev, ss.UNKNOWN_SPEAKER_STARTED)[0]
    assert started["candidate_present"] is False
    assert not find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)


def test_silence_after_extra_voice_clears_the_condition():
    ev = run(session(), [(1, 3), (2, 4), (None, 4)])
    assert find(ev, ss.MULTIPLE_SPEAKERS_DETECTED) and find(ev, ss.MULTIPLE_SPEAKERS_CLEARED)


def test_foreign_voice_while_ai_speaks_is_unresolved_not_an_extra_person():
    s = session()
    ev = run(s, [(1, 3)])
    s.set_phase(ss.PHASE_AI_SPEAKING)
    ev += run(s, [(2, 5)])
    assert not find(ev, ss.UNKNOWN_SPEAKER_STARTED) and not find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)
    assert find(ev, ss.SPEAKER_UNRESOLVED)[0]["reason"] == "possible_interviewer_audio"


def test_hysteresis_rapid_alternation_does_not_oscillate():
    spec = [(1, 3)] + [(2, 0.75), (1, 0.75)] * 6 + [(1, 3)]
    ev = run(session(), spec)
    assert not find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)
    assert len(find(ev, ss.MULTIPLE_SPEAKERS_CLEARED)) == 0


def test_ambiguous_voice_is_unresolved():
    mid = (settings.SPEAKER_UNKNOWN_THRESHOLD + settings.SPEAKER_CANDIDATE_THRESHOLD) / 2
    orth = sm.normalize(VOICES[4] - np.dot(VOICES[4], VOICES[1]) * VOICES[1])
    ambiguous = sm.normalize(mid * VOICES[1] + np.sqrt(1 - mid ** 2) * orth)

    def embed(windows):
        return np.stack([ambiguous if abs(np.max(np.abs(w)) - LEVEL[4]) < 0.01 else VOICES[1] for w in windows])

    ev = run(session(embed_fn=embed), [(1, 3), (4, 5)])
    assert find(ev, ss.SPEAKER_UNRESOLVED)[0]["reason"] == "ambiguous_similarity"
    assert not find(ev, ss.UNKNOWN_SPEAKER_STARTED)


def test_enrollment_from_answers_when_no_voiceprint():
    s = session(reference=False)
    s.set_phase(ss.PHASE_AI_SPEAKING)
    ev = run(s, [(1, 6)])                 # candidate audio while AI speaks: never enrolled
    assert s.enrolled_s == 0
    s.set_phase(ss.PHASE_CANDIDATE, turn_index=0)
    ev += run(s, [(1, 12)])
    confirmed = find(ev, ss.CANDIDATE_SPEAKER_CONFIRMED)[0]
    assert confirmed["reason"] == "enrolled_from_answers" and confirmed["turn_index"] == 0
    assert s.reference_source == "interview_enrollment"
    ev += run(s, [(2, 4)])
    assert find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)


def test_no_reference_by_end_reports_voice_reference_unavailable():
    s = session(reference=False)
    run(s, [(1, 4)])
    fin = s.finish()
    assert names(fin) == [ss.VOICE_REFERENCE_UNAVAILABLE, ss.AUDIO_STREAM_STOPPED]


def test_model_outage_degrades_then_recovers_without_stopping():
    broken = {"on": False}

    def embed(windows):
        if broken["on"]:
            raise RuntimeError("encoder unavailable")
        return fake_embed(windows)

    s = session(embed_fn=embed)
    ev = run(s, [(1, 3)])
    broken["on"] = True
    ev += run(s, [(1, 3)])
    assert s.audio_context()["analysis_status"] == "degraded"
    broken["on"] = False
    ev += run(s, [(1, 2), (2, 4)])
    assert names(ev).count(ss.AUDIO_ANALYSIS_DEGRADED) == 1
    assert names(ev).count(ss.AUDIO_ANALYSIS_RECOVERED) == 1
    assert find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)  # analysis works again after recovery


def test_buffer_is_bounded_when_analysis_falls_behind():
    s = session()
    s.add_pcm(pcm([(1, 60)]))                # 60s arrives without any processing
    assert len(s.buffer) <= int(settings.SPEAKER_MAX_BUFFER_SECONDS * SR)
    assert s.stats["dropped"] >= 60 - settings.SPEAKER_MAX_BUFFER_SECONDS - 1


def test_concurrent_sessions_are_isolated():
    a, b = session(session_id="a"), session(session_id="b")
    ev_a, ev_b = [], []
    data_a, data_b = pcm([(1, 4), (2, 6)]), pcm([(1, 10)])
    step = int(0.25 * SR) * 2
    for i in range(0, len(data_a), step):     # interleaved, like two live interviews
        a.add_pcm(data_a[i:i + step]); ev_a += a.process()
        b.add_pcm(data_b[i:i + step]); ev_b += b.process()
    assert find(ev_a, ss.MULTIPLE_SPEAKERS_DETECTED)
    assert not find(ev_b, ss.MULTIPLE_SPEAKERS_DETECTED) and not find(ev_b, ss.UNKNOWN_SPEAKER_STARTED)
    assert a.centroids and not b.centroids


def test_events_never_carry_embeddings():
    ev = run(session(), [(1, 4), (2, 6), (1, 4)]) + session().finish()
    for e in ev:
        for v in e.values():
            assert not (isinstance(v, (list, np.ndarray)) and len(v) >= 64)


# ── Persistence + WebSocket + API (real app, fake models) ───────────────

@pytest.fixture()
def env(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'spk.db'}", connect_args={"check_same_thread": False})
    models.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(database, "SessionLocal", Session)
    monkeypatch.setattr(sm, "vad_speech_ratio", fake_vad)
    monkeypatch.setattr(sm, "embed_windows", fake_embed)

    db = Session()
    sid = str(uuid.uuid4())
    db.add(models.ScreeningSession(id=sid, email="cand@example.com", role_title="Engineer", status="in_progress"))
    job = models.Role(id=str(uuid.uuid4()), title=f"Role {sid[:6]}", status="open")
    cand = models.Candidate(id=str(uuid.uuid4()), name="Cand", email="cand@example.com")
    db.add_all([job, cand]); db.flush()
    appl = models.Application(id=str(uuid.uuid4()), candidate_id=cand.id, job_id=job.id, stage="INTERVIEW")
    db.add(appl); db.flush()
    db.add(models.Interview(id=str(uuid.uuid4()), application_id=appl.id, candidate_id=cand.id, job_id=job.id,
                            mode="ai_screening", status="scheduled", screening_session_id=sid))
    # Existing platform enrollment for this candidate's email -> used as the reference.
    db.add(models.VoicePrint(id=str(uuid.uuid4()), speaker_name="Cand", email="Cand@Example.com",
                             embedding=VOICES[1].tolist(), status="active"))
    db.commit()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[deps.get_current_user] = lambda: User(id="hr", email="hr@x.com", role=HR_ADMIN, name="HR")
    yield {"Session": Session, "sid": sid, "cand_id": cand.id}
    app.dependency_overrides.clear()


def recv_until(ws, event, timeout=20):
    seen = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        msg = ws.receive_json()
        seen.append(msg)
        if msg.get("event") == event:
            return seen
    raise AssertionError(f"{event} not received; got {[m.get('event') or m.get('type') for m in seen]}")


def test_rate_limit_drops_audio_arriving_faster_than_real_time(env):
    import asyncio

    async def scenario():
        mgr = ss.StreamManager()
        ok, _ = await mgr.start(env["sid"], owner="sock")
        assert ok
        s = mgr._sessions[env["sid"]]
        for _ in range(40):                     # 40s of audio pushed instantly
            await mgr.feed(env["sid"], pcm([(1, 1)]))
        accepted = s.received / SR
        await mgr.stop(env["sid"])
        return accepted

    accepted = asyncio.run(scenario())
    assert accepted <= settings.SPEAKER_MAX_REALTIME_FACTOR + 1


def test_websocket_stream_end_to_end_with_persistence(env, monkeypatch):
    # This test pushes 14s of audio in well under a second; the real-time
    # rate limit (covered above) would otherwise drop most of it.
    monkeypatch.setattr(settings, "SPEAKER_MAX_REALTIME_FACTOR", 1000.0)
    sid = env["sid"]
    with TestClient(app) as client:
        with client.websocket_connect(f"/api/v1/interview/ws/{sid}") as ws:
            ws.send_bytes(pcm([(2, 1)]))               # before start: ignored
            ws.send_json({"type": "audio_stream_start", "consent": False})
            assert ws.receive_json() == {"type": "audio_stream_status", "status": "rejected", "reason": "consent_required"}
            ws.send_json({"type": "audio_stream_start", "consent": True})
            msgs = recv_until(ws, ss.AUDIO_STREAM_STARTED)
            ws.send_json({"type": "audio_phase", "phase": "candidate", "turn_index": 0})
            data = pcm([(1, 4), (2, 6), (1, 4)])
            step = int(0.25 * SR) * 2
            for i in range(0, len(data), step):
                ws.send_bytes(data[i:i + step])
                time.sleep(0.01)
            msgs += recv_until(ws, ss.MULTIPLE_SPEAKERS_CLEARED)
            ws.send_json({"type": "audio_stream_stop"})
            msgs += recv_until(ws, ss.AUDIO_STREAM_STOPPED)

    got = [m.get("event") for m in msgs if m.get("type") == "audio_speaker_event"]
    for e in (ss.AUDIO_STREAM_STARTED, ss.CANDIDATE_SPEAKER_CONFIRMED, ss.MULTIPLE_SPEAKERS_DETECTED,
              ss.MULTIPLE_SPEAKERS_CLEARED, ss.AUDIO_STREAM_STOPPED):
        assert e in got, (e, got)
    assert any(m.get("type") == "audio_speaker_state" for m in msgs)

    db = env["Session"]()
    rows = db.query(models.InterviewAudioEvent).filter_by(session_id=sid).all()
    types = [r.event_type for r in rows]
    assert ss.MULTIPLE_SPEAKERS_DETECTED in types and ss.SPEECH_STARTED not in types
    assert all(r.candidate_id == env["cand_id"] for r in rows)
    acts = db.query(models.CandidateActivity).filter_by(candidate_id=env["cand_id"]).all()
    assert any(a.event_type == "interview.audio.multiple_speakers_detected" for a in acts)
    base = db.get(models.InterviewSpeakerBaseline, sid)
    assert base.reference_source == "voiceprint" and base.embedding_sum is None  # VoicePrint never copied
    db.close()


def test_audio_events_api_returns_events_without_embeddings(env):
    s = ss.SpeakerStreamSession(session_id=env["sid"], reference=VOICES[1], reference_source="voiceprint",
                                candidate_id=env["cand_id"], vad_fn=fake_vad, embed_fn=fake_embed)
    ev = run(s, [(1, 4), (2, 6), (1, 4)]) + s.finish()
    db = env["Session"]()
    ss.persist(db, s, ev)
    ss.persist(db, s, ev)  # retried write: deduplicated
    assert db.query(models.InterviewAudioEvent).filter_by(event_type=ss.MULTIPLE_SPEAKERS_DETECTED).count() == 1
    db.close()
    with TestClient(app) as client:
        body = client.get(f"/api/v1/interview/{env['sid']}/audio-events").json()
    assert body["reference_source"] == "voiceprint"
    assert any(e["event_type"] == ss.MULTIPLE_SPEAKERS_DETECTED for e in body["events"])
    assert "embedding" not in str(body) and "centroid" not in str(body)


def test_audio_events_api_requires_auth(env):
    app.dependency_overrides.pop(deps.get_current_user, None)
    with TestClient(app) as client:
        assert client.get(f"/api/v1/interview/{env['sid']}/audio-events").status_code == 401


def test_stream_refused_for_completed_interview(env):
    db = env["Session"]()
    db.get(models.ScreeningSession, env["sid"]).status = "completed"
    db.commit(); db.close()
    with TestClient(app) as client:
        with client.websocket_connect(f"/api/v1/interview/ws/{env['sid']}") as ws:
            ws.send_json({"type": "audio_stream_start", "consent": True})
            assert ws.receive_json() == {"type": "audio_stream_status", "status": "unavailable",
                                         "reason": "interview already completed"}


def test_publish_drops_dead_socket_without_raising():
    import asyncio
    import threading

    class DeadSocket:
        async def send_json(self, _msg):
            raise RuntimeError("disconnected")

    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()
    try:
        interview_live.register("s-dead", DeadSocket(), loop)
        assert interview_live.publish("s-dead", {"type": "x"}) == 0
    finally:
        loop.call_soon_threadsafe(loop.stop)


# ── Real models on real speech (skipped without local audio) ───────────

AUDIO_DIR = os.environ.get("SPEAKER_TEST_AUDIO_DIR")


@pytest.mark.skipif(not AUDIO_DIR, reason="set SPEAKER_TEST_AUDIO_DIR to run against real models + real speech")
def test_real_models_stream_detects_and_clears_second_real_speaker():
    import soundfile as sf

    a, _ = sf.read(os.path.join(AUDIO_DIR, "spk1.wav"), dtype="float32")
    b, _ = sf.read(os.path.join(AUDIO_DIR, "spk2.wav"), dtype="float32")
    s = ss.SpeakerStreamSession(session_id="real")        # real Silero + real ECAPA
    s.set_phase(ss.PHASE_CANDIDATE, 0)
    audio = np.concatenate([b[:12 * SR], b[12 * SR:], a[:6 * SR], b[:4 * SR], np.zeros(2 * SR, dtype=np.float32)])
    data = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    ev = []
    step = int(0.25 * SR) * 2
    for i in range(0, len(data), step):
        s.add_pcm(data[i:i + step])
        if s.ready():
            ev += s.process()
    got = names(ev)
    assert ss.CANDIDATE_SPEAKER_CONFIRMED in got
    detected = find(ev, ss.MULTIPLE_SPEAKERS_DETECTED)
    assert len(detected) == 1 and detected[0]["additional_speakers"] == 1
    other_starts = 15.3                                     # where speaker A begins in the stream
    assert abs(detected[0]["stream_seconds"] - other_starts) <= 1.5
    assert ss.MULTIPLE_SPEAKERS_CLEARED in got
