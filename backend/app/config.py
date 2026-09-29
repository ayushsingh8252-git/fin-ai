from pydantic_settings import BaseSettings, SettingsConfigDict

from pydantic import Field, AliasChoices

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    PORT: int = 8000

    GEMINI_API_KEY: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY"))
    GROK_API_KEY: str = Field(default="", validation_alias=AliasChoices("GROK_API_KEY", "XAI_API_KEY", "GROQ_API_KEY"))
    GROQ_API_KEY: str = Field(default="", validation_alias=AliasChoices("GROQ_API_KEY", "GROK_API_KEY"))

    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = ""
    PINECONE_INDEX_NAME: str = Field(default="policy-rules", validation_alias=AliasChoices("PINECONE_INDEX_NAME", "PINECONE_INDEX"))

    TAVILY_API_KEY: str = ""

    # LLMOps observability (Langfuse — https://langfuse.com). Empty keys mean
    # the feature is fully off: services/llmops.py::get_langfuse() returns
    # None and every call site skips tracing, same "empty = not configured"
    # convention used everywhere else in this file. Never a hard dependency
    # for an LLM call to succeed.
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""
    LANGFUSE_HOST: str = Field(
        default="https://cloud.langfuse.com",
        validation_alias=AliasChoices("LANGFUSE_HOST", "LANGFUSE_BASE_URL"),
    )
    # JSON map keyed by the exact provider model ID. Values are USD per one
    # million tokens, e.g. {"gemini-2.5-flash":{"input":0.15,"output":0.60}}.
    # Keep this tied to the account's actual price card; no guessed provider
    # prices belong in source code. Langfuse receives costs only when a rate
    # exists for the model that actually answered.
    LLM_COST_RATES_JSON: str = "{}"
    # Operational guardrails for measured USD spend. Example:
    # {"daily_usd":25,"monthly_usd":500,"warning_ratio":0.8}
    LLM_COST_BUDGETS_JSON: str = "{}"
    LANGFUSE_PROMPT_LABEL: str = "production"

    # Online evals (services/online_eval.py) — samples recent LIVE traces per
    # workflow via the Langfuse API and scores them with cheap heuristics
    # (plus a coarse LLM-judge groundedness check on a smaller RAG sample),
    # distinct from scripts/evaluate_rag.py's offline fixed-question-set run.
    # No-op unless Langfuse is configured — same "empty config = feature off"
    # convention as the rest of this section.
    ONLINE_EVAL_ENABLED: bool = True
    ONLINE_EVAL_INTERVAL_SECONDS: int = 900
    # Deliberately > interval so a slow tick never leaves a gap of
    # unconsidered traces between runs; already-scored trace_ids are skipped
    # via OnlineEvalResult, so the overlap is just a dedupe check, not
    # wasted work.
    ONLINE_EVAL_LOOKBACK_SECONDS: int = 1200
    ONLINE_EVAL_SAMPLE_RATE: float = 0.3
    # Applied on top of ONLINE_EVAL_SAMPLE_RATE, RAG traces only — the
    # judge check makes a real LLM call, so it's sampled more conservatively.
    ONLINE_EVAL_JUDGE_SAMPLE_RATE: float = 0.2
    ONLINE_EVAL_LATENCY_THRESHOLD_MS: int = 15000

    # Retrieval — hybrid search (dense Pinecone/local-cosine + sparse BM25,
    # fused via Reciprocal Rank Fusion; see services/retrieval.py and
    # services/sparse_retrieval.py). Defaults on since it's additive on top
    # of the existing dense path (BM25 runs alongside it, never instead of
    # it) — set false to fall back to the previous dense-only behavior, or to
    # A/B it in the evaluation suite.
    ENABLE_HYBRID_SEARCH: bool = True

    # Reranking — a genuine cross-encoder re-scores the fused candidate set
    # pairwise against the query (see services/reranking.py), instead of the
    # cheap same-scores sort used when this is off. Off by default: it lazily
    # loads a ~17MB transformer model on first use, and this box has a
    # documented history of OOM crashes under memory pressure — turn on only
    # once you've confirmed headroom (GET /health, or just watch it not crash).
    ENABLE_CROSS_ENCODER_RERANK: bool = False

    # OAuth client ID from Google Cloud Console (Credentials > OAuth 2.0 Client
    # IDs > Web application). Must match NEXT_PUBLIC_GOOGLE_CLIENT_ID on the
    # frontend — used to reject ID tokens issued for a different app.
    GOOGLE_CLIENT_ID: str = ""

    # Comma-separated list of allowed frontend origins in production (e.g. the
    # Vercel URL). Empty means "allow any origin" — fine for local dev, but
    # tightening this in render.yaml is what actually makes CORS_ORIGINS mean
    # something instead of sitting there unused.
    CORS_ORIGINS: str = ""

    # Public HTTPS origin (no trailing slash) Sarvam can reach to post the
    # outbound-call result webhook — e.g. an ngrok URL in dev, or this
    # backend's deployed URL in production. Outbound calling is disabled
    # (with a clear error) while this is unset, since Sarvam cannot call
    # back into localhost.
    PUBLIC_BASE_URL: str = ""

    # Telephonic Agent — real outbound calling via Sarvam AI (samvaad). Sarvam
    # owns the whole call: a conversational "app" configured in the Sarvam
    # console runs its own STT/TTS/dialog state machine once triggered, and
    # posts the result back to the /telephonic/sarvam/webhook route once the
    # call ends. Same "empty = not configured, fail with a clear error, never
    # fake a response" convention used across every other integration here.
    SARVAM_API_KEY: str = ""
    SARVAM_ORG_ID: str = ""
    SARVAM_WORKSPACE_ID: str = ""
    SARVAM_APP_ID: str = ""
    SARVAM_APP_VERSION: int = 1
    SARVAM_CONNECTION_ID: str = ""
    SARVAM_AGENT_PHONE_NUMBER: str = ""
    # Optional — only sent as app_overrides.initial_state_name when set; leave
    # blank to let the Sarvam app start at its own configured entry state.
    SARVAM_INITIAL_STATE_NAME: str = ""
    SARVAM_BASE_URL: str = "https://apps.sarvam.ai"

    # SMTP — used only by the Screening Agent invite flow (app/services/email_service.py).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    # Candidate-facing origin (the frontend's own URL), used to build interview
    # invite links — distinct from PUBLIC_BASE_URL, which is this backend's own
    # public URL for the Sarvam outbound-call webhook.
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    # Recruitment RBAC bootstrap: comma-separated emails that are promoted to
    # role "hr_admin" when they sign in. Without some seed like this nobody
    # could ever be granted a role, since only an hr_admin may assign roles.
    # Promote-only: removing an email here does NOT demote an existing admin
    # (that is a deliberate act through the role-assignment endpoint), so a
    # typo or a config rollback can never lock the real admin out.
    HR_ADMIN_EMAILS: str = ""

    DATABASE_URL: str = "sqlite:///./policy_engine.db"

    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

    # OCEAN-AI behavioral analysis — a deliberately separate service (its own
    # container, its own pinned heavy deps: torch/opencv/mediapipe/opensmile)
    # rather than merged into this backend's requirements.txt. See
    # ocean-service/ and docs/behavioral-analysis.md. Empty string (not a
    # bogus default host) so an unconfigured deployment fails fast and
    # honestly instead of silently trying to reach "localhost".
    OCEAN_SERVICE_URL: str = ""
    OCEAN_SERVICE_TIMEOUT_SECONDS: int = 600

    # Recruitment "Active Users Now" presence (services/presence.py) — how
    # many seconds since a heartbeat before that user drops out of the live
    # count. Not "session length"; just the staleness tolerance for a
    # heartbeat sent roughly every 30s from the frontend.
    RECRUITMENT_PRESENCE_WINDOW_SECONDS: int = 90

    # --- Agent memory architecture (app/memory/) ---
    # Episodic memory (one row per finished agent session: screening interview,
    # telephonic call, ...). Separate Postgres database, not the primary SQLite
    # DB above — SQLite already serves as this platform's shared/global memory
    # (documents/rules/roles/SOPs), Postgres is for the higher write-volume,
    # structured session history. Falls back cleanly (session just isn't
    # persisted, logged not raised) if this Postgres isn't reachable, same
    # fail-open convention as REDIS_URL / services/cache.py.
    # Port 5433, not the standard 5432 — docker-compose.yml publishes the
    # postgres container there too, since 5432 was already occupied by
    # another Postgres instance on the host during development.
    EPISODIC_DATABASE_URL: str = "postgresql+psycopg2://policy:policy@localhost:5433/policy_episodic"

    # Working/short-term memory: how long a session's live state (current
    # question, running transcript, latest sentiment) survives in Redis with
    # no activity before it's treated as abandoned.
    WORKING_MEMORY_TTL_SECONDS: int = 1800

    # Semantic/long-term memory: Pinecone namespace used for agent-extracted
    # facts, kept separate from the default namespace (policy rules/chunks
    # indexed by services/canonicalization.py) inside the SAME index/project
    # so no second Pinecone index needs to be provisioned.
    PINECONE_MEMORY_NAMESPACE: str = "agent-memory"

    # --- MCP enterprise tool integrations (app/mcp/) ---
    # Each connector fails soft with a clear "not configured" error (never a
    # fake response) while its own block below is unset — same convention as
    # TWILIO_* above. See app/mcp/connectors/ for what each is used for.

    # Slack — bot token from an installed Slack App (OAuth & Permissions >
    # Bot User OAuth Token). Scopes needed: chat:write, channels:read, channels:history.
    SLACK_BOT_TOKEN: str = ""

    # Microsoft Teams + SharePoint — one Azure AD app registration (Graph API,
    # client-credentials/application permissions, admin-consented). Teams
    # needs ChannelMessage.Send + Team.ReadBasic.All; SharePoint needs
    # Sites.Read.All (or Sites.ReadWrite.All to upload).
    MS_GRAPH_TENANT_ID: str = ""
    MS_GRAPH_CLIENT_ID: str = ""
    MS_GRAPH_CLIENT_SECRET: str = ""

    # Jira — Atlassian Cloud REST API v3, Basic auth with an account email +
    # API token (id.atlassian.com/manage-profile/security/api-tokens).
    JIRA_BASE_URL: str = ""  # e.g. https://your-domain.atlassian.net
    JIRA_EMAIL: str = ""
    JIRA_API_TOKEN: str = ""

    # GitHub — a fine-grained personal access token (or GitHub App
    # installation token) with repo/issues read+write on the target repos.
    GITHUB_TOKEN: str = ""

    # Salesforce — username-password OAuth2 flow (simplest server-to-server
    # option; a Connected App with this flow enabled is required). Rotate the
    # security token whenever the password changes.
    SALESFORCE_INSTANCE_URL: str = ""  # e.g. https://your-domain.my.salesforce.com
    SALESFORCE_CLIENT_ID: str = ""
    SALESFORCE_CLIENT_SECRET: str = ""
    SALESFORCE_USERNAME: str = ""
    SALESFORCE_PASSWORD: str = ""
    SALESFORCE_SECURITY_TOKEN: str = ""

    # SAP — OAuth2 client-credentials against an SAP Cloud (BTP/SuccessFactors/
    # S/4HANA Cloud) OData service. SAP_BASE_URL is the OData service root;
    # exact scopes depend on which SAP service is provisioned.
    SAP_BASE_URL: str = ""
    SAP_TOKEN_URL: str = ""
    SAP_CLIENT_ID: str = ""
    SAP_CLIENT_SECRET: str = ""

    # Google Workspace (Gmail, Drive, Calendar, Docs, Sheets) — two mutually
    # exclusive auth modes, since which one works depends on the account type:
    #
    # 1. Domain-wide delegation (Google Workspace business/education accounts
    #    ONLY — an admin must authorize the service account in the Workspace
    #    admin console). Accepts the key JSON pasted inline or a path to the
    #    downloaded key file.
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON: str = ""
    GOOGLE_WORKSPACE_DELEGATED_USER: str = ""
    #
    # 2. OAuth2 user-consent flow (personal @gmail.com accounts — domain-wide
    #    delegation doesn't exist for these). Run
    #    `python backend/scripts/google_oauth_device_setup.py` once to mint
    #    GOOGLE_OAUTH_REFRESH_TOKEN via the device-code flow (needs a
    #    "Desktop app" OAuth client ID from the same GCP project as the
    #    service account, Google Cloud Console > APIs & Services >
    #    Credentials). Preferred over mode 1 when both are set.
    GOOGLE_OAUTH_CLIENT_ID: str = ""
    GOOGLE_OAUTH_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REFRESH_TOKEN: str = ""
    #
    # Distinct from GOOGLE_CLIENT_ID above, which is only for verifying this
    # app's own Google Sign-In ID tokens — these are for calling Workspace
    # APIs as a user.
    #
    # 3. Browser-based one-time setup done as a live callback endpoint
    #    (api/google_oauth.py) instead of scripts/google_oauth_browser_setup.py's
    #    local CLI server — visit GET /auth/google/login, approve access, and
    #    the callback mints GOOGLE_OAUTH_REFRESH_TOKEN above automatically.
    #    Must be registered as an "Authorized redirect URI" on the OAuth
    #    client (Web application type) in Google Cloud Console.
    GOOGLE_AUTH_REDIRECT_URL: str = ""

    # WhatsApp Agent — Meta WhatsApp Cloud API. ACCESS_TOKEN/PHONE_NUMBER_ID
    # come from the Meta app dashboard (WhatsApp > API Setup); BUSINESS_ACCOUNT_ID
    # is the WABA ID. VERIFY_TOKEN is a string you invent yourself and register
    # in the same Meta webhook config screen — GET /webhooks/whatsapp checks the
    # incoming hub.verify_token against this value, never a hard-coded one.
    # Same "empty = not configured, fail with a clear error, never fake a
    # response" convention as TWILIO_* / the MCP connectors above.
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_BUSINESS_ACCOUNT_ID: str = ""
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_API_VERSION: str = "v21.0"
    # App Secret from the Meta App Dashboard (Settings > Basic) — used to
    # verify the X-Hub-Signature-256 header Meta sends on every webhook POST,
    # so a POST to the (publicly guessable) /webhooks/whatsapp URL can't be
    # spoofed. Empty means signature verification is skipped (dev-only; a
    # warning is logged) rather than rejecting every request outright, since
    # local/ngrok dev often predates having this configured.
    WHATSAPP_APP_SECRET: str = ""

    # --- Auth (JWT) ---
    # Signs/verifies the access token issued by POST /auth/google (see
    # api/auth.py) and required by api/deps.py's get_current_user on every
    # protected route. Empty in dev is tolerated (a random key is generated
    # once at process startup, with a logged warning) so a fresh checkout
    # still boots — but that means every restart invalidates all existing
    # sessions, so ALWAYS set a real value in any deployed environment.
    # Generate one with: python -c "import secrets; print(secrets.token_hex(32))"
    JWT_SECRET_KEY: str = ""
    JWT_EXPIRE_DAYS: int = 7

    # Fraud detection pipeline
    FRAUD_ELA_THRESHOLD: float = 35.0
    # Empty by default so pytesseract resolves `tesseract` from PATH, which is
    # how the apt-installed binary is found on Linux hosts (Render/Docker/HF
    # Spaces). Only set this in .env on Windows dev machines, where Tesseract
    # isn't on PATH by default — e.g. C:\Program Files\Tesseract-OCR\tesseract.exe.
    TESSERACT_CMD: str = ""

    # --- Voice Identification Tool ---
    # Pinecone index for 192-dim ECAPA-TDNN speaker embeddings (separate from
    # the 768-dim policy-rules index used by the RAG engine).  Must be created
    # manually in the Pinecone console with dimension=192, metric=cosine.
    PINECONE_VOICE_INDEX_NAME: str = "voice-embeddings"
    VOICE_ID_SIMILARITY_THRESHOLD: float = 0.63
    # Minimum gap between the #1 and #2 candidate scores — protects against
    # ambiguous matches where two speakers sound almost equally similar.
    VOICE_ID_MARGIN_THRESHOLD: float = 0.15
    # VAD / quality-gate thresholds.
    VOICE_ID_MIN_SPEECH_DURATION: float = 0.5   # seconds
    VOICE_ID_MIN_ENROLLMENT_SAMPLES: int = 1
    VOICE_ID_MAX_ENROLLMENT_SAMPLES: int = 30
    # Anti-spoofing feature flags — disable individually if latency is critical.
    VOICE_ID_REPLAY_DETECTION_ENABLED: bool = True
    VOICE_ID_AI_VOICE_DETECTION_ENABLED: bool = True
    VOICE_ID_CHALLENGE_ENABLED: bool = True

    # Backend inference engine (pytorch, onnx, onnx_int8)
    VOICE_INFERENCE_BACKEND: str = "pytorch"
    VOICE_LOCAL_INFERENCE: bool = False
    VOICE_MIN_SPEECH_SECONDS: float = 1.5
    VOICE_CALIBRATION_FILE: str = "models/voice_calibration.json"
    VOICE_MODEL_VERSION: str = "ecapa-voxceleb-v1"

    # --- Text-to-speech (services/tts_service.py) ---
    # "kokoro" = self-hosted Kokoro-82M via kokoro-onnx (services/kokoro_tts.py);
    # "edge" = the previous Edge-TTS -> gTTS chain, which is also the fallback
    # when Kokoro fails to load or synthesize (TTS_FALLBACK_ENABLED).
    TTS_PROVIDER: str = "kokoro"
    TTS_FALLBACK_ENABLED: bool = True
    # Voice for the "edge" provider / fallback only.
    TTS_EDGE_VOICE: str = "en-US-AndrewMultilingualNeural"
    KOKORO_VOICE: str = "am_michael"
    KOKORO_LANG: str = "en-us"          # espeak-ng language code (en-us / en-gb)
    KOKORO_SPEED: float = 1.0           # 0.5 - 2.0
    KOKORO_DEVICE: str = "auto"         # auto | cpu | cuda
    # fp32 by default: measured on this project's dev CPU, the int8 export ran
    # ~3x SLOWER (RTF 2.5 vs 0.8) — dynamic-quant kernels aren't faster on
    # every CPU. Re-measure before switching on new hardware.
    KOKORO_MODEL_PATH: str = "models/kokoro/kokoro-v1.0.onnx"
    KOKORO_VOICES_PATH: str = "models/kokoro/voices-v1.0.bin"
    KOKORO_THREADS: int = 0             # 0 = min(cpu_count, 8)
    # Syntheses run at once. Each one already uses KOKORO_THREADS cores, so >1
    # mostly just splits the CPU between interviews rather than adding speed.
    KOKORO_MAX_CONCURRENCY: int = 1
    KOKORO_PRELOAD: bool = True         # load at startup instead of on first request
    # onnxruntime's CPU arena keeps every buffer it ever allocated (measured:
    # RSS 433 MB after load -> ~770 MB after a few replies). Off = allocate per
    # run and give memory back; see docs/kokoro-tts.md for the measured cost.
    KOKORO_CPU_MEM_ARENA: bool = False
    TTS_CACHE_MAX_ITEMS: int = 64       # static-phrase audio cache (0 disables)

    # Interview speaker monitor (services/speaker_stream.py): the candidate's
    # mic streamed over the interview WebSocket -> Silero VAD per 1.5s window
    # -> ECAPA embedding -> similarity to the candidate reference -> hysteresis
    # state machine -> events. Separate from VOICE_ID_SIMILARITY_THRESHOLD
    # above, which is calibrated for full enrollment clips; short windows
    # score lower and noisier.
    SPEAKER_MONITOR_ENABLED: bool = True
    SPEAKER_WINDOW_SECONDS: float = 1.5
    SPEAKER_WINDOW_HOP_SECONDS: float = 0.75
    SPEAKER_WINDOW_MIN_SPEECH_RATIO: float = 0.6
    SPEAKER_VAD_THRESHOLD: float = 0.5          # Silero speech probability per 32ms frame
    SPEAKER_MIN_SILENCE_SECONDS: float = 1.0    # silence before SPEECH_ENDED
    SPEAKER_CLEAR_SECONDS: float = 2.0          # sustained candidate-only speech that ends an unknown speaker
    SPEAKER_SILENCE_CLEAR_SECONDS: float = 3.0  # or sustained silence
    SPEAKER_CANDIDATE_CONFIRM_SECONDS: float = 1.5
    SPEAKER_CO_PRESENCE_SECONDS: float = 30.0   # candidate heard this recently -> "multiple speakers"
    SPEAKER_MAX_BUFFER_SECONDS: float = 20.0    # per-session audio kept in memory; older audio is dropped
    SPEAKER_MAX_FRAME_BYTES: int = 32000        # 1s of 16kHz int16 mono
    SPEAKER_MAX_REALTIME_FACTOR: float = 2.0    # frames arriving faster than this are dropped
    # Measured on real speech (2 speakers, held-out, 1.5s windows): same
    # speaker mostly 0.35-0.71, different speaker never above 0.13. Recalibrate
    # on a larger set before relying on the exact coverage percentage.
    SPEAKER_CANDIDATE_THRESHOLD: float = 0.35   # similarity >= this -> CANDIDATE
    SPEAKER_UNKNOWN_THRESHOLD: float = 0.25     # similarity <= this -> UNKNOWN_SPEAKER
    SPEAKER_MIN_UNKNOWN_SECONDS: float = 2.0    # shorter unknown runs never become events
    SPEAKER_BASELINE_MIN_SECONDS: float = 10.0  # clean candidate speech needed before classifying
    SPEAKER_CLUSTER_THRESHOLD: float = 0.45     # unknown intervals this similar = same extra speaker

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
