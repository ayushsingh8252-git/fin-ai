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

## Update 2026-09-30: LLM → Kokoro streaming

The interviewer's reply is now streamed token-by-token from the LLM into
Kokoro, so the first sentence is spoken while the model is still writing the
rest. Opt-in per WS message (`next_turn.stream_llm: true`, which the
interview room sends); clients without the flag get the old contract.

```
answer -> /transcribe -> WS next_turn{stream_llm}
  -> stream_next_turn (Groq SSE / Gemini stream, plain text + [[END]] marker)
  -> SentenceChunker (. ! ? ; — skips Mr./Dr./e.g./i.e./initials, 3.14)
  -> check_output (per sentence) -> format_for_speech
  -> asyncio.Queue -> ONE Kokoro worker (strict order)
  -> turn_start, tts_chunk{seq,text,audio}*, turn_result (when the LLM ends), tts_end
```

- **Provider audit:** raw `urllib` to Groq's OpenAI-compatible API, JSON
  mode, `openai/gpt-oss-120b` → `gpt-oss-20b` → `qwen/qwen3.8-27b`, then
  Gemini (`gemini-2.5-flash`, `gemini-3.6-flash`) — not LangChain. The new
  `services/llm_stream.py` uses the same keys/rotation/cooldowns with native
  streaming (`stream: true` SSE via pooled `httpx`; Gemini
  `aio.models.generate_content_stream`); failover only before the first
  token. The JSON path used by everything else is unchanged.
- **Barge-in:** cancels the turn task → the queue is dropped, the Kokoro
  worker stops after its current sentence, and the LLM HTTP stream is closed
  (verified by test). The transcript records exactly the text generated
  before the interruption, and `turn_result{interrupted:true}` carries the
  same text so client and server histories stay in step.
- **Instrumentation:** `[VOICE_LATENCY]` server lines (`llm_ttft_ms`,
  `first_sentence_ms`, `kokoro_first_audio_ms`, `llm_done_ms`,
  `full_response_ms`, client-reported `stt_ms`) and browser lines
  (`candidate_stop_to_first_audio_ms`, measured when the first sample is due
  at the speakers). Timings only, never text.

### Measured in a real browser (Playwright, 3 answers per run, same backend)

Run with an in-memory Redis stand-in so conditions match the Docker deploy
(see the Redis finding below).

| Candidate stops → first interviewer audio | turn 1 | turn 2 | turn 3 |
|---|---|---|---|
| Before (blocking JSON LLM → whole-question TTS) | 10.6 s | 16.1 s | 8.9 s |
| **After (streaming)** | **6.4 s** | **9.2 s** | **7.4 s** |

After, per turn: STT 2.7 / 4.0 / 2.8 s (+1.3 s VAD silence wait) · LLM first
token 0.61 / 1.00 / 0.78 s · first sentence +1–8 ms after that · Kokoro
first audio 1.6 / 2.6 / 2.1 s after the first sentence · LLM finished
0.63–1.08 s (before audio even started) · next_turn → browser first audio
2.3–3.9 s · full response played 9.7–10.6 s.

### Findings from the audit (not fixed — outside this change's scope)

- **Redis down = +2–4 s per LLM call.** `key_manager.get_next_key` checks
  Redis synchronously; when unreachable, `cache.get_redis_client()` retries
  every 30 s with a 2 s connect timeout (4.0 s measured on Windows) — i.e.
  every interview turn. Harmless in the Docker deploy (Redis runs); the
  streaming path now calls it off the event loop so it can't freeze other
  sockets, but the delay itself remains wherever Redis is absent.
- **`/screening/start` is 35–48 s** on this box: two sequential structured
  LLM calls at 17–19 s each, including a 2–5 s Langfuse prompt lookup that
  404s (`screening-resume-profile`/`screening-question-set` don't exist in
  the Langfuse project) and is refetched every call. It exceeded the
  frontend's 30 s timeout, so interviews couldn't start; timeout raised to
  60 s. Creating those prompts in Langfuse (or caching the miss) would cut
  ~4–10 s.
- **STT:** faster-whisper `base` beam 5 took 1.6–2.8 s standalone for 7–13 s
  answers; beam 1 measured 1.5–1.6 s with identical text on these samples —
  left unchanged (STT was out of scope), an easy option to revisit.
- **Model choice:** standalone TTFT p50 — gpt-oss-120b 671 ms, gpt-oss-20b
  555 ms, qwen3.8-27b 243 ms. Kept gpt-oss-120b (quality decision).
- **Laptop contention:** in these runs headless Chromium (camera +
  MediaPipe proctoring on software WebGL) shared the CPU with Kokoro and
  Whisper; standalone Kokoro first audio for a short opener is ~0.7 s, not
  1.6–2.6 s. On a server the browser isn't on the same CPU.

Realistic floor on this architecture: VAD 1.3 s + STT ~1.6 s + LLM ~0.7 s +
Kokoro opener ~0.7 s ≈ 4.3 s. Getting to 2–4 s needs streaming STT (or a
shorter silence wait) — a redesign, not attempted here.

## Update 2026-09-30 (later): silence wait + Whisper beam — measured, both kept

Neither change passed its own evidence bar, so neither was made.

