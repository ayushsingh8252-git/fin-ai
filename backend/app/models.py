from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Float, Text, UniqueConstraint, Index, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

# ── Recruitment RBAC roles (User.role) ───────────────────────────────────
# Kept here rather than in api/deps.py so the model layer, the service layer
# and the migration can all import one definition without a circular import
# back through the API package.
HR_ADMIN = "hr_admin"
RECRUITER = "recruiter"
HIRING_MANAGER = "hiring_manager"
INTERVIEWER = "interviewer"
USER_ROLES = (HR_ADMIN, RECRUITER, HIRING_MANAGER, INTERVIEWER)

# ── Application pipeline stages (Application.stage) ──────────────────────
# One authoritative lifecycle. Agents never invent a stage of their own —
# every transition goes through recruitment_service.transition_stage, which
# validates against STAGE_TRANSITIONS below and records a CandidateActivity.
STAGE_APPLIED = "APPLIED"
STAGE_PROCESSING = "PROCESSING"
STAGE_SCREENING = "SCREENING"
STAGE_SHORTLISTED = "SHORTLISTED"
STAGE_INTERVIEW = "INTERVIEW"
STAGE_SELECTED = "SELECTED"
STAGE_OFFER = "OFFER"
STAGE_HIRED = "HIRED"
STAGE_REJECTED = "REJECTED"
STAGE_WITHDRAWN = "WITHDRAWN"

PIPELINE_STAGES = (
    STAGE_APPLIED, STAGE_PROCESSING, STAGE_SCREENING, STAGE_SHORTLISTED,
    STAGE_INTERVIEW, STAGE_SELECTED, STAGE_OFFER, STAGE_HIRED,
)
TERMINAL_STAGES = (STAGE_REJECTED, STAGE_WITHDRAWN)
ALL_STAGES = PIPELINE_STAGES + TERMINAL_STAGES

# ── Score provenance (Application.score_provenance) ──────────────────────
# Why this exists: the codebase's own audit found a fabricated score (a
# hardcoded 50 produced during a total LLM outage) persisted and then marked
# "is_real: true", because the guard only checked `is None`. A value alone
# can never answer "was this actually computed?" — so every AI-derived score
# on an Application carries a status + source alongside it, and the UI is
# built to refuse to render a number whose status isn't "computed".
SCORE_COMPUTED = "computed"          # the real (LLM) path produced this value
SCORE_DEGRADED = "degraded"          # a fallback produced it; value kept, must be labelled
SCORE_NOT_COMPUTED = "not_computed"  # nothing produced it; value is None

SOURCE_LLM = "llm"
SOURCE_DETERMINISTIC = "deterministic"
SOURCE_DERIVED = "derived"           # arithmetic over other persisted fields, no model involved

class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)
    upload_date = Column(DateTime(timezone=True), server_default=func.now())
    metadata_ = Column("metadata", JSON, default={})

    chunks = relationship("Chunk", back_populates="document")
    rules = relationship("Rule", back_populates="document")

class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String, primary_key=True, index=True)
    document_id = Column(String, ForeignKey("documents.id"))
    page = Column(Integer)
    section = Column(String, index=True)
    content = Column(String)

    document = relationship("Document", back_populates="chunks")

