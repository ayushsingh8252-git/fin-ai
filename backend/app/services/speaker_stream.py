"""
Near-real-time speaker monitoring on the candidate's microphone.

    browser mic (AudioWorklet, 16 kHz int16 mono)
      -> binary frames on the existing interview WebSocket (api/interview.py)
      -> SpeakerStreamSession: rolling 1.5 s windows, 0.75 s hop
           Silero VAD speech ratio per window (existing singleton)
           ECAPA-TDNN embedding for speech windows (existing singleton, batched)
           cosine vs the candidate reference, median-smoothed
           CANDIDATE / UNKNOWN / UNRESOLVED
           hysteresis state machine -> events
      -> persisted (InterviewAudioEvent + CandidateActivity) and pushed back
         over the same WebSocket.

Topology (audited): the candidate mic is a local browser track; the AI
interviewer is TTS played from a local <audio> element — no WebRTC, no remote
or mixed track. Interviewer audio can only reach the mic acoustically, and
only while the AI is speaking, so the browser tags the stream with the
interview phase and a voice that doesn't match the candidate during AI speech
is reported UNRESOLVED (possible interviewer audio), never as an extra person.

This is a rolling-window method, not native streaming diarization: speakers
are separated by comparing per-window ECAPA embeddings to the candidate
reference, and non-candidate windows are clustered into anonymous, per-session
labels (speaker_2, speaker_3, ...). speaker_1 is the candidate because the
window matches the reference, never because of ordering.

Reference: an existing active VoicePrint for the session's email (the
platform's own enrollment, /api/v1/voice/*) when there is one; otherwise the
candidate's first ~10 s of speech in answer phases (never AI-speaking phases).
Until a reference exists, nothing is classified.
"""
import asyncio
import logging
import threading
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
from fastapi.concurrency import run_in_threadpool

from ..config import settings
from . import speaker_monitor as sm

logger = logging.getLogger(__name__)

AUDIO_STREAM_STARTED = "AUDIO_STREAM_STARTED"
AUDIO_STREAM_STOPPED = "AUDIO_STREAM_STOPPED"
SPEECH_STARTED = "SPEECH_STARTED"
SPEECH_ENDED = "SPEECH_ENDED"
CANDIDATE_SPEAKER_CONFIRMED = "CANDIDATE_SPEAKER_CONFIRMED"
UNKNOWN_SPEAKER_STARTED = "UNKNOWN_SPEAKER_STARTED"
UNKNOWN_SPEAKER_ENDED = "UNKNOWN_SPEAKER_ENDED"
MULTIPLE_SPEAKERS_DETECTED = "MULTIPLE_SPEAKERS_DETECTED"
MULTIPLE_SPEAKERS_CLEARED = "MULTIPLE_SPEAKERS_CLEARED"
SPEAKER_UNRESOLVED = "SPEAKER_UNRESOLVED"
VOICE_REFERENCE_UNAVAILABLE = "VOICE_REFERENCE_UNAVAILABLE"
AUDIO_ANALYSIS_DEGRADED = "AUDIO_ANALYSIS_DEGRADED"
AUDIO_ANALYSIS_RECOVERED = "AUDIO_ANALYSIS_RECOVERED"

# SPEECH_STARTED/ENDED fire on every utterance: live-only, never persisted.
LIVE_ONLY = {SPEECH_STARTED, SPEECH_ENDED}

SUMMARIES = {
    AUDIO_STREAM_STARTED: "Interview audio monitoring started",
    AUDIO_STREAM_STOPPED: "Interview audio monitoring stopped",
    CANDIDATE_SPEAKER_CONFIRMED: "Candidate voice verified",
    UNKNOWN_SPEAKER_STARTED: "Unknown speaker detected",
    UNKNOWN_SPEAKER_ENDED: "Unknown speaker no longer detected",
    MULTIPLE_SPEAKERS_DETECTED: "Additional speaker detected",
    MULTIPLE_SPEAKERS_CLEARED: "Audio monitoring back to candidate only",
    SPEAKER_UNRESOLVED: "Unresolved audio (speaker could not be determined)",
    VOICE_REFERENCE_UNAVAILABLE: "Candidate voice reference unavailable",
    AUDIO_ANALYSIS_DEGRADED: "Audio analysis temporarily unavailable",
    AUDIO_ANALYSIS_RECOVERED: "Audio analysis recovered",
}

