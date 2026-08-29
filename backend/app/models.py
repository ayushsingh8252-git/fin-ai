from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON, Float, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

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


class Role(Base):
    """Shared/global memory — one row per job role, readable by every agent
    (Screening, Telephonic, Fraud) so role expectations stay consistent
    across products instead of each agent guessing at role_title free text."""

    __tablename__ = "roles"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, index=True, unique=True)
    department = Column(String, nullable=True)
    jd_text = Column(Text, nullable=True)
    must_have_skills = Column(JSON, default=list)
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
