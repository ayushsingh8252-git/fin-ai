import asyncio
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import os
from .config import settings
from .api import upload, query, rules, audio, fraud, interview, auth, telephonic, hiring, screening, orchestrator, mcp, observability, google_oauth, agent, whatsapp, voice, command_center, outcomes, feedback, evals, health, recruitment, recruitment_analytics
from .api.deps import get_current_user
from .database import engine
from .rate_limit import limiter
from . import models

from contextlib import asynccontextmanager

import logging

logger = logging.getLogger(__name__)


async def _online_eval_loop():
    """Runs services/online_eval.py's sampling job on an interval, forever,
    for as long as this process lives. A single bad iteration (a Langfuse API
    hiccup, a DB blip) must never kill the loop — only a cancellation
    (shutdown) should stop it, so every iteration's own errors are caught and
    logged rather than left to propagate."""
    from .services.online_eval import run_online_eval_once

    while True:
        try:
            await asyncio.to_thread(run_online_eval_once)
        except Exception as e:
            logger.warning("[OnlineEval Loop] Iteration failed: %s", e)
        await asyncio.sleep(settings.ONLINE_EVAL_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup Warmup ──
    # 0. Create any missing tables from the current model definitions.
    # Alembic's migration chain here only ever applies incremental ALTERs on
    # top of an assumed-already-existing schema (its own "initial schema"
    # migration only creates documents/chunks/rules, three tables from this
    # app's original RAG-only scope) — every other table (users, call_records,
    # whatsapp_messages, voice_prints, ...) has never had a create-table
    # migration written for it. That's fine for a long-lived dev/prod DB file
    # that already has them, but a genuinely fresh DB (e.g. a new Docker
    # volume) starts with zero tables and every DB-backed feature fails.
    # create_all() is idempotent (no-op for tables that already exist), so
    # this is safe to run on every startup regardless of the DB's history.
    try:
        print("[Lifespan Startup] Ensuring all tables exist (create_all)...")
        models.Base.metadata.create_all(bind=engine)
        print("[Lifespan Startup] Table check complete!")
    except Exception as e:
        print(f"[Lifespan Startup Warning] create_all failed: {e}")

    # 0a. create_all() never adds columns to a table that already exists, and
    # deploys don't run Alembic — so a column added to an existing model is
    # added here, idempotently, or every query on that table breaks.
    try:
        from sqlalchemy import inspect as _inspect, text as _text
        existing = {c["name"] for c in _inspect(engine).get_columns("candidates")}
        json_type = "JSON" if engine.dialect.name == "postgresql" else "TEXT"
        for col, ddl in (("summary", "TEXT"), ("work_history", json_type)):
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(_text(f"ALTER TABLE candidates ADD COLUMN {col} {ddl}"))
                print(f"[Lifespan Startup] Added missing column candidates.{col}")
    except Exception as e:
        print(f"[Lifespan Startup Warning] candidates column check failed: {e}")

    # 0b. Tag demo-seeded candidates created before the seeders set
    # source="demo_seed", so Recruitment Analytics never counts them as real.
    # Exact, not heuristic: the real upload pipeline is the only other code
    # path that creates a Candidate, and it always sets source="bulk_upload".
    # Idempotent — a no-op once no NULL-source rows remain.
    try:
        from sqlalchemy import update as _update
        with engine.begin() as conn:
            tagged = conn.execute(
                _update(models.Candidate)
                .where(models.Candidate.source.is_(None))
                .values(source="demo_seed")
            ).rowcount
        if tagged:
            print(f"[Lifespan Startup] Tagged {tagged} pre-existing demo-seeded candidate(s) as demo_seed")
    except Exception as e:
        print(f"[Lifespan Startup Warning] demo_seed backfill failed: {e}")

    # 1. Warm up embedding model (bge-base-en-v1.5) & run dummy forward-pass
    # to eliminate the 17.4s cold-start on the first user query.
    try:
        print("[Lifespan Startup] Pre-warming embedding model (bge-base-en-v1.5)...")
        from .services.detection import get_embedding_model
        model = get_embedding_model()
        model.encode("startup warmup query")
        print("[Lifespan Startup] Embedding model pre-warmed successfully (weights cached in RAM)!")
    except Exception as e:
        print(f"[Lifespan Startup Warning] Embedding model warmup failed: {e}")

    # 2. Warm up Pinecone vector index connection pool
    try:
        from .services.canonicalization import get_pinecone_index
        get_pinecone_index()
        print("[Lifespan Startup] Pinecone vector index connection pool warmed!")
    except Exception as e:
        print(f"[Lifespan Startup Warning] Pinecone index warmup failed: {e}")

    # 3. Pre-warm local fallback retrieval caches
    try:
        from .services.local_fallback_retrieval import prewarm_caches
        prewarm_caches()
    except Exception as e:
        print(f"[Lifespan Startup Warning] Local fallback cache prewarm failed: {e}")

    # 3b. Pre-warm the BM25 sparse-retrieval indexes (hybrid search's sparse
    # half) — same rationale as step 3: build once in the background at
    # startup instead of paying the cost on the first live query.
    try:
        from .services.sparse_retrieval import prewarm_indexes
        prewarm_indexes()
    except Exception as e:
        print(f"[Lifespan Startup Warning] BM25 index prewarm failed: {e}")

    # 4. Refresh live LLM keys
    try:
        from .services.key_manager import key_manager
        key_manager.refresh_keys()
    except Exception as e:
        print(f"[Lifespan Startup Warning] Key manager refresh failed: {e}")

    # 5. Pre-warm ECAPA-TDNN speaker encoder for Voice Identification Tool
    #    (~25MB model, ~3s first load).  Non-fatal if it fails — the model
    #    will be loaded lazily on the first voice request instead.
    try:
        from .services.voice_identification import get_speaker_model
        print("[Lifespan Startup] Pre-warming ECAPA-TDNN speaker encoder...")
        get_speaker_model()
        print("[Lifespan Startup] ECAPA-TDNN speaker encoder pre-warmed!")
    except Exception as e:
        print(f"[Lifespan Startup Warning] ECAPA-TDNN warmup failed (will load lazily): {e}")

    # 6. Verify Langfuse (LLMOps observability) connectivity, if configured.
    #    Non-fatal either way — get_langfuse() already treats missing keys as
    #    "tracing off", and a failed auth_check just means traces silently
    #    won't show up upstream, never a reason to block startup.
    lf = None
    try:
        from .services.llmops import get_langfuse
        lf = get_langfuse()
        if lf is not None:
            if lf.auth_check():
                print("[Lifespan Startup] Langfuse observability connected!")
            else:
                print("[Lifespan Startup Warning] Langfuse auth_check failed — check LANGFUSE_* keys.")
    except Exception as e:
        print(f"[Lifespan Startup Warning] Langfuse init failed: {e}")

    # 7. Start the online-eval background loop (services/online_eval.py) —
    # only when Langfuse is actually reachable, since the loop's every
    # iteration is a no-op otherwise. Single-process only: with multiple
    # uvicorn workers this would run once per worker, sampling redundantly
    # rather than incorrectly (dedupe in online_eval.py is per-process-safe
    # via the shared DB), which is an acceptable gap for this app's current
    # single-worker deployment (see docs on the missing --workers flag).
    online_eval_task = None
    if settings.ONLINE_EVAL_ENABLED and lf is not None:
        online_eval_task = asyncio.create_task(_online_eval_loop())
        print("[Lifespan Startup] Online eval background loop started.")

    yield

    if online_eval_task is not None:
        online_eval_task.cancel()
        try:
            await online_eval_task
        except (asyncio.CancelledError, Exception):
            pass

    # ── Shutdown ──
    # Flush any buffered Langfuse traces before the process exits, otherwise
    # the last batch (whatever hasn't hit flush_at/flush_interval yet) is
    # silently lost on a clean shutdown.
    try:
        from .services.llmops import shutdown_langfuse
        shutdown_langfuse()
    except Exception as e:
        print(f"[Lifespan Shutdown Warning] Langfuse flush failed: {e}")


app = FastAPI(
    title="AI Policy Intelligence Platform API",
    description="Backend API for the rule intelligence engine.",
    version="1.0.0",
    lifespan=lifespan
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]

# Every Vercel deployment (production and each PR/branch preview) gets its own
# hostname under *.vercel.app, so a fixed CORS_ORIGINS list can't keep up with
# preview URLs on its own — match the whole vercel.app family by regex in
# addition to whatever explicit custom domain(s) are set in CORS_ORIGINS.
VERCEL_ORIGIN_REGEX = r"^https://[a-zA-Z0-9-]+\.vercel\.app$"

if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=VERCEL_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # No explicit origins configured (local dev) — allow any origin, but
    # without credentials, since browsers reject a wildcard origin combined
    # with credentialed requests regardless of what the server sends.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Auth guard (api/deps.py::get_current_user) is applied per-router here
# rather than per-route, so most routers need only this one line. Left OPEN
# by deliberate scope decision (see docs/client-readiness-audit-2026-09-16.md):
# auth.router (this is how a token is obtained), google_oauth.router/
# whatsapp.router (external callback/webhook, not a user session), and
# query.router/audio.router (the public marketing-page chat widget —
# AIAssistantWidget.tsx, mounted site-wide in layout.tsx — calls /query and
# /transcribe unauthenticated; forcing sign-in there would break that public
# feature). Both stay rate-limited (see the routers themselves) since they're
# reachable by anonymous traffic.
#
# interview.router and screening.router are NOT blanket-protected either,
# for a different reason: both mix platform-user routes (HR sending an
# invite, viewing a result — protected individually via Depends(get_current_
# user) inside screening.py) with candidate-facing routes reached via an
# emailed invite link (interview turn/evaluate/report + its WS route,
# screening start/session/proctor-telemetry). A candidate on that link was
# never a signed-in platform user and must not be forced to become one — the
# long random session_id already in every one of those calls is the real
# access control there, not this dependency.
#
# fraud.router is handled per-route too, but purely for a header-mechanics
# reason: its SSE scan-progress stream can't use a header-based Authorization
# check at all (browsers' EventSource API can't set custom headers on ANY
# request), so it reads the JWT from a `?token=` query param instead
# (api/deps.py::get_current_user_query) while its other routes use the
# normal header-based get_current_user directly.
_auth_guard = [Depends(get_current_user)]

app.include_router(upload.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(query.router, prefix="/api/v1")
app.include_router(rules.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(audio.router, prefix="/api/v1")
app.include_router(fraud.router, prefix="/api/v1")
app.include_router(interview.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(telephonic.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(hiring.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(screening.router, prefix="/api/v1")
app.include_router(orchestrator.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(mcp.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(observability.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(outcomes.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(feedback.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(evals.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(agent.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(voice.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(command_center.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(recruitment.router, prefix="/api/v1", dependencies=_auth_guard)
app.include_router(recruitment_analytics.router, prefix="/api/v1", dependencies=_auth_guard)

# Mounted at the root (not /api/v1) so the callback path matches
# GOOGLE_AUTH_REDIRECT_URL in .env exactly: /auth/google/callback.
app.include_router(google_oauth.router)

# Mounted at the root so the path matches exactly what's registered in the
# Meta App Dashboard's webhook config: /webhooks/whatsapp (not /api/v1/...).
app.include_router(whatsapp.router)

# Real liveness/readiness checks (api/health.py) — mounted at root, not
# /api/v1, matching the existing GET /health below. No auth: a load
# balancer/orchestrator probes these without credentials, same as /health
# already does today.
app.include_router(health.router)

UPLOADS_ROOT = os.path.abspath("uploads")
os.makedirs(UPLOADS_ROOT, exist_ok=True)


@app.get("/uploads/{file_path:path}")
def get_uploaded_file(file_path: str, user: models.User = Depends(get_current_user)):
    """Replaces a raw StaticFiles mount (which served every uploaded resume/
    scan to anyone with the URL, no auth at all) with a gated route. Also
    closes a read-side path-traversal risk symmetrically with the write-side
    filename sanitization in services/upload_safety.py: the resolved path
    must still land inside UPLOADS_ROOT after normalization."""
    candidate = os.path.abspath(os.path.join(UPLOADS_ROOT, file_path))
    if os.path.commonpath([candidate, UPLOADS_ROOT]) != UPLOADS_ROOT or not os.path.isfile(candidate):
        raise HTTPException(status_code=404, detail="File not found.")
    # Candidate resumes are served only by GET /recruitment/candidates/{id}/resume,
    # which checks that this user may see that candidate. This route only checks
    # that someone is signed in, so it must not be a way around that.
    if os.path.commonpath([candidate, os.path.join(UPLOADS_ROOT, "resumes")]) == os.path.join(UPLOADS_ROOT, "resumes"):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(candidate)



@app.get("/")
def read_root():
    return {"message": "Welcome to the AI Policy Intelligence Platform API", "environment": settings.ENVIRONMENT}

@app.get("/health")
def health_check():
    from .services.resilience import all_breaker_states
    return {"status": "ok", "circuit_breakers": all_breaker_states()}
