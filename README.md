# AgenticFlow

**An autonomous enterprise platform that reads policy documents like a compliance officer and runs first-round hiring like a recruiting team — citing every answer, gating every action behind a human, and refusing to guess when it doesn't know.**

![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat-square&logo=fastapi) ![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=next.js) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white) ![Pinecone](https://img.shields.io/badge/Pinecone-000000?style=flat-square&logo=pinecone) ![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)

**[Live Demo](https://ai-policy-rule-engine.vercel.app)** · [Getting Started](#getting-started) · [Core Features](#core-features) · [How It Works](#how-it-works) · [Engineering Notes](#engineering-notes) · [Honest Status](#honest-status) · [Memory Architecture](#memory-architecture)

> The demo runs against real infra, not stubs — including a live LLM, vector DB, and cost model. That also means it inherits real infra's bad days; see [Honest Status](#honest-status) for exactly what's live right now before you judge it on a broken call.

![AgenticFlow](hero.png)

## What this actually is

Two products sharing one reasoning core:

1. **A policy intelligence engine.** Feed it HR manuals, compliance docs, contracts — it extracts every rule as structured, confidence-scored data and answers questions in seconds, citing the exact page and sentence it used. No hallucinated policy.
2. **An agentic hiring platform.** A 9-agent pipeline takes a resume from upload to onboarded employee: parsing → ATS scoring → requirement matching → AI-drafted assignment → voice + avatar interview → human approval → provisioned accounts → knowledge transfer. Nothing touches a real system without a human clicking approve.

Same orchestration kernel underneath both: parse intent, select the right tool, gate on human approval, execute deterministically, log everything.

## Getting started

Requires Docker. From the monorepo root (this app is one of three under `apps/`):

```bash
cp apps/AI-Policy-Rule-Engine/.env.example apps/AI-Policy-Rule-Engine/.env
# fill in GEMINI_API_KEY at minimum — everything else below is optional
docker compose up redis postgres policy-backend policy-frontend --build
```

- Frontend → [http://localhost:3000](http://localhost:3000)
- Backend → [http://localhost:8000/health](http://localhost:8000/health) · orchestrator tier status → `/api/v1/orchestrator/health`

Every other credential in `.env.example` — Pinecone, Sarvam, SMTP, Google OAuth — is optional and **fails open**: unset it and that specific capability (vector search, outbound calls, invite emails) degrades gracefully instead of crashing the app, logged rather than silent. Same convention the memory tiers use, see [Memory Architecture](#memory-architecture).

## Core Features

### 🧠 Policy & Knowledge Intelligence
- **Dual-tier RAG reasoning** — answers from structured, validated rules first, falls back to raw document chunks only when rules don't cover it, and admits "not found" instead of fabricating an answer.
- **Grounded citations** — every answer links back to the exact page and bounding box in the source PDF, rendered next to the answer.
- **Self-validating extraction** — every extracted rule gets a confidence score; anything under 70% is discarded before it ever reaches the database (`MIN_RULE_CONFIDENCE` in `backend/app/worker.py`).
- **Multilingual retrieval** — non-English queries are translated for retrieval so vector search quality never degrades, then answered back in the original language.
- **Interactive knowledge graph** — traces how a departing employee's projects, PRs, and tech stack connect, for whoever backfills them.

### 🤖 Agentic Hiring Pipeline — 9 autonomous agents, one human gate
- **Resume Parser → ATS + Email Extraction → Requirement Matching → Assignment Generator → Candidate Evaluation**, fully autonomous end to end.
- **Telephonic Agent** — AI voice screening calls, WhatsApp-verified, 10+ languages, pay-per-connect.
- **Screening Agent** — 3D avatar interviews (standard, deep-probe, or fully human-structured), proctored, auto-scored, PDF report per candidate.
- **Human-in-the-loop gate** — HR + hiring manager sign off before onboarding fires; nothing is silently automated into production.
- **Live hand-off** — approved hires flow straight into the real onboarding and knowledge-transfer systems below, zero re-entry.

### 🏢 Enterprise Operations
- **One-click onboarding UI** — a three-portal HR / Manager / Employee flow (access requests, approvals, document sharing) for provisioning accounts, repo access, and equipment; see [Honest Status](#honest-status) for what's wired to real provisioning today versus still a UI walkthrough.
- **Enterprise Orchestration Layer** (`backend/app/memory/orchestrator.py`, `POST/GET /api/v1/orchestrator/*`) — the shared session lifecycle behind Screening and Telephonic: opens a working-memory session, feeds it question/answer/sentiment as the conversation happens, and on end folds it into episodic + semantic memory — see [Memory Architecture](#memory-architecture) below. Intent parsing / MCP tool routing / an enforced approval gate are not part of this layer yet.
- **Track Insights** — auto-generated executive digests: automations run, hours saved, docs indexed, cost saved.
- **Live ROI calculator** — a real cost model, not marketing copy — computes manual-vs-automated screening cost from the same per-unit pricing that bills usage, so the numbers can't drift from reality.

  ![Live ROI calculator computing a cost estimate from real per-unit pricing](image1.png)

### 🔐 Trust & Infra
- **Auth** — Google Sign-In issues a real JWT session; every product API requires it (see [Honest Status](#honest-status) for the two intentionally-public exceptions). RBAC/per-tenant data scoping is not built yet — treat this as single-tenant-pilot readiness today, not enterprise multi-tenant.
- **Dual-provider LLM fallback** — primary calls go to Groq/Grok; on failure the pipeline transparently retries on Gemini, so one provider outage doesn't take the product down.
- **Redis-backed caching** for embeddings and query results, keeping repeat queries fast without re-hitting the LLM or vector DB.
- **18+ native integrations** — Slack, Teams, Jira, GitHub, Salesforce, SAP, SharePoint, and custom MCP connectors.

## How it works

A 6-stage pipeline turns raw PDF text into grounded, structured knowledge:

`Parse → Chunk → Detect → Classify → Extract → Validate` → dual-indexed in **Pinecone** (vector search) + **SQL** (structured queries).

The hiring pipeline runs the same shape of process on a different input — a resume instead of a policy PDF — through nine specialized agents instead of six stages, with one difference: it stops and waits for a human before the final, irreversible step.

## Engineering notes

The parts that make this more than a wrapper around an LLM API:

- **Confidence-gated extraction, not confident-sounding extraction.** Rules under a 70% confidence threshold never reach the database — the system would rather say nothing than say something wrong. (Rows ingested before this gate was tightened may still carry lower scores; the gate only filters new extractions.)
- **Provider-agnostic reasoning.** Groq/Grok is primary; Gemini is a transparent fallback. A rate limit or outage on one provider doesn't degrade the product.
- **Citations carry geometry, not just text.** Each rule keeps its page number and bounding box, so the UI can highlight the *exact* source sentence in the original PDF.
- **A deterministic, resumable agent pipeline.** The hiring workflow is a real state machine (upload → parse → match → generate → evaluate → approve → onboard → transfer knowledge) with in-flight animation state that's invalidated on unmount, not a chain of hopeful `setTimeout`s.
- **Human approval is a hard gate, not a toast notification.** No downstream agent (onboarding, knowledge transfer, email dispatch) fires until HR explicitly confirms — enforced in the state machine, not just in the UI copy.

## Honest status

Every claim in this README is checked against a running system, not asserted from memory — dated audit passes live in [`docs/`](docs/), each one re-verifying the previous pass's claims against real Redis/Postgres/Pinecone containers instead of trusting the code (or the last audit) at a glance. When an audit found the docs claiming something the code didn't do — an 85%-confidence gate that was actually 70% — the doc got corrected, not the finding suppressed.

**Latest pass ([2026-08-21](docs/platform-status-audit-2026-08-21.md)):** roughly **78% of the five subsystems are real and working end-to-end** — RAG, Fraud Detection, Telephonic Agent, Screening Agent, and the Enterprise Orchestration Layer above. The rest isn't hidden, it's scoped honestly in the audit table: what's real, what's illustrative UI, and what's still wired to nothing. Every open gap this pass turned out to be **operational, not missing code** — a dead ngrok tunnel blocking live Telephonic calls, an expired Groq key running "dual-provider fallback" on Gemini alone, a missing `ffmpeg` binary, and a Pinecone free-tier account currently past its egress quota (writes still succeed; reads 429 until it resets). None of that is a placeholder — it's one credential rotation, one tunnel restart, or one plan upgrade away from resolved, and the audit says so plainly instead of rounding up.

## Memory architecture

Five tiers, each backed by whichever store actually fits its access pattern, all wired together by `backend/app/memory/orchestrator.py`:

| Tier | Store | What it holds | Lifecycle |
|---|---|---|---|
| Working / short-term | Redis (`memory/working_memory.py`) | Current session's live state: current question, running transcript, latest sentiment | TTL'd (`WORKING_MEMORY_TTL_SECONDS`); deleted the moment a session ends |
| Episodic | Postgres (`memory/episodic_memory.py`) | One row per finished session — what was asked, what was answered, scores, timestamps | Written once at session end, kept indefinitely, queryable by subject (candidate email/phone) |
| Semantic / long-term | Pinecone, `agent-memory` namespace (`memory/semantic_memory.py`) | Facts extracted from sessions, embedded, retrievable by meaning from any agent | Written at session end; separate namespace from the policy-rules RAG index so the two never mix |
| Shared / global | SQLite, same DB as the policy engine (`memory/global_memory.py`) | Roles, JDs, company policy (the existing `Rule` table), onboarding SOPs | Read-mostly, updated as roles/SOPs change |
| Graph-structured | SQLite + networkx (`memory/graph_memory.py`) | Relationships — candidate↔role, and whatever else gets added (team, project) | Nodes/edges persisted per write, loaded into an in-memory graph per query |

Currently wired end-to-end into the Telephonic Agent (`backend/app/api/telephonic.py`) and the Screening Agent (`backend/app/api/screening.py` + `interview.py`) — both start a session on first contact, stream turns through working memory, and fold the result into episodic + semantic memory when the call/interview ends. RAG and Fraud Detection can read from it (`GET /api/v1/orchestrator/context/{subject_id}`) but don't yet write to it.

`GET /api/v1/orchestrator/health` reports live reachability of all five tiers — useful for confirming Redis/Postgres/Pinecone/SQLite are actually up rather than silently degrading (every tier fails open, same convention as the existing Redis query cache).

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (React 19), TypeScript, Tailwind CSS v4, Framer Motion, shadcn/ui, react-pdf |
| Backend | FastAPI, SQLAlchemy, Pydantic |
| AI / Retrieval | Groq/Grok + Gemini (fallback), Pinecone, Sentence-Transformers |
| Infra | Redis (caching + working memory), Celery (async task scaffolding), SQLite (primary DB + shared/graph memory), PostgreSQL (episodic memory) |

## Author

**Ayush Singh** — [GitHub](https://github.com/ayushrajput8252-dev) · [LinkedIn](https://www.linkedin.com/in/ayush-singh-aiml/)

Licensed under [MIT](LICENSE).
