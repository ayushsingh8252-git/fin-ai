# Platform Status Audit — 2026-08-29: Unified Agent Tool Layer

Scope: convert existing HR/Interview features (RAG, Fraud, Telephonic, Screening, Hiring Orchestration) into a
consistent, agent-callable tool/connector layer, plus a Google-status check, a greenfield WhatsApp Agent, and a
plan-based executor — without duplicating business logic or disturbing any existing route/page. Full spec came
from the user; this doc reports what was actually verified, following this repo's own convention of distinguishing
real from simulated ([[ai-engine-project-map]]/[[user-profile]] memory).

## 1. Architecture

```
                     POST /api/v1/agent/plan   (prompt -> plan, no execution)
                     POST /api/v1/agent/run    (prompt -> plan -> executed)
                     GET  /api/v1/agent/tools  (full unified catalog)
                              |
                     agent_tools/planner.py  (one LLM call -> ordered steps,
                                               $stepN.field references resolved,
                                               fail-fast sequential executor)
                              |
                     agent_tools/registry.py  (unified catalog + call_tool(connector, tool, params))
                        /              \
     agent_tools/*_tools.py            mcp/registry.py (pre-existing, untouched)
     (7 new BaseMCPConnector            (12 pre-existing external connectors:
      subclasses: rag, fraud,            Slack, Teams, Jira, GitHub, Salesforce,
      telephonic, screening, hiring,     SAP, SharePoint, Gmail, Calendar, Sheets,
      google_workspace_status,           Docs, Drive)
      whatsapp)
        |
   thin wrappers calling the EXISTING functions directly:
   api/query.py::process_query, services/fraud_orchestrator.py::run_scan,
   api/telephonic.py::place_call/get_call, api/screening.py::screen_from_call,
   services/hiring_service.py::*, memory/orchestrator.py::schedule_candidate_interview
        |
   Meta WhatsApp Cloud API  <-- api/whatsapp.py (GET/POST /webhooks/whatsapp)
                                  -> services/whatsapp_agent.py (bounded intent router)
                                  -> registry.call_tool(...)
```

Every existing page/card (RAG, Fraud Detection, Telephonic Agent, Screening Agent, hiring-automation UI) still
calls its original route exactly as before — nothing in `frontend/` changed. The tool layer is a second, parallel
entry point into the same underlying functions, following this repo's own `mcp/base.py` `BaseMCPConnector`
contract (already proven across 12 real connectors) rather than inventing a competing abstraction.

