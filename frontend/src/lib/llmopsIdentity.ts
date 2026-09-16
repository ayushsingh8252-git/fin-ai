import { loadStoredSession } from "./auth";

// Best-effort caller identity sent to the backend purely for Langfuse
// session/user tagging (see backend/app/services/llmops_identity.py) — this
// app enforces no authentication anywhere, so these headers are never used
// for access control, only for grouping traces in observability dashboards.

const SESSION_KEY = "agenticflow:llmops-session-id";
const ANON_USER_KEY = "agenticflow:llmops-anon-id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getOrCreate(storage: Storage, key: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const created = randomId();
  storage.setItem(key, created);
  return created;
}

/** One id per browser tab session — groups every RAG/fraud/interview/
 * screening/telephonic action taken in this tab into one Langfuse session. */
export function getLlmopsSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return getOrCreate(window.sessionStorage, SESSION_KEY);
}

/** The signed-in user's email if this browser already knows one (see
 * src/lib/auth.ts), else a persistent anonymous id — real identity when
 * available, a stable per-browser fallback otherwise. */
export function getLlmopsUserId(): string | null {
  if (typeof window === "undefined") return null;
  const session = loadStoredSession();
  if (session?.user?.email) return session.user.email;
  return `anon:${getOrCreate(window.localStorage, ANON_USER_KEY)}`;
}

/** Spread into a fetch()'s headers for any LLM-backed request. */
export function getLlmopsHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const sessionId = getLlmopsSessionId();
  const userId = getLlmopsUserId();
  if (sessionId) headers["X-Session-Id"] = sessionId;
  if (userId) headers["X-User-Id"] = userId;
  return headers;
}