class FraudScan(Base):
    __tablename__ = "fraud_scans"

    id = Column(String, primary_key=True, index=True)
    filename = Column(String)
    file_path = Column(String)
    content_type = Column(String)  # "pdf" | "image"
    status = Column(String, default="uploaded")  # uploaded -> scanning -> complete -> error
    result = Column("result", JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class IdentityRecord(Base):
    """One row per document ever scanned that yielded identity fields — the
    corpus the Duplicate Identity Scan blocks/matches new scans against, and
    the corpus Resume Authenticity's embedding-similarity check compares
    against to catch templated/mass-produced resumes.

    Sensitive fields are never stored raw: bank_account_last4 keeps only the
    last 4 digits, and device_fingerprint/ip_hash store a SHA-256 hash (not
    the raw IP/user-agent) — enough to detect exact re-use across
    submissions without persisting the underlying PII.
    """

    __tablename__ = "identity_records"

    id = Column(String, primary_key=True, index=True)  # == scan_id, 1:1 with FraudScan
    full_name = Column(String, nullable=True)
    name_key = Column(String, index=True, nullable=True)  # phonetic blocking key
    email = Column(String, nullable=True)
    email_local_key = Column(String, index=True, nullable=True)  # normalized local-part blocking key
    email_domain = Column(String, index=True, nullable=True)
    phone = Column(String, nullable=True)
    phone_key = Column(String, index=True, nullable=True)  # last-7-digits blocking key
    date_of_birth = Column(String, nullable=True)  # YYYY-MM-DD
    bank_account_last4 = Column(String, nullable=True)
    device_fingerprint_hash = Column(String, index=True, nullable=True)
    ip_hash = Column(String, index=True, nullable=True)
    resume_embedding = Column(JSON, nullable=True)  # list[float] (truncated precision)
    resume_text_len = Column(Integer, nullable=True)
    cluster_id = Column(String, index=True, nullable=True)  # identity-graph cluster this record belongs to
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String)
    picture = Column(String)
    login_count = Column(Integer, default=0)
    # Recruitment RBAC. Deliberately a plain string column rather than a
    # separate roles/permissions table: this app has exactly four fixed roles
    # and no notion of custom roles, so a lookup table would add a join to
    # every authorization check and buy nothing. See api/deps.py::require_role
    # and services/recruitment_service.py's visible_jobs_filter /
    # assert_can_act_on, which are the only two places that interpret it.
    #
    # Defaults to "recruiter" rather than something more restrictive because
    # every account that exists today predates this column and was, in
    # effect, already a full-access user (get_current_user was a boolean
    # "is signed in" gate). Defaulting to a narrower role would silently
    # revoke access those users already have; tightening is a deliberate
    # admin action, not a migration side effect.
    role = Column(String, nullable=False, default=RECRUITER, server_default=RECRUITER, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), server_default=func.now())

