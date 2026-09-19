"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Inbox, Zap,
  Loader2, RefreshCw, Database
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { errorMessage, getMe, seedDemoPipeline, type Me, type UserRole } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<UserRole, string> = {
  hr_admin: "HR Administrator",
  recruiter: "Recruiter",
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
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-zinc-100 text-zinc-900 font-semibold"
          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "text-zinc-900" : "text-zinc-500")} />
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            "ml-1 inline-flex items-center rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium",
            active ? "bg-zinc-200 text-zinc-800" : "bg-zinc-100 text-zinc-600"
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

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-zinc-900 antialiased selection:bg-zinc-200">
      {/* Enterprise Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white shadow-xs">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {/* Brand & Section Navigation */}
          <div className="flex items-center gap-6">
            <Link
              href="/recruitment"
              className="flex items-center gap-2.5 text-zinc-900 transition-opacity hover:opacity-80"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white shadow-xs">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-zinc-900 leading-none">
                  Recruitment
                </span>
                <span className="text-[10px] text-zinc-500 font-normal leading-tight mt-0.5">
                  Talent Pipeline
                </span>
              </div>
            </Link>

            <div className="h-4 w-px bg-zinc-200" />

            {/* Navigation Tabs */}
            <nav aria-label="Recruitment navigation" className="flex items-center gap-1">
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
                label="Action Queue"
              />
              <NavLink
                href="/recruitment/workflows"
                active={pathname === "/recruitment/workflows"}
                icon={Zap}
                label="Workflows"
                badge="3 Active"
              />
            </nav>
          </div>

          {/* Right Action Items & Profile Dock */}
          <div className="flex items-center gap-2.5">
            {/* Quick Demo Seeder */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="hidden sm:inline-flex items-center gap-1.5 h-8 rounded-md border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
              ) : (
                <Database className="h-3.5 w-3.5 text-zinc-500" />
              )}
              Seed Demo Data
            </Button>

            {/* User Profile Pill */}
            {value ? (
              <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white py-1 pl-1.5 pr-2.5 shadow-xs">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
                  {userInitials}
                </div>
                <div className="flex flex-col text-left">
                  <span className="max-w-[130px] truncate text-xs font-semibold text-zinc-800 leading-tight">
                    {value.me.name || value.me.email}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-normal leading-tight">
                    {ROLE_LABEL[value.me.role] ?? value.me.role}
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-8 w-28 rounded-md" />
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy={loaded === null}>
        {loaded === null && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-60 rounded-md" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-48 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {loaded && "error" in loaded && (
          <div className="mx-auto max-w-md space-y-4 py-16 text-center">
            <ErrorBanner message={loaded.error} className="text-left" />
            <Button
              variant="outline"
              onClick={() => {
                setLoaded(null);
                setAttempt((n) => n + 1);
              }}
              className="rounded-md"
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

export function RecruitmentShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellContent>{children}</ShellContent>
    </ToastProvider>
  );
}
