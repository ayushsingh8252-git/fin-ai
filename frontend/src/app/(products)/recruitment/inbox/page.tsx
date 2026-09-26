"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2,
  Clock, Filter, RefreshCw, ShieldAlert,
  Briefcase, CheckSquare, Square, X,
  User, Check, ChevronRight, Sparkles, HelpCircle,
  Award, Activity, Inbox, ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { getInbox, bulkSetStage, type InboxItem, type InboxResponse, type Stage } from "@/lib/recruitmentApi";
import { CandidatePoolMetricSvg, OutcomesMetricSvg, EvaluationMetricSvg } from "../_components/indicators";
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
    <div className="space-y-6 pb-32">
      {/* ─── Clean Enterprise Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Review Inbox
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {data ? `${data.total_count} candidate evaluations waiting for your review & decision.` : "Loading candidate queue..."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {filteredItems.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectAll}
              className="h-8.5 rounded-xl border-zinc-200 bg-white text-xs font-semibold text-zinc-700 hover:bg-zinc-50 shadow-2xs cursor-pointer"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8.5 rounded-xl border-zinc-200 bg-white text-xs font-semibold text-zinc-700 hover:bg-zinc-50 shadow-2xs cursor-pointer transition-all"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-400", loading && "animate-spin text-blue-600")} />
            Sync Queue
          </Button>
        </div>
      </div>

      {/* ─── Triage Summary Cards (Clean Enterprise Design) ─── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setActiveFilter("all")}
          className={cn(
            "rounded-2xl border p-5 transition-all cursor-pointer bg-white shadow-2xs flex flex-col justify-between group",
            activeFilter === "all"
              ? "border-zinc-900 ring-1 ring-zinc-900/10 shadow-xs"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-500">Total Queue</span>
              <div className="w-8 h-8 rounded-xl bg-zinc-50 border border-zinc-200/70 flex items-center justify-center text-zinc-700">
                <CandidatePoolMetricSvg className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono text-zinc-900">
                {data ? data.total_count : "—"}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500 font-medium pt-2.5 border-t border-zinc-100 flex items-center justify-between">
            <span>Awaiting decision</span>
            <span className="text-[10px] font-mono text-zinc-400">All</span>
          </p>
        </div>

        <div
          onClick={() => setActiveFilter("high_match")}
          className={cn(
            "rounded-2xl border p-5 transition-all cursor-pointer bg-white shadow-2xs flex flex-col justify-between group",
            activeFilter === "high_match"
              ? "border-emerald-600 ring-1 ring-emerald-600/20 shadow-xs"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-500">Top Matches</span>
              <div className="w-8 h-8 rounded-xl bg-emerald-50/80 border border-emerald-200/70 flex items-center justify-center text-emerald-600">
                <OutcomesMetricSvg className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono text-zinc-900">
                {data ? highMatchCount : "—"}
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/80">
                ≥ 80% Fit
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500 font-medium pt-2.5 border-t border-zinc-100 flex items-center justify-between">
            <span>Ready for panel interview</span>
            <span className="text-[10px] font-mono text-emerald-600">Qualified</span>
          </p>
        </div>

        <div
          onClick={() => setActiveFilter("screening_ready")}
          className={cn(
            "rounded-2xl border p-5 transition-all cursor-pointer bg-white shadow-2xs flex flex-col justify-between group",
            activeFilter === "screening_ready"
              ? "border-blue-600 ring-1 ring-blue-600/20 shadow-xs"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-500">Pre-Screen</span>
              <div className="w-8 h-8 rounded-xl bg-blue-50/80 border border-blue-200/70 flex items-center justify-center text-blue-600">
                <EvaluationMetricSvg className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold font-mono text-zinc-900">
                {data ? screeningCount : "—"}
              </span>
              <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/80">
                Screening
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500 font-medium pt-2.5 border-t border-zinc-100 flex items-center justify-between">
            <span>Voice & telephonic call</span>
            <span className="text-[10px] font-mono text-blue-600">Ready</span>
          </p>
        </div>

        <div
          onClick={() => setActiveFilter("urgent")}
          className={cn(
            "rounded-2xl border p-5 transition-all cursor-pointer bg-white shadow-2xs flex flex-col justify-between group",
            activeFilter === "urgent"
              ? "border-rose-600 ring-1 ring-rose-600/20 shadow-xs"
              : "border-zinc-200/80 hover:border-zinc-300"
          )}
        >
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-500">Document Flags</span>
              <div className="w-8 h-8 rounded-xl bg-rose-50/80 border border-rose-200/70 flex items-center justify-center text-rose-600">
                <ShieldAlert className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={cn("text-3xl font-extrabold font-mono", urgentCount > 0 ? "text-rose-600" : "text-zinc-900")}>
                {data ? urgentCount : "—"}
              </span>
              {urgentCount > 0 && (
                <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/80">
                  Review
                </span>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500 font-medium pt-2.5 border-t border-zinc-100 flex items-center justify-between">
            <span>Formatting notices</span>
            <span className="text-[10px] font-mono text-zinc-400">Integrity</span>
          </p>
        </div>
      </div>

      {/* ─── Filter Tabs Bar ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200/80 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "high_match", "screening_ready", "urgent"] as const).map((filter) => {
            const label = filter === "all" ? "All Queue" : filter === "high_match" ? "Top Matches" : filter === "screening_ready" ? "Pre-Screen" : "Document Warnings";
            const count = filter === "all" ? (data?.total_count || 0) : filter === "high_match" ? highMatchCount : filter === "screening_ready" ? screeningCount : urgentCount;
            const active = activeFilter === filter;

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer border",
                  active
                    ? "bg-zinc-900 text-white border-zinc-900 shadow-sm"
                    : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900"
                )}
              >
                <span>{label}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.2 text-[10px] font-mono font-bold tabular-nums",
                  active ? "bg-zinc-800 text-blue-300" : "bg-zinc-100 text-zinc-700"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <span className="text-xs text-zinc-500 font-mono">
          Showing <strong className="text-zinc-900 font-bold">{filteredItems.length}</strong> applicants
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ─── Candidate Review Cards List ─── */}
      <div className="space-y-3.5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl bg-zinc-100" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 bg-white p-14 text-center text-xs shadow-2xs space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mx-auto">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="font-extrabold text-zinc-900 text-base">Inbox is completely clear</p>
            <p className="text-zinc-500 max-w-sm mx-auto leading-relaxed">
              No candidates in this category require immediate triage. New applicant evaluations will stream into this view automatically.
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
                  "rounded-2xl border bg-white p-5 shadow-2xs transition-all hover:border-blue-300 hover:shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-5",
                  isSelected ? "border-blue-500 ring-2 ring-blue-500/10 bg-blue-50/20" : "border-zinc-200/80"
                )}
              >
                {/* Checkbox & Candidate Details */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => toggleSelectOne(item.application_id, e)}
                    className="mt-1 text-zinc-400 hover:text-zinc-900 focus:outline-none cursor-pointer"
                  >
                    {isSelected ? <CheckSquare className="h-4.5 w-4.5 text-blue-600" /> : <Square className="h-4.5 w-4.5" />}
                  </button>

                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/80 border border-blue-200/80 text-blue-700 font-bold text-xs shadow-2xs">
                    {initials}
                  </div>

                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/recruitment/jobs/${item.job_id}`}
                        className="font-extrabold text-sm sm:text-base text-zinc-900 hover:text-blue-600 transition-colors"
                      >
                        {candidateName}
                      </Link>
                      <span className="text-xs text-zinc-400 font-medium">for</span>
                      <span className="text-xs font-bold text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-md truncate max-w-[200px]">
                        {item.job_title}
                      </span>
                      {isUrgent ? (
                        <span className="rounded-full bg-rose-50 border border-rose-200 text-rose-700 px-2.5 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          Document Flag
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Qualified Match
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-zinc-600 leading-relaxed max-w-2xl">
                      {item.description}
                    </p>
                  </div>
                </div>

                {/* Quick Action Decision Controls */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 w-full sm:w-auto justify-end">
                  <Button
                    size="sm"
                    onClick={(e) => handleSingleAction(item.application_id, "INTERVIEW", e)}
                    className="h-8.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 shadow-sm shadow-blue-600/20 cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0"
                  >
                    <Check className="h-3.5 w-3.5 mr-1 text-emerald-300" />
                    Approve to Interview
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => handleSingleAction(item.application_id, "REJECTED", e)}
                    className="h-8.5 rounded-xl border-zinc-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:border-rose-200 cursor-pointer"
                  >
                    Reject
                  </Button>

                  <Link
                    href={`/recruitment/jobs/${item.job_id}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-zinc-700 hover:text-blue-600 px-2.5 py-1.5 rounded-xl hover:bg-blue-50/50 transition-colors"
                  >
                    Pipeline
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── Floating Bulk Action Bar ─── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-8 inset-x-0 z-40 mx-auto max-w-md px-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-md px-5 py-3 text-white shadow-2xl">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-white font-mono">
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
                className="h-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-600/30 cursor-pointer"
              >
                Approve ({selectedIds.size})
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction("REJECTED")}
                className="h-8 rounded-xl border-zinc-700 bg-zinc-800 text-xs font-semibold text-rose-400 hover:bg-zinc-700 cursor-pointer"
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
