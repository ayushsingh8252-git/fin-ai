"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckSquare, FileUp, Loader2, RefreshCw, Square,
  Users, Search, ChevronRight, X, LayoutGrid, Table as TableIcon,
  GripVertical, CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert,
  Send, UserCheck, XCircle, SlidersHorizontal
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  errorMessage, getJob, listCandidates, retryUpload,
  bulkSetStage, bulkAnalyze, setStage,
  type CandidatePage, type Job, type Stage, type CandidateApplication
} from "@/lib/recruitmentApi";
import { AnalysisIndicator, ScoreCell, StageBadge, PipelineProgressionSvg, EmptyStateGeometricSvg } from "../../_components/indicators";
import { UploadPanel } from "../../_components/UploadPanel";
import { useBatchProgress } from "../../_components/useBatchProgress";
import { useRecruitment } from "../../_components/RecruitmentShell";
import { STAGE_LABEL } from "../../_components/stages";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type LoadState = { job: Job; candidates: CandidatePage } | { error: string } | null;

const BOARD_STAGES: Stage[] = [
  "APPLIED",
  "SHORTLISTED",
  "INTERVIEW",
  "SELECTED",
  "OFFER",
  "HIRED",
  "REJECTED",
];

const ALL_STAGES_FILTER: { key: Stage | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "APPLIED", label: "Applied" },
  { key: "SHORTLISTED", label: "Shortlisted" },
  { key: "INTERVIEW", label: "Interview" },
  { key: "SELECTED", label: "Selected" },
  { key: "OFFER", label: "Offer" },
  { key: "HIRED", label: "Hired" },
  { key: "REJECTED", label: "Rejected" },
];

function AgenticPipelineTracker({
  active,
  counts,
  total,
}: {
  active: boolean;
  counts?: { parsed: number; processing: number; queued: number; duplicate: number; failed: number };
  total: number;
}) {
  if (!active && (!counts || counts.processing === 0)) return null;

  const currentStep = (counts?.processing ?? 0) > 0 ? 3 : (counts?.queued ?? 0) > 0 ? 2 : 4;

  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-[#12B76A] animate-pulse" />
          <span className="text-xs font-semibold text-[#171717]">
            Automated Evaluation Pipeline Active
          </span>
        </div>
        <span className="text-xs text-[#667085] tabular-nums font-medium">
          {counts ? `${counts.parsed} of ${total} resumes processed` : "Evaluating applicants…"}
        </span>
      </div>

      <PipelineProgressionSvg currentStep={currentStep} totalSteps={4} isRunning={true} />
    </div>
  );
}

