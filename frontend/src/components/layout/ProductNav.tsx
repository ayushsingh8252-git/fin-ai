"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, ChevronDown, LogOut, Radar } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { ProductMenu } from "./ProductMenu";
import { isActivePath } from "./products";

const PRIMARY = [
  { href: "/recruitment", label: "Recruitment", icon: BriefcaseBusiness },
  { href: "/command-center", label: "HR Command Center", icon: Radar },
];

/** Top bar for every product page (rendered from (products)/layout.tsx).
 * Hidden where a page supplies its own workspace header (/rag,
 * /recruitment) and on the candidate interview link, which a candidate opens
 * without an account and must not expose internal navigation. */
export function ProductNav() {
  const pathname = usePathname();
  if (
    pathname?.startsWith("/rag") ||
    pathname?.startsWith("/recruitment") ||
    pathname?.startsWith("/screening-agent/session/")
  ) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <BrandMark variant="dark" />
            <span className="hidden text-[15px] font-semibold tracking-tight text-zinc-900 sm:inline">AgenticFlow AI</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {PRIMARY.map(({ href, label, icon: Icon }) => {
              const active = isActivePath(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                    active ? "bg-blue-50 text-blue-700" : "text-zinc-700 hover:bg-zinc-100",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-blue-600" : "text-zinc-400")} />
                  <span className={href === "/command-center" ? "hidden md:inline" : undefined}>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProductMenu align="right" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const { status, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (status !== "signed-in" || !user) return null;
  const initials = (user.name || user.email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 hover:bg-zinc-100 cursor-pointer"
      >
        {user.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.picture} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">{initials}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <div className="px-3 py-2">
            {user.name && <p className="truncate text-[13px] font-medium text-zinc-900">{user.name}</p>}
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
          </div>
          <div className="my-1 border-t border-zinc-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 cursor-pointer"
          >
            <LogOut className="h-4 w-4 text-zinc-400" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