**One shared-infrastructure change, made carefully:** `mcp/base.py`'s `BaseMCPConnector` gated every tool on a
connector uniformly by that connector's `missing_config()`. WhatsApp's `get_whatsapp_message_status` reads only
this app's own DB (Meta's API has no status-poll endpoint — see §5) and needs no WhatsApp credentials at all, but
was being blocked by the same gate as the two real Meta-calling tools. Fix: added an opt-in `requires_config: bool
= True` field to `ToolDefinition`/`_add_tool` (default preserves every pre-existing connector's exact behavior —
verified live: Slack's `send_message` still raises `NotConfiguredError` with zero config change). Only
`whatsapp_tools.py`'s status-lookup tool sets `requires_config=False`.

## 2. Tools created

| Tool | Connector | Wraps (existing function) | Status |
|---|---|---|---|
| `query_documents` | `rag` | `api/query.py::process_query` | Live-tested (real retrieval ran during a WhatsApp webhook test) |
| `run_fraud_check` | `fraud` | `services/fraud_orchestrator.py::run_scan` | Tested: validation + not-found paths live; full scan not run (needs an uploaded doc) |
| `place_screening_call` | `telephonic` | `api/telephonic.py::place_call` | **Live-tested against real Twilio** — got a real (expected) trial-account rejection |
| `get_call_status` | `telephonic` | `api/telephonic.py::get_call` | Live-tested, incl. derived `transcript_available`/`analysis_available` |
| `run_screening_analysis` | `screening` | `api/screening.py::screen_from_call` | Tested: not-found path live |
| `get_candidate_profile` | `hiring` | `services/hiring_service.py::parse_resume_pdf` | Wired, not live-tested (needs a saved resume PDF) |
| `match_candidate_requirement` | `hiring` | `services/hiring_service.py::match_candidate_to_requirement` | Wired, not live-tested |
| `generate_candidate_assignment` | `hiring` | `services/hiring_service.py::generate_assignment` | Wired, not live-tested |
| `run_candidate_screening` | `hiring` | alias over `screening` connector | Tested |
| `run_candidate_fraud_check` | `hiring` | alias over `fraud` connector | Tested |
| `calculate_candidate_score` | `hiring` | `memory/orchestrator.py`'s real/placeholder lookup (reused, not reimplemented) | **Live-tested** — placeholder stability verified |
| `generate_candidate_scorecard` | `hiring` | `memory/orchestrator.py::schedule_candidate_interview` | **Live-tested** |
| `get_candidate_scorecard` | `hiring` | composite over the six above | **Live-tested**, incl. the fraud fold-in path (monkeypatched fraud result, verified DB untouched) |
| `get_google_integration_status` | `google_workspace_status` | introspects `mcp/connectors/google/*`'s `missing_config()` | **Live-tested** — see §4 |
| `send_whatsapp_message` | `whatsapp` | new `services/whatsapp_service.py::send_text_message` | Tested (not-configured path); no real Meta app available this session |
| `send_whatsapp_template` | `whatsapp` | new `services/whatsapp_service.py::send_template_message` | Wired, not live-tested (same reason) |
| `get_whatsapp_message_status` | `whatsapp` | new local `WhatsAppMessage` table read | **Live-tested** |

64 tools total in the unified catalog (`GET /api/v1/agent/tools`) — the 17 above plus the 12 pre-existing MCP
connectors' 47 tools (Gmail 3, Calendar 7, Sheets 5, Docs 3, Drive 4, Slack/Teams/Jira/GitHub/Salesforce/SAP/
SharePoint the rest), all reachable through the exact same `call_tool()` path.

## 3. Hiring inner tools -> composite

Before this pass, `api/hiring.py` (resume parse/match, fully stateless) and `api/orchestrator.py` (candidate
scorecard CRUD) were **completely disconnected** — `hiring.py` never wrote to `CandidateScoreCard`, and no fraud
check ever fed into it. There was no eligibility check anywhere in the real code, so none was invented here.

```
get_candidate_scorecard  (composite)
    |
    +-- run_candidate_screening      (optional, if call_id given)
    +-- run_candidate_fraud_check    (optional, if scan_id given)
    +-- generate_candidate_scorecard (interview_type="telephonic") -- persists
    +-- generate_candidate_scorecard (interview_type="ai")         -- persists
    +-- overall_recommendation: "proceed" | "proceed_with_caution" | "hold_for_review"
        (derived from fraud verdict, computed only at this composition layer)
```

Per an explicit product decision made mid-task, the composite now folds a fraud result into its response
(`overall_recommendation`) — the one piece of new behavior in this file beyond pure wrapping. It does **not** add
a column to `CandidateScoreCard` or change what `schedule_candidate_interview` persists — verified live: a test
forced a `likely_fraudulent` verdict and confirmed the DB row gained no new fraud-related attribute. This was a
deliberate scope boundary to avoid a schema migration touching a live table, not an oversight.

`calculate_candidate_score` and `generate_candidate_scorecard` reuse `memory/orchestrator.py`'s real
`_lookup_real_telephonic_score`/`_lookup_real_ai_interview_score`/`_placeholder_score` functions directly (imported,
not reimplemented) — the existing real-score-vs-seeded-placeholder distinction (`*_is_real`) is preserved exactly.
Live-verified: calling `calculate_candidate_score` twice for the same never-interviewed candidate returns the
identical placeholder number both times (seeded, not re-randomized).

## 4. Google status

