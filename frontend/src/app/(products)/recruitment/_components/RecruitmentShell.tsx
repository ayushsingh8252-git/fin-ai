"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Inbox, Workflow, BarChart3,
  Loader2, RefreshCw, Database, ArrowLeft, LogOut,
  LayoutGrid, ChevronDown, Radar, Search, ShieldCheck, Upload,
  ShieldAlert, Phone, Video, Zap, Brain, UserPlus, Shield, BriefcaseBusiness,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { errorMessage, getMe, seedDemoPipeline, type Me, type UserRole } from "@/lib/recruitmentApi";
import { useAuth } from "@/contexts/AuthContext";
import { TalentBrandMarkSvg } from "./indicators";
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

const ROLE_LABEL: Record<UserRole, string> = {
  hr_admin: "HR Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring Manager",
  interviewer: "Interviewer",
};

interface RecruitmentContextValue {
  me: Me;
  can: (action: string) => boolean;
  triggerRefresh: () => void;
  refreshCount: number;
}

const RecruitmentContext = createContext<RecruitmentContextValue | null>(null);

export function useRecruitment(): RecruitmentContextValue {
  const ctx = useContext(RecruitmentContext);
  if (!ctx) throw new Error("useRecruitment must be used inside <RecruitmentShell>");
  return ctx;
}

type Loaded = { me: Me } | { error: string } | null;

