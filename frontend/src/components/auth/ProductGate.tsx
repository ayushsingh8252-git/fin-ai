"use client";

import { motion } from "framer-motion";
import { Loader2, ShieldCheck, Users, Settings2 } from "lucide-react";
import { AUTH_GATE_ENABLED, useAuth } from "@/contexts/AuthContext";
import GoogleSignInButton from "./GoogleSignInButton";

/** Wraps every product route — nothing behind it renders until the visitor
 * has signed in with Google. Presented as a popup dialog (dim backdrop, card
 * pops in) rather than a plain page, and is the single place sign-in lives —
 * the site header carries no sign-in control of its own.
 * Gating is currently switched off via AUTH_GATE_ENABLED (see AuthContext). */
import { usePathname } from "next/navigation";

export default function ProductGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, uniqueUserCount, errorMessage, notConfigured } = useAuth();

  if (!AUTH_GATE_ENABLED || status === "signed-in" || pathname?.startsWith("/command-center")) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-blue-950 flex items-center justify-center px-6 py-20">
      <motion.div
        key="signin-popup"
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="w-full max-w-sm text-center bg-white rounded-3xl shadow-2xl border border-white/10 px-8 py-10"
      >
        <div className="mx-auto mb-5 w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-extrabold text-zinc-900 mb-2">Sign in to try this product</h1>
        <p className="text-sm text-zinc-500 mb-6 leading-relaxed">
          A quick Google sign-in unlocks the live demo — no forms, no password.
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
            <GoogleSignInButton size="large" shape="pill" />
          </div>
        )}

        {!notConfigured && errorMessage && (
          <p className="mt-4 text-xs text-red-500">{errorMessage}</p>
        )}

        {uniqueUserCount !== null && (
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
            <Users className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-bold text-zinc-600">{uniqueUserCount.toLocaleString()}</span>{" "}
            unique {uniqueUserCount === 1 ? "person has" : "people have"} tested this platform
          </p>
        )}
      </motion.div>
    </div>
  );
}
