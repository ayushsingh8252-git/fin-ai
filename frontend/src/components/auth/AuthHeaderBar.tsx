"use client";

import { Users, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/** Slim utility strip above every page's own nav — shows the unique-tester
 * count and, once signed in, who's signed in. Sign-in itself only ever
 * happens through the popup (ProductGate) — this bar carries no sign-in
 * control of its own. */
import { usePathname } from "next/navigation";

export default function AuthHeaderBar() {
  const pathname = usePathname();
  const { status, user, uniqueUserCount, signOut } = useAuth();

  if (pathname?.startsWith("/command-center")) return null;

  return (
    <div className="w-full bg-zinc-900 text-zinc-100 text-[12px]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-zinc-400 truncate">
          {uniqueUserCount !== null && (
            <>
              <Users className="w-3.5 h-3.5 shrink-0 text-blue-400" />
              <span className="truncate">
                <span className="font-bold text-white">{uniqueUserCount.toLocaleString()}</span>{" "}
                unique {uniqueUserCount === 1 ? "person has" : "people have"} tested this platform
              </span>
            </>
          )}
        </div>

        <div className="shrink-0">
          {status === "signed-in" && user ? (
            <div className="flex items-center gap-2">
              {user.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
              ) : null}
              <span className="hidden sm:inline text-zinc-300">{user.name || user.email}</span>
              <button
                onClick={signOut}
                className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          ) : status === "loading" ? (
            <span className="text-zinc-500">Loading…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
