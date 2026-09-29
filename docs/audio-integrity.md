# Audio Integrity (interview speaker monitor)

Near-real-time detection of voices other than the candidate's on the
candidate's microphone during an AI interview. Opt-in per interview. It
reports observable audio events ("Additional speaker detected for 6.0 s"),
never conclusions about the candidate, and no LLM is involved anywhere in
the detection path.

## Audited topology

- Candidate mic: a **local** browser track (`getUserMedia`).
- AI interviewer: TTS played from a local `<audio>` element. No WebRTC, no
  remote or mixed track, no mixed recording.
- Interviewer audio can only reach the mic acoustically, and only while the
  AI speaks. The browser tags the stream with the interview phase; a voice
  that doesn't match the candidate during AI speech is reported
  `SPEAKER_UNRESOLVED` (`possible_interviewer_audio`), never as an extra
  person. Echo cancellation is requested on the capture.
- Existing proctoring "cross-talk" (`useProctoring`) is volume-only RMS and is
  left as is; it is not used as speaker identification.

## Pipeline

```
Browser (InterviewRoom.tsx)
  getUserMedia (echoCancellation) -> AudioWorklet -> 16 kHz int16 mono
  -> binary frames (~250 ms) on the EXISTING /api/v1/interview/ws/{session_id}
     + JSON control: audio_stream_start {consent}, audio_phase {phase, turn_index}, audio_stream_stop
        │
Backend (api/interview.py -> services/speaker_stream.py, one session per interview)
  bounded buffer (20 s) + rate limit (2x real time) + max frame 32 KB
  every 0.75 s: 1.5 s window
    Silero VAD speech ratio        (existing singleton, pre-warmed at startup)
    ECAPA-TDNN embedding           (existing singleton, pre-warmed, batched)
    cosine vs candidate reference -> 3-window median -> CANDIDATE/UNKNOWN/UNRESOLVED
    hysteresis state machine -> events
        │
  persisted: InterviewAudioEvent + CandidateActivity (when the interview has a candidate)
  pushed back on the same WebSocket: audio_speaker_event / audio_speaker_state
        │
UI: BrewShield panel "Voice check" (live) ; Recruitment report "Audio Integrity Events"
Report: ScreeningResult.details.audio_integrity (stats + event counts at completion)
Interview state: turn_result.audio_context (deterministic; never LLM input)
```

This is a rolling-window method, not native streaming diarization. Windows
are compared to the candidate reference; non-candidate intervals are
clustered by ECAPA embedding into anonymous per-session labels (`speaker_2`,
`speaker_3`, ...). `speaker_1` is the candidate because windows match the
reference, never because of ordering. A different voice taking over
mid-episode (third speaker) opens a new episode with a new label.

## Candidate reference

1. An existing active `VoicePrint` whose email matches the interview
   session's email (the platform's own enrollment, `/api/v1/voice/*`).
2. Otherwise the candidate's first ~10 s of speech in answer phases (never
   AI-speaking phases; windows that don't sound like the voice being
   enrolled are dropped). Until then the state is
   `VOICE_REFERENCE_UNAVAILABLE` and nothing is classified; if the interview
   ends first, a persisted `VOICE_REFERENCE_UNAVAILABLE` records it.

## Events

Persisted: `AUDIO_STREAM_STARTED/STOPPED`, `CANDIDATE_SPEAKER_CONFIRMED`,
`UNKNOWN_SPEAKER_STARTED/ENDED`, `MULTIPLE_SPEAKERS_DETECTED/CLEARED`,
`SPEAKER_UNRESOLVED`, `VOICE_REFERENCE_UNAVAILABLE`,
`AUDIO_ANALYSIS_DEGRADED/RECOVERED`. Live only: `SPEECH_STARTED/ENDED`.

```json
{"type": "audio_speaker_event", "event": "MULTIPLE_SPEAKERS_DETECTED",
 "audio_session_id": "...", "stream_seconds": 15.0, "timestamp": "...", "turn_index": 0,
 "source": "audio_speaker_verification", "speaker_id": "speaker_2",
 "speakers_detected": 2, "additional_speakers": 1, "candidate_present": true, "confidence": 1.0}
```

`MULTIPLE_SPEAKERS_DETECTED` = candidate heard within the last 30 s plus at
least one additional voice. An unknown voice with no recent candidate speech
is only `UNKNOWN_SPEAKER_STARTED` (`candidate_present: false`). `confidence`
= share of the episode's windows individually below the unknown threshold.
Dedupe keys make retried writes idempotent.

## Temporal rules / thresholds (config.py, env-overridable)

