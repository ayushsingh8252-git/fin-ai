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

    DATABASE_URL: str = "sqlite:///./policy_engine.db"

    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

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

    # Command Center — password unlock (server-side alternative to the voice
    # biometric gate; see api/command_center.py). A bcrypt hash, never the
    # plaintext password — generate with:
    #   python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
    # Empty means the /command-center/unlock endpoint is disabled (503),
    # same "empty = not configured, fail with a clear error" convention used
    # across every other integration in this file.
    # Under Docker Compose: escape every `$` in the hash as `$$` in .env —
    # Compose interpolates env_file contents and will otherwise silently
    # truncate the hash at the first unresolved `$word` (see .env.example).
    COMMAND_CENTER_PASSWORD_HASH: str = ""

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
    VOICE_ID_MIN_ENROLLMENT_SAMPLES: int = 3
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

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
