# AgenticFlow — Technical Project Case Study

> Interview reference document. All numbers below are either measured (cited with source) or explicitly labeled as estimated. Solo-built; no live paying customers — framed honestly as a portfolio-grade production system, not a funded startup.

---

### PROJECT IN 30 SECONDS

| Problem | Solution | Architecture | AI | ROI | My Contribution |
|---|---|---|---|---|---|
| Compliance teams can't get trustworthy, cited answers from scattered policy PDFs; first-round hiring screening is manual and inconsistent | One platform: citation-grounded policy RAG + an agentic hiring pipeline gated by a human approval step | FastAPI + Next.js, hybrid dense/sparse retrieval, a bounded LLM planner over a 22-module tool registry | Dual-provider LLMs (Groq/Gemini) behind a circuit breaker, CRAG/ARAG adaptive retrieval, real speaker-verification ML | Estimated: hours saved per compliance query / per first-round screen (see §2 for basis) | Solo architect, builder, and self-auditor across all layers — 133 commits, ~2.5 months |

---

## 1. Executive Summary

**Problem →** Two recurring enterprise pain points, solved on one backend: (1) employees and compliance officers can't quickly get a *trustworthy, source-cited* answer from large sets of policy documents, and manually cross-referencing PDFs doesn't scale; (2) first-round technical hiring (resume screening, fraud/authenticity checks, phone screening) is manual, slow, and inconsistent across recruiters.

**Solution →** AgenticFlow: a single FastAPI/Next.js platform combining a hybrid-retrieval RAG engine that answers policy questions with document-level citations, and an agentic hiring pipeline (fraud detection → telephonic screening → JD-matched scoring → human approval gate) — both orchestrated through a shared, bounded LLM planner and a unified external-tool registry.

**Technology →** Hybrid dense+sparse (BM25) retrieval with Reciprocal Rank Fusion and adaptive CRAG/ARAG grading; dual-provider LLMs (Groq, Gemini) behind a hand-rolled circuit breaker; a deliberately non-open-ended "plan, validate, then execute" agent design over 13 external system connectors (Slack, Jira, GitHub, Salesforce, SAP, SharePoint, Teams, Google Workspace) and 9 internal domain tool modules; real speaker-verification ML (SpeechBrain ECAPA-TDNN); Langfuse LLMOps tracing.

**Impact →** Measured engineering rigor: eliminated a documented production MemoryError crash cause (~600MB → ~1.1GB free RAM headroom on the same box), fixed a live hallucination bug where the system gave a confident wrong answer about a document that had failed to ingest, and closed a retrieval-confidence bug that caused false "I don't know" answers. Business impact is presented as **estimated**, not measured — see §2.

**My role →** Sole architect and engineer for the entire platform: design, implementation, integration, deployment, and — notably — the self-critical audits that found and fixed the bugs above.

---

## 2. Business Value & ROI

