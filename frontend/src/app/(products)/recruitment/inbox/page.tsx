"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2,
  Clock, Filter, Inbox as InboxIcon, RefreshCw, ShieldAlert,
  Briefcase, CheckCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
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
    <div className="space-y-6">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
            Action Queue
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Priority triage for document integrity alerts, high-confidence candidate matches, and screening approvals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-500", loading && "animate-spin")} />
            Sync Queue
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Actions */}
        <div
          onClick={() => setActiveFilter("all")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer shadow-xs",
            activeFilter === "all"
              ? "border-zinc-900 bg-zinc-50/50"
              : "border-zinc-200/80 bg-white hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Total Items</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
              <InboxIcon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              {data ? data.total_count : "—"}
            </span>
            <span className="text-xs text-zinc-400 font-normal">pending</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">All candidate triage triggers</div>
        </div>

        {/* Urgent Integrity Alerts */}
        <div
          onClick={() => setActiveFilter("urgent")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer shadow-xs",
            activeFilter === "urgent"
              ? "border-red-600 bg-red-50/40"
              : "border-zinc-200/80 bg-white hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Integrity Alerts</span>
            <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", urgentCount > 0 ? "bg-red-50 text-red-600" : "bg-zinc-100 text-zinc-600")}>
              <ShieldAlert className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", urgentCount > 0 ? "text-red-700" : "text-zinc-900")}>
              {data ? urgentCount : "—"}
            </span>
            {urgentCount > 0 && (
              <span className="rounded bg-red-100 px-1.5 py-0.2 text-[10px] font-medium text-red-700">
                Action Required
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">Discrepancies & keyword stuffing</div>
        </div>

        {/* High Matches */}
        <div
          onClick={() => setActiveFilter("high_match")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer shadow-xs",
            activeFilter === "high_match"
              ? "border-zinc-900 bg-zinc-50/50"
              : "border-zinc-200/80 bg-white hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">High Confidence Matches</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
              <CheckCircle className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              {data ? highMatchCount : "—"}
            </span>
            <span className="text-xs text-zinc-500 font-normal">≥ 85% match</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">Recommended for fast-track</div>
        </div>

        {/* Screening Pending */}
        <div
          onClick={() => setActiveFilter("screening_ready")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer shadow-xs",
            activeFilter === "screening_ready"
              ? "border-zinc-900 bg-zinc-50/50"
              : "border-zinc-200/80 bg-white hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500">Screening Ready</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
              {data ? screeningCount : "—"}
            </span>
            <span className="text-xs text-zinc-500 font-normal">pending invite</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">Pre-qualification voice sessions</div>
        </div>
      </div>

      {/* Filter Tabs Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === "all"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            All Items
            <span className={cn("ml-1 rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium", activeFilter === "all" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-600")}>
              {data?.total_count || 0}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("urgent")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === "urgent"
                ? "bg-red-600 text-white"
                : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
            )}
          >
            <AlertTriangle className={cn("h-3.5 w-3.5", activeFilter === "urgent" ? "text-white" : "text-red-600")} />
            Integrity Alerts
            <span className={cn("ml-1 rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium", activeFilter === "urgent" ? "bg-red-700 text-white" : "bg-red-50 text-red-700")}>
              {urgentCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("high_match")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === "high_match"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
            )}
          >
            <CheckCircle className="h-3.5 w-3.5 text-zinc-500" />
            High Matches
            <span className={cn("ml-1 rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium", activeFilter === "high_match" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-700")}>
              {highMatchCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter("screening_ready")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === "screening_ready"
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50"
            )}
          >
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            Screening Ready
            <span className={cn("ml-1 rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium", activeFilter === "screening_ready" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-700")}>
              {screeningCount}
            </span>
          </button>
        </div>

        <div className="text-xs text-zinc-500 font-normal">
          Showing <span className="font-semibold text-zinc-800">{filteredItems.length}</span> items
        </div>
      </div>

      {/* Items list */}
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-48 rounded" />
                <Skeleton className="h-5 w-20 rounded" />
              </div>
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center shadow-xs">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 mb-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900">All Queue Items Processed</h3>
          <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
            There are no pending alerts or actions requiring attention in this filter category.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((item: InboxItem) => {
            const isUrgent = item.priority === "urgent";
            const isHighMatch = item.category === "high_match";
            const isScreening = item.category === "screening_ready";

            return (
              <div
                key={item.id}
                className={cn(
                  "relative overflow-hidden rounded-lg border bg-white p-4 shadow-xs transition-colors hover:border-zinc-300",
                  isUrgent
                    ? "border-red-200"
                    : "border-zinc-200/80"
                )}
              >
                {/* Left accent indicator bar */}
                <div
                  className={cn(
                    "absolute left-0 top-0 bottom-0 w-1",
                    isUrgent ? "bg-red-500" : isHighMatch ? "bg-blue-600" : isScreening ? "bg-emerald-500" : "bg-zinc-300"
                  )}
                />

                <div className="flex flex-wrap items-center justify-between gap-4 pl-2">
                  <div className="space-y-1.5 min-w-0 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-wide",
                          isUrgent
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : item.priority === "high"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-zinc-100 text-zinc-700"
                        )}
                      >
                        {item.priority}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                        <Briefcase className="h-3 w-3 text-zinc-400" />
                        {item.job_title}
                      </span>

                      {item.created_at && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
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
                      <h3 className="text-sm font-semibold text-zinc-900">
                        {item.title}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-600 font-normal leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 transition-colors"
                    >
                      <span>Review Candidate</span>
                      <ArrowRight className="h-3.5 w-3.5 text-zinc-400" />
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
