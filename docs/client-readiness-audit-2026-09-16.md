# Client-Readiness Audit — AgenticFlow / AI-Policy-Rule-Engine

> **2026-09-17 implementation update:** P0-1 (auth), P0-3 (Command Center password bypass),
> P0-5 (upload path traversal), P0-7 (rate limiting), and P0-8 (README overclaim) below are
> now **implemented and live-verified** (real JWT auth via `Depends(get_current_user)` on
> every router except the 4 deliberately-open ones — see `main.py`'s `_auth_guard` comment
> block for exactly which and why; `slowapi` rate limiting on every LLM/compute-calling
> route; filename sanitization + size caps on all 4 upload endpoints; the hardcoded
> `acceptedDemoPasswords` bypass and the "Default: admin123" hint removed from
> `VoiceGateModal.tsx`; README's RBAC/"zero-trust" claim corrected). Verified via a live
> `TestClient` suite (unauthenticated 401s on protected routes, 200 on open ones, 429 after
> the configured rate-limit threshold) — not just read from code. One scope refinement made
> during implementation, confirmed with the user: candidate-facing routes reached via an
> emailed invite link (`screening.py`'s start/session/proctor-telemetry,
> `interview.py`'s turn/evaluate/report + its WS route) are intentionally left open — the
> long random `session_id` in the URL is that flow's access control, since an external
> candidate was never a signed-in platform user. **Still open**: P0-2 (fabricated fallback
> results in `fraud_tools.py`/`hiring_tools.py`/`verification_tools.py`/Command Center's
> `DEMO_RESULTS`), P0-4 (covered by P0-1 now, but not re-verified live against the actual
> EC2 deployment — this pass was local-only), P0-6 (TLS). All P1+ items below are unchanged.
> Also found mid-implementation: multiple concurrent sessions/terminals are active on this
> machine right now (`ListAgents` showed 2 idle peer sessions) and the user's own direct git
> commits during this same window absorbed several of these fixes under unrelated commit
> messages ("lanfuse implemented", "fixing small bug") — the code is confirmed correct and
> live-tested regardless of which commit it landed in, but worth a `git log -p` skim before
> writing release notes off commit messages alone.

**Date:** 2026-09-16
**Scope:** `apps/AI-Policy-Rule-Engine` (flagship platform: RAG, Hiring, Fraud Detection, Screening/Interview, Telephonic Agent, Command Center, MCP connectors, Onboarding). Verified against current code + the live EC2 deployment (`44.201.3.194:8000`), not just prior audit docs.
**Method:** Direct code reads + 3 parallel verification passes today, cross-checked against this repo's own `docs/production-readiness-punchlist-2026-09-14.md`. Every claim below has a file:line citation. Nothing here is inferred from README/marketing copy.

---

## 1. Executive verdict

> "If I give this to a real client tomorrow, what are the top things that could go wrong?"

1. **Anyone who can reach the URL has full read/write access to every candidate's data, resumes, fraud scans, call records — no login is enforced anywhere.** A technical evaluator finds this in minutes via `/docs` (Swagger, publicly open).
2. **The "Agentic Command Center" demo can silently show a fully fabricated result** (parsed resume, 89% match, "clean" fraud verdict, fake WhatsApp delivery receipt) if the backend call fails or times out — with zero visual difference from a real result. If this happens live in front of the client, they see a lie, not an error.
3. **The Command Center's password gate is fake** — the real password is hardcoded in the shipped JS bundle (and even shown as a UI hint: "Default: admin123") and doesn't even protect the underlying tool-execution API, which is callable directly with no gate at all.
4. **WhatsApp cannot be demoed** — Meta requires HTTPS to register a webhook, and the live box has no TLS. If it's in the demo script, it will fail publicly.
5. **A wrong/garbage `scan_id` on the fraud-check agent tool returns a confident fake "genuine" verdict** instead of an error — same pattern in the hiring scorecard tool and a newly-found background-verification tool (fake HR contact + fake phone number on failure).
6. **Uploaded filenames aren't sanitized on 4 endpoints** — a crafted filename can write outside the intended upload directory.
7. **Every LLM-calling endpoint has no rate limit** — a client (or a bot) can run up real, unbounded API cost with no throttle.
8. **CI never actually runs** — the workflow file lives at `apps/AI-Policy-Rule-Engine/.github/workflows/ci.yml`, one level too deep for GitHub Actions to discover it. Nothing shipped since this was added has been CI-validated.
9. **The "Onboarding" portal (HR/Manager/Employee) and the hiring "bulk send"/"Knowledge Transfer Agent" are 100% client-side theater** — no backend persistence, a page refresh loses everything, and "Delivered ✓ / Reply Received ✓" is shown without ever sending an email.
10. **The README's "Trust & Infra" section claims RBAC and a "zero-trust surface"** — the codebase has no authentication of any kind. If a technical evaluator reads the README next to the code, this is the first credibility hit, and it costs nothing to fix.

---

## 2. Feature reality table

| Feature | Actual Status | Evidence | Client Risk | Action |
|---|---|---|---|---|
| RAG (hybrid dense+BM25+RRF, CRAG/ARAG grading, reranking, citations) | **REAL & WORKING** | Live-verified multiple sessions; `retrieval.py`, `adaptive_rag.py`, `sparse_retrieval.py` | Low | Keep |
| Resilience layer (circuit breakers, fallback cascades) | **REAL & WORKING** | `services/resilience.py`, wired into every external call site | Low | Keep |
| Fraud detection core pipeline (15 checks, SSE streaming) | **REAL & WORKING** | `fraud_orchestrator.py:25-124`, live SSE-verified | Low | Keep |
| Fraud agent-tool wrapper | **REAL BUT FLAWED** | `agent_tools/fraud_tools.py:81-92` fabricates "genuine" verdict on unknown scan_id | **High** | Fix |
| Hiring: parse/ATS-score/match/assignment | **REAL & WORKING** | `hiring_service.py:142-178,254-286,394-412`, real LLM calls | Low | Keep |
| Hiring: bulk send, onboarding agent, knowledge-transfer agent | **MOCK / HARDCODED** | `hiring-automation/page.tsx:451-464,550-583` — pure `setTimeout` animation, zero network calls | **High** (looks like real email/provisioning) | Relabel clearly in UI, not just tooltip; consider hiding until real |
| Hiring: interview-scheduling calendar contention | **MOCK / HARDCODED** | `page.tsx:224-254` — seeded fake "30% pre-booked" | Medium | Relabel or remove |
| Hiring agent-tool scorecard | **REAL BUT FLAWED** | `agent_tools/hiring_tools.py:296-308` fabricates full scorecard on any exception | **High** | Fix |
| Screening/Interview (question gen, STT, LLM eval, WS+HTTP fallback, report) | **REAL & WORKING** | `interview_service.py`, `InterviewRoom.tsx`, honest failure states throughout | Low | Keep |
| Telephonic Agent (Sarvam calling) | **REAL & WORKING** (per prior audits) | Not re-verified this pass; no new contradicting evidence found | Low-Medium | Spot-check before demo |
| Command Center — real agent-tool calls (happy path) | **REAL & WORKING** | `agent_tools/planner.py`, `execute_plan` | Low | Keep, but see fabrication risk below |
| Command Center — failure/timeout behavior | **MOCK / HARDCODED masquerading as real** | `CommandCenter.tsx:46-88`, `types.ts:179-257` — full fake pipeline substituted silently, including fake WhatsApp receipt | **Critical** | Fix immediately |
| Command Center — password security gate | **MOCK / HARDCODED (client bypass); real gate protects nothing** | `VoiceGateModal.tsx:43-48,69-74`; real API has no dependency on it at all | **Critical** | Fix or remove the "security gate" framing entirely |
| Background Verification tool (company legitimacy + HR contacts) | **REAL BUT FLAWED** (new, previously undocumented) | `agent_tools/verification_tools.py:134-147` — real Tavily search, but fabricates score 92/"high" + fake HR contact + fake phone number on any exception | **High** — feeds hiring/fraud decisions | Fix |
| Voice identification (speaker ID, anti-spoofing) | **REAL, demo-scoped** | Confirmed prior sessions; SpeechBrain ECAPA-TDNN, Silero VAD | Low-Medium | Keep, disclose "one enrolled speaker" scope |
| Onboarding portal (HR/Manager/Employee) | **MOCK / HARDCODED** | `onboarding/page.tsx:51-110` — fictional seed data, zero persistence except 2 doc-upload calls | **High** (whole product page is theater) | Hide or clearly mark Preview |
| Memory/Orchestration layer (5-tier) | **PARTIAL** | Real infra exists; Command Center planner never actually consults it (`planner.py`) | Low (not client-visible directly) | Leave; don't market as "agent memory-aware" yet |
| MCP connectors (12: Slack/Jira/Salesforce/Gmail/etc.) | **PARTIAL** — architecture real, mostly `not_configured` | Verified live `503`/`not_configured` responses in prior audit | Low (honest about gaps) | Keep, don't demo unconfigured ones |
| Google Workspace connector | **REAL, live-configured** | Verified via a real `list_events` call in prior audit | Low | Keep |
| WhatsApp integration | **REAL webhook/parsing, but DOA in production** | No TLS on live box; Meta requires HTTPS to register a webhook | **High if demoed** | Don't demo; fix TLS first |
| Authentication | **NOT IMPLEMENTED** | `api/auth.py:38-83` — upserts DB row, issues no JWT/session/cookie; zero `Depends(get_current_user)` anywhere in repo | **Critical** | Fix before any client contact |
| Health checks (`/health`) | **MOCK — cosmetic** | `main.py:230-233` returns hardcoded `"ok"`; on a cold process `_breakers` is empty, i.e. provably fake on startup | Medium | Fix |
| CI/CD | **NOT IMPLEMENTED (never runs)** | Workflow file at wrong path depth — never discovered by GitHub Actions | Medium (no client-visible risk day 1, but no safety net) | Fix (cheap) |
| README "Trust & Infra — zero-trust / RBAC" claim | **NOT IMPLEMENTED, misrepresented in docs** | `README.md:54,61-63` vs. zero auth-guard code found anywhere | **High** (credibility) | Relabel/remove immediately |
| TLS | **NOT IMPLEMENTED** | `nginx/policy.conf` — port 80 only, no cert anywhere in repo | **Critical for WhatsApp, High otherwise** | Fix |
| Rate limiting | **NOT IMPLEMENTED** | No rate-limit library/middleware anywhere in backend or nginx | **High** (cost exposure) | Fix |
| Upload filename handling | **REAL BUT FLAWED** | 4 endpoints, unsanitized `file.filename` in path construction | **High** | Fix |

---

## 3. P0 — MUST FIX BEFORE CLIENT

### P0-1: Zero authentication enforced anywhere
- **File/location:** `backend/app/api/auth.py:38-83` (login never mints a session); every router in `backend/app/main.py:192-218` mounted with no auth dependency; confirmed via repo-wide grep — no `get_current_user`/`require_auth`/`verify_token` exists anywhere, not even as dead code.
- **Why it matters:** every API (RAG documents, candidate resumes, fraud scans, call recordings, agent tool execution) is reachable by anyone with the URL. Live-verified today: `GET /api/v1/telephonic/calls` on the running EC2 box returns the last 50 candidates' call records with **zero credentials**.
- **Expected client impact:** if the client points anyone else (a colleague, a prospect, a curious visitor) at the URL, that person sees other candidates'/companies' data. For a hiring/fraud product, this is the single fastest way to lose the engagement.
- **Exact recommended change:** issue a real JWT (or server session cookie) from the existing Google OAuth `google_login` flow; add a `get_current_user` dependency; apply it via `dependencies=[Depends(get_current_user)]` on every `include_router()` call in `main.py` except `/health`, `/docs`, and the OAuth callback itself. Scope tokens by `company_id`/`user_id` so cross-company queries can be filtered at the DB layer, not just gated at the route.
- **Estimated effort:** 1–2 days for JWT issuance + guard + wiring across ~15 routers; add company/user scoping to queries is a larger follow-on (can be P1 if a single-tenant pilot is acceptable short-term, but the route guard itself is non-negotiable P0).
- **How to test:** T01–T08 in the test matrix below (unauthenticated request → 401 on every router; valid token → 200; token for User A can't fetch User B's/Company B's records).

### P0-2: Fabricated fallback results on failure (4 locations, same pattern)
- **File/location:**
  - `backend/app/agent_tools/fraud_tools.py:81-92` — unknown `scan_id` → fake `risk_score: 8, verdict: "likely_genuine"`.
  - `backend/app/agent_tools/hiring_tools.py:296-308` — any exception → fake scorecard `overall_score: 89, recommendation: "PROCEED"`, defaults candidate name/email to the developer's own.
  - `backend/app/agent_tools/verification_tools.py:138-147` — any exception → fake legitimacy score 92/"high", fake HR contact ("Head of People"), fake phone number `+1 (800) 555-0199`.
  - `frontend/.../command-center/CommandCenter.tsx:46-88` + `types.ts:179-257` — any backend error/timeout (3.5s) → silently substitutes a full canned pipeline result, including a fabricated WhatsApp delivery receipt with a fake `message_id`. No `isDemo`/`isReal` flag exists anywhere in the rendering layer (`LeftPanel.tsx`, `NodeInspector.tsx`, `RightCanvas.tsx`, `AgentNode.tsx` — confirmed via grep, none contain "demo").
- **Why it matters:** this is the exact "fabricated fallback response" / "fake success state" pattern the client-trust audit specifically screens for. It is structurally indistinguishable from a genuine result in every consumer.
- **Expected client impact:** a recruiter or evaluator could make a real hiring/fraud decision off a number that was never computed. If it happens during a live demo (backend hiccup, LLM timeout — both plausible on a t3.small box), the client sees a wrong "clean" fraud verdict or "89% match" and has no way to know it's fake.
- **Exact recommended change:** in all four locations, replace the fabricated payload with a real error response (`raise MCPToolError(...)` / HTTP 502, or a UI error state). If a "demo mode" is genuinely wanted for sales calls without a live backend, gate it behind an explicit, developer-only flag and render a persistent "DEMO DATA" banner in the UI — never as a silent substitution for a real call.
- **Estimated effort:** ~0.5 day (mostly deletion — remove the fallback blocks, propagate the real exception/error state instead).
- **How to test:** T20–T24 (kill the backend mid-Command-Center-run, pass a garbage `scan_id`, force an LLM timeout on the verification tool) — expect a visible, real error in every case, never a plausible-looking result.

### P0-3: Command Center "security gate" is fully bypassable and protects nothing
- **File/location:** `frontend/.../command-center/VoiceGateModal.tsx:43-48,69-74` — hardcoded `acceptedDemoPasswords` list checked client-side before any network call, and again on network error; line 95 even shows the real password as a UI hint ("Default: admin123"). Separately, `backend/app/api/agent.py`'s tool-execution routes (`/agent/tools/.../call`, `/agent/plan`, `/agent/run`) have zero reference to `command_center`/`COMMAND_CENTER_PASSWORD_HASH` anywhere — confirmed via grep.
- **Why it matters:** the real backend bcrypt+rate-limited check in `command_center.py` is a well-built gate that guards **nothing** — the actual tool-execution API is callable directly, unlocked or not. The frontend gate is theater on top of theater.
- **Expected client impact:** any technical evaluator who opens devtools finds a hardcoded password list in the shipped bundle within minutes, directly contradicting a product pitch built on "grounded, never fake."
- **Exact recommended change:** delete `acceptedDemoPasswords` and the network-error fallback entirely — always require the real backend check. Separately (and more importantly, since P0-1 will already gate this), don't market this modal as a "security gate" at all once real auth exists; it's UX friction, not security.
- **Estimated effort:** ~1 hour (delete ~15 lines).
- **How to test:** T25 — attempting any of the 8 listed passwords with the network reachable must go through the real `/command-center/unlock` call and fail if wrong; with the network blocked (devtools offline mode), no password should unlock the panel.

### P0-4: Cross-candidate data exposure, live-demonstrated
- **File/location:** `backend/app/api/telephonic.py` — `GET /api/v1/telephonic/calls`, confirmed returning 200 with real data, unauthenticated, on the live box today.
- **Why it matters:** this is not theoretical — it's the concrete, reproducible instance of P0-1. Listed separately because it's the fastest, most obvious thing a client or their IT/security reviewer would try.
- **Expected client impact:** immediate loss of trust if discovered independently rather than disclosed.
- **Exact recommended change:** covered by P0-1's auth guard; additionally scope the query by the requesting user's company/tenant once auth exists.
- **Estimated effort:** covered by P0-1.
- **How to test:** T04.

### P0-5: Upload path traversal (4 endpoints)
- **File/location:** `backend/app/api/upload.py:42`, `fraud.py:43-44`, `hiring.py:42`, `telephonic.py:226` — all build `os.path.join(UPLOAD_DIR, f"{uuid}_{file.filename}")` with the raw client-supplied filename; no `secure_filename`/`os.path.basename()` call anywhere in these files.
- **Why it matters:** a filename like `../../../etc/cron.d/x` is not neutralized by the uuid prefix (`normpath` still resolves upward past the first `..` segment). Also no server-side file-size cap on any of the 4 endpoints (only nginx's `client_max_body_size 25m`, which doesn't apply to direct-port access).
- **Expected client impact:** a malicious or just buggy upload (e.g. a resume file with `/` in its name from certain export tools) could write outside the uploads directory or exhaust disk via an oversized upload.
- **Exact recommended change:** sanitize with `os.path.basename(file.filename)` (or `werkzeug.utils.secure_filename`) before use in all 4 endpoints; add a server-side `Content-Length`/streamed byte-count cap (e.g. 25MB) independent of nginx.
- **Estimated effort:** ~2 hours (4 near-identical small changes + one shared size-check helper).
- **How to test:** T09–T14.

### P0-6: No TLS anywhere on the live deployment
- **File/location:** `nginx/policy.conf` (single `server { listen 80; }` block, no 443/cert directives); confirmed live — `.env_aws` explicitly notes direct-port mode, no nginx in front yet either.
- **Why it matters:** all traffic (soon to include auth tokens, per P0-1) is unencrypted. Meta's WhatsApp Business API **requires** HTTPS to even register a webhook — WhatsApp is dead on arrival without this.
- **Expected client impact:** if WhatsApp is in the demo script, it fails publicly. Any credential/token traffic is sniffable on the network path.
- **Exact recommended change:** get a cert (Let's Encrypt/certbot against the EC2 public IP or a real domain), add a second nginx `server` block for 443 redirecting 80→443, mount the cert via a volume, open 443 in the security group (already open per prior audit — just unused).
- **Estimated effort:** 0.5–1 day (domain + DNS if not already pointed, certbot setup, nginx config, verify webhook registration with Meta).
- **How to test:** T26–T28.

### P0-7: No rate limiting on any LLM-calling endpoint
- **File/location:** confirmed absent repo-wide — no `slowapi`/`fastapi-limiter` in `requirements.txt`, no rate-limit middleware in `main.py`, no `limit_req` in `nginx/policy.conf`.
- **Why it matters:** RAG query, fraud scan, screening, telephonic, and agent-plan endpoints all trigger real paid LLM/API calls with no per-client throttle.
- **Expected client impact:** a scripted loop (malicious, buggy client integration, or just an enthusiastic QA tester) can run up real dollar cost with no ceiling before anyone notices.
- **Exact recommended change:** add `slowapi` (or nginx `limit_req_zone`) with a per-IP (and, once auth exists, per-user) limit on the 5 LLM-calling router groups — start conservative (e.g. 20 req/min) and loosen based on real pilot usage.
- **Estimated effort:** ~0.5 day.
- **How to test:** T29 — script 50 rapid requests to `/rag/query`, confirm throttling kicks in with a proper 429, not silent cost accrual.

### P0-8: README overclaims security posture that doesn't exist
- **File/location:** `apps/AI-Policy-Rule-Engine/README.md:54,61-63` — "Zero-trust surface — RBAC, audit logs..." and "RBAC portals" language, directly contradicted by P0-1's finding (zero auth-guard code anywhere).
- **Why it matters:** this is the one item on this list that costs nothing but attention — and it's exactly the kind of claim a technical evaluator checks first, right next to the code that disproves it. Rule 4 in this audit's own brief (fix > remove > hide > relabel > harden > test > add) applies directly: this needs a wording fix, not new code.
- **Expected client impact:** a mismatch here, caught independently, reads as either incompetence or dishonesty — worse for trust than the underlying gap itself, since the rest of the README is unusually honest (it has a whole "Honest Status ~78%" section elsewhere).
- **Exact recommended change:** remove or rewrite the "RBAC"/"zero-trust surface" line until P0-1 actually ships; something like "Auth: in progress — see Honest Status" matches this project's own established documentation style.
- **Estimated effort:** 10 minutes.
- **How to test:** re-read README against actual code once P0-1 ships; keep them in sync going forward.

---

## 4. P1 — SHOULD FIX BEFORE FIRST CLIENT

| # | Issue | Location | Why | Fix | Effort |
|---|---|---|---|---|---|
| P1-1 | CI never actually runs | `.github/workflows/ci.yml` lives at `apps/AI-Policy-Rule-Engine/.github/workflows/`, one level too deep for GitHub Actions discovery (needs to be at repo root `.github/workflows/`) | Nothing shipped has been CI-validated; regressions ship silently | Move the workflow file to the actual repo root's `.github/workflows/` | 30 min |
| P1-2 | Weak hardcoded DB password | `docker-compose.yml:19,36` and nested `apps/AI-Policy-Rule-Engine/docker-compose.yml:24,47` — `POSTGRES_PASSWORD: policy` | Postgres isn't published beyond the host today, but this is one security-group misconfig away from being exposed with a trivial password | Generate a real secret, load via `.env`, remove from compose defaults | 1 hour |
| P1-3 | `.env_aws` not covered by `.gitignore` | Root `.gitignore` `.env.*` pattern requires a literal dot after "env"; `.env_aws` doesn't match | One broad `git add` away from committing live deployment config (not yet leaked — verified clean history) | Add `.env_aws` and a `.env*` wildcard to `.gitignore` | 10 min |
| P1-4 | Health checks are cosmetic | `main.py:230-233` — hardcoded `"ok"`, empty breaker list on a cold process | Docker/orchestration reports "healthy" even if Postgres/Redis/Pinecone are down | Add real connectivity pings (cheap `SELECT 1`, `PING`, a lightweight Pinecone describe-index call) with a short timeout, fail the check if any core dependency is unreachable | 0.5 day |
| P1-5 | Command Center's `DEMO_PLAN` silently replaces ambiguous prompts | `CommandCenter.tsx:226-229` | An unrecognized free-text prompt runs the canned "Ayush Singh" pipeline instead of asking for clarification or failing | Return a clarification prompt or explicit "couldn't parse this request" instead of falling through to demo data | 2-3 hours (tied to P0-2 fix) |
| P1-6 | Onboarding portal has zero backend persistence | `onboarding/page.tsx:51-110` | Whole HR/Manager/Employee portal looks functional but a refresh loses every action; no toast discloses this | Hide behind a "Preview" label, or scope out of the first-client demo entirely until wired to real persistence | Hide: 1 hour. Real fix: multi-day, don't do yet |
| P1-7 | "Bulk send" shows fake delivery confirmation | `hiring-automation/page.tsx:451-464` | "Delivered ✓ / Reply Received ✓" shown with zero email actually sent | Either wire to a real email/notification send, or replace the button with a clearly-labeled "Preview only" state | Relabel: 1 hour. Real send: 1-2 days |
| P1-8 | Migrations gap | Alembic (13 migrations) only covers `documents`/`chunks`/`rules`; every later table relies on `create_all()` at startup | No repeatable, automated schema-upgrade path for prod; a schema change today has no rollback story | Write migrations for the remaining tables, add `alembic upgrade head` to the deploy step (Dockerfile CMD or an entrypoint script) | 1 day |
| P1-9 | Celery configured but never dispatched | Broker/backend/tasks exist; ingestion runs on `ThreadPoolExecutor` instead | Dead-code confusion for the client's engineers if they read the codebase; also caps ingestion scaling to one box | Either wire Celery in for real, or remove the unused config/dependency to avoid confusing a technical evaluator | 0.5 day (remove) / 1-2 days (wire in) |
| P1-10 | Observability endpoints unauthenticated | `/api/v1/observability/*` | Query/document content visible to anyone who can reach the backend with a known `request_id` | Covered by P0-1's auth guard | Covered by P0-1 |

---

## 5. P2 — PILOT (safe to handle during a controlled pilot)

- Onboarding/Knowledge-Transfer "agents" are pure `setTimeout` step animations (`hiring-automation/page.tsx:550-583`) — fine for a controlled pilot as long as clearly labeled Preview (see §6).
- Fake calendar contention in interview scheduling (`page.tsx:224-254`) — cosmetic, low risk, but should be labeled or replaced with real calendar integration before any real scheduling commitment is made through it.
- No infrastructure-as-code for the EC2 box — fine for one pilot client; revisit before a second concurrent client.
- Single process holds multiple large resident ML models (embedding + ECAPA-TDNN + faster-whisper), no `--workers` — documented real OOM crash history; acceptable risk for a controlled pilot with light concurrent load, but budget for a larger instance (t3.large+) if the pilot ramps up.
- `render.yaml`'s SQLite-on-ephemeral-disk warning — verify `DATABASE_URL` actually points at hosted Postgres if that path is ever used for the client; not verified this pass.
- Redis first-connect latency (~4.1s) after an outage — minor, self-heals via existing fail-open cooldown.
- Undisclosed generic-question fallback in interview flow (`interview_service.py:46,138-153`) — low impact (a plausible interview question), but should eventually be surfaced.
- Empty-state vs fetch-failure ambiguity on the rules page (`rules/page.tsx:26-42`) — minor honesty gap, low frequency.

---

## 6. REMOVE / HIDE / RELABEL

This is the highest-leverage section — most of it is text/config changes, not new engineering.

**Remove entirely (until real):**
- The `DEMO_RESULTS`/`DEMO_PLAN` silent-substitution fallback in Command Center (`CommandCenter.tsx`, `types.ts`) — remove the fallback behavior, not necessarily the demo data itself if it's kept behind an explicit flag for sales use.
- The hardcoded password list in `VoiceGateModal.tsx`.
- The fabricated-result branches in `fraud_tools.py`, `hiring_tools.py`, `verification_tools.py`.

**Hide from the first-client build (mark Preview/Roadmap, don't remove the code):**
- Onboarding portal (HR/Manager/Employee) — whole feature is client-side theater with no persistence.
- Hiring "Bulk Send," "Onboarding Agent," "Knowledge Transfer Agent" buttons — real for parse/score/match, fake past that point; either hide these specific buttons or badge them "Preview."
- WhatsApp integration — until TLS ships, don't surface it in the demo at all.

**Relabel / correct wording:**
- README's "Trust & Infra — RBAC, zero-trust surface" language (§P0-8).
- README's "provisions accounts, repo access, and equipment automatically across HR/Manager/Employee RBAC portals" (`README.md:54`) — same issue, describes the mock onboarding portal as if it's real provisioning.
- Command Center's "Default: admin123" password hint — remove regardless of the bypass fix; showing the password defeats the point of a gate.
- The "Live Planning Thoughts Stream" hardcoded "21 connectors, 71 tools" literal (from prior audit, unrelated to real catalog size) — correct to the real, current tool count or compute it dynamically.

**Metrics to remove/qualify:**
- Any place presenting the single 3-week-stale RAG eval (88.9%, 9 questions, one document) as a general accuracy number — either re-run and refresh it before the client sees it, or caption it explicitly ("internal smoke-test, not a general benchmark").
- Fraud detection and resume-matching have **zero accuracy evaluation anywhere in the repo** — don't present any implied accuracy claim for these until at least a small labeled eval exists.

---

## 7. WHAT NOT TO CHANGE

- **RAG pipeline** (hybrid dense+BM25+RRF, CRAG/ARAG adaptive grading, cross-encoder reranking, citation grounding) — genuinely real, repeatedly live-verified across multiple independent sessions, including hand-verified fusion math. Don't rewrite.
- **Resilience layer** (circuit breakers, exponential backoff, fail-open cascades wired into every external call) — solid, well-tested engineering. Keep.
- **Screening/Interview workflow** — this is the most honest, well-engineered workflow in the codebase: real WebSocket+HTTP fallback, real STT/LLM eval, and a confirmed history of a fake report component being *actively removed* in favor of an honest one. Don't touch beyond the minor undisclosed-fallback note in P2.
- **Fraud detection core pipeline** (the 15-check SSE-streamed scan itself, not the agent-tool wrapper around it) — real, deterministic-fallback-on-LLM-failure is genuinely well-designed (`fraud_reasoning.py:43-114`).
- **Hiring parse/score/match** (the actual REST path used by the main hiring page, as opposed to the agent-tool wrapper) — real LLM calls, honest fallback messaging when both LLM providers fail.
- **Voice identification** — genuinely real ML (SpeechBrain ECAPA-TDNN, Silero VAD, anti-spoofing), don't second-guess it; just keep its "one enrolled speaker" demo scope disclosed.
- **CORS allowlist mechanism itself** — the allowlist+regex path is correctly implemented when the env var is set; don't rebuild it, just make sure the env var is always set in every deploy target (currently falls back to open `*` only when unset — an ops/config fix, not an architecture fix).
- **Frontend architecture generally (Next.js/React)** — no evidence found of structural problems; issues found are all in specific components' data/failure handling, not the framework choices.

---

## 8. End-to-end test plan

| ID | Scenario | Expected Result | Priority |
|---|---|---|---|
| T01 | Unauthenticated GET to any candidate/document/call-record endpoint | 401, once P0-1 ships | P0 |
| T02 | Valid auth token, own company's data | 200 with correct data | P0 |
| T03 | Valid auth token, request another company's/user's data by ID | 403/404, never the other party's data | P0 |
| T04 | `GET /api/v1/telephonic/calls` unauthenticated | 401 (currently 200 — regression check) | P0 |
| T05 | Login via Google OAuth | Real session/JWT issued, usable on a protected route | P0 |
| T06 | Expired/tampered token | 401, not silently accepted | P0 |
| T07 | Brute-force login attempts | Rate-limited/locked out, not unlimited attempts | P1 |
| T08 | Logout / token revocation (if implemented) | Token no longer works on protected routes | P1 |
| T09 | Upload resume with normal filename | Stored correctly, processed | P0 |
| T10 | Upload with filename containing `../../` traversal | Rejected or safely sanitized, never written outside uploads dir | P0 |
| T11 | Upload oversized file (e.g. 500MB) | Rejected server-side with clear error, not silently accepted/OOM | P0 |
| T12 | Upload unsupported file type (.exe renamed to .pdf) | Rejected on real content inspection, not just extension string | P1 |
| T13 | Upload corrupted/truncated PDF | Clear parse-failure error, not a fabricated result | P0 |
| T14 | Two simultaneous uploads with the same filename | No file overwrite/clobber, both processed independently | P1 |
| T15 | Resume upload → parse → score → recruiter review happy path | Correct end-to-end scoring, real LLM output | P0 |
| T16 | Resume parse when both LLM providers are down | Honest "manual review needed" fallback, not a fake score | P0 |
| T17 | Hiring "Bulk Send" button click | Either real email confirmation or clearly labeled Preview — not fake "Delivered" | P0 |
| T18 | Onboarding portal: approve access request, refresh page | State persists (once fixed) or portal is clearly labeled Preview | P1 |
| T19 | Interview scheduling: book a slot | Real persistence, no fake pre-booked contention shown as real | P2 |
| T20 | Fraud agent-tool call with garbage `scan_id` | Real 404/error, not a fake "likely_genuine" verdict | P0 |
| T21 | Hiring agent-tool call that triggers a DB exception | Real error surfaced, not a fake 89/PROCEED scorecard | P0 |
| T22 | Background-verification tool call with Tavily unreachable | Real error/empty result, not a fake legitimacy score + fake phone number | P0 |
| T23 | Command Center run with backend killed mid-plan | Visible failure state, never a silently substituted fake pipeline result | P0 |
| T24 | Command Center run exceeding the 3.5s frontend timeout while backend is still processing | No duplicate/conflicting result; real result not discarded in favor of demo data | P0 |
| T25 | Command Center password gate: enter any of the 8 hardcoded strings with network blocked (devtools offline) | Gate does not unlock without a real backend confirmation | P0 |
| T26 | Access the app over HTTP after TLS is added | Redirects to HTTPS | P0 |
| T27 | Access the app over HTTPS | Valid cert, no browser warning | P0 |
| T28 | Register WhatsApp webhook with Meta after TLS ships | Registration succeeds | P0 |
| T29 | Script 50 rapid `/rag/query` calls from one client | Throttled with 429 after threshold, not unlimited LLM spend | P0 |
| T30 | Full fraud scan happy path (real document) | Correct multi-check result, SSE stream completes | P0 |
| T31 | Fraud scan on a corrupt/unreadable document | Honest error, not a fabricated risk score | P0 |
| T32 | Fraud scan: browser disconnects mid-scan | Scan completes server-side and is retrievable, not orphaned "scanning" forever | P1 |
| T33 | Two fraud scans submitted for the same document simultaneously | No duplicate processing / DB conflict | P2 |
| T34 | Interview: candidate joins, completes full flow | Correct real-time question gen, STT, eval, report | P0 |
| T35 | Interview: LLM eval fails at the end | Real error banner shown, transcript preserved, no fake score | P0 |
| T36 | Interview: WebSocket drops mid-session | Falls back to HTTP, session continues without candidate-visible failure | P1 |
| T37 | Interview: mic/camera permission denied | Real, clear error shown, not a silent stall | P1 |
| T38 | Interview: candidate refreshes mid-session | Session state recoverable or a clear "session ended, contact recruiter" message — not silent data loss | P1 |
| T39 | RAG query against a `failed`/empty-ingestion document | Clear "document not ready" response, not a confident unrelated web-search answer | P0 (previously fixed — regression check) |
| T40 | RAG query, upload document, ask before ingestion completes | Blocked until real "completed" status, not a race-condition false negative | P1 (previously fixed — regression check) |
| T41 | RAG: Pinecone unreachable | Falls back to local cosine search, real answer still returned | P1 |
| T42 | RAG: Redis unreachable | Cache miss handled gracefully, no crash | P1 |
| T43 | Postgres unreachable at startup | Backend fails to start with a clear error, not a silent partial-degraded start | P1 |
| T44 | Postgres goes down mid-session | In-flight requests fail cleanly with 5xx, not silent data loss or a hang | P1 |
| T45 | Container restart mid-ingestion (background thread work) | Ingestion resumable/retryable via the existing `reprocess` endpoint, not permanently stuck | P1 |
| T46 | LLM call times out (both Groq and Gemini slow) | Resilience/circuit-breaker fallback kicks in within a bounded time, no indefinite hang | P0 |
| T47 | LLM returns malformed JSON for a structured-output call | Handled/retried/degraded gracefully, not an unhandled crash or fabricated parse | P1 |
| T48 | `/health` check while Postgres is down | Returns unhealthy (once fixed), not a hardcoded 200 | P1 |
| T49 | Docker Compose full stack cold start | All services reach healthy state without manual intervention | P0 |
| T50 | Container restart after a crash | State recovers correctly (in-flight query traces, sessions) without corruption | P1 |
| T51 | Two recruiters review the same candidate simultaneously | No lost update / conflicting approve-reject state | P2 |
| T52 | Duplicate resume upload (same candidate, same file, submitted twice quickly) | Not double-processed / duplicated in DB | P2 |
| T53 | Cross-company MCP connector action (Slack/Salesforce) triggered by an unrelated user | Blocked once auth+scoping exists (covered by P0-1/T03) | P0 |
| T54 | Observability trace lookup (`/observability/trace/{id}`) by an unrelated user guessing an ID | Blocked once auth exists (currently open) | P1 |
| T55 | Voice ID: unenrolled speaker attempts biometric unlock | Clear "not enrolled" message, not a false accept | P1 |
| T56 | Voice ID: replay-attack audio sample | Anti-spoofing rejects it | P2 |
| T57 | GitHub Actions CI on a push after the workflow-path fix | Pipeline actually triggers and runs | P1 |
| T58 | `alembic upgrade head` against a fresh empty DB (once migrations are completed) | All tables created via migration, not `create_all()` | P1 |
| T59 | Weak-password DB: attempt external connection to Postgres port | Refused/unreachable if security group is correctly scoped | P1 |
| T60 | `.env_aws` after gitignore fix: `git status` / `git add -A` | File no longer staged | P1 |

---

## 9. Client demo test — exact pre-demo checklist

Run this in full, in order, against the actual deployment target the client will see, immediately before any client session:

1. Confirm TLS is live: load the app over `https://`, verify no browser warning.
2. Confirm auth is enforced: open an incognito window, hit a data endpoint directly (e.g. `/api/v1/telephonic/calls`) with no login — must get 401, not data.
3. Log in as the demo account; confirm a real session persists across a page refresh.
4. Create/select a job, upload a real (not corrupted) resume.
5. Verify the document shows "processing" then "completed" — do not click into scoring before that status changes.
6. Run screening/scoring; confirm the score and reasoning look plausible and reference the actual resume content (not a stock example).
7. Open the candidate review UI; approve one candidate, reject another; confirm the decision persists after a refresh.
8. Run a fraud scan on a real test document; confirm the SSE progress stream shows real step-by-step checks, not an instant result.
9. Start a screening interview session end-to-end (mic/camera, a few Q&A turns, completion); confirm the report reflects the actual conversation.
10. **Deliberately trigger one failure case** before the client sees it live: e.g. upload a corrupted PDF and confirm you get a real error, not a fabricated answer. Do this in rehearsal, not live, unless you're confident it's fixed.
11. If demoing Command Center: confirm it's running against a live, reachable backend (check `/health` — once fixed to be real — immediately before); do **not** demo it if there's any doubt about backend stability, given the current silent-fallback bug (fix P0-2 first).
12. If demoing WhatsApp: confirm TLS + webhook registration succeeded in advance (§ T28) — don't attempt this live until P0-6 ships.
13. Check `/api/v1/observability/*` (or whatever internal trace view you use) for the session just run — confirm no unexpected errors were swallowed.
14. Log out / clear the session at the end to avoid leaving an authenticated browser tab open on a shared machine.

---

## 10. Client acceptance criteria

Before saying "this version is ready for the first client," all of the following must be true and independently verified (not just believed fixed):

- [ ] No unauthenticated access to any candidate, company, call, document, or fraud-scan data (T01–T04 pass).
- [ ] Google OAuth login issues a real, verifiable session/JWT (T05 passes).
- [ ] No fabricated/hardcoded result can be returned from any agent tool or Command Center call on backend failure — every failure path returns a real, visible error (T20–T24 pass).
- [ ] The Command Center password gate cannot be bypassed via hardcoded client-side strings (T25 passes).
- [ ] HTTPS is live on the deployment the client will use, with a valid certificate (T26–T27 pass).
- [ ] Upload filenames cannot escape the intended storage directory on any of the 4 upload endpoints (T10 passes).
- [ ] LLM-calling endpoints are rate-limited (T29 passes).
- [ ] The primary hiring, screening/interview, and fraud workflows complete successfully end-to-end on real data (T15, T34, T30 pass).
- [ ] Every feature actually shown to the client in the demo has zero client-side-only "success" states not backed by a real API call — bulk send, onboarding, KT-agent either hidden or clearly labeled Preview.
- [ ] README/marketing language matches actual implemented capability (P0-8 fixed) — no "RBAC"/"zero-trust" claims until real.
- [ ] CI actually runs on push (P1-1 fixed) — not required for demo safety, but required before calling this "client-ready" rather than "demo-ready."
- [ ] `.env_aws` (or its successor) is properly gitignored — no secret/config leak risk on the next commit.
- [ ] Known failure cases (corrupted upload, LLM timeout, document-not-ready query) all produce honest errors, not fabricated answers (T13, T31, T39 pass).

---

## 11. Expected client changes

**Before client (must happen now):** the 8 P0 items above — all security/fabrication fixes, no new features. Roughly 4-6 engineering days total if worked sequentially, less if parallelized (auth work and the fabrication-removal work don't block each other).

**First week (expect, don't need to prevent):**
- Configuration changes: CORS origin adjustments once the client's actual domain/IP is known; possibly a dedicated client-facing subdomain.
- Bug reports from real usage patterns the demo script didn't cover — expect 5-15 minor bugs, concentrated in the hiring/onboarding UI given its partial-mock nature.
- UX feedback on scoring/report terminology ("what does this score mean") — worth pre-empting with a short glossary (§13).
- A request to see or export data (audit trail, candidate history) — worth having a basic CSV/JSON export ready.

**First month:**
- Feature requests around the currently-mocked areas (real bulk email send, real onboarding provisioning) — these become genuine build decisions once there's real client demand signal, not before.
- Requests for role-based access within the client's own org (recruiter vs. hiring-manager vs. admin views) — this is a natural extension of P0-1's auth work, budget for it.
- Possible request for SSO/enterprise login instead of Google-only OAuth, if the client is a larger org.
- Accuracy questions on fraud/matching scores once the client has real volume — this is where the "zero eval anywhere" gap (fraud, resume-matching) will surface; worth having even a small labeled eval ready to discuss honestly.

**Major changes NOT expected/needed pre-client, testable now instead of guessed:**
- Multi-tenant data isolation done right (company-scoped queries, not just route-level auth) — can be deferred to a single-client pilot, but test explicitly (T03) so it's a known, bounded gap rather than a surprise.
- Horizontal scaling / Celery wiring — irrelevant at one-client pilot scale; don't build ahead of demand.
- IaC for the EC2 box — irrelevant until there's a second environment to keep in sync.

---

## 12. Final implementation plan

Ordered by dependency and priority — P0 items only listed here as engineering steps; P1+ deferred to a follow-up pass once P0 ships.

### STEP 1 — Auth: JWT issuance + route guard
**Task:** Add JWT/session issuance to `google_login`; add a `get_current_user` dependency; apply to every router in `main.py` except `/health`, `/docs`, OAuth callback.
**Files:** `backend/app/api/auth.py`, `backend/app/main.py`, new `backend/app/api/deps.py` (or similar) for the dependency.
**Why:** P0-1, P0-4 — the single highest-leverage fix; almost everything else is moot without it.
**Effort:** 1-2 days.
**Test:** T01-T08.

### STEP 2 — Remove fabricated fallbacks (4 locations)
**Task:** Replace silent fake-success fallbacks with real errors in `fraud_tools.py`, `hiring_tools.py`, `verification_tools.py`, and `CommandCenter.tsx`/`types.ts`.
**Files:** `backend/app/agent_tools/fraud_tools.py:81-92`, `hiring_tools.py:296-308`, `verification_tools.py:138-147`, `frontend/.../command-center/CommandCenter.tsx:46-88`, `types.ts:179-257`.
**Why:** P0-2 — the "trust bug" family; cheapest fix on this list relative to its severity.
**Effort:** 0.5 day.
**Test:** T20-T24.

### STEP 3 — Remove Command Center password bypass
**Task:** Delete `acceptedDemoPasswords` and its network-error fallback in `VoiceGateModal.tsx`; remove the "Default: admin123" hint text.
**Files:** `frontend/.../command-center/VoiceGateModal.tsx`.
**Why:** P0-3.
**Effort:** 1 hour.
**Test:** T25.

### STEP 4 — Upload filename sanitization + size cap
**Task:** Add `os.path.basename()` sanitization and a server-side size cap to all 4 upload endpoints.
**Files:** `backend/app/api/upload.py`, `fraud.py`, `hiring.py`, `telephonic.py`.
**Why:** P0-5.
**Effort:** 2 hours.
**Test:** T09-T14.

### STEP 5 — Rate limiting on LLM-calling endpoints
**Task:** Add `slowapi` (or nginx `limit_req`) to RAG/fraud/screening/telephonic/agent routers.
**Files:** `backend/app/main.py`, `requirements.txt`, `nginx/policy.conf`.
**Why:** P0-7.
**Effort:** 0.5 day.
**Test:** T29.

### STEP 6 — TLS
**Task:** Provision a cert (certbot/Let's Encrypt against the EC2 IP or a domain), add a 443 `server` block to nginx, redirect 80→443.
**Files:** `nginx/policy.conf`, `docker-compose.yml` (cert volume mount), EC2 security group (already has 443 open per prior audit).
**Why:** P0-6 — also unblocks WhatsApp.
**Effort:** 0.5-1 day (longer if DNS/domain setup is needed).
**Test:** T26-T28.

### STEP 7 — README correction
**Task:** Remove/rewrite the "RBAC"/"zero-trust surface" claims; align with the existing "Honest Status" section's tone.
**Files:** `apps/AI-Policy-Rule-Engine/README.md:54,61-63`.
**Why:** P0-8 — free credibility fix, do alongside Step 1 once real auth exists (or immediately, as an honest "in progress" note, if done before Step 1 ships).
**Effort:** 10 minutes.
**Test:** Manual re-read against current code.

### STEP 8 — Pre-demo hide/relabel pass
**Task:** Add "Preview" badges (or hide entirely) on: Onboarding portal, Bulk Send, Onboarding Agent, Knowledge Transfer Agent buttons in the hiring UI.
**Files:** `frontend/.../onboarding/page.tsx`, `frontend/.../hiring-automation/page.tsx`.
**Why:** §6 — cheapest way to eliminate the "materially misleading output" risk from these specific UI elements without new engineering.
**Effort:** 2-3 hours.
**Test:** T17-T19, manual UI walkthrough.

### STEP 9 — Health checks
**Task:** Make `/health` actually ping Postgres/Redis/Pinecone with a short timeout and reflect real status.
**Files:** `backend/app/main.py:230-233`.
**Why:** P1-4, but cheap enough to bundle with the P0 pass — also makes Step 6's Docker `depends_on: condition: service_healthy` chains actually meaningful.
**Effort:** 0.5 day.
**Test:** T48-T49.

### STEP 10 — Full regression pass
**Task:** Run the full test matrix (§8) end-to-end against the fixed deployment.
**Files:** N/A (testing pass).
**Why:** Confirms all acceptance criteria (§10) before client contact.
**Effort:** 1 day.
**Test:** All of §8.

**Total estimated effort: ~6-8 engineering days** for the full P0 pass through Step 10, assuming one engineer working sequentially; less with any parallelization (Steps 2-4 are independent of Step 1 and each other).

---

## 13. Readiness scores (separate dimensions, not one number)

| Dimension | Score (1-10) | Note |
|---|---|---|
| 1. Core functionality | 7 | RAG, fraud core, screening/interview are genuinely strong; hiring pipeline is real through scoring, fake past that; Command Center's happy path is real but its failure path lies. |
| 2. Security | 2 | No auth anywhere, no TLS, no rate limiting, a fake security gate, path traversal — this is the actual blocker. |
| 3. Reliability | 6 | Resilience/circuit-breaker layer is genuinely well-built where it's used; undermined by fabricated fallbacks that hide real failures instead of degrading honestly. |
| 4. AI quality/evaluation | 3 | RAG has one 3-week-stale 9-question eval; fraud and resume-matching have zero evaluation anywhere. The engineering (CRAG/ARAG/hybrid) is real; the *measured* quality is not. |
| 5. Deployment | 4 | Live, running, Docker-composed — real, not vaporware. But single under-provisioned box, no IaC, no TLS, CI that never runs. |
| 6. Observability | 6 | Genuine request-level tracing (Langfuse + query_traces) is real and useful; undermined by having no auth on the endpoints that expose it. |
| 7. UX | 5 | Screening/interview UX is honest and well-designed with real error states. Hiring/onboarding UX actively misleads (fake "Delivered," fake calendar, zero-persistence portal presented as functional). |
| 8. Documentation | 4 | Excellent internal dated-audit discipline (rare and valuable) — but nothing written for a client audience, and one README section actively overclaims. |
| 9. Client readiness (today) | 2 | Not ready — the P0 list is a hard blocker, not polish. |
| 10. Enterprise readiness | 2 | Correctly out of scope per this audit's own rules — single-tenant pilot readiness is the right target, not enterprise scale, and that's fine. |

---

## Final questions

**A. What should I fix before the first client?**
The 8 P0 items in §3: auth enforcement, the 4-location fabricated-fallback pattern, the fake Command Center password gate, live cross-candidate exposure, upload path traversal, TLS, rate limiting, and the README's RBAC overclaim. Roughly 6-8 engineering days.

**B. What should I remove instead of building?**
The `DEMO_RESULTS`/`DEMO_PLAN` silent substitution logic, the hardcoded password list, and the three fabricated-fallback code blocks — all deletions, not builds. Also: don't build real backend persistence for Onboarding/Bulk-Send/KT-Agent yet — hide or relabel them instead (§6, §8 Step 8) until there's real client demand for those specific features.

**C. What should I test before the first client?**
The full §8 matrix, especially every P0-tagged row — auth boundaries (T01-T06), fabrication paths (T20-T24), TLS (T26-T28), upload safety (T09-T13), and the three primary workflows end-to-end (T15, T30, T34). Run the §9 pre-demo checklist in full immediately before the actual client session, on the actual deployment target.

**D. What can safely wait until after the pilot?**
Multi-tenant query scoping beyond route-level auth, Celery/horizontal scaling, IaC, migrations completeness for every table, real backend persistence for the currently-mocked hiring/onboarding features, SSO, and any deeper eval-driven accuracy work beyond having an honest baseline. All P2/P3 items in §5.

**E. What changes are most likely to be requested by the client?**
Real email/notification sending for bulk-send once they see the Preview label and ask "when is this real," role-based access within their own org, a data export, and — once they have volume — questions about fraud/matching accuracy that the current zero-eval state can't answer with numbers.

**F. What can I do NOW to prevent those major client changes?**
Ship auth with company/user scoping from the start (not just a route guard) so RBAC is a incremental extension, not a rewrite, when requested. Label the mocked features honestly now so "when is this real" becomes a scoped feature conversation, not a trust incident. Run even a small (20-30 example) labeled eval for fraud/resume-matching now, so accuracy questions have a real, defensible answer instead of silence.

**G. What should I absolutely NOT spend time building right now?**
Enterprise-scale infrastructure (Kubernetes, multi-region, IaC), Celery/queue-based scaling, SSO/enterprise identity, a general-purpose agent-memory-aware planner, or any new AI features. The AI engineering is already ahead of the production hardening — don't widen that gap further before the P0 list is closed.