No live paying customers exist yet, so the numbers below are **estimated**, built on directly observable assumptions (documented in the platform's own eval runs, not invented). Where a number is measured rather than estimated, it's labeled explicitly.

| Metric | Before (manual) | After (AgenticFlow) | Impact |
|---|---|---|---|
| Policy Q&A | Manually search/skim PDFs, no citation trail | Cited, sourced answer in one query; correctness held at **8/9 (0.889)** on a 9-question eval set (measured, [source](#)) | Estimated: minutes → seconds per query, with an audit trail manual search doesn't produce |
| First-round hiring screen | Recruiter manually reviews resume, calls candidate, scores subjectively | Fraud check → automated call → LLM JD-match score → human approval | Estimated: consistent, documented scoring criteria before a human ever spends review time |
| Retrieval reliability under vector-DB outage | N/A (single point of failure) | Circuit breaker + local SQLite fallback keeps answers grounded instead of silently degrading to open web search | Measured: verified live during a real Pinecone quota outage |
| System uptime under memory pressure | Real MemoryError crash on this hardware (documented, pre-fix) | Root cause (unconditional model load with zero callers) removed | Measured: ~600MB → ~1.1GB free RAM headroom, same machine, before/after |
| Engineering velocity (solo) | — | 133 commits, 2026-06-27 → 2026-09-09 | Measured: `git rev-list --count HEAD` |

**Strongest points for an interview:** (1) the platform's own hybrid-retrieval eval didn't regress correctness when reliability features were added — a real before/after comparison, not a claim; (2) three separate live bugs affecting answer *trustworthiness* were found via adversarial self-QA and fixed, which is the kind of rigor a RAG-in-production interviewer will probe for; (3) the honesty to label ROI as estimated rather than invent adoption numbers is itself a signal worth naming out loud.

---

## 3. System Architecture

```
User (browser)
   │
   ▼
Next.js 16 / React 19 frontend  ─── deterministic UI, PDF citation viewer, Command Center
   │  REST
   ▼
FastAPI backend (main.py)  ─── deterministic routing, Pydantic validation
   │
   ├─► Business logic services (deterministic)
   │     RAG query pipeline · fraud scoring · hiring · screening · telephonic
   │
   ├─► AI / Agent layer
   │     • Bounded planner (plan → validate → execute, no open-ended loop)
   │     • LLM calls (Groq primary / Gemini fallback) behind a circuit breaker
   │     • CRAG/ARAG adaptive retrieval grading
   │
   ├─► Data / Knowledge layer
   │     Pinecone (dense vectors) + rank_bm25 (sparse) + RRF fusion
   │     PostgreSQL (episodic/primary) · SQLite (shared/graph memory, query traces) · Redis (cache/working memory)
   │
   └─► Integrations (unified tool registry, 22 modules)
         13 external MCP-style connectors: Slack, Jira, GitHub, Salesforce, SAP,
         SharePoint, Teams, Google Workspace (Gmail/Calendar/Docs/Sheets/Drive)
         9 internal domain tools: RAG, fraud, hiring, screening, telephonic,
         voice-ID, WhatsApp, Google-status, verification
   │
   ▼
Output / Action
   Cited chat answer · hiring scorecard behind a human approval gate ·
   downstream action in an external system (e.g. Slack notification)
```

**Not shown as a layer because it doesn't exist yet:** an authentication/authorization boundary. Every route above is reachable with `Depends(get_db)` only — no session, JWT, or guard. This is an explicit, in-code-documented gap (`api/agent.py:12-14`), not an oversight, and it is the single most important thing to raise before this system touches real user data. Covered fully in §7.

**Design rationale, briefly:**
- **FastAPI + Pydantic** — chosen for async-first I/O (many external calls per request: LLM, vector DB, telephony) and free request/response schema validation.
- **Dual dense+sparse retrieval instead of dense-only** — policy documents contain exact legal/compliance terms that pure embedding similarity under-weights; BM25 catches them.
- **Circuit breaker wrapping every external call, not just retries** — five independent third-party dependencies (2 LLM providers, Pinecone, Tavily, Twilio) can each fail independently; a naive retry loop doesn't stop cascading latency, a breaker does.
- **Bounded planner instead of an open-ended agent loop** — the tool registry can reach real external systems (Slack, Salesforce, email). An unbounded ReAct-style loop trades predictability for flexibility; here, every step is validated against the tool catalog *before* anything executes, and the plan hard-stops on the first invalid step rather than improvising.

---

## 4. End-to-End System Flow (RAG query — the platform's core path)

```
Input                Context/Evidence            Model                  Structured Output        Validation                    Decision → Action
─────                ─────────────────           ─────                  ──────────────────       ──────────                    ──────────────────
User question   ──►  Document-readiness gate ──► Hybrid retrieval  ──►  LLM call            ──►  Guardrail regex checks   ──►  HIGH grade: answer
(scoped to a doc)     (fails fast if the doc       (dense + BM25,       (Groq → Gemini             (~0.08ms) +                  with citations
                       never finished ingesting     RRF-fused)           fallback, behind           CRAG grade vs. cosine        │
                       — closes a real bug,          │                   circuit breaker)           evidence threshold           LOW/no evidence:
                       see §8)                       ▼                                             cross-check                  explicit "insufficient
                                                CRAG/ARAG grades                                                                 info" or web-search
                                                relevance (LOW/                                                                  fallback — never a
                                                MED/HIGH), optional                                                              silent guess
                                                cross-encoder rerank
```

Every step above is persisted as a structured `QueryTrace` (request ID, retrieval mode, grades, latency per stage) to an observability store — this is what let real bugs (§8) get diagnosed instead of guessed at.

**Hiring pipeline flow (second product line, same architecture pattern):** candidate call → telephonic agent transcript → screening agent runs an LLM JD-match analysis over the transcript → composite score written to an orchestration scorecard → **human approval gate** (the LLM never auto-advances a candidate) → optional downstream action (e.g., a Slack/email notification via the connector registry).

---

## 5. AI / LLM Engineering

**Model.** Groq (Llama/`gpt-oss`/Qwen family) as primary for latency/cost, Google Gemini as fallback — a dual-provider setup, not a single vendor dependency. Model IDs are centralized in one `model_config.py` after both providers independently retired model IDs the code depended on (see §8) — a direct lesson learned, not a starting design choice.

**Prompt/context engineering.** Context is the fused, top-k output of hybrid retrieval, gated by a document-readiness check before it's ever assembled. Guardrail regex checks run on input and output (~0.08ms overhead, chosen over a second model call to avoid adding LLM latency/cost to every request).

**Structured output.** Planner steps, screening scorecards, and fraud results are all JSON-schema outputs. The planner specifically validates every generated step against the live tool registry (`registry.unified_catalog()`) before execution — an unrecognized tool/connector pair is marked invalid and the plan hard-stops rather than being executed speculatively.

**Agent architecture.**
- **Goal:** fulfill a natural-language request by chaining calls across a 22-module tool catalog.
- **Design:** single LLM call builds a full plan up front (`planner.py`, `build_plan`) — explicitly *not* a ReAct-style loop. The module's own docstring frames this as a deliberate trade: a flat plan-then-execute pass, chosen for auditability and bounded blast radius over open-ended autonomy.
- **Execution:** `execute_plan` is fail-fast — it breaks on the first error rather than re-planning around it.
- **State:** step outputs are threaded via `$stepN.field` placeholder resolution so later steps can reference earlier results without re-querying.
- **Human approval:** the hiring pipeline's final decision is gated behind explicit human review — the agent produces a recommendation, not an action.

**RAG / Knowledge.**
- Retrieval: dense (Pinecone, `bge-base-en-v1.5` embeddings) fused with sparse (BM25 via `rank_bm25`) using Reciprocal Rank Fusion.
- Adaptive grading: CRAG grades retrieved evidence LOW/MED/HIGH and branches strategy accordingly (direct answer, refinement, or web-search escalation via Tavily); ARAG branches further by query type.
- Reranking: an optional lazy-loaded cross-encoder (`ms-marco-MiniLM-L-2-v2`), off by default, loads only on first real use (confirmed via cold vs. warm latency: cold load includes full model init, warm calls are sub-second).
- Citations: answers resolve back to a specific document ID and PDF bounding box, not just "the document."

**AI reliability — what the system actually does, not just claims:**
| Failure mode | Mitigation | Status |
|---|---|---|
| Hallucination on a failed/empty document | Document-readiness gate returns an explicit `document_not_ready` status before retrieval runs at all | Fixed live bug, see §8 |
| Two relevance signals disagreeing (LLM grade vs. cosine threshold) | HIGH CRAG grade now short-circuits the raw-score gate | Fixed live bug, see §8 |
| Vector DB outage | Circuit breaker opens → local SQLite cosine+BM25 fallback keeps answers grounded instead of falling through to open web search | Measured live during a real Pinecone quota outage |
| LLM provider outage / rate limit | Circuit breaker + exponential backoff; multiple numbered API keys per provider rotate on rate limits; Gemini as full fallback provider | Implemented |
| Model ID retirement (silent) | Centralized `model_config.py`, verified against each provider's live model catalog | Fixed after being found live (see §8) |
| Invalid/unrecognized tool call | Planner validates every step against the tool registry before execution; hard stop, not a guess | Implemented |

---

## 6. Important Engineering Decisions

| # | Problem | Options considered | Decision | Trade-off |
|---|---|---|---|---|
| 1 | Dense-only embedding search under-matches exact compliance/legal terms | Dense-only / BM25-only / hybrid | Hybrid dense+BM25 with RRF fusion | +latency (~3.8s vs. faster dense-only in eval runs) and a second index to keep consistent; required a stopword filter after an early version let common words inflate irrelevant matches |
| 2 | Agent needs to call 22 tool modules that reach real external systems (Slack, Salesforce, email) | Open-ended ReAct loop / hardcoded fixed workflows / bounded plan-validate-execute | Single-pass planner: full plan generated once, every step validated against the live tool catalog, fail-fast on the first invalid step | Less self-correcting than a re-planning loop, but every action is auditable and bounded before it can touch a real system |
| 3 | Five independent external dependencies (2 LLMs, Pinecone, Tavily, Twilio) can each fail and cascade | Per-call try/retry / adopt a retry library (`tenacity`) / hand-rolled breaker | Hand-rolled circuit breaker + backoff, wired uniformly into every external call site, no new dependency | More code to own than a library, chosen for per-service fail-open semantics (e.g., Pinecone's breaker opening triggers a *different* local fallback than an LLM breaker opening) |
| 4 | Pinecone quota exhaustion previously caused silent degradation to ungrounded web search | Retry/queue only / local fallback index | Maintain a local SQLite cosine+BM25 index that serves when the Pinecone breaker is open | Duplicate indexing logic and eventual consistency to manage between Pinecone and the local copy |
| 5 | Single LLM provider is a hard dependency and rate-limit risk | Single provider / dual provider with manual switch / dual provider with automatic failover | Groq primary, Gemini automatic fallback, plus multiple rotating keys per provider | More integration surface and two prompt-compatibility profiles to maintain |
| 6 | Hiring decisions could be fully automated end-to-end | Full automation / human-in-the-loop gate | LLM produces a recommendation; a human approves before any action is taken | Slower time-to-decision than full automation, by design — matches the product's "never guesses, always grounded" positioning |
| 7 | Limited solo-dev time; auth vs. continuing feature/AI work | Build auth first / defer and document | Deferred, but explicitly documented in-code and flagged as the top blocker before real users | Honest, scoped technical debt — the risk is real (any reachable client can trigger connector actions and read/write candidate data) and is treated as such in §7, not hidden |

---

## 7. Production & System Design

**Implemented**
- *Reliability:* circuit breaker + backoff on every external call; local fallback retrieval; idempotent document-reprocess endpoint; per-request `QueryTrace` observability that survived a real unplanned process crash (found intact on restart).
- *Observability:* Langfuse LLMOps tracing threaded through every LLM call site (RAG, fraud, screening, telephonic, WhatsApp, agent planner); custom trace/stats API.
- *Data:* SQLAlchemy models, Alembic migrations for the original 3 RAG tables; PostgreSQL for primary/episodic data, Redis for cache/working memory, SQLite for shared/graph memory and traces.
- *Deployment (partial):* Docker Compose for local/dev; a real (if minimal) AWS EC2 deployment attempt — single `t3.small`, nginx reverse proxy.

**Partially implemented / gaps — stated plainly, as this user's own audit docs do**
- *Scalability:* API handlers are largely stateless, but one `uvicorn` process holds several large resident models (embedding model, ECAPA-TDNN speaker model, faster-whisper) with no `--workers` flag — a documented real OOM crash cause on constrained hardware (see §8). Celery is fully configured (broker, backend, task definitions) but never actually dispatched; ingestion runs on an in-process `ThreadPoolExecutor` instead, so it doesn't scale past one box today.
- *Data:* only the original 3 tables have migration coverage; every table added since relies on `create_all()` at startup, with no `alembic upgrade` step in any deploy path.
- *Deployment:* GitHub Actions CI references monorepo-style paths that don't exist in the nested repo's own checkout root — every CI job fails immediately if triggered. No TLS anywhere in the stack (nginx serves `:80` only, despite `:443` being open in the EC2 security group). No IaC — the EC2 box was provisioned by hand.

**Not implemented (explicit gap, not oversight)**
- *Security/Auth:* zero authentication enforced on any API route. A Google OAuth endpoint exists but only upserts a `User` row — it never issues a session or JWT. This is called out in-code as an accepted gap. Practical exposure: anyone who can reach the backend can trigger real connector actions (Slack/Jira/Salesforce/Gmail, where credentialed) and read/write candidate data with no session at all. Also: unsanitized upload filenames on 4 endpoints (path-traversal risk), and a client-side demo UI (Command Center) that ships a hardcoded password list and silently substitutes fake "success" results on any backend error — the single most credibility-damaging finding if an evaluator opens devtools, and one I'd lead with unprompted in an interview rather than let them find it.
- Health endpoints return an unconditional 200 with no live dependency check — Postgres/Redis/Pinecone can be down and the system still reports healthy.

---

## 8. Hardest Technical Problems

**1. Silent hallucination on a failed document ingestion**
*Why hard:* the bug produced no error — it produced a plausible, confident, fully wrong answer (a query against a corrupt/failed PDF returned a real answer about the Declaration of Independence, sourced from open web search) with no signal that the referenced document had zero usable content. Invisible without an adversarial test designed specifically to probe grounding integrity, not just happy-path correctness.
*Solution:* added a document-readiness gate in the query path that short-circuits before retrieval and returns an explicit `document_not_ready` status.
*Result:* verified live against the exact repro; closes a class of bug that directly undermines a "never guesses" product claim.

**2. Two independently-reasonable relevance signals silently disagreeing**
*Why hard:* the LLM-based CRAG grader and a raw-cosine evidence threshold (`>=0.45`) each passed their own tests in isolation, but a document CRAG-graded HIGH/0.92 could still trigger a false "required info missing" because its chunks scored just under the numeric cutoff — an intermittent symptom that took a dedicated diagnostic pass to trace to a threshold mismatch between two gates that were never designed to be compared directly.
*Solution:* a HIGH CRAG grade now short-circuits the raw-score gate (safe, since both checks see the same candidate set).
*Result:* fixed a root cause of "RAG sometimes returns no answer" that an earlier diagnostic pass had only partially explained.

**3. A memory crash caused by dead code, not live traffic**
*Why hard:* the crashing function (spaCy-based candidate detection) had zero callers anywhere in the app — a normal "what runs when a user hits this endpoint" review wouldn't surface it, because it was loading a full NLP model unconditionally at *import time* regardless of whether anything ever called it.
*Solution:* removed the unconditional model load.
*Result:* measured free-RAM headroom on the same machine went from ~600MB to ~1.1GB in a direct before/after comparison.

**4. Silent latency tax from provider model-ID churn**
*Why hard:* both Groq and Gemini retired model IDs the app depended on; a fallback cascade already in place masked the failures well enough that the primary model was silently dead on 100% of calls, adding guaranteed-fail latency instead of a visible error. Root cause required directly probing each provider's live model catalog, not reading the code.
*Solution:* centralized every model ID into one config file, verified against live provider catalogs.
*Result:* removed a hidden per-request latency tax; the breaker layer now catches the next occurrence automatically.

**5. Real-time speaker verification without destabilizing an already memory-constrained process**
*Why hard:* adding SpeechBrain ECAPA-TDNN + Silero VAD + anti-spoofing + Pinecone 1:N search as a fourth resident ML model, on a process that had already caused OOM crashes, meant genuine memory/startup-order tradeoffs — and anti-spoofing has to resist replay/synthetic-voice attacks, not just threshold on similarity.
*Solution:* pre-warm models at startup, with a local-cosine fallback path when Pinecone search is unavailable.
*Result:* a functioning, real (not stubbed) voice-ID pipeline, demo-scoped to one enrolled speaker.

---

## 9. My Personal Contribution

**I designed** the unified multi-product architecture (RAG + agentic hiring on one backend); the 5-tier agent memory model (working/episodic/semantic/shared/graph); the bounded plan-validate-execute agent pattern instead of an open-ended loop; the hybrid dense+sparse+RRF retrieval pipeline with CRAG/ARAG adaptive grading; the circuit-breaker pattern applied uniformly across every external dependency.

**I implemented** the FastAPI backend services (RAG query, fraud, hiring, screening, telephonic, voice ID, WhatsApp webhook); the hand-rolled resilience/guardrails/local-fallback modules; the BM25+RRF retrieval layer; per-request observability tracing; Alembic migrations; 14 pytest test files; the Next.js/React frontend (RAG chat, hiring dashboards, orchestration scorecards); the CI workflow config (currently broken — my own audit caught this, see §7).

**I integrated** Groq and Gemini (dual-provider failover), Pinecone, Redis, Twilio, SpeechBrain/Silero/faster-whisper, Langfuse, Tavily, and 13 external system connectors (Slack, Jira, GitHub, Salesforce, SAP, SharePoint, Teams, Google Workspace) behind one tool registry.

**I optimized** the async-ingestion/frontend race condition that let users query documents before they'd finished processing; the fraud-detection pipeline (parallelized); the guardrail check path (~0.08ms via regex, avoiding a second model call).

**I solved** (found and fixed myself, verified live, not just written up): the silent-hallucination-on-failed-document bug; the CRAG-vs-cosine-threshold disagreement bug; a BM25 stopword-pollution bug; a missing `load_dotenv()` bug that silently zeroed out every local LLM API key outside Docker; a cross-document PDF-citation mismatch bug; a voice-mode "stop and send" bug that never actually submitted.

**I deployed** the Docker Compose stack and a real AWS EC2 instance with an nginx reverse proxy.

**I audited, without yet fixing** — and consider this part of the contribution, not a gap to hide: the zero-authentication exposure across every API route, the broken CI workflow, the hardcoded demo-password/fake-success-data bug in one internal demo UI, unsanitized upload filenames, and missing TLS. All are documented in dated audit files rather than discovered by someone else later.

**What wasn't mine:** the LLM models themselves (Groq/Gemini), SpeechBrain/Silero/faster-whisper as ML libraries, Pinecone/Redis/Postgres as infrastructure, and the frameworks (FastAPI, Next.js). My work is the system that composes, validates, and recovers around them.

---

## 10. Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 16, React 19, Tailwind v4, `@xyflow/react`, `@mediapipe/tasks-vision` | Modern React (server components) for fast iteration; MediaPipe for real client-side proctoring |
| Backend | FastAPI, SQLAlchemy, Alembic, Celery (configured, not dispatched) | Async-first I/O for a request path with many external calls |
| Database | PostgreSQL + SQLite + Redis | Postgres for primary/episodic data, SQLite for lightweight shared/graph memory + traces, Redis for cache/working memory |
| AI/LLM | Groq (Llama/`gpt-oss`/Qwen) primary, Gemini fallback | Latency/cost-optimized primary with automatic vendor redundancy |
| Agent/Orchestration | Custom bounded planner + unified tool registry (22 modules) | Auditable, bounded blast radius vs. an open-ended agent loop |
| Retrieval | Pinecone (dense, `bge-base-en-v1.5`) + `rank_bm25` (sparse) + RRF + CRAG/ARAG | Exact-term recall (BM25) combined with semantic recall (dense), with adaptive confidence grading |
| Voice/ML | SpeechBrain ECAPA-TDNN, Silero VAD, faster-whisper, gTTS | Real speaker verification and speech pipeline, not stubbed |
| Infrastructure | Docker Compose, nginx, AWS EC2 (manual) | Local/dev parity plus a real (if minimal) cloud deployment |
| Authentication | Google OAuth endpoint (no session issuance) | Exists but not enforced anywhere — explicit known gap, see §7 |
| Monitoring | Langfuse + custom `QueryTrace`/observability API | LLMOps tracing across every LLM call site, plus per-request pipeline visibility |

---

## 11. Results

**Measured**
- Hybrid-retrieval correctness held at **8/9 (0.889)** across dense-only, hybrid, and hybrid+rerank modes on a 9-question eval set — adding reliability features didn't regress accuracy.
- Free-RAM headroom on identical hardware: **~600MB → ~1.1GB**, same before/after comparison, after removing the unconditional model-load crash cause.
- **20/20** pytest tests passing at the time of the retrieval-improvement pass; **14** test files currently in the suite.
- Hand-computed hybrid RRF fusion matched the live implementation's output to **6 decimal places** in an independent adversarial QA pass.
- **133 commits**, 2026-06-27 → 2026-09-09, solo.

**Estimated / potential (explicitly not measured against real customers)**
- Time saved per compliance query vs. manual document search.
- Recruiter hours saved per first-round screen if the fraud/telephonic/screening pipeline pre-filters candidates ahead of human review.

---

## "If You Want to Go Deeper"

| Interviewer asks about | Show/explain |
|---|---|
| Architecture | §3 diagram — deterministic vs. AI/agent vs. data layers |
| AI pipeline | §5 — hybrid retrieval, CRAG/ARAG, reliability table |
| Agent | §5 "Agent architecture" — bounded plan-validate-execute, why not ReAct |
| Database | §7 "Data" — Postgres/SQLite/Redis split, migration gap |
| Security | §7 "Not implemented" — zero-auth finding, exact exposure |
| Scalability | §7 "Partially implemented" — single-process model memory, Celery-not-dispatched |
| Production | §7 full section — implemented vs. partial vs. missing |
| Decision making | §6 — 7 decisions with trade-offs |
| ROI | §2 — measured vs. estimated, explicit assumptions |
| My contribution | §9 — designed/implemented/integrated/optimized/solved/deployed, split from library/framework work |
| Hardest problems | §8 — 5 debugged production bugs with root cause and result |
