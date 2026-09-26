"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Home, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRODUCT_GROUPS, isActivePath } from "./products";

/** The "All products" menu used in every app header. */
export function ProductMenu({ align = "left" }: { align?: "left" | "right" }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors cursor-pointer",
          open ? "border-zinc-300 bg-zinc-100 text-zinc-900" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50",
        )}
      >
        <LayoutGrid className="h-4 w-4 text-zinc-500" />
        <span className="hidden sm:inline">Products</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-2 w-[min(92vw,560px)] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <Link
            href="/"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50"
          >
            <Home className="h-4 w-4 text-zinc-400" /> Platform home
          </Link>
          <div className="grid gap-x-2 sm:grid-cols-2">
            {PRODUCT_GROUPS.map((group) => (
              <div key={group.title} className="py-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-zinc-400">{group.title}</p>
                {group.items.map(({ href, label, icon: Icon, description }) => {
                  const active = isActivePath(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md px-3 py-2 transition-colors",
                        active ? "bg-blue-50" : "hover:bg-zinc-50",
                      )}
                    >
                      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-blue-600" : "text-zinc-400")} />
                      <span className="min-w-0">
                        <span className={cn("block text-[13px] font-medium", active ? "text-blue-700" : "text-zinc-900")}>{label}</span>
                        <span className="block truncate text-xs text-zinc-500">{description}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