| Setting | Default | Meaning |
|---|---|---|
| `SPEAKER_CANDIDATE_THRESHOLD` | 0.35 | similarity ≥ → candidate |
| `SPEAKER_UNKNOWN_THRESHOLD` | 0.25 | similarity ≤ → unknown; between → unresolved |
| `SPEAKER_MIN_UNKNOWN_SECONDS` | 2.0 | sustained unknown before STARTED/DETECTED |
| `SPEAKER_CLEAR_SECONDS` | 2.0 | sustained candidate-only speech before ENDED/CLEARED |
| `SPEAKER_SILENCE_CLEAR_SECONDS` | 3.0 | or sustained silence |
| `SPEAKER_CANDIDATE_CONFIRM_SECONDS` | 1.5 | candidate speech before CONFIRMED (VoicePrint reference) |
| `SPEAKER_BASELINE_MIN_SECONDS` | 10 | enrollment speech needed |
| `SPEAKER_CO_PRESENCE_SECONDS` | 30 | "candidate present" window |
| `SPEAKER_WINDOW_SECONDS` / `_HOP_SECONDS` | 1.5 / 0.75 | analysis window |
| `SPEAKER_WINDOW_MIN_SPEECH_RATIO` / `SPEAKER_VAD_THRESHOLD` | 0.6 / 0.5 | speech gating |
| `SPEAKER_MIN_SILENCE_SECONDS` | 1.0 | before SPEECH_ENDED |
| `SPEAKER_MAX_BUFFER_SECONDS` / `_MAX_FRAME_BYTES` / `_MAX_REALTIME_FACTOR` | 20 / 32000 / 2.0 | memory + rate bounds |
| `SPEAKER_CLUSTER_THRESHOLD` | 0.45 | same extra speaker if ≥ |
| `SPEAKER_MONITOR_ENABLED` | true | kill switch |

Threshold basis (measured, small sample — recalibrate on more speakers):
real speech, 1.5 s windows, held-out audio — same speaker mostly 0.35–0.71,
different speaker never above 0.13. 0.45 left the candidate's own speech
mostly "unresolved"; 0.35 recognized it.

## Measured (dev box, 12-core CPU, CPU-only)

- Model init: ECAPA 3.8 s, Silero 0.3 s (from cache), both at startup.
- Per 0.75 s hop (VAD + ECAPA on one window): median 134 ms, p95 159 ms
  (~18% of real time, ~17% of one core per live interview).
- Real browser E2E detection latency: 7–8.5 s from the moment the other voice
  starts (3.5 s is the deliberate confirmation hold; the rest is CPU
  contention with faster-whisper/LLM work in the same backend process).
  Clears: 6.5–7 s after the other voice stops.
- Durations measured: 6.0 s against a true 6.0 s second voice, every loop.

## Real E2E (browser → mic → WS → models → DB → UI)

Headless Chromium on the real invite-link interview page, Chrome's fake
microphone playing real speech (candidate, then a different person for 6 s,
then candidate, then silence, looping):

- A candidate alone → `CANDIDATE_SPEAKER_CONFIRMED` (enrolled from answers) ✅
- B second voice → `MULTIPLE_SPEAKERS_DETECTED` (2 speakers, 1 additional) ✅
- C second voice stops → `MULTIPLE_SPEAKERS_CLEARED` (6.0 s) ✅
- D injected VAD+ECAPA outage → `AUDIO_ANALYSIS_DEGRADED` within 0.5 s; interview continued ✅
- E outage removed → `AUDIO_ANALYSIS_RECOVERED`, detection works again ✅
- End & Get Report → `AUDIO_STREAM_STOPPED`; events in DB + CandidateActivity ✅

## Fixes made while validating

- Silero VAD was not pre-warmed (first interview stalled ~25 s) — now pre-warmed.
- `/transcribe` and `/screening/start` ran blocking work on the event loop,
  freezing every WebSocket during transcription / resume parsing — now in the
  threadpool.
- The WS `next_turn` handler blocked the receive loop for the LLM+TTS
  duration — now a serialized task, so audio keeps flowing.

## Security / privacy

- Opt-in consent box; `audio_stream_start` without `consent: true` is rejected.
- Stream accepted only for an existing, not-completed interview session, only
  on the socket that started it; follows the interview's existing
  session-id-as-capability model (the candidate is not a platform user).
- Raw audio is never stored; only windows in the 20 s buffer exist in memory.
- Embeddings never appear in events, CandidateActivity, REST or WS payloads.
  An in-interview reference is kept in `interview_speaker_baselines` (plain
  JSON, same as `VoicePrint`); a VoicePrint reference is never copied.
- HR report endpoint `GET /interview/{id}/audio-events` requires `ACTION_VIEW`.

## Limitations

- In-process WebSocket registry and stream manager: one uvicorn worker only.
- Detection latency ~7–8 s (see above); a dedicated analysis worker process
  would remove the contention with transcription.
- Thresholds validated on two real speakers only.
- The WebSocket is unauthenticated by design (existing interview model);
  anyone holding the session id could stream audio into that session.