PHASE_CANDIDATE = "candidate"
PHASE_AI_SPEAKING = "ai_speaking"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SpeakerStreamSession:
    """All state for one interview's audio stream. Nothing here is shared
    between sessions; the only shared objects are the stateless-per-call
    model singletons behind vad_fn / embed_fn."""

    def __init__(
        self,
        session_id: str,
        candidate_id: Optional[str] = None,
        interview_id: Optional[str] = None,
        reference: Optional[np.ndarray] = None,
        reference_source: Optional[str] = None,
        enrollment_sum: Optional[List[float]] = None,
        enrolled_seconds: float = 0.0,
        centroids: Optional[List[List[float]]] = None,
        started_at: Optional[datetime] = None,
        vad_fn: Callable[[np.ndarray], float] = None,
        embed_fn: Callable[[List[np.ndarray]], np.ndarray] = None,
    ):
        self.audio_session_id = str(uuid.uuid4())
        self.session_id = session_id
        self.candidate_id = candidate_id
        self.interview_id = interview_id
        self.started_at = started_at or _now()
        self.vad_fn = vad_fn or sm.vad_speech_ratio
        self.embed_fn = embed_fn or sm.embed_windows

        self.sr = sm.SAMPLE_RATE
        self.win = int(settings.SPEAKER_WINDOW_SECONDS * self.sr)
        self.hop = int(settings.SPEAKER_WINDOW_HOP_SECONDS * self.sr)
        self.hop_s = settings.SPEAKER_WINDOW_HOP_SECONDS
        self.max_buffer = int(settings.SPEAKER_MAX_BUFFER_SECONDS * self.sr)

        self.buffer = np.zeros(0, dtype=np.float32)
        self.buffer_start = 0          # absolute sample index of buffer[0]
        self.next_start = 0            # absolute sample index of the next window
        self.phase_marks: List[Tuple[int, str]] = [(0, PHASE_CANDIDATE)]
        self.turn_marks: List[Tuple[int, int]] = []

        self.reference = sm.normalize(np.asarray(reference)) if reference is not None else None
        self.reference_source = reference_source
        self.enroll_sum = np.asarray(enrollment_sum) if enrollment_sum is not None else None
        self.enrolled_s = enrolled_seconds
        self.centroids: List[List[float]] = list(centroids or [])

        self.recent_sims: deque = deque(maxlen=3)
        self.speaking = False
        self.silence_s = 0.0
        self.candidate_run_s = 0.0
        self.last_candidate_end: Optional[float] = None
        self.candidate_confirmed = False

        self._reset_pending()
        self.unknown_active = False
        self.unknown_label: Optional[str] = None
        self.unknown_start: Optional[float] = None
        self.unknown_end: Optional[float] = None
        self.unknown_centroid: Optional[np.ndarray] = None
        self.switch_embs: List[np.ndarray] = []
        self.switch_start: Optional[float] = None

        self.multi_active = False
        self.multi_start: Optional[float] = None
        self.multi_labels: List[str] = []

        self.unresolved_run_s = 0.0
        self.unresolved_reported = False
        self.unresolved_count = 0
        self.degraded = False
        self.stats = {k: 0.0 for k in ("stream", "speech", "enrollment", "candidate", "unknown", "unresolved", "dropped")}

    # ── input ────────────────────────────────────────────────────────────
    @property
    def received(self) -> int:
        return self.buffer_start + len(self.buffer)

    def add_pcm(self, data: bytes) -> None:
        """16 kHz mono int16 little-endian. Memory is bounded: if analysis
        falls behind, the oldest audio is dropped and counted, never queued."""
        if len(data) % 2:
            data = data[:-1]
        samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
        self.buffer = np.concatenate([self.buffer, samples])
        overflow = len(self.buffer) - self.max_buffer
        if overflow > 0:
            self.buffer = self.buffer[overflow:]
            self.buffer_start += overflow
            if self.next_start < self.buffer_start:
                self.stats["dropped"] += (self.buffer_start - self.next_start) / self.sr
                self.next_start = self.buffer_start

    def set_phase(self, phase: str, turn_index: Optional[int] = None) -> None:
        if phase in (PHASE_CANDIDATE, PHASE_AI_SPEAKING):
            self.phase_marks.append((self.received, phase))
        if turn_index is not None:
            self.turn_marks.append((self.received, turn_index))

    def ready(self) -> bool:
        return self.next_start + self.win <= self.received

    def _mark_at(self, marks, sample, default=None):
        value = default
        for at, v in marks:
            if at <= sample:
                value = v
            else:
                break
        return value

    # ── analysis ─────────────────────────────────────────────────────────
    def process(self) -> List[dict]:
        """Analyze every complete window buffered so far. Model failures are
        contained: they produce AUDIO_ANALYSIS_DEGRADED once, the pending
        audio is skipped, and the next successful batch emits RECOVERED."""
        events: List[dict] = []
        starts = []
        while self.next_start + self.win <= self.received:
            starts.append(self.next_start)
            self.next_start += self.hop
        if not starts:
            return events
        windows = [self.buffer[s - self.buffer_start: s - self.buffer_start + self.win] for s in starts]
        try:
            ratios = [self.vad_fn(w) for w in windows]
            speech_idx = [i for i, r in enumerate(ratios) if r >= settings.SPEAKER_WINDOW_MIN_SPEECH_RATIO]
            embs = self.embed_fn([windows[i] for i in speech_idx]) if speech_idx else []
        except Exception as e:
            logger.warning("[speaker_stream] session=%s analysis failed: %s", self.session_id, e)
            if not self.degraded:
                self.degraded = True
                events.append(self._ev(AUDIO_ANALYSIS_DEGRADED, starts[0] / self.sr, reason=type(e).__name__))
            self._trim()
            return events
        if self.degraded:
            self.degraded = False
            events.append(self._ev(AUDIO_ANALYSIS_RECOVERED, starts[0] / self.sr))
        emb_by_window = dict(zip(speech_idx, embs))
        for i, s in enumerate(starts):
            self._step(s, emb_by_window.get(i), events)
        self._trim()
        return events

    def _trim(self) -> None:
        drop = self.next_start - self.buffer_start
        if drop > 0:
            self.buffer = self.buffer[drop:]
            self.buffer_start = self.next_start

    def _step(self, start: int, emb: Optional[np.ndarray], events: List[dict]) -> None:
        t0, t1 = start / self.sr, (start + self.win) / self.sr
        phase = self._mark_at(self.phase_marks, start + self.win // 2, PHASE_CANDIDATE)
        self.stats["stream"] += self.hop_s

        if emb is None:
            self._on_silence(t1, events)
            return

        self.silence_s = 0.0
        if not self.speaking:
            self.speaking = True
            events.append(self._ev(SPEECH_STARTED, t0))
        self.stats["speech"] += self.hop_s

        if self.reference is None:
            if phase == PHASE_CANDIDATE:
                self._enroll(emb, t1, events)
            return

        raw = sm.cosine(emb, self.reference)
        self.recent_sims.append(raw)
        sim = float(np.median(self.recent_sims))
        label = sm.classify(sim, settings.SPEAKER_CANDIDATE_THRESHOLD, settings.SPEAKER_UNKNOWN_THRESHOLD)
        reason = None
        if label == sm.UNKNOWN and phase == PHASE_AI_SPEAKING:
            label, reason = sm.UNRESOLVED, "possible_interviewer_audio"

        if label == sm.CANDIDATE:
            self._on_candidate(sim, t1, events)
        elif label == sm.UNKNOWN:
            self._on_unknown(emb, raw, t0, t1, events)
        else:
            self._on_unresolved(reason or "ambiguous_similarity", t0, events)

    def _enroll(self, emb: np.ndarray, t1: float, events: List[dict]) -> None:
        if self.enroll_sum is not None and sm.cosine(emb, self.enroll_sum) <= settings.SPEAKER_UNKNOWN_THRESHOLD:
            return  # doesn't sound like the voice being enrolled; keep it out of the reference
        self.enroll_sum = emb.copy() if self.enroll_sum is None else self.enroll_sum + emb
        self.enrolled_s = round(self.enrolled_s + self.hop_s, 2)
        self.stats["enrollment"] += self.hop_s
        if self.enrolled_s >= settings.SPEAKER_BASELINE_MIN_SECONDS:
            self.reference = sm.normalize(self.enroll_sum)
            self.reference_source = "interview_enrollment"
            self.candidate_confirmed = True
            self.last_candidate_end = t1
            events.append(self._ev(CANDIDATE_SPEAKER_CONFIRMED, t1, speaker_id="speaker_1",
                                   reason="enrolled_from_answers", baseline_seconds=self.enrolled_s))

    def _on_silence(self, t1: float, events: List[dict]) -> None:
        self.silence_s += self.hop_s
        if self.speaking and self.silence_s >= settings.SPEAKER_MIN_SILENCE_SECONDS:
            self.speaking = False
            events.append(self._ev(SPEECH_ENDED, t1 - self.silence_s))
        if self.silence_s >= settings.SPEAKER_MIN_SILENCE_SECONDS:
            self._discard_pending()
        if self.unknown_active and self.silence_s >= settings.SPEAKER_SILENCE_CLEAR_SECONDS:
            self._end_unknown(events)

    def _on_candidate(self, sim: float, t1: float, events: List[dict]) -> None:
        self.stats["candidate"] += self.hop_s
        self.candidate_run_s += self.hop_s
        self.last_candidate_end = t1
        self._discard_pending()
        self.switch_embs, self.switch_start = [], None
        self.unresolved_run_s, self.unresolved_reported = 0.0, False
        if not self.candidate_confirmed and self.candidate_run_s >= settings.SPEAKER_CANDIDATE_CONFIRM_SECONDS:
            self.candidate_confirmed = True
            events.append(self._ev(CANDIDATE_SPEAKER_CONFIRMED, t1 - self.candidate_run_s, speaker_id="speaker_1",
                                   confidence=round(sim, 3), reason=f"matched_{self.reference_source}"))
        if self.unknown_active and self.candidate_run_s >= settings.SPEAKER_CLEAR_SECONDS:
            self._end_unknown(events)

    def _on_unknown(self, emb, raw, t0, t1, events) -> None:
        self.candidate_run_s = 0.0
        self.unresolved_run_s, self.unresolved_reported = 0.0, False
        if self.unknown_active:
            self.stats["unknown"] += self.hop_s
            self.unknown_end = t1
            # A different voice taking over mid-episode (a third speaker):
            # close this episode and open a new one once it's sustained.
            if sm.cosine(emb, self.unknown_centroid) < settings.SPEAKER_CLUSTER_THRESHOLD:
                if self.switch_start is None:
                    self.switch_start = t0
                self.switch_embs.append(emb)
                if len(self.switch_embs) * self.hop_s >= settings.SPEAKER_MIN_UNKNOWN_SECONDS:
                    switch_embs, switch_start = self.switch_embs, self.switch_start
                    self._end_unknown(events, keep_multi=True, end_at=switch_start)
                    self.pending_embs, self.pending_sims = switch_embs, [raw] * len(switch_embs)
                    self.pending_start, self.pending_s = switch_start, len(switch_embs) * self.hop_s
                    self._start_unknown(t1, events)
            else:
                self.switch_embs, self.switch_start = [], None
            return
        if self.pending_start is None:
            self.pending_start = t0
        self.pending_s += self.hop_s
        self.pending_embs.append(emb)
        self.pending_sims.append(raw)
        if self.pending_s >= settings.SPEAKER_MIN_UNKNOWN_SECONDS:
            self._start_unknown(t1, events)

    def _on_unresolved(self, reason: str, t0: float, events: List[dict]) -> None:
        self.stats["unresolved"] += self.hop_s
        self.unresolved_run_s += self.hop_s
        if not self.unresolved_reported and self.unresolved_run_s >= settings.SPEAKER_MIN_UNKNOWN_SECONDS:
            self.unresolved_reported = True
            self.unresolved_count += 1
            events.append(self._ev(SPEAKER_UNRESOLVED, t0 - self.unresolved_run_s + self.hop_s,
                                   duration_ms=int(self.unresolved_run_s * 1000), reason=reason))

    def _reset_pending(self) -> None:
        self.pending_start: Optional[float] = None
        self.pending_s = 0.0
        self.pending_embs: List[np.ndarray] = []
        self.pending_sims: List[float] = []

    def _discard_pending(self) -> None:
        """A too-short foreign run never becomes an event; its time is
        accounted as unresolved audio instead."""
        if self.pending_s:
            self.stats["unresolved"] += self.pending_s
        self._reset_pending()

    def _start_unknown(self, t1: float, events: List[dict]) -> None:
        centroid = sm.normalize(np.mean(self.pending_embs, axis=0))
        idx, _ = sm.assign_cluster(self.centroids, centroid, settings.SPEAKER_CLUSTER_THRESHOLD)
        label = f"speaker_{idx + 2}"
        low = settings.SPEAKER_UNKNOWN_THRESHOLD
        confidence = round(sum(1 for s in self.pending_sims if s <= low) / max(1, len(self.pending_sims)), 2)
        self.unknown_active = True
        self.unknown_label = label
        self.unknown_start = self.pending_start
        self.unknown_end = t1
        self.unknown_centroid = centroid
        self.stats["unknown"] += self.pending_s
        candidate_present = (
            self.last_candidate_end is not None
            and self.unknown_start - self.last_candidate_end <= settings.SPEAKER_CO_PRESENCE_SECONDS
        )
        events.append(self._ev(UNKNOWN_SPEAKER_STARTED, self.unknown_start, speaker_id=label, confidence=confidence,
                               candidate_similarity=round(float(np.mean(self.pending_sims)), 3),
                               candidate_present=candidate_present))
        if candidate_present and label not in self.multi_labels:
            self.multi_labels.append(label)
            if not self.multi_active:
                self.multi_active = True
                self.multi_start = self.unknown_start
            events.append(self._ev(
                MULTIPLE_SPEAKERS_DETECTED, self.unknown_start,
                speakers_detected=1 + len(self.multi_labels), additional_speakers=len(self.multi_labels),
                candidate_present=True, confidence=confidence, speaker_id=label,
            ))
        self._reset_pending()

    def _end_unknown(self, events: List[dict], keep_multi: bool = False, end_at: Optional[float] = None) -> None:
        end = end_at if end_at is not None else self.unknown_end
        events.append(self._ev(UNKNOWN_SPEAKER_ENDED, end, speaker_id=self.unknown_label,
                               duration_ms=int(max(0.0, end - self.unknown_start) * 1000),
                               started_at_seconds=self.unknown_start))
        self.unknown_active = False
        self.unknown_label = None
        self.switch_embs, self.switch_start = [], None
        if self.multi_active and not keep_multi:
            events.append(self._ev(MULTIPLE_SPEAKERS_CLEARED, end,
                                   duration_ms=int(max(0.0, end - self.multi_start) * 1000),
                                   additional_speakers=len(self.multi_labels)))
            self.multi_active = False
            self.multi_start = None
            self.multi_labels = []

    def finish(self) -> List[dict]:
        events: List[dict] = []
        t = self.received / self.sr
        if self.unknown_active:
            self._end_unknown(events)
        if self.reference is None:
            events.append(self._ev(VOICE_REFERENCE_UNAVAILABLE, t, reason="insufficient_candidate_speech",
                                   baseline_seconds=self.enrolled_s))
        events.append(self._ev(AUDIO_STREAM_STOPPED, t, duration_ms=int(t * 1000)))
        return events

    # ── output ───────────────────────────────────────────────────────────
    def _ev(self, event_type: str, stream_seconds: float, **fields) -> dict:
        ev = {
            "type": "audio_speaker_event",
            "event": event_type,
            "audio_session_id": self.audio_session_id,
            "stream_seconds": round(max(0.0, stream_seconds), 2),
            "timestamp": (self.started_at + timedelta(seconds=max(0.0, stream_seconds))).isoformat(),
            "turn_index": self._mark_at(self.turn_marks, int(stream_seconds * self.sr)),
            "source": "audio_speaker_verification",
        }
        ev.update({k: v for k, v in fields.items() if v is not None})
        return ev

    def audio_context(self) -> dict:
        t = self.received / self.sr
        recent_candidate = (
            self.last_candidate_end is not None and t - self.last_candidate_end <= settings.SPEAKER_CO_PRESENCE_SECONDS
        )
        extra = len(self.multi_labels) if self.multi_active else (1 if self.unknown_active else 0)
        return {
            "candidate_verified": bool(self.reference is not None and self.candidate_confirmed),
            "candidate_speaking_recently": bool(recent_candidate),
            "additional_speaker_detected": bool(self.unknown_active),
            "speaker_count": (1 if recent_candidate else 0) + extra,
            "unresolved_audio_events": self.unresolved_count,
            "reference_status": "ready" if self.reference is not None else "enrolling",
            "reference_source": self.reference_source,
            "analysis_status": "degraded" if self.degraded else "active",
        }


# ── Persistence ──────────────────────────────────────────────────────────

def _dedupe_key(ev: dict) -> str:
    return f"{ev['audio_session_id']}:{ev['event']}:{int(ev['stream_seconds'] * 1000)}:{ev.get('speaker_id', '')}"


def persist(db, s: SpeakerStreamSession, events: List[dict], application_id=None, job_id=None) -> None:
    """Write durable events (InterviewAudioEvent always; CandidateActivity
    too when the interview belongs to a Recruitment candidate) and the
    session's state row. Embeddings are never written to either event table."""
    from .. import models
    from . import recruitment_service as rs

    for ev in events:
        if ev["event"] in LIVE_ONLY:
            continue
        key = _dedupe_key(ev)
        if db.query(models.InterviewAudioEvent.id).filter(models.InterviewAudioEvent.dedupe_key == key).first():
            continue
        public = {k: v for k, v in ev.items() if k not in ("type", "event")}
        end = ev["stream_seconds"] if ev["event"] in (UNKNOWN_SPEAKER_ENDED, MULTIPLE_SPEAKERS_CLEARED) else None
        start = ev.get("started_at_seconds", ev["stream_seconds"])
        db.add(models.InterviewAudioEvent(
            id=str(uuid.uuid4()), session_id=s.session_id, candidate_id=s.candidate_id,
            interview_id=s.interview_id, audio_session_id=s.audio_session_id, event_type=ev["event"],
            source=ev["source"], speaker_label=ev.get("speaker_id"), turn_index=ev.get("turn_index"),
            start_seconds=start, end_seconds=end,
            duration_seconds=ev["duration_ms"] / 1000 if ev.get("duration_ms") is not None else None,
            candidate_similarity=ev.get("candidate_similarity"), confidence=ev.get("confidence"),
            details={k: v for k, v in public.items() if k in (
                "speakers_detected", "additional_speakers", "candidate_present", "reason", "baseline_seconds")} or None,
            occurred_at=datetime.fromisoformat(ev["timestamp"]), dedupe_key=key,
        ))
        if s.candidate_id:
            rs.record_activity(
                db, candidate_id=s.candidate_id, application_id=application_id, job_id=job_id,
                event_type=f"interview.audio.{ev['event'].lower()}", summary=SUMMARIES.get(ev["event"], ev["event"]),
                actor_type=rs.ACTOR_SYSTEM, payload=public, dedupe_key=f"audio:{key}",
            )

    row = db.get(models.InterviewSpeakerBaseline, s.session_id)
    if row is None:
        row = models.InterviewSpeakerBaseline(session_id=s.session_id)
        db.add(row)
    row.status = "ready" if s.reference is not None else "enrolling"
    row.reference_source = s.reference_source
    if s.reference_source != "voiceprint" and s.enroll_sum is not None:
        row.embedding_sum = np.asarray(s.enroll_sum).tolist()
    row.enrolled_seconds = s.enrolled_s
    row.enrolled_windows = int(round(s.enrolled_s / s.hop_s))
    row.unknown_centroids = s.centroids
    prev = dict(row.stats or {})
    row.stats = {k: round(prev.get(k, 0.0) + v, 2) for k, v in s.stats.items()}
    s.stats = {k: 0.0 for k in s.stats}  # stats are flushed as deltas
    row.audio_context = s.audio_context()
    row.status_reason = "audio analysis degraded" if s.degraded else None
    db.commit()


# ── Per-process manager used by the interview WebSocket ─────────────────

class StreamManager:
    """One SpeakerStreamSession per interview session_id, in this process.
    Frames are appended on the event loop (cheap); analysis, persistence and
    publishing run in the threadpool, one batch at a time per session."""

    def __init__(self):
        self._sessions: Dict[str, SpeakerStreamSession] = {}
        self._meta: Dict[str, dict] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._draining: Dict[str, bool] = {}
        self._guard = threading.Lock()

    def active(self, session_id: str) -> bool:
        return session_id in self._sessions

    def audio_context(self, session_id: str) -> Optional[dict]:
        s = self._sessions.get(session_id)
        return s.audio_context() if s else None

    async def start(self, session_id: str, owner) -> Tuple[bool, str]:
        if not settings.SPEAKER_MONITOR_ENABLED:
            return False, "speaker monitoring is disabled"
        with self._guard:
            if session_id in self._sessions:
                return False, "an audio stream is already active for this interview"
        try:
            s, meta, events = await run_in_threadpool(_open_session, session_id)
        except Exception as e:
            logger.warning("[speaker_stream] session=%s could not start: %s", session_id, e)
            return False, "audio monitoring unavailable"
        if s is None:
            return False, meta
        meta["owner"] = owner
        meta["t0"] = asyncio.get_running_loop().time()
        with self._guard:
            self._sessions[session_id] = s
            self._meta[session_id] = meta
            self._locks[session_id] = asyncio.Lock()
        await self._emit(session_id, events)
        return True, s.audio_session_id

    def owns(self, session_id: str, owner) -> bool:
        return self._meta.get(session_id, {}).get("owner") is owner

    def set_phase(self, session_id: str, phase: str, turn_index: Optional[int]) -> None:
        s = self._sessions.get(session_id)
        if s:
            s.set_phase(phase, turn_index)

    async def feed(self, session_id: str, data: bytes) -> None:
        s = self._sessions.get(session_id)
        if s is None or len(data) > settings.SPEAKER_MAX_FRAME_BYTES:
            return
        meta = self._meta[session_id]
        loop_t = asyncio.get_running_loop().time()
        # Rate limit: never accept audio faster than SPEAKER_MAX_REALTIME_FACTOR x real time.
        allowed = (loop_t - meta["t0"] + 1.0) * s.sr * 2 * settings.SPEAKER_MAX_REALTIME_FACTOR
        if meta["bytes"] + len(data) > allowed:
            return
        meta["bytes"] += len(data)
        s.add_pcm(data)
        if s.ready() and not self._draining.get(session_id):
            self._draining[session_id] = True
            asyncio.create_task(self._drain(session_id))

    async def _drain(self, session_id: str) -> None:
        try:
            async with self._locks[session_id]:
                while session_id in self._sessions and self._sessions[session_id].ready():
                    s = self._sessions[session_id]
                    events = await run_in_threadpool(s.process)
                    await self._emit(session_id, events)
        except Exception as e:
            logger.warning("[speaker_stream] session=%s drain failed: %s", session_id, e)
        finally:
            self._draining[session_id] = False

    async def stop(self, session_id: str) -> None:
        s = self._sessions.get(session_id)
        if s is None:
            return
        async with self._locks[session_id]:
            events = s.finish()
            await self._emit(session_id, events)
        with self._guard:
            self._sessions.pop(session_id, None)
            self._meta.pop(session_id, None)
            self._locks.pop(session_id, None)
            self._draining.pop(session_id, None)

    async def _emit(self, session_id: str, events: List[dict]) -> None:
        s = self._sessions.get(session_id)
        meta = self._meta.get(session_id, {})
        if s is None:
            return
        await run_in_threadpool(_persist_and_publish, s, events, meta.get("application_id"), meta.get("job_id"))


def _open_session(session_id: str):
    from .. import models
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        session = db.get(models.ScreeningSession, session_id)
        if session is None:
            return None, "unknown interview session", []
        if session.status == "completed":
            return None, "interview already completed", []
        interview = db.query(models.Interview).filter(models.Interview.screening_session_id == session_id).first()
        vp = None
        if session.email:
            vp = (db.query(models.VoicePrint)
                  .filter(models.VoicePrint.email.ilike(session.email), models.VoicePrint.status == "active",
                          models.VoicePrint.embedding.isnot(None))
                  .first())
        row = db.get(models.InterviewSpeakerBaseline, session_id)
        kwargs = dict(session_id=session_id,
                      candidate_id=interview.candidate_id if interview else None,
                      interview_id=interview.id if interview else None,
                      centroids=(row.unknown_centroids if row else None))
        if vp is not None:
            kwargs.update(reference=np.asarray(vp.embedding), reference_source="voiceprint")
        elif row is not None and row.embedding_sum:
            if row.status == "ready":  # reconnect after in-interview enrollment finished
                kwargs.update(reference=np.asarray(row.embedding_sum), reference_source="interview_enrollment")
            else:
                kwargs.update(enrollment_sum=row.embedding_sum, enrolled_seconds=row.enrolled_seconds)
        s = SpeakerStreamSession(**kwargs)
        events = [s._ev(AUDIO_STREAM_STARTED, 0.0, reason=f"reference_{s.reference_source or 'pending'}")]
        if s.reference is None:
            live = s._ev(VOICE_REFERENCE_UNAVAILABLE, 0.0, reason="enrolling_from_answers")
            live["live_only"] = True
            events.append(live)
        meta = {"application_id": interview.application_id if interview else None,
                "job_id": interview.job_id if interview else None, "bytes": 0}
        return s, meta, events
    finally:
        db.close()


def _persist_and_publish(s: SpeakerStreamSession, events: List[dict], application_id, job_id) -> None:
    from ..database import SessionLocal
    from . import interview_live

    durable = [e for e in events if not e.pop("live_only", False)]
    db = SessionLocal()
    try:
        persist(db, s, durable, application_id, job_id)
    except Exception as e:
        db.rollback()
        logger.warning("[speaker_stream] session=%s persist failed: %s", s.session_id, e)
    finally:
        db.close()
    for ev in events:
        interview_live.publish(s.session_id, ev)
    interview_live.publish(s.session_id, {"type": "audio_speaker_state", "audio_context": s.audio_context()})


manager = StreamManager()
