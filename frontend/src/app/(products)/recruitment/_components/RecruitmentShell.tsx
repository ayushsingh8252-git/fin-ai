"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Inbox, Workflow,
  Loader2, RefreshCw, Database, Sparkles, ArrowLeft,
  LayoutGrid, ChevronDown, Radar, Search, ShieldCheck, Upload,
  ShieldAlert, Phone, Video, Zap, Brain, UserPlus, Shield, BriefcaseBusiness,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { errorMessage, getMe, seedDemoPipeline, DEMO_USER, type Me, type UserRole } from "@/lib/recruitmentApi";
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
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-zinc-900 text-white font-semibold shadow-xs"
          : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "text-white" : "text-zinc-400")} />
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            "ml-1 inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold",
            active ? "bg-zinc-800 text-zinc-200" : "bg-zinc-100 text-zinc-600"
          )}
        >
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!productsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProductsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProductsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [productsOpen]);

  useEffect(() => {
    setProductsOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 overflow-x-hidden bg-white-grid relative selection:bg-blue-500/20">
      {/* Top Ambient Glow matching Main Website */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-96 opacity-60 z-0 bg-[radial-gradient(ellipse_800px_450px_at_50%_0%,rgba(37,99,235,0.08),transparent_75%)]"
        aria-hidden="true"
      />

      {/* Unified Enterprise Header — sticky top-0 z-40 */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* Brand & Section Navigation */}
          <div className="flex items-center gap-2.5 sm:gap-4 md:gap-5">
            {/* Back to Platform Link */}
            <Link
              href="/"
              title="Return to Main Platform"
              className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors py-1 px-2 rounded-lg hover:bg-zinc-100 shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden xl:inline">Platform</span>
            </Link>

            {/* Products Dropdown Switcher */}
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setProductsOpen((v) => !v)}
                aria-expanded={productsOpen}
                aria-haspopup="menu"
                className={cn(
                  "flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer",
                  productsOpen
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-zinc-600" />
                <span className="hidden sm:inline">Products</span>
                <ChevronDown className={cn("w-3 h-3 text-zinc-400 transition-transform", productsOpen && "rotate-180")} />
              </button>

              {productsOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-2 w-64 rounded-xl bg-white border border-zinc-200 shadow-xl p-1.5 max-h-[70vh] overflow-y-auto z-50"
                >
                  <div className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 mb-1">
                    Enterprise Suite
                  </div>
                  {PRODUCTS.map(({ href, label, icon: Icon }) => {
                    const active = pathname === href;
                    return (
                      <Link
                        key={href}
                        href={href}
                        role="menuitem"
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors",
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

            <div className="h-4 w-px bg-zinc-200" />

            {/* Brand Mark */}
            <Link
              href="/recruitment"
              className="flex items-center gap-2.5 transition-opacity hover:opacity-90 group shrink-0"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white shadow-2xs group-hover:scale-105 transition-transform">
                <TalentBrandMarkSvg className="h-4.5 w-4.5 text-blue-400" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold tracking-tight text-zinc-900">
                    Recruitment
                  </span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                </div>
                <span className="text-[10px] text-zinc-400 font-mono hidden lg:inline leading-none">talent & ats engine</span>
              </div>
            </Link>

            <div className="hidden md:block h-4 w-px bg-zinc-200" />

            {/* Navigation Links */}
            <nav aria-label="Recruitment navigation" className="hidden sm:flex items-center gap-1">
              <NavLink
                href="/recruitment"
                active={pathname === "/recruitment" || (pathname?.startsWith("/recruitment/jobs") && !pathname.includes("/inbox"))}
                icon={Briefcase}
                label="Overview & Jobs"
              />
              <NavLink
                href="/recruitment/inbox"
                active={pathname === "/recruitment/inbox"}
                icon={Inbox}
                label="Review Inbox"
              />
              <NavLink
                href="/recruitment/workflows"
                active={pathname === "/recruitment/workflows"}
                icon={Workflow}
                label="Workflows"
              />
              <Link
                href="/hiring-automation"
                className="hidden lg:inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50/70 border border-amber-200/80 hover:bg-amber-100/70 transition-all ml-1"
                title="AI Assignment Generator & Bulk Email Dispatch"
              >
                <Zap className="h-3 w-3 text-amber-500 fill-amber-500" />
                <span>AI Bulk Assignment</span>
              </Link>
            </nav>
          </div>

          {/* Right Action Items & Profile Dock */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Quick Demo Seeder */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="inline-flex items-center gap-1.5 h-8.5 rounded-xl border-zinc-200 bg-white text-xs font-semibold text-zinc-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 shadow-2xs transition-all active:scale-95"
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              )}
              <span className="hidden sm:inline">Demo Data</span>
            </Button>

            {/* User Profile */}
            {value ? (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white/90 py-1 pl-1.5 pr-2.5 shadow-2xs backdrop-blur-sm">
                <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg bg-zinc-900 text-[10px] font-bold text-white shadow-xs">
                  {userInitials}
                </div>
                <div className="flex flex-col text-left">
                  <span className="max-w-[100px] sm:max-w-[120px] truncate text-xs font-bold text-zinc-900 leading-tight">
                    {value.me.name || value.me.email}
                  </span>
                  <span className="text-[10px] text-zinc-600 font-mono leading-tight">
                    {ROLE_LABEL[value.me.role] ?? value.me.role}
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-8 w-28 rounded-xl bg-zinc-200" />
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-busy={loaded === null}>
        {loaded === null && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-9 w-64 rounded-xl bg-zinc-200" />
              <Skeleton className="h-9 w-32 rounded-xl bg-zinc-200" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl bg-zinc-200" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-52 rounded-2xl bg-zinc-200" />
              ))}
            </div>
          </div>
        )}

        {loaded && "error" in loaded && (
          <div className="mx-auto max-w-md space-y-4 py-16 text-center">
            <ErrorBanner message={loaded.error} className="text-left" />
            <div className="flex items-center justify-center gap-2.5">
              <Button
                variant="outline"
                onClick={() => {
                  setLoaded(null);
                  setAttempt((n) => n + 1);
                }}
                className="rounded-xl border-zinc-200 text-xs font-semibold"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Try again
              </Button>
              <Button
                onClick={() => {
                  setLoaded({ me: DEMO_USER });
                  toast("success", "Loaded Demo Workspace. You can explore jobs, candidates, and pipeline stages.");
                }}
                className="rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-md shadow-blue-600/20"
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Explore Demo Mode
              </Button>
            </div>
          </div>
        )}

        {value && <RecruitmentContext.Provider value={value}>{children}</RecruitmentContext.Provider>}
      </main>
    </div>
  );
}

export function RecruitmentShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellContent>{children}</ShellContent>
    </ToastProvider>
  );
}
