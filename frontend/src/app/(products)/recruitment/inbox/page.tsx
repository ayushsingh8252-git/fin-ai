"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Brain, CheckCircle2, ChevronRight,
  Clock, Filter, Inbox as InboxIcon, Loader2, RefreshCw, ShieldAlert,
  Sparkles, User, Briefcase, Zap, CheckCircle, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { getInbox, type InboxItem, type InboxResponse } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

type FilterType = "all" | "urgent" | "high_match" | "screening_ready";

export default function RecruitmentInboxPage() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInbox()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load inbox items");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const items = data?.items || [];
  const filteredItems = items.filter((item) => {
    if (activeFilter === "urgent") return item.priority === "urgent";
    if (activeFilter === "high_match") return item.category === "high_match";
    if (activeFilter === "screening_ready") return item.category === "screening_ready";
    return true;
  });

  const urgentCount = data?.urgent_count || 0;
  const highMatchCount = items.filter((i) => i.category === "high_match").length;
  const screeningCount = items.filter((i) => i.category === "screening_ready").length;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* Executive Command Header */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-gradient-to-r from-zinc-900 via-indigo-950 to-zinc-900 p-8 text-white shadow-xl shadow-indigo-950/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Intelligent Decision Queue</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Recruitment Inbox
            </h1>
            <p className="text-sm text-zinc-300/90 leading-relaxed">
              Unified priority queue for fraud alerts, high-confidence AI talent matches, and screening approvals requiring HR action.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefresh((n) => n + 1)}
              disabled={loading}
              className="border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Sync Queue
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Actions */}
        <div
          onClick={() => setActiveFilter("all")}
          className={cn(
            "group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md",
            activeFilter === "all"
              ? "border-zinc-900 bg-white ring-2 ring-zinc-900/10 shadow-md"
              : "border-zinc-200/80 bg-white/80 hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Total Items</span>
            <div className="rounded-xl bg-zinc-100 p-2.5 text-zinc-600 transition-transform group-hover:scale-110">
              <InboxIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-zinc-900">
              {data ? data.total_count : "—"}
            </span>
            <span className="text-xs text-zinc-400 font-medium">pending</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-400">All actionable candidate triggers</div>
        </div>

        {/* Urgent Integrity Alerts */}
        <div
          onClick={() => setActiveFilter("urgent")}
          className={cn(
            "group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md",
            activeFilter === "urgent"
              ? "border-red-500 bg-red-50/70 ring-2 ring-red-500/20 shadow-md shadow-red-500/10"
              : "border-red-200/70 bg-gradient-to-br from-red-50/50 to-white hover:border-red-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-red-600">Urgent Fraud Alerts</span>
            <div className="rounded-xl bg-red-100/80 p-2.5 text-red-600 transition-transform group-hover:scale-110">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-red-700">
              {data ? urgentCount : "—"}
            </span>
            {urgentCount > 0 && (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white animate-pulse">
                Needs Attention
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] text-red-600/80">Tampering & credential discrepancies</div>
        </div>

        {/* High Matches */}
        <div
          onClick={() => setActiveFilter("high_match")}
          className={cn(
            "group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md",
            activeFilter === "high_match"
              ? "border-indigo-500 bg-indigo-50/70 ring-2 ring-indigo-500/20 shadow-md shadow-indigo-500/10"
              : "border-indigo-200/70 bg-gradient-to-br from-indigo-50/50 to-white hover:border-indigo-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">High Confidence Matches</span>
            <div className="rounded-xl bg-indigo-100/80 p-2.5 text-indigo-600 transition-transform group-hover:scale-110">
              <Brain className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-indigo-700">
              {data ? highMatchCount : "—"}
            </span>
            <span className="text-xs text-indigo-600/80 font-medium">≥ 85% score</span>
          </div>
          <div className="mt-2 text-[11px] text-indigo-600/80">Fast-track candidate recommendations</div>
        </div>

        {/* Screening Pending */}
        <div
          onClick={() => setActiveFilter("screening_ready")}
          className={cn(
            "group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md",
            activeFilter === "screening_ready"
              ? "border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/20 shadow-md shadow-emerald-500/10"
              : "border-emerald-200/70 bg-gradient-to-br from-emerald-50/50 to-white hover:border-emerald-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Screening Ready</span>
            <div className="rounded-xl bg-emerald-100/80 p-2.5 text-emerald-600 transition-transform group-hover:scale-110">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-black tracking-tight text-emerald-700">
              {data ? screeningCount : "—"}
            </span>
            <span className="text-xs text-emerald-600/80 font-medium">pending session</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-600/80">Automated phone & voice screening</div>
        </div>
      </div>

      {/* Filter Tabs Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200",
              activeFilter === "all"
                ? "bg-zinc-900 text-white shadow-md shadow-zinc-900/20"
                : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            All Items
            <span className={cn("ml-1 rounded-full px-1.5 py-0.2 text-[10px]", activeFilter === "all" ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-600")}>
              {data?.total_count || 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("urgent")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200",
              activeFilter === "urgent"
                ? "bg-red-600 text-white shadow-md shadow-red-600/20"
                : "bg-white text-red-600 border border-red-200 hover:bg-red-50/50"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Urgent Alerts
            <span className={cn("ml-1 rounded-full px-1.5 py-0.2 text-[10px]", activeFilter === "urgent" ? "bg-white/20 text-white" : "bg-red-100 text-red-700")}>
              {urgentCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("high_match")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200",
              activeFilter === "high_match"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50/50"
            )}
          >
            <Brain className="h-3.5 w-3.5" />
            High Matches
            <span className={cn("ml-1 rounded-full px-1.5 py-0.2 text-[10px]", activeFilter === "high_match" ? "bg-white/20 text-white" : "bg-indigo-100 text-indigo-700")}>
              {highMatchCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("screening_ready")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all duration-200",
              activeFilter === "screening_ready"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50/50"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Screening Ready
            <span className={cn("ml-1 rounded-full px-1.5 py-0.2 text-[10px]", activeFilter === "screening_ready" ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700")}>
              {screeningCount}
            </span>
          </button>
        </div>

        <div className="text-xs text-zinc-500 font-medium">
          Showing <span className="font-bold text-zinc-800">{filteredItems.length}</span> items
        </div>
      </div>

      {/* Items list */}
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-48 rounded" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-zinc-200/80 bg-white/80 backdrop-blur-xl p-16 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 mb-4 shadow-sm">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-bold text-zinc-900">All Queue Items Processed!</h3>
          <p className="mt-2 text-sm text-zinc-500 max-w-md mx-auto leading-relaxed">
            There are no pending alerts or actions requiring your attention in this filter category. Workflows and screening sessions are running autonomously.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item: InboxItem) => {
            const isUrgent = item.priority === "urgent";
            const isHighMatch = item.category === "high_match";
            const isScreening = item.category === "screening_ready";

            return (
              <div
                key={item.id}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5",
                  isUrgent
                    ? "border-red-200/80 hover:border-red-300 hover:shadow-red-500/5"
                    : isHighMatch
                    ? "border-indigo-200/80 hover:border-indigo-300 hover:shadow-indigo-500/5"
                    : "border-zinc-200/80 hover:border-zinc-300"
                )}
              >
                {/* Left accent border highlight */}
                <div
                  className={cn(
                    "absolute left-0 top-0 bottom-0 w-1.5 transition-all",
                    isUrgent ? "bg-red-500" : isHighMatch ? "bg-indigo-600" : isScreening ? "bg-emerald-500" : "bg-zinc-400"
                  )}
                />

                <div className="flex flex-wrap items-start justify-between gap-4 pl-2">
                  <div className="space-y-3 min-w-0 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                          isUrgent
                            ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                            : item.priority === "high"
                            ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                            : "bg-zinc-100 text-zinc-700"
                        )}
                      >
                        {isUrgent && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />}
                        {item.priority} priority
                      </span>

                      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100/80 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
                        <Briefcase className="h-3 w-3 text-zinc-500" />
                        {item.job_title}
                      </span>

                      {item.created_at && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                          <Clock className="h-3 w-3" />
                          {new Date(item.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-zinc-900 group-hover:text-indigo-600 transition-colors">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-600 font-normal">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  {/* Actions Dock */}
                  <div className="flex items-center gap-2.5 self-center">
                    <Link
                      href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all duration-200 hover:shadow-lg hover:scale-[1.02]",
                        isUrgent
                          ? "bg-gradient-to-r from-red-600 to-rose-700 shadow-red-600/20 hover:from-red-700 hover:to-rose-800"
                          : "bg-gradient-to-r from-indigo-600 to-violet-700 shadow-indigo-600/20 hover:from-indigo-700 hover:to-violet-800"
                      )}
                    >
                      <span>Candidate 360</span>
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
