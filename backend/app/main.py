from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from .config import settings
from .api import upload, query, rules, audio, fraud, interview, auth, telephonic, hiring, screening, orchestrator, mcp, observability, google_oauth, agent, whatsapp, voice
from .database import engine
from . import models

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup Warmup ──
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

    yield


app = FastAPI(
    title="AI Policy Intelligence Platform API",
    description="Backend API for the rule intelligence engine.",
    version="1.0.0",
    lifespan=lifespan
)

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

app.include_router(upload.router, prefix="/api/v1")
app.include_router(query.router, prefix="/api/v1")
app.include_router(rules.router, prefix="/api/v1")
app.include_router(audio.router, prefix="/api/v1")
app.include_router(fraud.router, prefix="/api/v1")
app.include_router(interview.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(telephonic.router, prefix="/api/v1")
app.include_router(hiring.router, prefix="/api/v1")
app.include_router(screening.router, prefix="/api/v1")
app.include_router(orchestrator.router, prefix="/api/v1")
app.include_router(mcp.router, prefix="/api/v1")
app.include_router(observability.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")

# Mounted at the root (not /api/v1) so the callback path matches
# GOOGLE_AUTH_REDIRECT_URL in .env exactly: /auth/google/callback.
app.include_router(google_oauth.router)

# Mounted at the root so the path matches exactly what's registered in the
# Meta App Dashboard's webhook config: /webhooks/whatsapp (not /api/v1/...).
app.include_router(whatsapp.router)

# Mount uploads directory for static file serving
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")



@app.get("/")
def read_root():
    return {"message": "Welcome to the AI Policy Intelligence Platform API", "environment": settings.ENVIRONMENT}

@app.get("/health")
def health_check():
    from .services.resilience import all_breaker_states
    return {"status": "ok", "circuit_breakers": all_breaker_states()}
