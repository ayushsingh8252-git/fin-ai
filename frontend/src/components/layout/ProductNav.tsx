"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft, LayoutGrid, ChevronDown, Search, ShieldCheck, Upload,
  ShieldAlert, Phone, Video, Zap, Brain, UserPlus, Shield, Radar, BriefcaseBusiness,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PRODUCTS = [
  { href: "/command-center", label: "Command Center", icon: Radar },
  { href: "/rag", label: "RAG Workspace", icon: Search },
  { href: "/rules", label: "Rule Explorer", icon: ShieldCheck },
  { href: "/upload", label: "Ingest Documents", icon: Upload },
  { href: "/fraud-detection", label: "Fraud Detection", icon: ShieldAlert },
  { href: "/telephonic-agent", label: "Telephonic Agent", icon: Phone },
  { href: "/screening-agent", label: "Screening Agent", icon: Video },
  { href: "/hiring-automation", label: "Hiring Pipeline", icon: Zap },
  { href: "/recruitment", label: "Recruitment", icon: BriefcaseBusiness },
  { href: "/knowledge", label: "Knowledge Transfer", icon: Brain },
  { href: "/onboarding", label: "Onboarding", icon: UserPlus },
  { href: "/security", label: "Security & Compliance", icon: Shield },
] as const;

/** Shared top bar for every product page (rendered once from
 * (products)/layout.tsx, inside ProductGate). Owns exactly two jobs: a way
 * back to the marketing site, and a way to move sideways between products —
 * previously the only nav link on any product page was "back to Platform",
 * so reaching a second product meant going home and clicking again. Each
 * page keeps its own title/icon/action row directly below this bar; this
 * component intentionally doesn't know about per-page actions. */
export function ProductNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Closes the menu on route change (clicking a product link navigates away).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // /rag keeps its own bespoke nav (BrandMark-based workspace header) and is
  // explicitly excluded from this pass — render nothing there so it isn't
  // double-navved.
  if (pathname?.startsWith("/rag") || pathname?.startsWith("/command-center")) return null;

  return (
    <div className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-zinc-200/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-bold text-zinc-900 hover:text-blue-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back to Platform</span>
        </Link>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className={cn(
              "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors",
              open
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-zinc-100 border-zinc-200 text-zinc-700 hover:bg-zinc-200"
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Products</span>
            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-white ring-1 ring-foreground/10 shadow-lg p-1.5 max-h-[70vh] overflow-y-auto"
            >
              {PRODUCTS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                      active
                        ? "bg-blue-50 text-blue-700 font-bold"
                        : "text-zinc-700 hover:bg-zinc-50 font-medium"
                    )}
                  >
                    <Icon className={cn("w-4 h-4 shrink-0", active ? "text-blue-600" : "text-zinc-400")} />
                    {label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
