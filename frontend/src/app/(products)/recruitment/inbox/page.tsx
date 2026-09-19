"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Brain, CheckCircle2, ChevronRight,
  Clock, Filter, Inbox as InboxIcon, Loader2, RefreshCw, ShieldAlert, Sparkles, User
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Recruitment Inbox</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Action items, fraud alerts, and qualified candidates requiring HR or hiring manager decisions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-zinc-500 mb-2">
            <span>Total Action Items</span>
            <InboxIcon className="h-4 w-4 text-zinc-400" />
          </div>
          <span className="text-3xl font-bold text-zinc-900">{data ? data.total_count : "—"}</span>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-red-600 mb-2">
            <span>Urgent Integrity Alerts</span>
            <ShieldAlert className="h-4 w-4 text-red-500" />
          </div>
          <span className="text-3xl font-bold text-red-700">{data ? urgentCount : "—"}</span>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-blue-600 mb-2">
            <span>High Matches to Review</span>
            <Brain className="h-4 w-4 text-blue-500" />
          </div>
          <span className="text-3xl font-bold text-blue-700">{data ? highMatchCount : "—"}</span>
        </div>

        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-indigo-600 mb-2">
            <span>Screening Pending</span>
            <Sparkles className="h-4 w-4 text-indigo-500" />
          </div>
          <span className="text-3xl font-bold text-indigo-700">{data ? screeningCount : "—"}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-3">
        <Button
          variant={activeFilter === "all" ? "brand" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("all")}
        >
          All Items ({data?.total_count || 0})
        </Button>
        <Button
          variant={activeFilter === "urgent" ? "destructive" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("urgent")}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Urgent Alerts ({urgentCount})
        </Button>
        <Button
          variant={activeFilter === "high_match" ? "brand" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("high_match")}
        >
          <Brain className="h-3.5 w-3.5" />
          High Matches ({highMatchCount})
        </Button>
        <Button
          variant={activeFilter === "screening_ready" ? "brand" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("screening_ready")}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Screening Ready ({screeningCount})
        </Button>
      </div>

      {/* Items list */}
      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500 mb-3" />
          <h3 className="text-base font-bold text-zinc-900">All caught up!</h3>
          <p className="mt-1 text-sm text-zinc-500 max-w-sm mx-auto">
            There are currently no items needing attention for the selected filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item: InboxItem) => (
            <div
              key={item.id}
              className={cn(
                "rounded-2xl border bg-white p-5 shadow-sm transition-all hover:shadow-md flex flex-wrap items-center justify-between gap-4",
                item.priority === "urgent"
                  ? "border-red-200 hover:border-red-300"
                  : "border-zinc-200 hover:border-zinc-300"
              )}
            >
              <div className="space-y-1.5 min-w-0 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    tone={
                      item.priority === "urgent"
                        ? "danger"
                        : item.priority === "high"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {item.priority.toUpperCase()}
                  </StatusPill>
                  <span className="text-xs font-semibold text-zinc-500 bg-zinc-100 rounded px-2 py-0.5">
                    {item.job_title}
                  </span>
                  {item.created_at && (
                    <span className="text-xs text-zinc-400">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-zinc-900 truncate">{item.title}</h3>
                <p className="text-xs text-zinc-600 leading-relaxed">{item.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-700"
                >
                  Candidate 360
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
