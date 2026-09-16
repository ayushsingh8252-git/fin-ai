export interface AuthUser {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface StoredSession {
  user: AuthUser;
  uniqueUserCount: number;
  accessToken: string;
}

const STORAGE_KEY = "agenticflow:auth-session";

export function loadStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.user?.email || !parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Every authenticated fetch() call site spreads this into its headers, the
 * same way the existing getLlmopsHeaders() pattern works — see
 * lib/llmopsIdentity.ts. Returns {} when signed out, so a spread is always
 * safe even before sign-in (the backend will 401 on protected routes either
 * way, this just avoids sending a bogus "Authorization: Bearer null"). */
export function getAuthHeaders(): Record<string, string> {
  const session = loadStoredSession();
  return session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

export function saveStoredSession(session: StoredSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}
