# Kokoro TTS + interview call screen (2026-09-29)

Self-hosted Kokoro-82M replaces the interviewer's robotic voice; audio now
streams sentence by sentence; the interview screen was redesigned (AI left,
candidate right, End interview → report). Every number below was measured on
this project's dev laptop (Windows 11, 12 logical cores, Python 3.12) — not
copied from upstream benchmarks.

## What was there before (audit)

| Piece | Before |
|---|---|
| TTS | `audio_service.generate_tts_audio_async`: Edge-TTS, falling back to gTTS |
| **What actually ran** | **gTTS.** `edge-tts` was never in `requirements.txt` or the venv, so every call hit `ImportError` and fell through to gTTS — that is the robotic voice |
| Delivery | whole-question MP3, base64 inside the WS `turn_result` (sent only after LLM **and** TTS finished) |
| STT | faster-whisper `base` int8 via `POST /api/v1/transcribe` (unchanged) |
| Agent | `interview_service.generate_next_turn` — one JSON LLM call `{question, is_final}`, not token-streamed (unchanged) |
| Playback | `new Audio(dataURL)` per question |
| Barge-in | code existed but could never fire: the mic VAD only ran *after* the interviewer finished |
| Cache | none |

## Architecture now

```
mic → /transcribe (faster-whisper) → WS next_turn → generate_next_turn (LLM)
    → turn_result {question, turn_id, audio_stream:true}        ← text shown at once
    → speech_formatter (markdown/JSON/symbols → speakable; sentence chunks)
    → Kokoro per chunk (onnxruntime, one shared session)
    → tts_chunk {turn_id, seq, mime: audio/wav, base64} … tts_end
    → StreamingSpeechPlayer (Web Audio, ordered, gapless scheduling)
```

- **Why `kokoro-onnx`, not the PyTorch `kokoro` package:** `kokoro` requires
  `misaki[en]` → spaCy + spacy-curated-transformers + a runtime
  `en_core_web_sm` download. spaCy already crashed this backend with a
  MemoryError on a low-RAM box. `kokoro-onnx` runs the same Kokoro-82M weights
  on onnxruntime (already a dependency) with a bundled espeak-ng — no apt
  package, no runtime download.
- **fp32, not int8:** measured int8 at RTF 2.5 vs fp32 0.82 on this CPU
  (dynamic-quant kernels are slower here). Re-measure on new hardware.
- **Audio format:** Kokoro's 24 kHz float → 16-bit PCM WAV per chunk. No MP3
  encode/decode on either side; the browser decodes WAV natively.
