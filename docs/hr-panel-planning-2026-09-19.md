# HR Panel Planning: Context Notes (2026-09-19)

Research only. No code was written. These notes capture what already exists in `apps/AI-Policy-Rule-Engine` so the new HR panel can build on it instead of duplicating it. The panel itself is greenfield at the data layer: no real, persisted employee/HR data model exists today.

Related: `client-readiness-audit-2026-09-16.md` (current app status, auth, fabrication issues).

## What already exists to build on

**Frontend: `frontend/src/app/(products)/onboarding/page.tsx` (930 lines)**
- Already has an HR / Manager / Employee three-portal switcher, employee list, document sharing, repo-access grants, and manager hierarchy.
- Per the 2026-09-16 client-readiness audit it is 100% client-side theater: fictional seed data, no backend persistence except 2 document-upload calls, all state lost on refresh.
- It is the closest existing analog to the HR panel. Decide whether to replace or extend it before starting.

**Backend models that map onto HR concepts (not yet populated with real employee data)**
- `Role`: job postings (`title`, `department`, `jd_text`, `must_have_skills`). These are job roles, not user roles.
- `OnboardingSOP`: onboarding checklists keyed by topic (`equipment`, `accounts`, `first_week`) with `title` and `steps`.
- `GraphNode` / `GraphEdge`: generic entity graph already typed for candidate / role / team / project with relations like `MEMBER_OF` and `SCREENED_FOR`. Extensible to employee / department / manager.
- No `department`, `payroll`, `leave`, `attendance`, or `headcount` concept exists in the backend models or services. "department" appears only as a free-text field on `Role`.

**Hiring to onboarding hand-off: `frontend/src/lib/hiringSync.ts`**
- Client-side only (`sessionStorage` via `useSyncExternalStore`). Hired candidates from the Agentic Hiring Pipeline appear in the onboarding portal as `source: "Agentic Hiring Pipeline"`. Not persisted.

**Auth: `backend/app/api/auth.py`, `backend/app/api/deps.py`**
- Real JWT auth is live as of 2026-09-17 (Google Sign-In, then JWT, enforced via `Depends(get_current_user)` on almost every router in `main.py`).
- There is no RBAC. `User` has no role field. The HR vs manager vs employee split exists only client-side in `onboarding/page.tsx`. A real HR panel needs a server-side role concept added first.

**MCP connector framework: `backend/app/mcp/`**
- Already wraps Slack, Teams, Jira, GitHub, Salesforce, SAP, SharePoint, and Google Workspace. Real account/repo provisioning from the HR panel can plug into these instead of new integrations. `GET /api/v1/mcp/connectors` reports each as configured / not_configured.

**Memory layer: `backend/app/memory/orchestrator.py`, `global_memory.py`**
- `GET /api/v1/orchestrator/context/{subject_id}` unifies session state across the Screening and Telephonic agents. Nothing else writes to it today.
- `global_memory.py` stores roles / JDs / company policy / onboarding SOPs.

## Structural notes

- `apps/AI-Policy-Rule-Engine` is its own nested git repo, separate from the `ai_engine` monorepo root. Commit HR work there, not only at the root.
- `apps/AI-Policy-Rule-Engine/hiring-automation/` is a near-duplicate of the standalone root-level `apps/hiring-automation`. It is unclear which is canonical. Resolve this before the HR panel assumes one.
- The root `docker-compose.yml` wires all apps behind one nginx. The HR module can extend `policy-backend` / `policy-frontend` or become a fourth service.
- Alembic only covers the original `documents` / `chunks` / `rules` tables. Every later table relies on `create_all()` at startup, so new HR tables need a migration decision.

## Suggested starting points when implementation begins

1. Decide replace vs. extend for `onboarding/page.tsx`.
2. Add a server-side user role (RBAC) first. It blocks any real HR-vs-employee permission split.
3. Use `Role`, `OnboardingSOP`, and the graph models as schema starting points, and add an `Employee` entity backed by the DB.
4. Build new routes on `Depends(get_current_user)`.
5. Wire real provisioning through the MCP connectors, and label anything still simulated instead of faking success. The audit flags fabricated fallbacks as the app's biggest credibility risk.