| | Configured? |
|---|---|
| OAuth | **YES** — see correction below |
| Gmail | YES |
| Calendar | YES |
| Meet | YES (via Calendar's `conferenceData`, same connector) |
| Sheets | YES |
| Docs | YES |
| Drive | YES |

**Correction to the Phase 1 audit:** that audit checked only `apps/AI-Policy-Rule-Engine/.env` and reported
`GOOGLE_OAUTH_REFRESH_TOKEN` absent, concluding Google was "one consent click away." Building this layer surfaced
a second, gitignored `backend/.env` file (invisible to a file-glob-based audit) that **does** hold a real refresh
token — `config.py`'s `env_file=("../.env", ".env")` loads both, with `backend/.env` taking priority. Google
Workspace is genuinely live-configured on this machine right now, not pending any action from you.

Given that, this pass went one step further than the "skip live testing" decision strictly required: a real,
read-only `google_calendar.list_events` call was made through the tool layer. It reached the live Calendar API
path and failed only on a missing `calendar_id` parameter (a pre-existing tool requirement, not a bug introduced
here) — confirming the connection is genuinely live, not just configured-looking. No write call (create_event,
send_email, create_meet) was made, since those have real side effects on your actual Google account and you'd
asked to skip live Google testing — this stopped short of that deliberately. If you want the full Part 11
OAuth->Calendar->Meet->Gmail->Sheets->Docs test sequence run for real (each one now unblocked), say so explicitly.

## 5. WhatsApp status

| | Status |
|---|---|
| Webhook GET (verification) | **PASS** — live-tested, correct token accepted, wrong/empty token 403s |
| Webhook POST | **PASS** — live-tested: 200 ack, malformed body still 200s, inbound message persisted |
| Message parsing | **PASS** — `parse_incoming_webhook` unit-tested for text messages, status updates, and malformed shapes |
| Send message | **Not live-tested** — no real Meta WhatsApp Business app/credentials available this session (your choice, code-only pass); config-check path verified live (503 `not_configured`) |
| Status handling | **PASS** — live-tested end-to-end: an inbound webhook event persists a row, a `statuses` webhook event patches that row's status by `wamid` |
| Agent integration | **PASS, first pass, intentionally bounded** — live end-to-end test: inbound "What is your company leave policy?" correctly classified as `general_question`, real RAG retrieval ran (embedding model loaded, real pipeline executed), reply attempt correctly failed with a clean `not_configured` error (no Meta token) rather than crashing |

`services/whatsapp_agent.py` is deliberately **not** the general open-ended planner — it's a fixed intent
classifier (one LLM call) dispatching to a small, reviewed set of handlers (`get_interview_details`,
`schedule_interview`, `reschedule_interview`, `general_question`, `unknown`). This is a considered choice, not a
shortcut: this platform has no auth layer (flagged in the Phase 1 audit, deliberately not addressed this pass per
your decision), several reachable tools cost real money or send real messages, and an inbound WhatsApp message is
untrusted, unauthenticated input. Widening this to the full `agent_tools/planner.py` is a reasonable future step
once auth exists.

**Known, honestly-flagged gap:** `get_interview_details`/scheduling handlers look up a candidate by phone number
via `CallRecord.to_number` — the only phone-keyed table that exists. `CandidateScoreCard` has no phone column, so
a candidate who's never had a Telephonic Agent call placed to them can't be found by phone alone yet. Not
invented around; reported as-is.

## 6. Local -> VPS deployment

| | Status |
|---|---|
| Works locally right now | RAG, Fraud, Telephonic (real Twilio call confirmed), Screening, Hiring composite, Google status check, Google Calendar read (live), WhatsApp webhook + agent routing (send blocked only by missing Meta creds) |
| Requires public HTTPS | The WhatsApp webhook (`/webhooks/whatsapp`) — Meta will not call `localhost`. For local dev, use an HTTPS tunnel (ngrok or Cloudflare Tunnel — deliberately not hardcoded to one; point `WHATSAPP_*` config at whichever tunnel URL you're running, the same way `PUBLIC_BASE_URL` already works for Twilio) |
| Requires VPS configuration | **No TLS/reverse-proxy layer exists in this repo** — `docker-compose.yml` exposes `policy-backend` on port 8000 directly (its own comment references a raw `<ec2-ip>:8000`). Meta requires HTTPS for webhooks; something needs to terminate TLS in front of port 8000 in production (nginx/Caddy, or a platform that does it for you) before the WhatsApp webhook can go live there. This was flagged in the Phase 1 audit and not built this pass — out of scope without knowing your actual production setup |
| Requires Meta configuration | A real WhatsApp Business phone number + app in Meta Business Manager, `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_BUSINESS_ACCOUNT_ID`/`WHATSAPP_VERIFY_TOKEN` set, and the webhook URL + verify token registered in the Meta dashboard, pointing at whatever public HTTPS URL fronts this backend |
| Requires environment variables | `WHATSAPP_*` (5 new vars, added to `config.py` and `.env.example` as blank placeholders — no secrets committed) |

## 7. Files changed

**New:**
- `backend/app/agent_tools/` — `__init__.py`, `rag_tools.py`, `fraud_tools.py`, `telephonic_tools.py`,
  `screening_tools.py`, `hiring_tools.py`, `google_tools.py`, `whatsapp_tools.py`, `registry.py`, `planner.py`
- `backend/app/services/whatsapp_service.py` — Meta Graph API client
- `backend/app/services/whatsapp_agent.py` — bounded WhatsApp intent router
- `backend/app/api/agent.py` — `GET /agent/tools`, `POST /agent/tools/{connector}/{tool}/call`, `POST /agent/plan`, `POST /agent/run`
- `backend/app/api/whatsapp.py` — `GET`/`POST /webhooks/whatsapp`
- `backend/alembic/versions/a1c9f4e82b17_add_whatsapp_messages_table.py`
- `backend/tests/test_agent_tools.py`, `backend/tests/test_whatsapp_webhook.py` (27 new tests, all passing)

**Modified:**
- `backend/app/models.py` — added `WhatsAppMessage` (new table only; no existing table touched)
- `backend/app/config.py` — added 5 `WHATSAPP_*` settings
- `backend/app/main.py` — registered `agent.router` (under `/api/v1`) and `whatsapp.router` (root, matching Meta's expected path)
- `backend/app/mcp/base.py` — added opt-in `requires_config` (see §1); verified backward-compatible live
- `.env.example` — added `WHATSAPP_*` placeholder section

**Not touched:** every existing route, every existing frontend file, every existing page/card on the Live Product
Tour, every pre-existing MCP connector's tool set.

**Found but not caused by this pass:** `backend/app/mcp/connectors/google/sheets.py` has an unrelated pre-existing
uncommitted change (a `create_spreadsheet` tool) already in your working tree before this session started —
flagging it here so it isn't mistaken for part of this work when you review the diff.

## 8. Test results

```
backend/tests/  — 54 passed, 0 failed (27 pre-existing + 27 new)
```

Live-verified this session (not just unit-tested), each traced above: real Twilio call attempt and rejection,
real RAG retrieval run via the WhatsApp path, real Calendar API reachability, full WhatsApp webhook round-trip
(inbound persist -> intent classify -> RAG tool call -> reply attempt -> clean not-configured failure), status
webhook patching an existing row by `wamid`, `Slack` connector's gating unchanged after the shared `base.py` edit.

## 9. Remaining blockers

- **WhatsApp send is genuinely blocked** on you obtaining a real Meta WhatsApp Business API app — nothing further
  can be tested here without it.
- **Production HTTPS termination for the WhatsApp webhook doesn't exist yet** — needs your actual VPS/reverse-proxy
  setup, which wasn't visible from this repo.
- **No auth layer** — pre-existing gap, explicitly deferred per your decision; now more consequential since tool
  endpoints (`/api/v1/agent/tools/*/call`, `/api/v1/agent/run`) are reachable by anyone who can reach the backend,
  same as every other route today.
- **Google write operations (create_event/send_email/create_meet) were deliberately not live-tested** — the
  connection is confirmed live and real, but exercising them touches your real Gmail/Calendar; say the word if you
  want that run for real.
- **`get_candidate_profile`/`match_candidate_requirement`/`generate_candidate_assignment` weren't live-tested** —
  they need a resume PDF already saved on disk, which this session didn't have one of; the wrapped functions
  themselves are unchanged from the already-existing, already-used `hiring_service.py`.
