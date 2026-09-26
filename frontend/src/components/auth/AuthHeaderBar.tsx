"use client";

import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/** Slim utility strip above every page's own nav — shows who's signed in.
 * Sign-in itself only ever happens through the popup (ProductGate) — this
 * bar carries no sign-in control of its own. Renders nothing until there's
 * an actual signed-in identity to show. */
import { usePathname } from "next/navigation";

export default function AuthHeaderBar() {
  const pathname = usePathname();
  const { status, user, signOut } = useAuth();

  // Product pages have a profile menu (with sign-out) in their own header —
  // ProductNav, or the Recruitment shell. Only pages without one show this.
  if (!(pathname === "/" || pathname?.startsWith("/rag"))) return null;
  if (status !== "signed-in" || !user) return null;

  return (
    <div className="w-full bg-zinc-900 text-zinc-100 text-[12px]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-9 flex items-center justify-end gap-3">
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
      </div>
    </div>
  );
}