class CallRecord(Base):
    __tablename__ = "call_records"

    id = Column(String, primary_key=True, index=True)
    call_sid = Column(String, unique=True, index=True, nullable=True)  # Sarvam's outbound/attempt id
    to_number = Column(String)
    candidate_name = Column(String)
    role_title = Column(String)
    status = Column(String, default="queued")  # queued -> ringing/in-progress -> completed/no-answer/busy/failed
    transcript = Column(JSON, default=list)  # [{"role": "agent"|"candidate", "text": str}, ...]
    duration_sec = Column(Integer, nullable=True)
    error_message = Column(String, nullable=True)
    communication_score = Column(Integer, nullable=True)
    relevance_score = Column(Integer, nullable=True)
    confidence_score = Column(Integer, nullable=True)
    evaluation_summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ScreeningSession(Base):
    __tablename__ = "screening_sessions"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    role_title = Column(String, nullable=False)
    jd_text = Column(Text, nullable=True)
    status = Column(String, default="invited")  # invited -> opened -> in_progress -> completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class ScreeningResult(Base):
    """Screening Agent's JD-aligned analysis of a finished conversation — the
    last link in Candidate -> Telephonic Agent -> Conversation -> Response
    Storage -> Screening Agent -> Screening Result. One row per analysis run
    (re-running keeps history rather than overwriting)."""

    __tablename__ = "screening_results"

    id = Column(String, primary_key=True, index=True)
    source = Column(String, default="telephonic")  # "telephonic" | "interview" — which conversation this analyzed
    call_id = Column(String, ForeignKey("call_records.id"), nullable=True, index=True)
    session_id = Column(String, ForeignKey("screening_sessions.id"), nullable=True, index=True)  # set when source="interview"
    candidate_name = Column(String, nullable=False)
    role_title = Column(String, nullable=True)
    jd_text_used = Column(Text, nullable=True)
    jd_match_score = Column(Integer, nullable=True)
    verdict = Column(String, nullable=True)  # "Strong Match" | "Match" | "Consider" | "Not a Fit" (telephonic) or "Strong Hire" | "Hire" | "Lean Hire" | "No Hire" (interview)
    strengths = Column(JSON, default=list)
    gaps = Column(JSON, default=list)
    summary = Column(Text, nullable=True)
    # Extra structured fields specific to the interview-report shape (sub-scores,
    # matched/missing skills, timing, proctoring) that don't fit the telephonic
    # path's flatter schema — kept as JSON rather than N more nullable columns.
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CandidateScoreCard(Base):
    """Enterprise Orchestration Layer's per-candidate scorecard — one row per
    candidate scheduled for interviews, backing the compact scores table on
    the hiring-automation UI. `telephonic_score`/`ai_interview_score` are
    populated from the real CallRecord/episodic-memory scoring pipelines
    when available (see memory/orchestrator.py's schedule_candidate_interview),
    falling back to a stable placeholder only until that candidate's actual
    interview has run — `*_is_real` marks which is which so the UI can show
    an honest "placeholder" badge instead of presenting a guess as fact."""

    __tablename__ = "candidate_score_cards"

    id = Column(String, primary_key=True, index=True)  # candidate_id from the hiring-automation UI
    candidate_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    telephonic_score = Column(Integer, nullable=True)
    telephonic_score_is_real = Column(String, default="false")  # "true"|"false" — SQLite has no native bool
    ai_interview_score = Column(Integer, nullable=True)
    ai_interview_score_is_real = Column(String, default="false")
    telephonic_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    ai_interview_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    # The candidate-picked calendar slot itself (date label + time label, e.g.
    # "Mon, Jan 12" / "10:00 AM") — distinct from *_scheduled_at above, which
    # is when the scheduling action happened, not when the interview is for.
    telephonic_slot_date = Column(String, nullable=True)
    telephonic_slot_time = Column(String, nullable=True)
    ai_interview_slot_date = Column(String, nullable=True)
    ai_interview_slot_time = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CandidateDeliveryStatus(Base):
    """One row per hiring 'Bulk Send Assignment' recipient — replaces the old
    client-side animation that unconditionally marked every candidate
    "Delivered ✓ / Reply Received ✓" the moment the button was clicked, with
    zero email actually sent. Persists the real outcome of a real SMTP send
    (see services/email_service.py::send_assignment_email) so the frontend
    polls and displays what actually happened instead of animating a
    foregone conclusion.

    status: PENDING -> SENDING -> SENT | FAILED -> (SENT can move to) REPLIED.
    REPLIED is set only via the explicit /hiring/bulk-send/{id}/mark-replied
    endpoint, a human confirming they've actually seen a reply in their own
    inbox — there is no inbound-email/IMAP integration in this codebase to
    detect a reply automatically, so this deliberately stays a real,
    human-asserted fact rather than a fabricated automatic signal."""

    __tablename__ = "candidate_delivery_status"

    id = Column(String, primary_key=True, index=True)
    candidate_id = Column(String, nullable=False, index=True)
    candidate_name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    role_title = Column(String, nullable=True)
    status = Column(String, nullable=False, default="PENDING")  # PENDING|SENDING|SENT|FAILED|REPLIED
    error_message = Column(Text, nullable=True)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Role(Base):
    """Shared/global memory — one row per job role, readable by every agent
    (Screening, Telephonic, Fraud) so role expectations stay consistent
    across products instead of each agent guessing at role_title free text.

    Also the Job entity for the HR recruitment panel. Deliberately extended
    rather than shadowed by a parallel `jobs` table: this row already holds
    the JD text that the Screening and Telephonic agents read, so a second
    job table would immediately create two competing sources of truth for
    "what is this role's JD". The columns below are all nullable/defaulted,
    so rows auto-upserted by the agents (global_memory.upsert_role, which
    only ever sets title/jd_text) stay valid — they simply appear as jobs
    with no owner and status "draft" until someone fills them in."""

    __tablename__ = "roles"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, index=True, unique=True)
    department = Column(String, nullable=True)
    jd_text = Column(Text, nullable=True)
    must_have_skills = Column(JSON, default=list)
    # ── Recruitment-panel fields ──
    status = Column(String, nullable=False, default="draft", server_default="draft", index=True)  # draft | open | closed
    location = Column(String, nullable=True)
    min_experience_years = Column(Float, nullable=True)
    preferred_skills = Column(JSON, default=list)
    description = Column(Text, nullable=True)
    # The hiring-manager ownership key: a user with role="hiring_manager"
    # can only see and act on jobs where this matches their own id (see
    # recruitment_service.visible_jobs_filter). Nullable because every row
    # predating this column — and every row the agents auto-upsert — has no
    # creating user; those are visible to hr_admin/recruiter only.
    created_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class OnboardingSOP(Base):
    """Shared/global memory — company onboarding SOPs/policies keyed by topic,
    e.g. 'equipment', 'accounts', 'first_week'. Distinct from the ingested
    Document/Rule corpus (compliance policy text) — these are short,
    structured operational steps agents quote directly rather than retrieve."""

    __tablename__ = "onboarding_sops"

    id = Column(String, primary_key=True, index=True)
    topic = Column(String, index=True)
    title = Column(String)
    steps = Column(JSON, default=list)  # list[str]
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GraphNode(Base):
    """Graph-structured memory — one row per entity (candidate, role, team,
    project, agent session). Persisted so the in-memory networkx graph built
    by app/memory/graph_memory.py survives process restarts."""

    __tablename__ = "graph_nodes"

    id = Column(String, primary_key=True, index=True)  # stable entity key, e.g. "candidate:jane@x.com"
    type = Column(String, index=True)  # "candidate" | "role" | "team" | "project" | "session"
    label = Column(String)
    properties = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class GraphEdge(Base):
    """Graph-structured memory — directed relationship between two GraphNode
    rows, e.g. candidate --SCREENED_FOR--> role, candidate --MEMBER_OF--> team."""

    __tablename__ = "graph_edges"

    id = Column(String, primary_key=True, index=True)
    source_id = Column(String, ForeignKey("graph_nodes.id"), index=True)
    target_id = Column(String, ForeignKey("graph_nodes.id"), index=True)
    relation = Column(String, index=True)  # "SCREENED_FOR" | "MEMBER_OF" | "WORKED_ON" | ...
    properties = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QueryTrace(Base):
    """One row per /query request — structured execution observability (see
    docs/platform-status-audit-2026-08-26-rag-improvement-pass.md). Looked up
    by request_id via GET /api/v1/observability/trace/{request_id}; the last
    N rows are scanned for aggregate stats via GET /api/v1/observability/stats.

    `trace` holds the full structured payload (query processing, retrieval,
    CRAG, adaptive/ARAG, reranking, web search, LLM attempts, final response)
    as one JSON blob rather than a wide fixed column set — the shape can
    evolve without another migration for every new field the pipeline grows.
    Never contains API keys, full prompts, or full answer text — see
    services/trace.py, which builds this and mirrors guardrails.py's
    "never log secrets" convention."""

    __tablename__ = "query_traces"

    request_id = Column(String, primary_key=True, index=True)
    document_id = Column(String, nullable=True, index=True)
    query_text = Column(String, nullable=True)
    status = Column(String, default="ok", index=True)  # "ok" | "blocked" | "error"
    total_latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    trace = Column(JSON, default=dict)


