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

    # Telephonic Agent — real outbound calling via Twilio.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    # Public HTTPS origin (no trailing slash) Twilio can reach to fetch TwiML
    # and post call-status/speech-gather webhooks — e.g. an ngrok URL in dev,
    # or this backend's deployed URL in production. Outbound calling is
    # disabled (with a clear error) while this is unset, since Twilio cannot
    # call back into localhost.
    PUBLIC_BASE_URL: str = ""

    # SMTP — used only by the Screening Agent invite flow (app/services/email_service.py).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    # Candidate-facing origin (the frontend's own URL), used to build interview
    # invite links — distinct from PUBLIC_BASE_URL, which is this backend's own
    # public URL for Twilio webhooks.
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

    # Fraud detection pipeline
    FRAUD_ELA_THRESHOLD: float = 35.0
    # Empty by default so pytesseract resolves `tesseract` from PATH, which is
    # how the apt-installed binary is found on Linux hosts (Render/Docker/HF
    # Spaces). Only set this in .env on Windows dev machines, where Tesseract
    # isn't on PATH by default — e.g. C:\Program Files\Tesseract-OCR\tesseract.exe.
    TESSERACT_CMD: str = ""

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
