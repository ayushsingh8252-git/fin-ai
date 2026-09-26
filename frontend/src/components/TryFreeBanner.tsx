"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "agenticflow:try-free-dismissed";

const TRY = [
  { href: "/recruitment", label: "Upload resumes and screen candidates" },
  { href: "/command-center", label: "Plan an HR task with AI" },
  { href: "/fraud-detection", label: "Check a document for fraud" },
];

/** In-app "Try all features free" strip for external testers. Only claims
 * what is true: testing is free, and these links go to working features.
 * Dismissal is a per-browser convenience (storage may be unavailable). */
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
let dismissedThisSession = false;
const readDismissed = () => {
  if (dismissedThisSession) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

export function TryFreeBanner() {
  // Server render (and hydration) assume "dismissed" so the banner never
  // flashes and then disappears, and server/client markup always match.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  if (dismissed) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-zinc-900">
          <Sparkles className="h-4 w-4 text-blue-600" /> Try all features free
        </span>
        <span className="hidden text-xs text-zinc-500 sm:inline">Free to test · no credit card</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {TRY.map((t) => (
            <Link key={t.href} href={t.href} className="text-[13px] font-medium text-blue-700 hover:underline">
              {t.label}
            </Link>
          ))}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          dismissedThisSession = true;
          try {
            window.localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* storage unavailable — hides for this view only */
          }
          listeners.forEach((l) => l());
        }}
        aria-label="Dismiss"
        className="self-end rounded p-1 text-zinc-400 hover:bg-white hover:text-zinc-700 sm:self-auto cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
