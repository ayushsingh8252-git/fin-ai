"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2,
  Clock, Filter, RefreshCw, ShieldAlert,
  Briefcase, CheckSquare, Square, X
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

  const handleBulkAction = async (stage: Stage) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await bulkSetStage(Array.from(selectedIds), stage);
      toast("success", `Updated ${selectedIds.size} candidates to ${stage}`);
      setSelectedIds(new Set());
      setRefresh((n) => n + 1);
    } catch (err) {
      toast("error", `Bulk action failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E4E7EC] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#171717]">
            Review Inbox
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#667085]">
            {data ? `${data.total_count} candidates require recruiter review or verification` : "Triage queue"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-[#98A2B3]", loading && "animate-spin")} />
            Sync Queue
          </Button>
        </div>
      </div>

      {/* Triage Summary Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setActiveFilter("all")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer bg-white",
            activeFilter === "all"
              ? "border-[#171717]"
              : "border-[#E4E7EC] hover:border-[#D0D5DD]"
          )}
        >
          <span className="text-xs font-medium text-[#667085]">Total Queue</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
              {data ? data.total_count : "—"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#98A2B3]">All pending review items</p>
        </div>

        <div
          onClick={() => setActiveFilter("urgent")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer bg-white",
            activeFilter === "urgent"
              ? "border-[#171717]"
              : "border-[#E4E7EC] hover:border-[#D0D5DD]"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#667085]">Document Integrity</span>
            {urgentCount > 0 && (
              <span className="h-2 w-2 rounded-full bg-[#F04438]" />
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", urgentCount > 0 ? "text-[#F04438]" : "text-[#171717]")}>
              {data ? urgentCount : "—"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#98A2B3]">Discrepancies detected</p>
        </div>

        <div
          onClick={() => setActiveFilter("high_match")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer bg-white",
            activeFilter === "high_match"
              ? "border-[#171717]"
              : "border-[#E4E7EC] hover:border-[#D0D5DD]"
          )}
        >
          <span className="text-xs font-medium text-[#667085]">High Confidence</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
              {data ? highMatchCount : "—"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#98A2B3]">≥ 85% match for interview</p>
        </div>

        <div
          onClick={() => setActiveFilter("screening_ready")}
          className={cn(
            "rounded-lg border p-4 transition-colors cursor-pointer bg-white",
            activeFilter === "screening_ready"
              ? "border-[#171717]"
              : "border-[#E4E7EC] hover:border-[#D0D5DD]"
          )}
        >
          <span className="text-xs font-medium text-[#667085]">Screening Pending</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
              {data ? screeningCount : "—"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[#98A2B3]">Ready for pre-screen call</p>
        </div>
      </div>

      {/* Filter Tabs Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E7EC] pb-2">
        <div className="flex flex-wrap items-center gap-1">
          {(["all", "urgent", "high_match", "screening_ready"] as const).map((filter) => {
            const label = filter === "all" ? "All" : filter === "urgent" ? "Integrity Alerts" : filter === "high_match" ? "High Fit" : "Screening";
            const count = filter === "all" ? (data?.total_count || 0) : filter === "urgent" ? urgentCount : filter === "high_match" ? highMatchCount : screeningCount;
            const active = activeFilter === filter;

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  active
                    ? "bg-[#171717] text-white"
                    : "text-[#667085] hover:bg-[#F2F4F7] hover:text-[#171717]"
                )}
              >
                <span>{label}</span>
                <span className={cn("rounded px-1.5 py-0.2 text-[10px] tabular-nums font-medium", active ? "bg-[#262626] text-white" : "bg-[#F2F4F7] text-[#667085]")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <span className="text-xs text-[#667085]">
          Showing <strong className="text-[#171717]">{filteredItems.length}</strong> candidates
        </span>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Table of Review Queue */}
      <div className="rounded-lg border border-[#E4E7EC] bg-white overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md bg-[#E4E7EC]" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#667085]">
            <CheckCircle2 className="h-6 w-6 text-[#12B76A] mx-auto mb-2" />
            <p className="font-semibold text-[#171717]">Queue is clear</p>
            <p className="mt-0.5 text-[#98A2B3]">No candidates currently requiring action in this category.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#E4E7EC] bg-[#F7F8FA] text-[11px] font-medium uppercase tracking-wider text-[#667085]">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="flex items-center text-[#98A2B3] hover:text-[#171717] focus:outline-none"
                    >
                      {allSelected ? <CheckSquare className="h-4 w-4 text-[#171717]" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Candidate</th>
                  <th className="px-3 py-2.5">Reason for Review</th>
                  <th className="px-3 py-2.5">Position</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E7EC]">
                {filteredItems.map((item: InboxItem) => {
                  const isSelected = selectedIds.has(item.application_id);
                  const isUrgent = item.priority === "urgent";

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "group hover:bg-[#F7F8FA] transition-colors",
                        isSelected && "bg-[#F2F4F7]"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-3.5" onClick={(e) => toggleSelectOne(item.application_id, e)}>
                        <button type="button" className="flex items-center text-[#98A2B3] hover:text-[#171717] focus:outline-none">
                          {isSelected ? <CheckSquare className="h-4 w-4 text-[#171717]" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>

                      {/* Candidate */}
                      <td className="px-3 py-3.5">
                        <Link
                          href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                          className="font-semibold text-xs text-[#171717] group-hover:text-[#2563EB] transition-colors block"
                        >
                          {item.title.replace(/^Review:\s*/, "")}
                        </Link>
                      </td>

                      {/* Reason */}
                      <td className="px-3 py-3.5 text-xs text-[#667085] max-w-sm truncate">
                        {item.description}
                      </td>

                      {/* Job */}
                      <td className="px-3 py-3.5 text-xs text-[#667085]">
                        {item.job_title}
                      </td>

                      {/* Priority */}
                      <td className="px-3 py-3.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium uppercase",
                            isUrgent
                              ? "bg-[#FEF3F2] text-[#F04438] border border-[#FECDCA]"
                              : item.priority === "high"
                              ? "bg-[#FFFAEB] text-[#F79009] border border-[#FEDF89]"
                              : "bg-[#F2F4F7] text-[#667085]"
                          )}
                        >
                          {item.priority}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-3 py-3.5 text-right">
                        <Link
                          href={`/recruitment/jobs/${item.job_id}/candidates/${item.application_id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#667085] hover:text-[#171717] transition-colors"
                        >
                          Review
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-5 inset-x-0 z-40 mx-auto max-w-lg px-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#171717] bg-[#171717] px-4 py-2.5 text-white shadow-lg">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-[#F2F4F7]">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[#98A2B3] hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction("SHORTLISTED")}
                className="h-7 rounded-md border-[#262626] bg-[#262626] text-xs font-medium text-white hover:bg-[#333333]"
              >
                Approve to Interview
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={() => handleBulkAction("REJECTED")}
                className="h-7 rounded-md border-[#262626] bg-[#262626] text-xs font-medium text-[#F04438] hover:bg-[#333333]"
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