- **Chunking:** sentences; fragments < 12 chars ("Sure!") merge forward; an
  opening sentence > 110 chars splits once at a comma/semicolon/dash (live
  questions are often one long sentence — that took first audio from ~3.4 s
  to the opening clause's synthesis time); run-ons split at 220 chars.
- **Barge-in:** a mic monitor runs only while the interviewer speaks (echo
  cancellation on). Loud time accumulates, quiet drains at half rate; 300 ms
  of loud → local playback stops, `barge_in` cancels the server's synthesis
  task, flow moves to recording the candidate.
- **Fallback:** any Kokoro exception → the *remaining* text goes to the old
  Edge/gTTS chain (one request). Logged as `[TTS] Kokoro failed` /
  `[TTS] Falling back to existing provider`; the client only ever sees audio
  or a clean `tts_end` — never internals.
- **Cache:** in-process LRU keyed by `sha256(model|voice|speed|lang|text)`,
  **only** for fixed UI phrases ("No worries, let's move on." …), pre-rendered
  at startup. Candidate-specific replies are never cached.
- **Logs:** `request_started`, `first_audio_ms`, `generation_ms`,
  `audio_duration_ms`, `provider`, `device`, chunk counts — lengths and
  timings only, never the spoken text.

API compatibility: `POST /api/v1/tts` keeps its request body; the response is
`audio/wav` (Kokoro) or `audio/mpeg` (fallback) with `X-TTS-Provider`. WS
`turn_result` keeps `audio_base64` (now always `null`; old clients fall back
to `/tts`). New: `GET /health/tts` (informational — deliberately not in
`/health/ready`, since TTS has a working fallback).

## Benchmark (`python scripts/benchmark_tts.py --runs 3 --baseline`)

Laptop CPU busy with ordinary desktop load (~30 % before the run), 8 ORT
threads, CPU arena off (the default). Median of 3.

| Text | Chunks | Audio | Kokoro TTFB | Kokoro total | RTF | Before (gTTS, whole file) |
|---|---|---|---|---|---|---|
| short | 2 | 2.7 s | 701 ms | 1304 ms | 0.48 | 602 ms |
| ~5 s | 2 | 6.6 s | 764 ms | 4130 ms | 0.62 | 1022 ms |
| ~10 s | 3 | 13.9 s | 1056 ms | 7343 ms | 0.53 | 2548 ms |

- Before, *first playable audio = total* (one MP3, network round trip to
  Google). After, playback starts at TTFB and later chunks synthesize while
  earlier ones play (RTF < 1 keeps ahead of playback).
- Honest read: for very short lines gTTS was about as fast; the gain is the
  voice quality plus flat ~0.7–1.1 s first audio for long replies, no network
  dependency, no third-party API.
- Same run with 2 threads (≈ a 2-vCPU box): TTFB 1.07–1.43 s, RTF ~0.77.
- Model startup (load + warm-up): 2.1–2.6 s, done once at app startup on a
  worker thread (doesn't block health checks).

**Memory:** process RSS 42 MB → 410 MB after loading Kokoro, steady at
~413 MB after synthesis with `KOKORO_CPU_MEM_ARENA=False`. With the arena on
it grew to ~773 MB for similar latency — hence off by default.

**GPU:** none on this machine; CUDA path (`kokoro-onnx[gpu]`,
`KOKORO_DEVICE=cuda|auto`) is implemented and unit-tested for provider
selection/CPU fallback but **not measured on a real GPU**.

## End-to-end (real browser, Playwright + fake camera, Kokoro-voiced "candidate" on the mic)

Full flow verified: greeting → spoken answer → Whisper → LLM → streamed
question → candidate barges in → End interview → report.

- Candidate stops speaking → interviewer's first audio: **~15–18 s**, of
  which VAD end-of-speech wait 1.3 s, transcription ~6 s (includes
  faster-whisper's first-use model load), LLM ~5 s, TTS first chunk 3.4–5.2 s
  (Kokoro competing with Chromium + Next dev + Whisper on one laptop). STT
  and LLM dominate; they were out of scope.
- Barge-in: candidate starts talking → playback stopped + `barge_in` sent in
  **~0.86–0.89 s** (was 3.3 s with a "continuously loud" rule — real speech
  only clears the threshold in ~55 % of 10 ms windows).
- After interruption no further chunks of the old turn arrived; the next
  turn played normally.

## Interview screen

AI interviewer tile on the left, candidate camera on the right, active
speaker ring (blue = AI talking, green = candidate), live waveform from the
real audio, caption of the current question, transcript + BrewShield in a
sidebar, and a control bar with **End interview** (confirm dialog) and
Leave. Ending stops audio and in-flight turns immediately, shows a
"Generating the interview report…" screen, then the report (scrolled into
view), with Retry if evaluation fails. Invite-link candidates still get a
"submitted" confirmation rather than the scored report — unchanged by design
(scores/hire recommendation are for HR). The call UI is portaled to
`<body>`: an ancestor in the product layout was pinning the old fixed
overlay under the site header.

## Requirements

- CPU-only works; ≥ 4 cores recommended (2 cores: RTF ~0.77, still real-time
  but ~1.1–1.4 s first audio). Needs ~370 MB extra RAM.
- **Prod EC2 (t3.small, 2 vCPU / 1.9 GB) caveat:** the backend there already
  holds Whisper, ECAPA, Silero and the bge embedder. Adding ~370 MB may be
  too much — watch memory after deploy, or set `TTS_PROVIDER=edge` there
  (gTTS path, exactly as before).
- Docker: `scripts/download_kokoro.py` runs in its own image layer
  (checksum-verified, ~336 MB, cached until the script changes); nothing is
  downloaded at container start.

## Remaining limitations

- The LLM turn is one non-streamed JSON call, so TTS starts only after the
  whole question is generated. `SentenceChunker.feed()` accepts token deltas
  already; wiring a streaming LLM call is the next latency win.
- Docker image **build was not run** (Docker Desktop not running; ~1.4 GB free
  RAM on the dev box). Verified instead: every Linux/py3.11 wheel resolves
  (`kokoro-onnx 0.6.1`, `espeakng-loader` manylinux, `onnxruntime 1.30`,
  `numpy 2.4`), and the model script is idempotent with checksums.
- Barge-in with real laptop speakers (echo) is untested — only with an
  injected mic stream. If it false-triggers, raise `BARGE_IN_RMS_THRESHOLD`
  or set `BARGE_IN_ENABLED=false` in `InterviewRoom.tsx`.
- Voice default `am_michael` matches the male interviewer persona; Kokoro's
  own quality grades rate `af_heart` highest — try it via `KOKORO_VOICE`.
