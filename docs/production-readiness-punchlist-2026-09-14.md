# Production Readiness Punch List — AgenticFlow

> Derived from the 2026-09-13 full-platform audit + the 2026-09-14 case study fact-check. Priority reflects blast radius if a real user hit this today, not effort to fix.

## Overall readiness: not production-ready for real users

Rough qualitative read across the standard pillars (this is a judgment call, not a measured score):

| Pillar | State |
|---|---|
| Core AI/retrieval engineering | Strong — hybrid retrieval, adaptive grading, resilience layer all live-verified |
| Reliability (circuit breakers, fallbacks) | Strong for what's built |
| Security (auth, TLS, secrets, input validation) | Effectively absent — the real blocker |
| CI/CD | Broken, not just missing |
| Data layer (migrations, backups) | Partial — 3 of N tables migrated |
| Deployment/infra | Manual, no IaC, single box |
| Observability | Good coverage, but itself unauthenticated |

**Bottom line:** the AI engineering is ahead of the production hardening. If a technical evaluator or a real user touched this today, they'd hit the security gap within minutes (open API, no login enforced) before they'd ever notice the retrieval quality. Fix P0 before anything else matters.

---

## P0 — Blockers (fix before any real user touches this)

| # | Name | Description |
|---|---|---|
| 1 | **No authentication enforced anywhere** | A Google OAuth endpoint exists but never issues a session/JWT. Every API route (RAG, hiring, fraud, screening, agent tools, MCP connectors) is reachable by anyone who can hit the backend, with full read/write on candidate data and the ability to trigger real connector actions (Slack/Salesforce/Gmail, where credentialed). |
| 2 | **CI/CD is broken** | `.github/workflows/ci.yml` references monorepo paths that don't exist in this repo's own checkout root — every job fails immediately if triggered. No code has actually been CI-validated. |
| 3 | **Hardcoded demo credentials + fake fallback data (Command Center UI)** | The "security gate" modal has a client-side password list (`admin123`, `password`, `ayush`, etc.) shipped in the JS bundle, bypassing real backend auth entirely. On backend error/timeout it silently substitutes canned success data instead of showing failure — directly contradicts the product's "never guesses" positioning. |
| 4 | **No TLS anywhere** | nginx listens on `:80` only, despite `:443` being open in the EC2 security group. All traffic, including any credentials once auth exists, is unencrypted. |
| 5 | **Unsanitized upload filenames** | 4 endpoints (`upload.py`, `fraud.py`, `hiring.py`, `telephonic.py`) don't sanitize uploaded filenames — path-traversal risk. |

## P1 — High (needed before scaling past a demo)

| # | Name | Description |
|---|---|---|
| 6 | **No rate limiting on LLM-calling endpoints** | Every query can trigger paid LLM calls with no throttle — direct, unbounded dollar-cost exposure, not just abuse risk. |
| 7 | **Fake health checks** | `/health` on all three apps returns unconditional 200 with zero live dependency check. Postgres/Redis/Pinecone can be fully down and orchestration (Docker) still reports healthy. |
| 8 | **Weak hardcoded DB password** | `POSTGRES_PASSWORD: policy` is a hardcoded weak default in two docker-compose files. |
| 9 | **`.env_aws` not actually gitignored** | The `.env.*` gitignore pattern requires a literal dot after `env` and doesn't match `.env_aws` — no leak yet (verified clean via full history scan), but live risk on the next broad `git add`. |
| 10 | **Celery configured but never dispatched** | Full broker/backend/task setup exists but ingestion actually runs on an in-process `ThreadPoolExecutor` — Celery is dead code, and ingestion can't scale past one box as currently wired. |

## P2 — Medium (matters at real scale / real data)

| # | Name | Description |
|---|---|---|
| 11 | **Incomplete migrations** | Alembic (11 migrations) only covers the original 3 RAG tables. Every table added since (memory tiers, orchestration scores, voice ID, etc.) relies solely on `create_all()` at startup — no repeatable, automated schema upgrade path. |
| 12 | **Single process holds multiple large resident ML models** | Embedding model + ECAPA-TDNN speaker model + faster-whisper all loaded in one `uvicorn` process, no `--workers`. Documented, reproduced real OOM crash history on constrained hardware. |
| 13 | **Possible data loss on redeploy (Render)** | `render.yaml`'s own comment warns SQLite has no persistent disk on the free plan — unverified whether `DATABASE_URL` is actually pointed at hosted Postgres in that deployment path. |
| 14 | **No infrastructure-as-code** | The AWS EC2 box was provisioned by hand — not reproducible, no version-controlled infra definition. |
| 15 | **Observability endpoints unauthenticated** | `/api/v1/observability/*` has no auth. No secrets found in scanned traces, but query/document content is exposed to anyone who can reach the backend with a known `request_id`. |

## P3 — Low (polish, once the above is done)

| # | Name | Description |
|---|---|---|
| 16 | **Redis first-connect latency tax** | ~4.1s wall-clock on the first connection attempt after a Redis outage (likely Windows dual-stack DNS overhead), before the existing 30s fail-open cooldown kicks in. |
| 17 | **Root `ai_engine` repo has no CI at all** | Only the nested `AI-Policy-Rule-Engine` repo has a (broken) CI config; the monorepo root has none. |

---

## Suggested fix order

1. **P0-1 (auth)** first — everything else is moot if the backend stays open. Add session/JWT issuance to the existing Google OAuth flow, then a `Depends()` guard on every router.
2. **P0-3 (Command Center)** same day — it's a two-file fix (remove the hardcoded password list, remove the `DEMO_RESULTS` fallback) with outsized credibility risk if left.
3. **P0-2 (CI)** — fix the path mismatch so every future change is actually validated; cheap fix, high leverage since nothing since has been CI-checked.
4. **P0-4/P0-5 (TLS, upload sanitization)** — standard hardening, bundle together.
5. Then work down P1 in order — rate limiting and real health checks are both cheap and high-leverage before P2's deeper infra work (migrations, IaC, worker scaling).
