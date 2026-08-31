"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  type AuthUser,
} from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

// Single kill switch for the whole login feature — flip back to true to
// re-enable the sign-in popup and header bar with no other code changes.
// Nothing else in the auth code path is removed while this is off.
export const AUTH_GATE_ENABLED = false;

const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  uniqueUserCount: number | null;
  /** A failed sign-in attempt — surfaced next to the button, cleared on retry. */
  errorMessage: string | null;
  /** True when NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing — a setup issue, not a user-facing error. */
  notConfigured: boolean;
  gsiReady: boolean;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Loads the Google Identity Services script exactly once, however many components ask for it. */
function loadGsiScript(onReady: () => void) {
  if (typeof window === "undefined") return;
  if (window.google?.accounts?.id) {
    onReady();
    return;
  }
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_SRC}"]`);
  if (existing) {
    existing.addEventListener("load", onReady, { once: true });
    return;
  }
  const script = document.createElement("script");
  script.src = GSI_SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  script.onload = onReady;
  document.head.appendChild(script);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [uniqueUserCount, setUniqueUserCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gsiReady, setGsiReady] = useState(false);
  const notConfigured = !GOOGLE_CLIENT_ID;
  const initializedRef = useRef(false);

  const applySession = useCallback((nextUser: AuthUser, nextCount: number) => {
    setUser(nextUser);
    setUniqueUserCount(nextCount);
    setStatus("signed-in");
    saveStoredSession({ user: nextUser, uniqueUserCount: nextCount });
  }, []);

  const handleCredentialResponse = useCallback(
    async (response: { credential: string }) => {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: response.credential }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Sign-in failed (${res.status})`);
        }
        const data = await res.json();
        applySession(data.user, data.unique_user_count);
      } catch (err) {
        console.error("Google sign-in failed", err);
        setStatus("signed-out");
        setErrorMessage(
          err instanceof Error ? err.message : "Sign-in failed. Please try again.",
        );
      }
    },
    [applySession],
  );

  // Restore whatever was signed in last session immediately (so gated pages
  // don't flash a sign-in screen on every navigation), then quietly refresh
  // the tester count in the background — it changes as other people sign in.
  useEffect(() => {
    const stored = loadStoredSession();
    if (stored) {
      setUser(stored.user);
      setUniqueUserCount(stored.uniqueUserCount);
      setStatus("signed-in");
      fetch(`${API_URL}/api/v1/auth/stats`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.unique_user_count != null) setUniqueUserCount(data.unique_user_count);
        })
        .catch(() => {});
    } else {
      setStatus("signed-out");
    }
  }, []);

  useEffect(() => {
    if (notConfigured) return;
    loadGsiScript(() => {
      setGsiReady(true);
      if (initializedRef.current || !window.google) return;
      initializedRef.current = true;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
    });
  }, [handleCredentialResponse, notConfigured]);

  const signOut = useCallback(() => {
    window.google?.accounts.id.disableAutoSelect();
    clearStoredSession();
    setUser(null);
    setUniqueUserCount(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, uniqueUserCount, errorMessage, notConfigured, gsiReady, signOut }),
    [status, user, uniqueUserCount, errorMessage, notConfigured, gsiReady, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