function JobAgentActivity({ candidates }: { candidates: CandidateApplication[] }) {
  const recentEvaluated = useMemo(() => {
    return candidates
      .filter((c) => c.analysis_status === "completed" || (c.scores.match_score.value !== null && c.scores.match_score.value > 0))
      .slice(0, 3)
      .map((c) => {
        const match = c.scores.match_score.value;
        const ats = c.scores.ats_score.value;
        return {
          id: c.id,
          name: c.candidate.name || "Candidate",
          match,
          ats,
          stage: c.stage,
        };
      });
  }, [candidates]);

  if (recentEvaluated.length === 0) return null;

  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5 space-y-2">
      <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
          Agent Activity
        </span>
        <span className="text-[10px] text-[#12B76A] font-medium flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#12B76A]" /> Factual Audit Log
        </span>
      </div>
      <div className="divide-y divide-[#E4E7EC]">
        {recentEvaluated.map((item) => (
          <div key={item.id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-[#171717]">
              Agent evaluated <strong className="font-semibold">{item.name}</strong>
            </span>
            <span className="text-[#667085] tabular-nums text-[11px]">
              {item.match !== null ? `Semantic match: ${item.match}%` : "Requirements verified"} → Routed to <strong className="font-medium text-[#171717]">{STAGE_LABEL[item.stage] || item.stage}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function JobWorkspacePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const router = useRouter();
  const { can } = useRecruitment();
  const { toast } = useToast();

  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);

  // View Mode: Table vs Interactive Kanban Board
  const [viewMode, setViewMode] = useState<"table" | "board">("table");

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeStageTab, setActiveStageTab] = useState<Stage | "ALL">("ALL");
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"match_desc" | "ats_desc" | "name">("match_desc");

  // Bulk actions state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedApp, setDraggedApp] = useState<CandidateApplication | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [pendingRejectApp, setPendingRejectApp] = useState<CandidateApplication | null>(null);
  const [stageUpdating, setStageUpdating] = useState<string | null>(null);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const progress = useBatchProgress(batchId, reload, pollKey);

  useEffect(() => {
    let cancelled = false;
    setSelectedIds(new Set());
    Promise.all([getJob(jobId), listCandidates(jobId, { pageSize: 100 })])
      .then(([job, candidates]) => !cancelled && setLoaded({ job, candidates }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => { cancelled = true; };
  }, [jobId, refresh]);

  const candidatesList = loaded && "candidates" in loaded ? loaded.candidates.items : [];

  // Filter & sort candidates
  const filteredCandidates = useMemo(() => {
    return candidatesList.filter((app) => {
      // Stage filter (only in table view)
      if (viewMode === "table" && activeStageTab !== "ALL" && app.stage !== activeStageTab) return false;

      // Min match score filter
      if (minScoreFilter > 0) {
        const score = app.scores.match_score.value ?? 0;
        if (score < minScoreFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = app.candidate.name?.toLowerCase() || "";
        const email = app.candidate.email?.toLowerCase() || "";
        const role = app.candidate.current_role?.toLowerCase() || "";
        if (!name.includes(q) && !email.includes(q) && !role.includes(q)) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === "match_desc") {
        return (b.scores.match_score.value ?? 0) - (a.scores.match_score.value ?? 0);
      }
      if (sortBy === "ats_desc") {
        return (b.scores.ats_score.value ?? 0) - (a.scores.ats_score.value ?? 0);
      }
      return (a.candidate.name || "").localeCompare(b.candidate.name || "");
    });
  }, [candidatesList, viewMode, activeStageTab, minScoreFilter, searchQuery, sortBy]);

  // Group by stage for board view
  const candidatesByStage = useMemo(() => {
    const map: Record<Stage, CandidateApplication[]> = {
      APPLIED: [],
      PROCESSING: [],
      SCREENING: [],
      SHORTLISTED: [],
      INTERVIEW: [],
      SELECTED: [],
      OFFER: [],
      HIRED: [],
      REJECTED: [],
      WITHDRAWN: [],
    };
    filteredCandidates.forEach((c) => {
      if (map[c.stage]) {
        map[c.stage].push(c);
      } else {
        map.APPLIED.push(c);
      }
    });
    return map;
  }, [filteredCandidates]);

  const allSelected = filteredCandidates.length > 0 && selectedIds.size === filteredCandidates.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCandidates.map((c) => c.id)));
    }
  };

  const toggleSelectOne = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Drag & Drop Handler
  const executeStageMove = async (appId: string, targetStage: Stage) => {
    setStageUpdating(appId);
    try {
      await setStage(appId, targetStage);
      toast("success", `Candidate moved to ${STAGE_LABEL[targetStage] || targetStage}`);
      reload();
    } catch (err) {
      toast("error", `Failed to move candidate: ${errorMessage(err)}`);
    } finally {
      setStageUpdating(null);
      setDraggedApp(null);
      setDragOverStage(null);
    }
  };

  const handleDropOnStage = (targetStage: Stage) => {
    if (!draggedApp) return;
    if (draggedApp.stage === targetStage) {
      setDraggedApp(null);
      setDragOverStage(null);
      return;
    }

    if (targetStage === "REJECTED") {
      setPendingRejectApp(draggedApp);
      setDragOverStage(null);
      return;
    }

    executeStageMove(draggedApp.id, targetStage);
  };

  const handleBulkStage = async (stage: Stage) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      await bulkSetStage(Array.from(selectedIds), stage);
      toast("success", `Moved ${selectedIds.size} candidates to ${STAGE_LABEL[stage] || stage}.`);
      setSelectedIds(new Set());
      reload();
    } catch (err) {
      setBulkError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkAnalyze = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      await bulkAnalyze(Array.from(selectedIds));
      toast("success", `Queued re-evaluation for ${selectedIds.size} candidates.`);
      setSelectedIds(new Set());
      reload();
    } catch (err) {
      setBulkError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  if (loaded === null) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-36 rounded bg-[#E4E7EC]" />
        <Skeleton className="h-8 w-64 rounded-md bg-[#E4E7EC]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-[#E4E7EC]" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg bg-[#E4E7EC]" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="max-w-md space-y-3 py-12">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="rounded-md border-[#E4E7EC]">
          Try again
        </Button>
      </div>
    );
  }

  const { job } = loaded;
  const pipeline = job.pipeline;
  const isPipelineActive = Boolean(progress && !progress.status.done);

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-[#E4E7EC] pb-5">
        <div>
          <Link
            href="/recruitment"
            className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#667085] hover:text-[#171717] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All Positions
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#171717]">
              {job.title}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E4E7EC] bg-white px-2 py-0.5 text-xs font-medium text-[#171717]">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                job.status === "open" ? "bg-[#12B76A]" : job.status === "closed" ? "bg-[#F04438]" : "bg-[#98A2B3]"
              )} />
              <span className="capitalize">{job.status}</span>
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#667085]">
            {job.department && <span>{job.department}</span>}
            {job.location && (
              <>
                <span className="text-[#E4E7EC]">·</span>
                <span>{job.location}</span>
              </>
            )}
            {job.min_experience_years !== null && (
              <>
                <span className="text-[#E4E7EC]">·</span>
                <span>{job.min_experience_years}+ years experience</span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* View Mode Switcher */}
          <div className="flex items-center rounded-md border border-[#E4E7EC] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              title="Table View"
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                viewMode === "table" ? "bg-[#171717] text-white" : "text-[#667085] hover:text-[#171717]"
              )}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              title="Pipeline Board View (Drag & Drop)"
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                viewMode === "board" ? "bg-[#171717] text-white" : "text-[#667085] hover:text-[#171717]"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Pipeline Board</span>
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-[#98A2B3]" />
            Refresh
          </Button>

          {can("upload") && job.status !== "closed" && (
            <Button
              size="sm"
              onClick={() => setUploadOpen(true)}
              className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
            >
              <FileUp className="mr-1.5 h-3.5 w-3.5" />
              Upload Resumes
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5">
          <p className="text-xs font-medium text-[#667085]">Total Candidates</p>
          <p className="mt-1 text-2xl font-semibold text-[#171717] tabular-nums">{job.total_candidates}</p>
        </div>
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5">
          <p className="text-xs font-medium text-[#667085]">Shortlisted</p>
          <p className="mt-1 text-2xl font-semibold text-[#171717] tabular-nums">{pipeline.SHORTLISTED ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5">
          <p className="text-xs font-medium text-[#667085]">Interview</p>
          <p className="mt-1 text-2xl font-semibold text-[#171717] tabular-nums">{pipeline.INTERVIEW ?? 0}</p>
        </div>
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-3.5">
          <p className="text-xs font-medium text-[#667085]">Offer / Hired</p>
          <p className="mt-1 text-2xl font-semibold text-[#171717] tabular-nums">{(pipeline.OFFER ?? 0) + (pipeline.HIRED ?? 0)}</p>
        </div>
      </div>

      {/* Live Agentic Execution Tracker */}
      <AgenticPipelineTracker
        active={isPipelineActive}
        counts={progress?.status.counts}
        total={progress?.status.total ?? job.total_candidates}
      />

      {/* Factual Agent Activity Log */}
      <JobAgentActivity candidates={candidatesList} />

      {/* Stage Drop Target Bar (Visible when dragging or filtering) */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar border-b border-[#E4E7EC]">
        {ALL_STAGES_FILTER.map((st) => {
          const count = st.key === "ALL" ? job.total_candidates : (pipeline[st.key] ?? 0);
          const active = activeStageTab === st.key;
          const isDropTarget = st.key !== "ALL" && dragOverStage === st.key;

          return (
            <div
              key={st.key}
              onDragOver={(e) => {
                if (st.key !== "ALL") {
                  e.preventDefault();
                  setDragOverStage(st.key as Stage);
                }
              }}
              onDragLeave={() => {
                if (dragOverStage === st.key) setDragOverStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (st.key !== "ALL") handleDropOnStage(st.key as Stage);
              }}
              className="relative"
            >
              <button
                type="button"
                onClick={() => setActiveStageTab(st.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-all whitespace-nowrap",
                  isDropTarget
                    ? "border-[#171717] bg-[#F2F4F7] text-[#171717] font-semibold scale-105"
                    : active
                    ? "border-[#171717] text-[#171717] font-semibold"
                    : "border-transparent text-[#667085] hover:text-[#171717] hover:border-[#E4E7EC]"
                )}
              >
                <span>{st.label}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.2 text-[10px] font-medium tabular-nums transition-colors",
                    isDropTarget
                      ? "bg-[#171717] text-white"
                      : active
                      ? "bg-[#171717] text-white"
                      : count > 0
                      ? "bg-[#F2F4F7] text-[#667085]"
                      : "bg-transparent text-[#98A2B3]"
                  )}
                >
                  {count}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Search & Score Filters Bar */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-[#E4E7EC] bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98A2B3]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search candidates by name, email, or current role..."
            className="w-full rounded-md border border-[#E4E7EC] bg-[#F7F8FA] py-1.5 pl-8 pr-7 text-xs font-normal text-[#171717] placeholder:text-[#98A2B3] focus:border-[#171717] focus:bg-white focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#98A2B3] hover:text-[#171717]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#E4E7EC] pt-2 sm:border-t-0 sm:pt-0">
          <select
            value={minScoreFilter}
            onChange={(e) => setMinScoreFilter(Number(e.target.value))}
            className="h-8 rounded-md border border-[#E4E7EC] bg-[#F7F8FA] px-2.5 text-xs font-medium text-[#171717] hover:bg-[#F2F4F7] focus:outline-none"
          >
            <option value={0}>All Match Scores</option>
            <option value={80}>≥ 80% Match</option>
            <option value={70}>≥ 70% Match</option>
            <option value={50}>≥ 50% Match</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-md border border-[#E4E7EC] bg-[#F7F8FA] px-2.5 text-xs font-medium text-[#171717] hover:bg-[#F2F4F7] focus:outline-none"
          >
            <option value="match_desc">Sort: Semantic Fit</option>
            <option value="ats_desc">Sort: Hard Requirements</option>
            <option value="name">Sort: Candidate Name</option>
          </select>
        </div>
      </div>

      {bulkError && <ErrorBanner message={bulkError} />}

      {/* VIEW 1: TABLE VIEW WITH ROW DRAG & DROP */}
      {viewMode === "table" && (
        <section className="overflow-hidden rounded-lg border border-[#E4E7EC] bg-white">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] bg-[#F7F8FA] px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Candidate Roster ({filteredCandidates.length})
              </h2>
              {draggedApp && (
                <span className="text-xs text-[#2E90FA] font-medium">
                  Drop candidate on any stage tab above to move
                </span>
              )}
            </div>
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="p-12 text-center">
              <EmptyStateGeometricSvg className="mx-auto h-10 w-10 text-[#98A2B3]" />
              <h3 className="mt-2 text-sm font-semibold text-[#171717]">No candidates found</h3>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[#667085]">
                {candidatesList.length === 0
                  ? "No resumes have been uploaded for this role. Click 'Upload Resumes' to ingest candidate documents."
                  : "No candidates match the active search and filter criteria."}
              </p>
              {candidatesList.length === 0 && can("upload") && (
                <Button
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="mt-3 h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
                >
                  <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  Upload Resumes
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-xs">
                <thead className="bg-[#F7F8FA] text-[11px] font-medium uppercase tracking-wider text-[#667085] border-b border-[#E4E7EC]">
                  <tr>
                    <th className="w-8 px-2 py-2.5 text-center text-[#98A2B3]">
                      <span className="sr-only">Drag</span>
                    </th>
                    <th className="w-10 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="flex items-center text-[#98A2B3] hover:text-[#171717] focus:outline-none"
                      >
                        {allSelected ? <CheckSquare className="h-4 w-4 text-[#171717]" /> : <Square className="h-4 w-4" />}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 font-medium">Candidate</th>
                    <th className="px-3 py-2.5 font-medium">Experience</th>
                    <th className="px-3 py-2.5 font-medium">Hard Requirements</th>
                    <th className="px-3 py-2.5 font-medium">Semantic Fit</th>
                    <th className="px-3 py-2.5 font-medium">Stage</th>
                    <th className="px-3 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E7EC]">
                  {filteredCandidates.map((app) => {
                    const isSelected = selectedIds.has(app.id);
                    const isBeingDragged = draggedApp?.id === app.id;
                    const matchVal = app.scores.match_score.value;
                    const expYears = app.candidate.experience_years;

                    return (
                      <tr
                        key={app.id}
                        draggable={true}
                        onDragStart={() => setDraggedApp(app)}
                        onDragEnd={() => setDraggedApp(null)}
                        onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                        className={cn(
                          "group cursor-pointer transition-colors",
                          isBeingDragged ? "opacity-40 bg-[#F2F4F7]" : isSelected ? "bg-[#F2F4F7]" : "hover:bg-[#F7F8FA]"
                        )}
                      >
                        {/* Drag Handle */}
                        <td className="w-8 px-2 py-3.5 text-center text-[#98A2B3] group-hover:text-[#171717] cursor-grab">
                          <GripVertical className="h-3.5 w-3.5 mx-auto" />
                        </td>

                        {/* Checkbox */}
                        <td className="w-10 px-3 py-3.5" onClick={(e) => toggleSelectOne(app.id, e)}>
                          <button type="button" className="flex items-center text-[#98A2B3] hover:text-[#171717] focus:outline-none">
                            {isSelected ? <CheckSquare className="h-4 w-4 text-[#171717]" /> : <Square className="h-4 w-4" />}
                          </button>
                        </td>

                        {/* Candidate Name */}
                        <td className="px-3 py-3.5">
                          <div className="min-w-0">
                            <p className="font-semibold text-xs text-[#171717] group-hover:text-[#2563EB] transition-colors">
                              {app.candidate.name || "Unnamed Candidate"}
                            </p>
                            <p className="truncate text-[11px] text-[#667085] font-normal">
                              {app.candidate.current_role || app.candidate.email || "Applicant"}
                            </p>
                          </div>
                        </td>

                        {/* Experience */}
                        <td className="px-3 py-3.5 text-xs text-[#667085]">
                          {expYears !== null && expYears !== undefined ? `${expYears} yrs` : "—"}
                        </td>

                        {/* Hard Requirements */}
                        <td className="px-3 py-3.5">
                          <ScoreCell score={app.scores.ats_score} />
                        </td>

                        {/* Semantic Fit */}
                        <td className="px-3 py-3.5">
                          {matchVal !== null ? (
                            <span className={cn(
                              "text-xs font-semibold tabular-nums",
                              matchVal >= 80 ? "text-[#12B76A]" : matchVal >= 65 ? "text-[#171717]" : "text-[#667085]"
                            )}>
                              {matchVal >= 85 ? "Strong" : matchVal >= 70 ? "Good" : "Moderate"} · {matchVal}%
                            </span>
                          ) : (
                            <span className="text-xs text-[#98A2B3]">—</span>
                          )}
                        </td>

                        {/* Stage */}
                        <td className="px-3 py-3.5">
                          <StageBadge stage={app.stage} />
                        </td>

                        {/* Action */}
                        <td className="px-3 py-3.5 text-right">
                          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[#667085] group-hover:text-[#171717] transition-colors">
                            View
                            <ChevronRight className="h-3 w-3" />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* VIEW 2: INTERACTIVE PIPELINE KANBAN BOARD */}
      {viewMode === "board" && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3 overflow-x-auto pb-4">
          {BOARD_STAGES.map((stage) => {
            const list = candidatesByStage[stage] || [];
            const isTarget = dragOverStage === stage;

            return (
              <div
                key={stage}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => {
                  if (dragOverStage === stage) setDragOverStage(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDropOnStage(stage);
                }}
                className={cn(
                  "flex flex-col rounded-lg border bg-[#F7F8FA] p-2.5 min-w-[200px] transition-all min-h-[420px]",
                  isTarget
                    ? "border-[#171717] bg-[#F2F4F7] ring-1 ring-[#171717]"
                    : "border-[#E4E7EC]"
                )}
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between pb-2 border-b border-[#E4E7EC] mb-2 px-1">
                  <span className="text-[11px] font-semibold text-[#171717] uppercase tracking-wider">
                    {STAGE_LABEL[stage] || stage}
                  </span>
                  <span className="rounded bg-white border border-[#E4E7EC] px-1.5 py-0.2 text-[10px] font-semibold text-[#667085] tabular-nums">
                    {list.length}
                  </span>
                </div>

                {/* Candidate Cards in Stage */}
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                  {list.map((app) => {
                    const matchVal = app.scores.match_score.value;
                    const isBeingDragged = draggedApp?.id === app.id;

                    return (
                      <div
                        key={app.id}
                        draggable={true}
                        onDragStart={() => setDraggedApp(app)}
                        onDragEnd={() => setDraggedApp(null)}
                        onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                        className={cn(
                          "rounded-md border bg-white p-2.5 shadow-2xs cursor-grab active:cursor-grabbing transition-all hover:border-[#D0D5DD]",
                          isBeingDragged ? "opacity-30 border-dashed border-[#171717]" : "border-[#E4E7EC]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="text-xs font-semibold text-[#171717] truncate">
                            {app.candidate.name || "Candidate"}
                          </p>
                          <GripVertical className="h-3 w-3 text-[#98A2B3] shrink-0 mt-0.5" />
                        </div>

                        <p className="text-[10px] text-[#667085] truncate mt-0.5">
                          {app.candidate.current_role || "Applicant"}
                        </p>

                        <div className="mt-2 flex items-center justify-between border-t border-[#E4E7EC] pt-1.5 text-[10px]">
                          <span className="text-[#667085]">
                            {app.candidate.experience_years !== null ? `${app.candidate.experience_years}y exp` : "—"}
                          </span>
                          {matchVal !== null && (
                            <span className={cn(
                              "font-semibold tabular-nums",
                              matchVal >= 80 ? "text-[#12B76A]" : "text-[#171717]"
                            )}>
                              {matchVal}% Fit
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {list.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded border border-dashed border-[#E4E7EC] text-[11px] text-[#98A2B3]">
                      Drop candidate here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Bulk Action Dock */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-5 inset-x-0 z-40 mx-auto max-w-md px-4">
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
              <select
                defaultValue=""
                disabled={bulkLoading}
                onChange={(e) => {
                  const stage = e.target.value as Stage;
                  if (stage) handleBulkStage(stage);
                }}
                className="h-7 rounded-md border border-[#262626] bg-[#262626] px-2 text-xs font-medium text-white hover:bg-[#333333] focus:outline-none"
              >
                <option value="" disabled>Move to stage…</option>
                <option value="SHORTLISTED">Shortlist</option>
                <option value="INTERVIEW">Interview</option>
                <option value="SELECTED">Select</option>
                <option value="OFFER">Extend Offer</option>
                <option value="REJECTED">Reject</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={handleBulkAnalyze}
                className="h-7 rounded-md border-[#262626] bg-[#262626] text-xs font-medium text-white hover:bg-[#333333]"
              >
                {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Re-evaluate"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Destructive Rejection Drag */}
      {pendingRejectApp && (
        <Dialog open={Boolean(pendingRejectApp)} onOpenChange={(open) => !open && setPendingRejectApp(null)}>
          <DialogContent className="sm:max-w-md rounded-lg border-[#E4E7EC] bg-white p-5 shadow-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-[#171717]">Confirm Candidate Rejection</DialogTitle>
              <DialogDescription className="text-xs text-[#667085]">
                Are you sure you want to move <strong className="text-[#171717]">{pendingRejectApp.candidate.name}</strong> to the Rejected stage?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2 border-t border-[#E4E7EC] flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingRejectApp(null)}
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const id = pendingRejectApp.id;
                  setPendingRejectApp(null);
                  executeStageMove(id, "REJECTED");
                }}
                className="h-8 rounded-md bg-[#F04438] text-xs font-medium text-white hover:bg-[#D92D20]"
              >
                Confirm Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Upload Resumes Modal */}
      {can("upload") && (
        <UploadPanel
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          job={job}
          batchId={batchId}
          progress={progress}
          onBatchStarted={setBatchId}
          onUploaded={() => setPollKey((n) => n + 1)}
          onRetry={async (id) => {
            await retryUpload(id);
            setPollKey((n) => n + 1);
          }}
          onViewCandidates={() => {
            setUploadOpen(false);
            reload();
          }}
          onStartNew={() => setBatchId(null)}
        />
      )}
    </div>
  );
}
