# Behavioral Analysis (OCEAN-AI) — Integration

Adds OCEAN-AI (aimclub/OCEANAI, PyPI package `oceanai`) personality/behavioral
trait analysis of a candidate's AI-interview recording, as a supplementary
signal for HR — never an automated hire/reject decision.

## What OCEAN-AI does

[OCEAN-AI](https://github.com/aimclub/OCEANAI) is an open-source library that
estimates the Big-Five personality traits — Openness, Conscientiousness,
Extraversion, Agreeableness, and **Non-Neuroticism** (the library's own term;
not relabeled to "Neuroticism" here, see below) — from a person's recorded
audio and/or video, using its own pretrained neural network models. This
integration uses those real pretrained models and inference pipeline. It does
**not** use an LLM to guess personality traits, and does not implement its own
personality model.

Why "Non-Neuroticism" and not "Neuroticism": that is the literal field name
OCEAN-AI's own weight-loading API uses (`load_audio_models_weights_b5(...,
url_non_neuroticism=...)`) and the literal column name in its output
DataFrame (`"Non-Neuroticism"`). A higher score means fewer
negative-emotion/neurotic signals were detected — the same "higher = more of
that quality" direction as the other four traits. We preserve this naming
end-to-end (DB, API, UI) rather than silently flipping/renaming it, since a
silent rename risks inverting the value's meaning for anyone who later reads
OCEAN-AI's own docs alongside ours.

## Why a separate service

OCEAN-AI pins `transformers==4.45.1` exactly. The main backend
(`AI-Policy-Rule-Engine/backend`) already depends on an unpinned, newer
`transformers` (via `sentence-transformers` and the CrossEncoder reranker in
`services/reranking.py`) — a real, verified version conflict, not a
precaution. Per the project's own "isolate rather than destabilize" approach
for heavy conflicting dependencies, OCEAN-AI runs in its own container,
`ocean-service/`, with its own pinned `requirements.txt` (mirrors OCEAN-AI's
`setup.py` `install_requires` exactly — see that file's header comment).
`jupyterlab`/`gradio`/`ipython`, which `oceanai`'s own `setup.py` pulls
unconditionally for its notebook/demo UI, are deliberately excluded: this is
a headless service, and `oceanai` is installed with `--no-deps` specifically
so those never get pulled in.

## Architecture

```
Candidate opts in (consent checkbox, InterviewRoom.tsx)
        │
        ▼
Continuous camera+mic MediaRecorder for the whole interview
        │  (webm, kept only in the browser until the interview ends)
        ▼
POST /api/v1/interview/{session_id}/recording   (policy-backend)
        │  saves to the shared uploads volume,
        │  creates InterviewBehavioralAnalysis(status="pending")
        ▼
analyze_candidate_ocean_task.delay(session_id)   (Celery, existing broker)
        │  runs in policy-celery-worker — the EXISTING worker container,
        │  no new Celery worker/broker. Heavy ML deps are NOT imported here.
        ▼
services/ocean_client.py  ──HTTP (path inside shared volume, not bytes)──▶  ocean-service
        │                                                                       │
        │                                                          ffmpeg: webm → mp4
        │                                                                       │
        │                                                     oceanai.modules.lab.build.Run
        │                                                     ┌─────────────┬─────────────┐
        │                                                 audio-only    video-only     audio+video
        │                                                 (get_audio_   (get_video_    fusion
        │                                                 union_        union_         (get_av_union_
        │                                                 predictions)  predictions)   predictions)
        │                                                                       │
        ◀──────────────────────── {results, model, timing} ─────────────────────┘
        ▼
InterviewBehavioralAnalysis row updated: status="completed",
audio_results / video_results / audio_video_results, model_name/version
        │
        ▼
GET /api/v1/interview/{session_id}/behavioral-analysis   (HR-only, ACTION_VIEW)
        │
        ▼
