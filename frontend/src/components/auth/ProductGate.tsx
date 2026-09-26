"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { Loader2, Settings2, Zap } from "lucide-react";
import { AUTH_GATE_ENABLED, useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "./GoogleSignInButton";

/** Wraps every product route — nothing behind it renders until the visitor
 * has signed in with Google. A plain, standard sign-in card (no demo/marketing
 * copy or vanity stats — this gates a real production app, not a live demo),
 * and the single place sign-in lives — the site header carries no sign-in
 * control of its own.
 *
 * Command Center used to carve itself out of this gate entirely (it had its
 * own separate password modal instead). That carve-out is removed: Command
 * Center calls real, now-backend-authenticated agent-tool APIs like every
 * other product, so it needs the same real sign-in wall as everything else —
 * its password modal is a second factor on top of this, not a replacement
 * for it.
 *
 * /screening-agent/session/[sessionId] keeps its own, narrower carve-out:
 * that's the page an external candidate lands on from an emailed interview
 * invite link. They were never a signed-in platform user and must not be
 * forced through Google sign-in just to open their interview — the long
 * random session_id in the URL is that page's real access control (see
 * api/screening.py's module docstring on the backend side). */
export default function ProductGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, errorMessage, notConfigured } = useAuth();

  if (!AUTH_GATE_ENABLED || status === "signed-in" || pathname?.startsWith("/screening-agent/session/")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-6 py-20">
      <motion.div
        key="signin-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-sm text-center bg-white rounded-2xl shadow-sm border border-zinc-200 px-8 py-10"
      >
        <div className="mx-auto mb-5 w-11 h-11 rounded-xl bg-zinc-900 flex items-center justify-center text-white">
          <Zap className="w-5 h-5" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 mb-1.5">Sign in to continue</h1>
        <p className="text-sm text-zinc-500 mb-7 leading-relaxed">
          Use your Google account to access AgenticFlow AI.
        </p>

        {notConfigured ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
            <Settings2 className="w-4 h-4 shrink-0 text-zinc-400" />
            Google sign-in is being set up — check back shortly.
          </div>
        ) : status === "loading" ? (
          <div className="flex items-center justify-center gap-2 text-sm text-zinc-400 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex justify-center">
            <GoogleSignInButton size="large" shape="rectangular" />
          </div>
        )}

        {!notConfigured && errorMessage && (
          <p className="mt-4 text-xs text-red-500">{errorMessage}</p>
        )}
      </motion.div>
    </div>
  );
}