function NavLink({
  href,
  active,
  icon: Icon,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string | number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex h-11 items-center gap-2 px-1 text-[13px] font-medium whitespace-nowrap transition-colors",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full",
        active
          ? "text-zinc-900 after:bg-blue-600"
          : "text-zinc-500 hover:text-zinc-900 after:bg-transparent hover:after:bg-zinc-200"
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-blue-600" : "text-zinc-400")} />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="inline-flex items-center rounded-full bg-zinc-100 px-1.5 text-[10px] font-semibold tabular-nums text-zinc-600">
          {badge}
        </span>
      )}
    </Link>
  );
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const pathname = usePathname();
  const { toast } = useToast();

  const triggerRefresh = () => setRefreshCount((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => !cancelled && setLoaded({ me }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const res = await seedDemoPipeline();
      toast("success", res.message || "Demo dataset seeded successfully.");
      triggerRefresh();
    } catch (err) {
      toast("error", `Seeding failed: ${errorMessage(err)}`);
    } finally {
      setSeeding(false);
    }
  };

  const value = useMemo<RecruitmentContextValue | null>(() => {
    if (!loaded || !("me" in loaded)) return null;
    const perms = new Set(loaded.me.permissions);
    return {
      me: loaded.me,
      can: (action) => perms.has(action),
      triggerRefresh,
      refreshCount,
    };
  }, [loaded, refreshCount]);

  const userInitials = useMemo(() => {
    if (!loaded || !("me" in loaded)) return "HR";
    const name = loaded.me.name || loaded.me.email;
    const parts = name.split(/[\s@._-]+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }, [loaded]);

  const [productsOpen, setProductsOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  useDismiss(productsRef, productsOpen, () => setProductsOpen(false));
  useDismiss(userRef, userOpen, () => setUserOpen(false));
  const { signOut } = useAuth();

  const tabs = [
    {
      href: "/recruitment",
      label: "Positions",
      icon: Briefcase,
      active: pathname === "/recruitment" || Boolean(pathname?.startsWith("/recruitment/jobs")),
    },
    { href: "/recruitment/inbox", label: "Review Inbox", icon: Inbox, active: pathname === "/recruitment/inbox" },
    { href: "/recruitment/workflows", label: "Workflows", icon: Workflow, active: pathname === "/recruitment/workflows" },
    ...(value?.can("view_analytics")
      ? [{ href: "/recruitment/analytics", label: "Analytics", icon: BarChart3, active: pathname === "/recruitment/analytics" }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 selection:bg-blue-500/20">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
        {/* ── Top bar: product identity + utilities ── */}
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div ref={productsRef} className="relative">
              <button
                type="button"
                onClick={() => setProductsOpen((v) => !v)}
                aria-expanded={productsOpen}
                aria-haspopup="menu"
                aria-label="Switch product"
                title="Switch product"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border transition-colors cursor-pointer",
                  productsOpen ? "border-zinc-300 bg-zinc-100 text-zinc-900" : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>

              {productsOpen && (
                <div role="menu" className="absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
                  <Link
                    href="/"
                    role="menuitem"
                    onClick={() => setProductsOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50"
                  >
                    <ArrowLeft className="h-4 w-4 text-zinc-400" /> Platform home
                  </Link>
                  <div className="my-1 border-t border-zinc-100" />
                  <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-zinc-400">Products</p>
                  {PRODUCTS.map(({ href, label, icon: Icon }) => {
                    const current = href === "/recruitment";
                    return (
                      <Link
                        key={href}
                        href={href}
                        role="menuitem"
                        onClick={() => setProductsOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
                          current ? "bg-blue-50 font-medium text-blue-700" : "text-zinc-700 hover:bg-zinc-50"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", current ? "text-blue-600" : "text-zinc-400")} />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <Link href="/recruitment" className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white">
                <TalentBrandMarkSvg className="h-4 w-4 text-blue-300" />
              </span>
              <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-900">Recruitment</span>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {value?.me.role === "hr_admin" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSeedDemo}
                disabled={seeding}
                title="Add fictional sample candidates (tagged as demo data and excluded from analytics)"
                className="h-8 rounded-md px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                <span className="ml-1.5 hidden sm:inline">Sample data</span>
              </Button>
            )}

            {value ? (
              <div ref={userRef} className="relative">
                <button
                  type="button"
                  onClick={() => setUserOpen((v) => !v)}
                  aria-expanded={userOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-zinc-100 cursor-pointer"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
                    {userInitials}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-[140px] truncate text-[13px] font-medium leading-tight text-zinc-900">
                      {value.me.name || value.me.email}
                    </span>
                    <span className="block text-[11px] leading-tight text-zinc-500">{ROLE_LABEL[value.me.role] ?? value.me.role}</span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>

                {userOpen && (
                  <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
                    <div className="px-3 py-2">
                      <p className="truncate text-[13px] font-medium text-zinc-900">{value.me.name || value.me.email}</p>
                      <p className="truncate text-xs text-zinc-500">{value.me.email}</p>
                      <p className="mt-1 inline-flex rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                        {ROLE_LABEL[value.me.role] ?? value.me.role}
                      </p>
                    </div>
                    <div className="my-1 border-t border-zinc-100" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserOpen(false);
                        signOut();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-zinc-400" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Skeleton className="h-8 w-32 rounded-md bg-zinc-100" />
            )}
          </div>
        </div>

        {/* ── Section tabs (scrolls horizontally on small screens) ── */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <nav aria-label="Recruitment sections" className="-mb-px flex items-center gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => (
              <NavLink key={t.href} href={t.href} active={t.active} icon={t.icon} label={t.label} />
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8" aria-busy={loaded === null}>
        {loaded === null && (
          <div className="space-y-6">
            <Skeleton className="h-8 w-56 rounded-md bg-zinc-200/70" />
            <Skeleton className="h-24 w-full rounded-lg bg-zinc-200/70" />
            <Skeleton className="h-72 w-full rounded-lg bg-zinc-200/70" />
          </div>
        )}

        {loaded && "error" in loaded && (
          <div className="mx-auto max-w-md space-y-4 py-16">
            <ErrorBanner message={loaded.error} />
            <Button
              variant="outline"
              onClick={() => {
                setLoaded(null);
                setAttempt((n) => n + 1);
              }}
              className="rounded-md border-zinc-200 text-xs font-medium"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        )}

        {value && <RecruitmentContext.Provider value={value}>{children}</RecruitmentContext.Provider>}
      </main>
    </div>
  );
}

/** Close a popover on outside click or Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

export function RecruitmentShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellContent>{children}</ShellContent>
    </ToastProvider>
  );
}