"Behavioral Analysis" section on the interview report (InterviewReport.tsx)
```

## Installation / model setup

`ocean-service/Dockerfile` installs the CPU-only PyTorch wheel first (same
pattern as `backend/Dockerfile`), then the rest of
`ocean-service/requirements.txt` (pinned to match OCEAN-AI's own
`setup.py`, **including** `ipython`/`jupyterlab`/`gradio` — verified live
that `oceanai`'s own modules unconditionally import all three at load time,
not just inside notebook/demo-only code; a headless service still needs them
installed even though it never launches a notebook or Gradio UI), then
`oceanai==1.0.0a48` itself with `--no-deps` (its own declared deps are
already satisfied above; `--no-deps` here just skips a redundant resolve).

**Windows-host note (local dev only, not relevant inside the Linux
container):** installing `transformers==4.45.1` directly on a Windows host
can fail with `OSError: [Errno 2] No such file or directory` on a deeply
nested module path (e.g.
`transformers/models/audio_spectrogram_transformer/...`) unless either NTFS
long-path support is enabled, or the venv lives at a short path (e.g.
`C:\ocean_poc_venv`, not deep inside `%TEMP%`). Diagnosed and worked around
during this integration's own proof-of-concept. Not an issue inside the
Docker image (Linux).

Model weights are **not bundled** — OCEAN-AI downloads them itself, from URLs
its own `weights_for_big5_` registry provides (we never hardcode a weight
URL). `model_loader.py` loads, at process startup:

- Audio: base hc/nn feature extractors + audio-only B5 trait heads (5 files)
- Video: base hc/deep-fe/nn feature extractors + video-only B5 trait heads (5 files)
- Audio+Video fusion: B5 trait heads (5 files)

≈20 separate weight files total, on first cold start. `docker-compose.yml`'s
`ocean_weights` volume persists them across restarts so this only happens
once per deployment, not once per interview (or per container recreation).

## Required system resources

- **CPU-only by default** — `Run()`'s device selection is automatic
  (`"cuda:0" if torch.cuda.is_available() else "cpu"`, inside OCEAN-AI
  itself); this deployment installs the CPU-only torch wheel, so it always
  runs on CPU here. A GPU-equipped host would use it automatically with no
  code change, simply by installing a CUDA-enabled torch build instead.
- Measured baseline: ~0.8 GB RAM idle with models loaded, ~1.2 GB peak
  during inference, several CPU cores busy for ~25 s per 11.5 s clip. See
  "Real end-to-end validation" below for the full numbers. Budget at least
  2 GB RAM for this container on the EC2 host.

## Supported input format

Recordings arrive as `video/webm` (browser `MediaRecorder` output),
`video/mp4`, or `video/x-matroska`. OCEAN-AI's own file-extension filter only
matches `.mp4`/`.avi`/`.mov`/`.flv`, so every recording is **re-encoded to
mp4 via ffmpeg** before OCEAN-AI ever sees it, regardless of what it arrived
as (`ocean_service.py::_transcode_to_mp4`).

## API

`GET /api/v1/interview/{session_id}/behavioral-analysis` — HR-only
(`ACTION_VIEW`, same gate as the existing `GET /interview/report/{id}`).

```json
{
  "status": "completed",
  "source": {"audio": true, "video": true, "fusion": true},
  "model": {"name": "OCEAN-AI", "version": "1.0.0a48"},
  "results": {
    "audio": {"openness": 0.6, "conscientiousness": 0.71, "extraversion": 0.5, "agreeableness": 0.62, "non_neuroticism": 0.58},
    "video": { "...": "..." },
    "audio_video": { "...": "..." }
  },
  "error": null,
  "processed_at": "2026-09-28T12:00:00Z"
}
```

`status` is one of `not_requested` (candidate never opted in — no row
exists), `pending`, `processing`, `completed`, `failed`. `results` is only
ever populated when `status == "completed"` — never a partial/fabricated
score for any other state.

`POST /api/v1/interview/{session_id}/behavioral-analysis/retry` —
`ACTION_ANALYZE` (a stricter gate than `ACTION_VIEW`: this triggers real CPU
work, so an interviewer role, which only has `ACTION_VIEW`, cannot trigger
it). Re-dispatches the Celery task against the already-uploaded recording;
409 if already processing, 404 if no recording was ever uploaded.

`POST /api/v1/interview/{session_id}/recording` — candidate-facing (same
"session_id is the access control" model as the rest of `interview.py`'s
candidate routes), receives the browser's MediaRecorder capture.

## Database schema

New table `interview_behavioral_analyses` (`models.py::InterviewBehavioralAnalysis`).
One row per `session_id` (re-analysis overwrites in place, not history).
`candidate_id`/`interview_id` are nullable, resolved best-effort from any
Recruitment `Interview` row scheduled against the session — a bare
invite-link interview has neither. See the model's own docstring for the
full field list.

## Failure handling

`InterviewBehavioralAnalysis.status` is tracked entirely separately from
`ScreeningSession.status`/`ScreeningResult` — a failed or slow analysis
**never** affects the interview's own completed/evaluated state. The Celery
task (`analyze_candidate_ocean_task`, `worker.py`) distinguishes retryable
failures (ocean-service unreachable, 5xx) from permanent ones (missing
recording file, ocean-service 4xx — e.g. an unusable recording) via
`ocean_client.OceanServiceError.retryable`; permanent failures are not
retried and land in `status="failed"` with `error_message` set for HR to see
and manually retry via the `/retry` endpoint.

## Privacy considerations

- **Opt-in, off by default.** `InterviewRoom.tsx`'s consent checkbox gates
  whether the continuous camera+mic recorder ever starts at all — unchecked,
  nothing beyond the existing per-turn transcription audio (already
  discarded after STT) is recorded.
- **HR-only access.** The GET endpoint requires `ACTION_VIEW`
  (`recruitment_service.py`'s existing RBAC), same as every other
  candidate-analysis endpoint in this platform. Never exposed to the
  candidate.
- **No raw recording endpoint.** There is no route that serves the recording
  file itself — only OCEAN-AI's derived trait scores.
- **No PII in logs.** Neither `interview.py`'s upload route,
  `services/ocean_client.py`, nor `ocean-service`'s own `main.py`/
  `ocean_service.py` log the recording's file path in detail or its content
  — only the `session_id`, matching `services/guardrails.py`'s existing
  no-secrets/no-PII-in-logs convention.
- **Retention** follows whatever the deployment's existing `uploads/`
  retention policy is (not yet formalized elsewhere in this codebase) — this
  integration does not add a separate retention mechanism.

## Product rule (enforced by design, not just by convention)

OCEAN-AI's output is never used for automatic rejection, automatic hiring, or
hidden candidate ranking. Nothing in this integration writes to
`ScreeningResult.jd_match_score`, `.verdict`, or `CandidateScoreCard` — the
Behavioral Analysis section is entirely separate storage
(`InterviewBehavioralAnalysis`) and entirely separate UI (its own section,
below the interview score, explicitly labeled "supplementary" — see
`BehavioralAnalysis.tsx`).

## Real end-to-end validation (2026-09-28)

Run on the dev host (Windows 11, 12 logical CPUs, 7.3 GB RAM, CPU-only; a
GTX 1650 is present but unused by design) through the real production path:
`POST /interview/{id}/recording` → Celery `analyze_candidate_ocean` →
`ocean-service` `/analyze` → OCEAN-AI → DB → `GET .../behavioral-analysis`
→ Recruitment candidate page (headless Chromium). No mocks.

Input: `glgfB3vFewc.004.mp4` (First Impressions V2 sample that OCEAN-AI's own
test suite uses), re-encoded to VP8/Opus webm to match browser
`MediaRecorder` output. 11.5 s, 1280×720, 1.29 MB.

| Stage | Result |
|---|---|
| Model init (weights cached) | 49.0 s |
| Audio inference | 4.6 s — PASS |
| Video inference | 7.3 s — PASS |
| Audio+video fusion | 11.1 s — PASS |
| ocean-service total (incl. webm→mp4 transcode) | 26.1 s |
| Upload → persisted (Celery task) | 32.5 s |
| ocean-service RSS | 760 MB idle with models loaded, 1,152 MB peak |
| CPU | peak ~7.3 cores, ~4.8 cores mean over the ~25 s busy window |

Video scores were bit-identical across three separate runs (deterministic).
Retry was verified with a real outage: ocean-service stopped → task failed
with the real connection error and scheduled an automatic retry → service
restarted → HR `POST .../retry` completed it → the delayed automatic retry
then skipped via the idempotency guard.

### Dependency pins discovered during validation

oceanai's own `setup.py` ranges do not install a working stack today:
`mediapipe>=0.10.14` and `gradio>=5.6.0` resolve to versions that break the
import (see `requirements.txt`'s header for exact errors), and
`ipython`/`jupyterlab`/`gradio` are hard imports, not optional extras.
`ffmpeg` must be on PATH for oceanai's **own** audio extraction, not just our
webm→mp4 step, and that extraction passes paths to a shell unquoted, so
`ANALYSIS_WORK_DIR` must not contain spaces (enforced in `ocean_service.py`).
`gradio` calls `api.gradio.app` at import; the Dockerfile disables that with
`GRADIO_ANALYTICS_ENABLED=False`.

## Known limitations (as of this integration)

- Validated on a single 11.5 s sample clip. A real interview runs several
  minutes; inference time should scale roughly with duration but has not been
  measured on a full-length interview yet.
- The Docker image itself has not been built and run in this validation — the
  E2E run used the same code and pinned dependency set in a host venv. Build
  and smoke-test `ocean-service` before deploying.
- The corpus/language pretrained set used is OCEAN-AI's general-purpose
  "First Impressions V2" English set (`corpus="fi"`, `lang="en"`) — not
  fine-tuned on interview-specific or this company's own data.
- No automatic retention/deletion job for old recordings.
