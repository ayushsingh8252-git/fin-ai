"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Inbox, Layers, Sparkles, Zap, Shield, User,
  Loader2, CheckCircle2, ArrowRight, RefreshCw, Cpu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { errorMessage, getMe, seedDemoPipeline, type Me, type UserRole } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<UserRole, string> = {
  hr_admin: "HR Administrator",
  recruiter: "Senior Recruiter",
  hiring_manager: "Hiring Manager",
  interviewer: "Technical Interviewer",
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
        "group relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold tracking-wide transition-all duration-200",
        active
          ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-500/25"
          : "text-zinc-600 hover:bg-zinc-100/80 hover:text-zinc-900"
      )}
    >
      <Icon className={cn("h-4 w-4 transition-transform duration-200 group-hover:scale-110", active ? "text-white" : "text-zinc-500 group-hover:text-zinc-700")} />
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            "ml-1 inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
            active ? "bg-white/20 text-white" : "bg-blue-50 text-blue-700 ring-1 ring-blue-200/60"
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
      toast("success", res.message || "Demo pipeline seeded with realistic candidates and positions.");
      triggerRefresh();
    } catch (err) {
      toast("error", `Seed Failed: ${errorMessage(err)}`);
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

  return (
    <div className="relative min-h-screen bg-[#fafbfe] text-zinc-900 selection:bg-blue-500/20">
      {/* Subtle modern ambient background orbs */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-gradient-to-br from-blue-400/10 to-indigo-500/10 blur-3xl" />
      <div className="pointer-events-none absolute top-10 -right-32 h-96 w-96 rounded-full bg-gradient-to-bl from-purple-400/10 via-pink-300/5 to-transparent blur-3xl" />

      {/* Glassmorphic Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl shadow-xs transition-all">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {/* Brand & Section Navigation */}
          <div className="flex items-center gap-6">
            <Link
              href="/recruitment"
              className="group flex items-center gap-2.5 transition-transform active:scale-95"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-blue-500/20 ring-1 ring-white/30">
                <Briefcase className="h-4.5 w-4.5" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold tracking-tight text-zinc-900">Talent<span className="text-blue-600">OS</span></span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    AI Active
                  </span>
                </div>
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Autonomous Hiring</span>
              </div>
            </Link>

            <div className="h-5 w-px bg-zinc-200" />

            {/* Navigation Tabs */}
            <nav aria-label="Recruitment sections" className="flex items-center gap-1.5">
              <NavLink
                href="/recruitment"
                active={pathname === "/recruitment" || pathname?.startsWith("/recruitment/jobs")}
                icon={Briefcase}
                label="Jobs & Pipeline"
              />
              <NavLink
                href="/recruitment/inbox"
                active={pathname === "/recruitment/inbox"}
                icon={Inbox}
                label="Action Inbox"
              />
              <NavLink
                href="/recruitment/workflows"
                active={pathname === "/recruitment/workflows"}
                icon={Zap}
                label="AI Automations"
                badge="3 Active"
              />
            </nav>
          </div>

          {/* Right Action Items & Profile Dock */}
          <div className="flex items-center gap-3">
            {/* Quick Demo Seeder */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border-indigo-200/80 bg-indigo-50/50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 transition-all shadow-xs"
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
              )}
              Seed Demo Data
            </Button>

            {/* User Profile Pill */}
            {value ? (
              <div className="flex items-center gap-2.5 rounded-full border border-zinc-200/80 bg-white/80 py-1 pl-1.5 pr-3 shadow-xs backdrop-blur-sm">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-[11px] font-bold text-white shadow-xs">
                  {userInitials}
                </div>
                <div className="flex flex-col text-left">
                  <span className="max-w-[130px] truncate text-xs font-semibold text-zinc-800">
                    {value.me.name || value.me.email}
                  </span>
                  <span className="text-[10px] font-medium text-blue-600">
                    {ROLE_LABEL[value.me.role] ?? value.me.role}
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-8 w-28 rounded-full" />
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-busy={loaded === null}>
        {loaded === null && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-10 w-64 rounded-xl" />
              <Skeleton className="h-10 w-32 rounded-xl" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-64 rounded-3xl" />
              ))}
            </div>
          </div>
        )}

        {loaded && "error" in loaded && (
          <div className="mx-auto max-w-md space-y-4 py-20 text-center">
            <ErrorBanner message={loaded.error} className="text-left shadow-sm" />
            <Button
              variant="outline"
              onClick={() => {
                setLoaded(null);
                setAttempt((n) => n + 1);
              }}
              className="rounded-xl shadow-xs"
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Try again
            </Button>
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