class BusinessOutcomeEvent(Base):
    """Auditable business-impact event correlated to a product workflow.

    The row contains only measurements and opaque IDs. Candidate documents,
    prompts, transcripts, and model output remain outside this ledger.
    """

    __tablename__ = "business_outcome_events"

    id = Column(String, primary_key=True, index=True)
    workflow_type = Column(String, nullable=False, index=True)
    workflow_id = Column(String, nullable=False, index=True)
    langfuse_trace_id = Column(String, nullable=True, index=True)
    status = Column(String, nullable=False, default="completed", index=True)
    automated = Column(String, nullable=False, default="false")
    manual_baseline_minutes = Column(Float, nullable=True)
    human_active_minutes = Column(Float, nullable=True)
    labor_cost_per_hour_usd = Column(Float, nullable=True)
    ai_cost_usd = Column(Float, nullable=True)
    review_outcome = Column(String, nullable=True, index=True)  # accepted | rework | rejected
    required_rework = Column(String, nullable=False, default="false")
    metadata_ = Column("metadata", JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class LLMCostRecord(Base):
    """One provider generation's measured usage and locally calculated cost."""

    __tablename__ = "llm_cost_records"

    id = Column(String, primary_key=True, index=True)
    langfuse_trace_id = Column(String, nullable=True, index=True)
    provider = Column(String, nullable=False, index=True)
    model = Column(String, nullable=False, index=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cache_read_input_tokens = Column(Integer, nullable=True)
    cost_usd = Column(Float, nullable=True)
    cost_source = Column(String, nullable=False)  # configured_rate_card | unpriced
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class FeedbackEvent(Base):
    """One row per human thumbs up/down on a specific LLM-produced result
    (RAG answer, fraud scan, interview/screening report, telephonic call
    evaluation). `subject_id` is that result's own id — request_id / scan_id
    / report_id / session_id / call_id — the exact same value `trace_id_for()`
    (services/llmops.py) hashes to derive the Langfuse trace this feedback is
    also pushed to as a score, so a vote here and the underlying trace always
    resolve to the same Langfuse record without a separate id mapping table."""

    __tablename__ = "feedback_events"

    id = Column(String, primary_key=True, index=True)
    workflow_type = Column(String, nullable=False, index=True)  # "rag" | "fraud" | "interview" | "screening" | "telephonic"
    subject_id = Column(String, nullable=False, index=True)
    langfuse_trace_id = Column(String, nullable=True, index=True)
    rating = Column(String, nullable=False)  # "up" | "down"
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class OnlineEvalResult(Base):
    """One row per automated check run against a sampled *live* trace (see
    services/online_eval.py) — distinct from scripts/evaluate_rag.py's
    offline fixed-question-set evaluation. Also pushed to Langfuse as a score
    on the same trace when Langfuse is configured; kept here too so there's a
    pass-rate dashboard (GET /api/v1/evals/online/summary) even without
    opening Langfuse, and so the job can dedupe against re-scoring the same
    trace on overlapping lookback windows."""

    __tablename__ = "online_eval_results"

    id = Column(String, primary_key=True, index=True)
    langfuse_trace_id = Column(String, nullable=False, index=True)
    workflow_type = Column(String, nullable=False, index=True)
    check_name = Column(String, nullable=False, index=True)  # "has_output" | "no_error" | "latency_ok" | "groundedness_judge"
    passed = Column(String, nullable=False)  # "true" | "false" — SQLite has no native bool
    score = Column(Float, nullable=True)
    detail = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class WhatsAppMessage(Base):
    """One row per WhatsApp message this platform has sent or received via the
    Meta Cloud API. Needed because Meta's API is send-only — there is no GET
    endpoint to poll a message's delivery state, only asynchronous `statuses`
    webhook events (see api/whatsapp.py's POST handler) — so
    get_whatsapp_message_status (agent_tools/whatsapp_tools.py) reads this
    table instead of calling Meta directly. `wamid` is Meta's own message ID,
    used to correlate an outbound send with its later status callbacks."""

    __tablename__ = "whatsapp_messages"

    id = Column(String, primary_key=True, index=True)
    wamid = Column(String, nullable=True, index=True)  # Meta's message ID, set once Meta accepts the send
    direction = Column(String, index=True)  # "outbound" | "inbound"
    to_number = Column(String, nullable=True, index=True)
    from_number = Column(String, nullable=True, index=True)
    message_type = Column(String, default="text")  # "text" | "template" | ...
    body = Column(Text, nullable=True)
    status = Column(String, default="queued", index=True)  # queued -> sent -> delivered -> read | failed
    error_message = Column(Text, nullable=True)
    raw_payload = Column(JSON, nullable=True)  # last webhook/send-response payload, for debugging
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Rule(Base):
    __tablename__ = "rules"

    id = Column(String, primary_key=True, index=True)
    canonical_rule = Column(String)
    actor = Column(String)
    action = Column(String)
    condition = Column(String)
    type = Column(String, index=True) # RULE, GUIDELINE, OBLIGATION, etc.
    confidence = Column(Float)
    document_id = Column(String, ForeignKey("documents.id"))
    page = Column(Integer)
    section = Column(String)
    metadata_ = Column("metadata", JSON, default={})

    document = relationship("Document", back_populates="rules")

class VoicePrint(Base):
    """One row per enrolled speaker.  The consolidated voiceprint embedding
    is the centroid of all enrollment sample embeddings for this speaker,
    updated incrementally each time a new sample is submitted.  Used by the
    Voice Identification Tool (services/voice_identification.py) for 1:1
    verification; the same embedding is also stored in the Pinecone
    `voice-embeddings` index for 1:N identification search."""

    __tablename__ = "voice_prints"

    id = Column(String, primary_key=True, index=True)          # speaker_id
    speaker_name = Column(String, nullable=False, index=True)
    email = Column(String, nullable=True, index=True)
    embedding = Column(JSON, nullable=True)        # centroid [float x 192]
    enrollment_count = Column(Integer, default=0)
    status = Column(String, default="enrolling")    # enrolling | active | disabled
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VoiceEnrollment(Base):
    """One row per enrollment audio sample submitted for a speaker.  Each
    sample's individual embedding is kept so the centroid in VoicePrint can
    be recomputed if a sample is later removed (e.g. a noisy recording the
    user wants to discard)."""

    __tablename__ = "voice_enrollments"

    id = Column(String, primary_key=True, index=True)
    speaker_id = Column(String, ForeignKey("voice_prints.id"), index=True)
    embedding = Column(JSON, nullable=False)        # [float x 192]
    audio_quality_score = Column(Float, nullable=True)
    speech_duration_sec = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ═════════════════════════════════════════════════════════════════════════
# HR Recruitment Panel
#
# Until these tables existed, the hiring pipeline had no system of record:
# POST /hiring/parse-resumes parsed a PDF, deleted it, returned JSON, and
# persisted nothing, so the entire pipeline lived in React state and was
# lost on refresh. Candidate is the central entity; Application (Candidate
# x Role) is what actually moves through the pipeline.
#
# These reuse rather than replace what already existed: Role is the job,
# FraudScan holds fraud results, ScreeningSession/ScreeningResult hold
# screening and interview evaluations, CallRecord holds telephonic calls.
# Application carries foreign keys to those instead of copying their data.
# ═════════════════════════════════════════════════════════════════════════


class Candidate(Base):
    """One person, globally — not one row per application. Someone who
    applies to three roles is one Candidate with three Applications, so
    their resume, fraud history and activity timeline stay unified.

    The *_key columns are normalized blocking keys used by the dedup
    matcher (services/recruitment_service.py::find_matching_candidate).
    They're stored rather than computed per-query so they can be indexed.
    """

    __tablename__ = "candidates"
    __table_args__ = (
        # The database, not just the matcher, refuses a second candidate with
        # the same normalized email. find_matching_candidate() handles the
        # normal case, but two workers can both look, both find nothing, and
        # both insert; without this the loser silently creates a duplicate
        # person. With it the loser gets an IntegrityError and re-fetches the
        # winner. Partial (email_key IS NOT NULL) because resumes legitimately
        # parse with no email, and those must not collide with each other.
        Index(
            "uq_candidates_email_key", "email_key", unique=True,
            sqlite_where=text("email_key IS NOT NULL"),
            postgresql_where=text("email_key IS NOT NULL"),
        ),
    )

    id = Column(String, primary_key=True, index=True)
    email = Column(String, nullable=True, index=True)
    email_key = Column(String, nullable=True, index=True)   # lowercased, trimmed, gmail dots/+tags stripped
    name = Column(String, nullable=True)
    name_key = Column(String, nullable=True, index=True)    # lowercased, non-alpha stripped
    phone = Column(String, nullable=True)
    phone_key = Column(String, nullable=True, index=True)   # last 10 digits
    location = Column(String, nullable=True)
    current_role = Column(String, nullable=True)
    experience_text = Column(String, nullable=True)         # free text as extracted, e.g. "2.4 Years"
    experience_years = Column(Float, nullable=True)          # parsed from the above when unambiguous, else null
    education = Column(JSON, default=list)
    skills = Column(JSON, default=list)
    # Both straight from resume parsing (hiring_service.RESUME_SYSTEM_INSTRUCTION);
    # null means "not extracted", never a placeholder. work_history is a list
    # of {company, title, start, end, is_current}, most recent first — the
    # real employers the Background Verification agent contacts.
    summary = Column(Text, nullable=True)
    work_history = Column(JSON, nullable=True)
    # Unlike /hiring/parse-resumes, the recruitment path KEEPS the file so
    # HR can reopen it and so fraud analysis has something to scan. Served
    # through main.py's auth-gated GET /uploads/{path}, never a static mount.
    resume_file_path = Column(String, nullable=True)
    resume_filename = Column(String, nullable=True)
    resume_text = Column(Text, nullable=True)
    source = Column(String, nullable=True)                   # "bulk_upload" | "manual" | ...
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    applications = relationship("Application", back_populates="candidate")


class Application(Base):
    """A Candidate's candidacy for one Role — the pipeline entity. Every AI
    result and HR decision hangs off this row, which is why `stage` lives
    here and not on Candidate: the same person can be SHORTLISTED for one
    role and REJECTED for another.

    Scores are paired with `score_provenance` (see the SCORE_* constants at
    the top of this module). A number here is only trustworthy if its
    provenance entry says status="computed" — readers must check, and the
    UI is built to render a dash rather than a number otherwise.
    """

    __tablename__ = "applications"
    __table_args__ = (
        # One application per person per role. Also the concurrency guard:
        # two resume-processing tasks racing on the same candidate both try
        # to insert, one gets an IntegrityError, and the loser re-fetches
        # the winner's row instead of creating a duplicate.
        UniqueConstraint("candidate_id", "job_id", name="uq_application_candidate_job"),
        Index("ix_applications_job_stage", "job_id", "stage"),
    )

    id = Column(String, primary_key=True, index=True)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=False, index=True)
    stage = Column(String, nullable=False, default=STAGE_PROCESSING, server_default=STAGE_PROCESSING, index=True)

    # ── AI-derived, all nullable: null means "not computed", never zero ──
    ats_score = Column(Integer, nullable=True)           # resume quality, independent of any JD
    match_score = Column(Integer, nullable=True)         # JD match
    skill_match_score = Column(Integer, nullable=True)   # derived: matched / (matched + missing)
    matched_skills = Column(JSON, default=list)
    missing_skills = Column(JSON, default=list)
    recommendation = Column(String, nullable=True)
    ai_summary = Column(Text, nullable=True)
    # {"ats_score": {"status": "computed", "source": "llm"}, ...}
    score_provenance = Column(JSON, default=dict)

    analysis_status = Column(String, nullable=False, default="pending", server_default="pending", index=True)  # pending|running|completed|failed
    analysis_error = Column(Text, nullable=True)

    # Links to the existing engines rather than copies of their output.
    fraud_scan_id = Column(String, ForeignKey("fraud_scans.id"), nullable=True, index=True)
    screening_session_id = Column(String, ForeignKey("screening_sessions.id"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    candidate = relationship("Candidate", back_populates="applications")


class ResumeBatch(Base):
    """One bulk upload action. Exists so the UI can show real progress for
    a batch without the browser having to hold the file list itself."""

    __tablename__ = "resume_batches"

    id = Column(String, primary_key=True, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=False, index=True)
    uploaded_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    total_files = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ResumeUpload(Base):
    """One uploaded file, and the unit of work for process_resume_task.

    This row is what makes upload progress honest: the UI's counts are a
    GROUP BY over `status` here, so a stalled worker shows files still
    sitting in "queued" rather than an animation implying progress that
    isn't happening.

    It is also the idempotency key. The task claims a row by a conditional
    UPDATE (queued|failed -> processing) and returns without side effects
    if it didn't win the claim, so a Celery retry, a double-dispatch, or a
    user hitting Retry can never produce a second Candidate/Application.
    """

    __tablename__ = "resume_uploads"

    id = Column(String, primary_key=True, index=True)
    batch_id = Column(String, ForeignKey("resume_batches.id"), nullable=False, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=False, index=True)
    original_filename = Column(String, nullable=False)
    stored_path = Column(String, nullable=True)
    # queued -> processing -> parsed | duplicate | failed
    status = Column(String, nullable=False, default="queued", server_default="queued", index=True)
    error = Column(Text, nullable=True)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=True, index=True)
    application_id = Column(String, ForeignKey("applications.id"), nullable=True, index=True)
    task_id = Column(String, nullable=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CandidateActivity(Base):
    """The candidate timeline AND the audit trail — deliberately one table,
    not two. Every HR decision, AI analysis, fraud scan, screening invite
    and interview action writes exactly one row here via
    recruitment_service.record_activity().

    `actor_type` is what separates "the AI computed this" from "a person
    decided this", which is the distinction the whole panel is built on:
    AI recommends, HR decides, and the timeline has to show which was which.

    `dedupe_key` makes retries safe. A task that re-runs re-emits the same
    key (e.g. "resume_processed:<upload_id>") and the unique index turns
    the second write into a no-op instead of a duplicated history entry.
    """

    __tablename__ = "candidate_activities"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_candidate_activity_dedupe_key"),
        Index("ix_candidate_activities_candidate_created", "candidate_id", "created_at"),
    )

    id = Column(String, primary_key=True, index=True)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False, index=True)
    application_id = Column(String, ForeignKey("applications.id"), nullable=True, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)   # candidate.created, candidate.shortlisted, ...
    actor_type = Column(String, nullable=False, default="system")  # "hr" | "ai" | "system"
    actor_user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    summary = Column(String, nullable=False)
    payload = Column(JSON, default=dict)
    # Nullable: only events that a retry could duplicate need a key. Ad-hoc
    # HR actions (which are genuinely distinct each time someone clicks)
    # leave it null, and SQL's "nulls don't collide" rule means the unique
    # index doesn't constrain them.
    dedupe_key = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class Interview(Base):
    """A scheduled interview for an Application. Phase 1 needs only the
    columns that authorization reads: interviewer_email is what scopes an
    interviewer-role user to the applications they are actually scheduled
    against (recruitment_service.visible_applications_filter). Scheduling
    itself (Google Calendar, invitation email) is built on top of this table
    later and fills in the calendar_* fields; until then nothing writes here
    except that future flow and tests.
    """

    __tablename__ = "interviews"

    id = Column(String, primary_key=True, index=True)
    application_id = Column(String, ForeignKey("applications.id"), nullable=False, index=True)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=False, index=True)
    mode = Column(String, nullable=False, default="human")  # ai_screening | telephonic | human
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    interviewer_email = Column(String, nullable=True, index=True)
    calendar_event_id = Column(String, nullable=True)
    meet_link = Column(String, nullable=True)
    status = Column(String, nullable=False, default="scheduled")
    screening_session_id = Column(String, ForeignKey("screening_sessions.id"), nullable=True, index=True)
    call_record_id = Column(String, ForeignKey("call_records.id"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WorkflowRun(Base):
    """An execution run of an automated recruitment pipeline workflow
    (e.g., auto-shortlist top candidates, bulk fraud check, automated screening)."""

    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=True, index=True)
    workflow_type = Column(String, nullable=False, index=True)  # auto_shortlist | fraud_check_all | screening_invite_batch
    title = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued", index=True)  # queued | running | completed | failed | awaiting_hr
    total_steps = Column(Integer, nullable=False, default=1)
    completed_steps = Column(Integer, nullable=False, default=0)
    current_step_name = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    parameters = Column(JSON, default=dict)
    results = Column(JSON, default=dict)
    error = Column(Text, nullable=True)
    triggered_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    steps = relationship("WorkflowStep", back_populates="run", cascade="all, delete-orphan", order_by="WorkflowStep.step_index")


class WorkflowStep(Base):
    """One discrete step within a WorkflowRun."""

    __tablename__ = "workflow_steps"

    id = Column(String, primary_key=True, index=True)
    run_id = Column(String, ForeignKey("workflow_runs.id"), nullable=False, index=True)
    step_index = Column(Integer, nullable=False)
    name = Column(String, nullable=False)
    action = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | running | completed | failed | skipped
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    run = relationship("WorkflowRun", back_populates="steps")


class Offer(Base):
    """Formal job offer extended to a candidate for an application."""

    __tablename__ = "offers"

    id = Column(String, primary_key=True, index=True)
    application_id = Column(String, ForeignKey("applications.id"), nullable=False, index=True)
    candidate_id = Column(String, ForeignKey("candidates.id"), nullable=False, index=True)
    job_id = Column(String, ForeignKey("roles.id"), nullable=False, index=True)
    status = Column(String, nullable=False, default="draft", index=True)  # draft | sent | accepted | rejected | rescinded
    salary = Column(Float, nullable=True)
    currency = Column(String, nullable=False, default="USD")
    equity = Column(String, nullable=True)
    role_title = Column(String, nullable=True)
    start_date = Column(String, nullable=True)
    expiry_date = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

