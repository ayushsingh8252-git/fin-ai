"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase, Inbox, Workflow,
  Loader2, RefreshCw, Database
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { errorMessage, getMe, seedDemoPipeline, type Me, type UserRole } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[#F2F4F7] text-[#171717] font-semibold"
          : "text-[#667085] hover:bg-[#F2F4F7] hover:text-[#171717]"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "text-[#171717]" : "text-[#98A2B3]")} />
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={cn(
            "ml-1 inline-flex items-center rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium",
            active ? "bg-[#E4E7EC] text-[#171717]" : "bg-[#F2F4F7] text-[#667085]"
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
    <div className="min-h-screen bg-[#F7F8FA] text-[#171717] antialiased">
      {/* Enterprise Header */}
      <header className="sticky top-0 z-40 border-b border-[#E4E7EC] bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          {/* Brand & Section Navigation */}
          <div className="flex items-center gap-6">
            <Link
              href="/recruitment"
              className="flex items-center gap-2.5 text-[#171717] transition-opacity hover:opacity-85"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#171717] text-white">
                <Briefcase className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-[#171717] leading-none">
                  Recruitment
                </span>
                <span className="text-[11px] text-[#667085] font-normal leading-tight mt-0.5">
                  Talent Operations
                </span>
              </div>
            </Link>

            <div className="h-4 w-px bg-[#E4E7EC]" />

            {/* Navigation Links */}
            <nav aria-label="Recruitment navigation" className="flex items-center gap-1">
              <NavLink
                href="/recruitment"
                active={pathname === "/recruitment" || pathname?.startsWith("/recruitment/jobs")}
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
              className="hidden sm:inline-flex items-center gap-1.5 h-8 rounded-md border-[#E4E7EC] bg-white text-xs font-medium text-[#667085] hover:bg-[#F2F4F7] hover:text-[#171717]"
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#667085]" />
              ) : (
                <Database className="h-3.5 w-3.5 text-[#98A2B3]" />
              )}
              Demo Data
            </Button>

            {/* User Profile */}
            {value ? (
              <div className="flex items-center gap-2 rounded-md border border-[#E4E7EC] bg-white py-1 pl-1.5 pr-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#171717] text-[10px] font-semibold text-white">
                  {userInitials}
                </div>
                <div className="flex flex-col text-left">
                  <span className="max-w-[130px] truncate text-xs font-semibold text-[#171717] leading-tight">
                    {value.me.name || value.me.email}
                  </span>
                  <span className="text-[10px] text-[#667085] font-normal leading-tight">
                    {ROLE_LABEL[value.me.role] ?? value.me.role}
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-8 w-28 rounded-md bg-[#E4E7EC]" />
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy={loaded === null}>
        {loaded === null && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-8 w-60 rounded-md bg-[#E4E7EC]" />
              <Skeleton className="h-8 w-28 rounded-md bg-[#E4E7EC]" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-lg bg-[#E4E7EC]" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-48 rounded-lg bg-[#E4E7EC]" />
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
              className="rounded-md border-[#E4E7EC] text-xs font-medium"
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
