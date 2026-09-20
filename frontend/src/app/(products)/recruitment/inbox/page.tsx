"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2,
  Clock, Filter, RefreshCw, ShieldAlert,
  Briefcase, CheckSquare, Square, X,
  User, Check, ChevronRight, Sparkles, HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { getInbox, bulkSetStage, type InboxItem, type InboxResponse, type Stage } from "@/lib/recruitmentApi";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type FilterType = "all" | "urgent" | "high_match" | "screening_ready";

export default function RecruitmentInboxPage() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [refresh, setRefresh] = useState(0);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    getInbox()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load review queue");
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

  const allSelected = filteredItems.length > 0 && selectedIds.size === filteredItems.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.application_id)));
    }
  };

  const toggleSelectOne = (appId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const handleSingleAction = async (appId: string, stage: Stage, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await bulkSetStage([appId], stage);
      toast("success", `Candidate moved to ${stage}`);
      setRefresh((n) => n + 1);
    } catch (err) {
      toast("error", `Action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleBulkAction = async (stage: Stage) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await bulkSetStage(Array.from(selectedIds), stage);
      toast("success", `Updated ${selectedIds.size} candidate(s) to ${stage}`);
      setSelectedIds(new Set());
      setRefresh((n) => n + 1);
    } catch (err) {
      toast("error", `Bulk action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Friendly Non-Tech Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
            Review Inbox
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            {data ? `${data.total_count} candidate applications waiting for your hiring decision.` : "Loading candidate queue..."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 shadow-2xs cursor-pointer"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-400", loading && "animate-spin")} />
            Sync Queue
          </Button>
        </div>
      </div>

      {/* Triage Summary Cards in Plain English */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setActiveFilter("all")}
          className={cn(
            "rounded-xl border p-4 transition-all cursor-pointer bg-white shadow-2xs space-y-1",
            activeFilter === "all"
              ? "border-zinc-900 ring-1 ring-zinc-900/10"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">All Decisions</span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-zinc-900">
              {data ? data.total_count : "—"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">Total waiting candidates</p>
        </div>

        <div
          onClick={() => setActiveFilter("high_match")}
          className={cn(
            "rounded-xl border p-4 transition-all cursor-pointer bg-white shadow-2xs space-y-1",
            activeFilter === "high_match"
              ? "border-zinc-900 ring-1 ring-zinc-900/10"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Top Matches</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded-full border border-emerald-200">
              High Fit
            </span>
          </div>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-zinc-900">
              {data ? highMatchCount : "—"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">Ready for interview invite</p>
        </div>

        <div
          onClick={() => setActiveFilter("screening_ready")}
          className={cn(
            "rounded-xl border p-4 transition-all cursor-pointer bg-white shadow-2xs space-y-1",
            activeFilter === "screening_ready"
              ? "border-zinc-900 ring-1 ring-zinc-900/10"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Pre-Screen Ready</span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-zinc-900">
              {data ? screeningCount : "—"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">Ready for voice/phone call</p>
        </div>

        <div
          onClick={() => setActiveFilter("urgent")}
          className={cn(
            "rounded-xl border p-4 transition-all cursor-pointer bg-white shadow-2xs space-y-1",
            activeFilter === "urgent"
              ? "border-zinc-900 ring-1 ring-zinc-900/10"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Document Checks</span>
            {urgentCount > 0 && (
              <span className="h-2 w-2 rounded-full bg-rose-500" />
            )}
          </div>
          <div className="flex items-baseline gap-2 pt-1">
            <span className={cn("text-2xl sm:text-3xl font-bold font-mono", urgentCount > 0 ? "text-rose-600" : "text-zinc-900")}>
              {data ? urgentCount : "—"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">Formatting / integrity notices</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "high_match", "screening_ready", "urgent"] as const).map((filter) => {
            const label = filter === "all" ? "All" : filter === "high_match" ? "Top Matches" : filter === "screening_ready" ? "Pre-Screen" : "Document Warnings";
            const count = filter === "all" ? (data?.total_count || 0) : filter === "high_match" ? highMatchCount : filter === "screening_ready" ? screeningCount : urgentCount;
            const active = activeFilter === filter;

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
                  active
                    ? "bg-zinc-900 text-white shadow-2xs"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <span>{label}</span>
                <span className={cn("rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono", active ? "bg-zinc-800 text-white" : "bg-zinc-200 text-zinc-700")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <span className="text-xs text-zinc-500">
          Showing <strong className="text-zinc-900">{filteredItems.length}</strong> candidates
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Simple Candidate Review Cards / List */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl bg-zinc-200" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border border-zinc-200/80 bg-white p-12 text-center text-xs shadow-2xs space-y-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mx-auto">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="font-bold text-zinc-900 text-sm">Inbox is completely clear</p>
            <p className="text-zinc-500 max-w-sm mx-auto">
              No candidates in this category require action right now. New submissions will show up here automatically.
            </p>
          </div>
        ) : (
          filteredItems.map((item: InboxItem) => {
            const isSelected = selectedIds.has(item.application_id);
            const isUrgent = item.priority === "urgent";
            const candidateName = item.title.replace(/^Review:\s*/, "");
            const initials = candidateName
              .split(/[\s@._-]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0].toUpperCase())
              .join("") || "C";

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-xl border bg-white p-4 shadow-2xs transition-all hover:border-zinc-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                  isSelected ? "border-zinc-900 ring-1 ring-zinc-900/10 bg-zinc-50/50" : "border-zinc-200/80"
                )}
              >
                {/* Checkbox & Candidate Details */}
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => toggleSelectOne(item.application_id, e)}
                    className="mt-1 text-zinc-400 hover:text-zinc-900 focus:outline-none cursor-pointer"
                  >
                    {isSelected ? <CheckSquare className="h-4 w-4 text-zinc-900" /> : <Square className="h-4 w-4" />}
                  </button>

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-800 text-white font-semibold text-xs border border-zinc-600/30 shadow-2xs">
                    {initials}
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                        className="font-bold text-sm text-zinc-900 hover:underline"
                      >
                        {candidateName}
                      </Link>
                      <span className="text-xs text-zinc-500 font-medium">for</span>
                      <span className="text-xs font-semibold text-zinc-700 truncate max-w-[200px]">
                        {item.job_title}
                      </span>
                      {isUrgent ? (
                        <span className="rounded-full bg-rose-50 border border-rose-200 text-rose-700 px-2 py-0.2 text-[10px] font-bold">
                          Warning Alert
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.2 text-[10px] font-bold">
                          Qualified Fit
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-zinc-600 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Quick Action Decision Controls */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-end">
                  <Button
                    size="sm"
                    onClick={(e) => handleSingleAction(item.application_id, "INTERVIEW", e)}
                    className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-3 shadow-2xs cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                    Approve to Interview
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleSingleAction(item.application_id, "REJECTED", e)}
                    className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-200 cursor-pointer"
                  >
                    Reject
                  </Button>

                  <Link
                    href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-900 px-2 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                  >
                    View 360
                    <ChevronRight className="h-3 w-3 text-zinc-400" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 inset-x-0 z-40 mx-auto max-w-md px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-white shadow-xl">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-white">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction("SHORTLISTED")}
                className="h-7 rounded-lg bg-white text-zinc-900 hover:bg-zinc-100 text-xs font-semibold cursor-pointer"
              >
                Approve ({selectedIds.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction("REJECTED")}
                className="h-7 rounded-lg border-zinc-700 bg-zinc-800 text-xs font-semibold text-rose-400 hover:bg-zinc-700 cursor-pointer"
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
