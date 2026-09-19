"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { ToastProvider } from "@/components/ui/toast";
import { errorMessage, getMe, type Me, type UserRole } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<UserRole, string> = {
  hr_admin: "HR Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring Manager",
  interviewer: "Interviewer",
};

interface RecruitmentContextValue {
  me: Me;
  /** Whether the signed-in user's role allows this kind of action. The server
   * enforces it regardless; this only decides what to offer. */
  can: (action: string) => boolean;
}

const RecruitmentContext = createContext<RecruitmentContextValue | null>(null);

export function useRecruitment(): RecruitmentContextValue {
  const ctx = useContext(RecruitmentContext);
  if (!ctx) throw new Error("useRecruitment must be used inside <RecruitmentShell>");
  return ctx;
}

type Loaded = { me: Me } | { error: string } | null;

/** Frame for every recruitment page: loads who the user is and what they may
 * do (from the database, via /recruitment/me), provides toasts, and renders
 * the section header. Nothing under it renders until the role is known, so a
 * page never briefly shows controls the user does not have. */
export function RecruitmentShell({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => !cancelled && setLoaded({ me }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const value = useMemo<RecruitmentContextValue | null>(() => {
    if (!loaded || !("me" in loaded)) return null;
    const perms = new Set(loaded.me.permissions);
    return { me: loaded.me, can: (action) => perms.has(action) };
  }, [loaded]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-zinc-50/60 text-zinc-900">
        <div className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/recruitment" className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                <Briefcase className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Recruitment
              </Link>
              <nav aria-label="Recruitment sections" className="flex items-center gap-1">
                <Link
                  href="/recruitment"
                  aria-current={pathname === "/recruitment" || pathname?.startsWith("/recruitment/jobs") ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    (pathname === "/recruitment" || pathname?.startsWith("/recruitment/jobs"))
                      ? "bg-zinc-100 text-zinc-900 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                  )}
                >
                  Jobs
                </Link>
                <Link
                  href="/recruitment/inbox"
                  aria-current={pathname === "/recruitment/inbox" ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    pathname === "/recruitment/inbox"
                      ? "bg-zinc-100 text-zinc-900 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                  )}
                >
                  Inbox
                </Link>
                <Link
                  href="/recruitment/workflows"
                  aria-current={pathname === "/recruitment/workflows" ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    pathname === "/recruitment/workflows"
                      ? "bg-zinc-100 text-zinc-900 font-semibold"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
                  )}
                >
                  Workflows
                </Link>
              </nav>
            </div>
            {value && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="hidden sm:inline">{value.me.name || value.me.email}</span>
                <StatusPill tone="neutral">{ROLE_LABEL[value.me.role] ?? value.me.role}</StatusPill>
              </div>
            )}
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6" aria-busy={loaded === null}>
          {loaded === null && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-2xl" />
                ))}
              </div>
            </div>
          )}
          {loaded && "error" in loaded && (
            <div className="mx-auto max-w-md space-y-3 py-16 text-center">
              <ErrorBanner message={loaded.error} className="text-left" />
              <Button
                variant="outline"
                onClick={() => {
                  setLoaded(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {value && <RecruitmentContext.Provider value={value}>{children}</RecruitmentContext.Provider>}
        </main>
      </div>
    </ToastProvider>
  );
}