**Silence wait (end-of-answer).** Introduced only in the browser:
`InterviewRoom.tsx` `VAD_SILENCE_STOP_MS = 1300` — after speech has been
heard, the answer ends once RMS stays ≤ `VAD_SPEECH_RMS_THRESHOLD` (0.025)
for 1.3 s (the backend's faster-whisper `vad_filter` only trims audio, it
doesn't end turns). Replayed that exact detector offline (AnalyserNode 512
samples @48 kHz, 8-bit time-domain, 60 Hz ticks) on real human speech:
14 real laptop-mic clips (43 s speech) and 3 × 10 min of a real, spontaneous
Indian-English interview-coaching video (847 s speech), level-matched to the
laptop mic (×0.68), plus −6 dB / +3 dB mic variants. Pauses long enough to
end a candidate's answer early:

| threshold | laptop clips | video 1 | video 2 | video 3 | video 2 @ −6 dB |
|---|---|---|---|---|---|
| 1300 ms (current) | 0 | 21 | 39 | 53 | 46 |
| 1000 ms | 2 | 38 | 63 | 75 | 67 |
| 800 ms | 3 | 71 | 77 | 98 | 86 |
| 700 ms | 5 | 90 | 94 | 114 | 110 |
| 600 ms | 12 | 129 | 115 | 136 | 133 |

800 ms gives 1.8–3.4× the premature cut-off points of today's value, 600 ms
2.6–6×; even 1000 ms is +42–81 %. Every candidate threshold trades 0.3–0.7 s
for a large jump in candidates being talked over mid-thought, so 1300 ms
stays. (The video is a live session with audience pauses, so absolute rates
are overstated; the relative increase is the finding.)

**Whisper beam 5 vs 1** (`audio_service.transcribe_audio`, `base` int8,
`vad_filter=True`, `language="en"`). WER/CER vs exact text (A) or
faster-whisper `small` beam 5 as reference (B, C); median of 3 runs:

| set | latency p50 b5→b1 | CPU total b5→b1 | WER b5→b1 | identical |
|---|---|---|---|---|
| A 3 exact-text clips (29 s) | 2032→1467 ms | 25.7→17.7 s | 8.4→8.4 % | 2/3 |
| B 14 real mic clips (98 s) | 1277→1213 ms | 88.1→80.0 s | 19.9→21.8 % | 11/14 |
| C 12 real spontaneous segments (240 s) | 2029→1668 ms | 115.5→128.6 s | 39.8→34.0 % | 2/12 |

Beam 1 only clearly wins on clean synthetic speech; on real speech it saved
~5 % (B) or used *more* CPU in total (C), and it got the domain term
"Agentic" wrong where beam 5 didn't. Set C is partly Hindi, so both settings
translate and WER is inflated for both. Not materially equivalent with a
material gain → beam 5 stays.

## EC2 deploy 2026-09-30 (t3.small, 2 vCPU / 1.9 GB + 4 GB swap)

Deployed commits `99ebcfb` + `42e85fe` (18 files, each verified byte-identical
on the box to the base these commits were built on, so no one else's live
edits were overwritten). Rollback: `~/deploy_backups/src_pre_kokoro_20260930_082952.tgz`
+ images tagged `ai_engine-{backend,frontend,celery-worker}:pre_kokoro_20260930_082952`;
`.env` backup `~/deploy_backups/env_pre_tts_provider_20260930_082952`.
The rebuild re-resolved the unpinned requirements; diff vs the old image was
patch/minor only (fastapi 0.141→0.142, SQLAlchemy 2.1.0→2.1.1, langchain-core,
opentelemetry 1.44→1.45) plus the Kokoro packages.

**Kokoro is not viable on this instance — measured, then switched off.**
With Kokoro on: backend RSS 300 MB → 1.0 GB, swap 1.1 → 1.9 GB; a warm 6 s
sentence took 5.65 s (RTF ≈ 1.0, CPU 96-100 %, no steal), and idle weights
were paged out (swap-in 0.7-2.3 MB/s at each synthesis), giving 10-28 s
stalls. A streamed question played "Got it, thanks." then ~11 s of silence.
Production therefore runs `TTS_PROVIDER=edge` (box `.env`): same streaming
pipeline, fallback voice. Measured through the public URL after the switch:
turn_start → first audio chunk 0.44-0.88 s, first sentence's audio sent
before the LLM finished, next sentence 0.6-1.2 s later; backend RSS 774 MB.
To use Kokoro in production: ≥ 4 vCPU and ≥ 4 GB RAM (e.g. a c7i/t3 large),
then set `TTS_PROVIDER=kokoro` and restart the backend.

## Remaining limitations

- STT still starts only after the candidate's answer ends (see above).
- Docker image **build was not run** (Docker Desktop not running; ~1.4 GB free
  RAM on the dev box). Verified instead: every Linux/py3.11 wheel resolves
  (`kokoro-onnx 0.6.1`, `espeakng-loader` manylinux, `onnxruntime 1.30`,
  `numpy 2.4`), and the model script is idempotent with checksums.
- Barge-in with real laptop speakers (echo) is untested — only with an
  injected mic stream. If it false-triggers, raise `BARGE_IN_RMS_THRESHOLD`
  or set `BARGE_IN_ENABLED=false` in `InterviewRoom.tsx`.
- Voice default `am_michael` matches the male interviewer persona; Kokoro's
  own quality grades rate `af_heart` highest — try it via `KOKORO_VOICE`.
