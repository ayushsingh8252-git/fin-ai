"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckSquare, FileUp, Loader2, RefreshCw, Square,
  Users, Search, ChevronRight, X, LayoutGrid, Table as TableIcon,
  GripVertical, CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert,
  Send, UserCheck, XCircle, SlidersHorizontal, Briefcase, Sparkles, Activity, Trash2, MapPin
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  errorMessage, getJob, listCandidates, retryUpload,
  bulkSetStage, bulkAnalyze, setStage, updateJob, deleteJob,
  type CandidatePage, type Job, type Stage, type CandidateApplication
} from "@/lib/recruitmentApi";
import { AnalysisIndicator, ScoreCell, StageBadge, PipelineProgressionSvg, EmptyStateGeometricSvg } from "../../_components/indicators";
import { UploadPanel } from "../../_components/UploadPanel";
import { JobFormDialog } from "../../_components/JobFormDialog";
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

  // Alteration & Deletion State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Drag and Drop state
  const [draggedApp, setDraggedApp] = useState<CandidateApplication | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [pendingRejectApp, setPendingRejectApp] = useState<CandidateApplication | null>(null);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getJob(jobId),
      listCandidates(jobId, { page: 1, pageSize: 100 }),
    ])
      .then(([job, candidates]) => {
        if (!cancelled) setLoaded({ job, candidates });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, refresh]);

  const progress = useBatchProgress(batchId, reload, pollKey);

  const handleStatusToggle = async (newStatus: "open" | "closed") => {
    if (!loaded || !("job" in loaded)) return;
    try {
      await updateJob(jobId, { status: newStatus });
      toast("success", `Position marked as ${newStatus === "open" ? "Active" : "Closed"}.`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteJob(jobId);
      toast("success", "Position removed successfully.");
      router.push("/recruitment");
    } catch (err) {
      toast("error", errorMessage(err));
      setDeleting(false);
    }
  };

  // Candidates list derived
  const candidatesList = useMemo(() => {
    if (!loaded || !("candidates" in loaded)) return [];
    return loaded.candidates.items;
  }, [loaded]);

  const candidatesByStage = useMemo(() => {
    const map: Record<Stage, CandidateApplication[]> = {
      PROCESSING: [],
      APPLIED: [],
      SCREENING: [],
      SHORTLISTED: [],
      INTERVIEW: [],
      SELECTED: [],
      OFFER: [],
      HIRED: [],
      REJECTED: [],
      WITHDRAWN: [],
    };
    candidatesList.forEach((c) => {
      if (map[c.stage]) map[c.stage].push(c);
    });
    return map;
  }, [candidatesList]);

  const filteredCandidates = useMemo(() => {
    return candidatesList.filter((app) => {
      if (activeStageTab !== "ALL" && app.stage !== activeStageTab) return false;
      if (minScoreFilter > 0) {
        const val = app.scores.match_score.value;
        if (val === null || val < minScoreFilter) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = app.candidate.name?.toLowerCase().includes(q);
        const emailMatch = app.candidate.email?.toLowerCase().includes(q);
        const roleMatch = app.candidate.current_role?.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch && !roleMatch) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === "match_desc") {
        return (b.scores.match_score.value ?? -1) - (a.scores.match_score.value ?? -1);
      }
      if (sortBy === "ats_desc") {
        return (b.scores.ats_score.value ?? -1) - (a.scores.ats_score.value ?? -1);
      }
      if (sortBy === "name") {
        return (a.candidate.name || "").localeCompare(b.candidate.name || "");
      }
      return 0;
    });
  }, [candidatesList, activeStageTab, minScoreFilter, searchQuery, sortBy]);

  const allSelected = filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCandidates.map((c) => c.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkStage = async (targetStage: Stage) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setBulkError(null);
    try {
      const ids = Array.from(selectedIds);
      const res = await bulkSetStage(ids, targetStage);
      const successCount = res.results.filter((r) => r.status === "ok").length;
      toast("success", `Moved ${successCount} candidates to ${STAGE_LABEL[targetStage]}.`);
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
      const ids = Array.from(selectedIds);
      await bulkAnalyze(ids);
      toast("success", `Requested re-evaluation for ${ids.length} candidates.`);
      setSelectedIds(new Set());
      reload();
    } catch (err) {
      setBulkError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDropOnStage = async (targetStage: Stage) => {
    if (!draggedApp) return;
    const appId = draggedApp.id;
    const candidateName = draggedApp.candidate.name || "Candidate";

    if (targetStage === "REJECTED") {
      setPendingRejectApp(draggedApp);
      setDraggedApp(null);
      setDragOverStage(null);
      return;
    }

    setDraggedApp(null);
    setDragOverStage(null);

    try {
      await setStage(appId, targetStage);
      toast("success", `Moved ${candidateName} to ${STAGE_LABEL[targetStage]}.`);
      reload();
    } catch (err) {
      toast("error", `Could not move candidate: ${errorMessage(err)}`);
    }
  };

  const confirmRejection = async () => {
    if (!pendingRejectApp) return;
    try {
      await setStage(pendingRejectApp.id, "REJECTED", "Moved to Rejected via pipeline board");
      toast("success", `Candidate moved to Rejected.`);
      setPendingRejectApp(null);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  if (loaded === null) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-36 rounded bg-zinc-200" />
        <Skeleton className="h-10 w-64 rounded-xl bg-zinc-200" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-zinc-200" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl bg-zinc-200" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="max-w-md space-y-3 py-12">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="rounded-xl border-zinc-200">
          Try again
        </Button>
      </div>
    );
  }

  const { job } = loaded;
  const pipeline = job.pipeline;
  const isPipelineActive = Boolean(progress && !progress.status.done);

  return (
    <div className="space-y-5 pb-12">
      {/* Workspace Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <Link
            href="/recruitment"
            className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Positions
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
              {job.title}
            </h1>
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
              job.status === "open" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-100 text-zinc-600 border-zinc-200"
            )}>
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                job.status === "open" ? "bg-emerald-500" : "bg-zinc-400"
              )} />
              <span>{job.status === "open" ? "Active" : "Closed"}</span>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {job.department && (
              <span className="font-medium text-zinc-700">
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="flex items-center gap-1 text-zinc-500">
                <span className="text-zinc-300">·</span>
                <MapPin className="h-3 w-3 text-zinc-400" />
                {job.location}
              </span>
            )}
            {job.min_experience_years !== null && (
              <span className="text-zinc-500">
                <span className="text-zinc-300">·</span>
                {job.min_experience_years}+ yrs exp
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => handleStatusToggle(job.status === "open" ? "closed" : "open")}
            className="h-8 px-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            {job.status === "open" ? "Close Role" : "Reopen Role"}
          </button>
          <button
            onClick={() => setEditDialogOpen(true)}
            className="h-8 px-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            className="h-8 px-2 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
            title="Delete position"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* View Mode Switcher */}
          <div className="flex items-center rounded-lg border border-zinc-200/80 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              title="Table View"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all",
                viewMode === "table" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-zinc-900"
              )}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              title="Board View"
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all",
                viewMode === "board" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-zinc-900"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Board</span>
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 shadow-2xs"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5 text-zinc-400" />
            Refresh
          </Button>

          {can("upload") && job.status !== "closed" && (
            <Button
              size="sm"
              onClick={() => setUploadOpen(true)}
              className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-2xs px-3"
            >
              <FileUp className="mr-1 h-3.5 w-3.5" />
              Add Candidates
            </Button>
          )}
        </div>
      </div>

      {/* Sleek KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Total Candidates</span>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-zinc-900 font-mono">{job.total_candidates}</p>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Shortlisted</span>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-zinc-900 font-mono">{pipeline.SHORTLISTED ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">In Interview</span>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-zinc-900 font-mono">{pipeline.INTERVIEW ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Offers & Hired</span>
          <p className="mt-1 text-xl sm:text-2xl font-bold text-emerald-700 font-mono">{(pipeline.OFFER ?? 0) + (pipeline.HIRED ?? 0)}</p>
        </div>
      </div>

      {/* Live Agentic Execution Tracker */}
      {isPipelineActive && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
            <span className="font-semibold text-zinc-800">Processing Resumes</span>
          </div>
          <span className="font-mono text-zinc-600">
            {progress?.status.counts.parsed || 0} of {progress?.status.total || job.total_candidates} evaluated
          </span>
        </div>
      )}

      {/* Single Consolidated Search & Stage Toolbar */}
      <div className="space-y-2.5">
        {/* Stage Filter Pills in Table Mode */}
        {viewMode === "table" && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {ALL_STAGES_FILTER.map((st) => {
              const count = st.key === "ALL" ? job.total_candidates : (pipeline[st.key] ?? 0);
              const active = activeStageTab === st.key;
              const isDropTarget = st.key !== "ALL" && dragOverStage === st.key;

              return (
                <button
                  key={st.key}
                  type="button"
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
                  onClick={() => setActiveStageTab(st.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                    isDropTarget
                      ? "bg-blue-100 text-blue-900 ring-2 ring-blue-500"
                      : active
                      ? "bg-zinc-900 text-white shadow-xs"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  )}
                >
                  <span>{st.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                      active
                        ? "bg-zinc-800 text-white"
                        : count > 0
                        ? "bg-zinc-200 text-zinc-700"
                        : "bg-transparent text-zinc-400"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search & Score Controls */}
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200/80 bg-white p-2 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search candidates by name, email, or role..."
              className="w-full rounded-lg border border-zinc-200/80 bg-zinc-50/60 py-1.5 pl-8 pr-7 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={minScoreFilter}
              onChange={(e) => setMinScoreFilter(Number(e.target.value))}
              className="h-8 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 focus:outline-none"
            >
              <option value={0}>All Match Scores</option>
              <option value={80}>≥ 80% Match</option>
              <option value={70}>≥ 70% Match</option>
              <option value={50}>≥ 50% Match</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-8 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 focus:outline-none"
            >
              <option value="match_desc">Sort: Match Score</option>
              <option value="ats_desc">Sort: ATS Score</option>
              <option value="name">Sort: Name</option>
            </select>
          </div>
        </div>
      </div>

      {bulkError && <ErrorBanner message={bulkError} />}

      {/* VIEW 1: TABLE VIEW */}
      {viewMode === "table" && (
        <section className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-2xs">
          {filteredCandidates.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="mx-auto h-8 w-8 text-zinc-300" />
              <h3 className="mt-2 text-sm font-bold text-zinc-800">No Candidates Found</h3>
              <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
                {candidatesList.length === 0
                  ? "No resumes have been uploaded for this position. Click 'Add Candidates' to upload resumes."
                  : "No candidates match the active search or filters."}
              </p>
              {candidatesList.length === 0 && can("upload") && (
                <Button
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="mt-4 h-8 rounded-lg bg-zinc-900 text-xs font-semibold text-white"
                >
                  <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  Add Candidates
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-zinc-50/70 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                  <tr>
                    <th className="w-8 px-3 py-3 text-center text-zinc-400">
                      <span className="sr-only">Drag</span>
                    </th>
                    <th className="w-10 px-3 py-3">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="flex items-center text-zinc-400 hover:text-zinc-800 focus:outline-none"
                      >
                        {allSelected ? <CheckSquare className="h-4 w-4 text-zinc-900" /> : <Square className="h-4 w-4" />}
                      </button>
                    </th>
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Experience</th>
                    <th className="px-4 py-3">ATS Score</th>
                    <th className="px-4 py-3">Match Score</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredCandidates.map((app) => {
                    const isSelected = selectedIds.has(app.id);
                    const isBeingDragged = draggedApp?.id === app.id;
                    const matchVal = app.scores.match_score.value;
                    const atsVal = app.scores.ats_score.value;
                    const expYears = app.candidate.experience_years;
                    const name = app.candidate.name || "Candidate";
                    const initials = name
                      .split(/[\s@._-]+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0].toUpperCase())
                      .join("") || "C";

                    return (
                      <tr
                        key={app.id}
                        draggable={true}
                        onDragStart={() => setDraggedApp(app)}
                        onDragEnd={() => setDraggedApp(null)}
                        onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                        className={cn(
                          "group cursor-pointer transition-colors duration-150",
                          isBeingDragged ? "opacity-40 bg-zinc-100" : isSelected ? "bg-zinc-50" : "hover:bg-zinc-50/70"
                        )}
                      >
                        {/* Drag Handle */}
                        <td className="w-8 px-3 py-3.5 text-center text-zinc-300 group-hover:text-zinc-600 cursor-grab">
                          <GripVertical className="h-3.5 w-3.5 mx-auto" />
                        </td>

                        {/* Checkbox */}
                        <td className="w-10 px-3 py-3.5">
                          <button
                            type="button"
                            onClick={(e) => toggleSelect(app.id, e)}
                            className="flex items-center text-zinc-400 hover:text-zinc-800"
                          >
                            {isSelected ? <CheckSquare className="h-4 w-4 text-zinc-900" /> : <Square className="h-4 w-4" />}
                          </button>
                        </td>

                        {/* Candidate Name & Role */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white font-bold text-[10px]">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-xs text-zinc-900 truncate">{name}</p>
                              <p className="text-[11px] text-zinc-500 truncate font-medium">
                                {app.candidate.current_role || app.candidate.email || "Applicant"}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Experience */}
                        <td className="px-4 py-3.5 text-xs text-zinc-600 font-medium">
                          {expYears !== null && expYears !== undefined ? `${expYears}y exp` : "—"}
                        </td>

                        {/* ATS Score */}
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-zinc-700">
                          {atsVal !== null ? `${atsVal}%` : "—"}
                        </td>

                        {/* Match Fit Score */}
                        <td className="px-4 py-3.5">
                          {matchVal !== null ? (
                            <span className={cn(
                              "font-bold font-mono text-xs px-2 py-0.5 rounded-full border",
                              matchVal >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : matchVal >= 60 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-amber-50 text-amber-700 border-amber-200"
                            )}>
                              {matchVal}%
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Stage */}
                        <td className="px-4 py-3.5">
                          <StageBadge stage={app.stage} />
                        </td>

                        {/* Action */}
                        <td className="px-5 py-3.5 text-right">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-zinc-900">
                            Profile
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
        <div className="flex gap-3 overflow-x-auto pb-6 scrollbar-thin">
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
                  "flex flex-col rounded-xl border bg-zinc-50/70 p-3 w-72 shrink-0 min-h-[480px] shadow-2xs transition-all",
                  isTarget
                    ? "border-zinc-900 bg-zinc-100 ring-2 ring-zinc-900/20"
                    : "border-zinc-200/80"
                )}
              >
                {/* Stage Header */}
                <div className="flex items-center justify-between pb-2.5 border-b border-zinc-200/70 mb-2.5 px-0.5">
                  <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider">
                    {STAGE_LABEL[stage] || stage}
                  </span>
                  <span className="rounded-full bg-white border border-zinc-200 px-2 py-0.2 text-[10px] font-bold text-zinc-600 font-mono">
                    {list.length}
                  </span>
                </div>

                {/* Candidate Cards in Stage */}
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[600px] pr-0.5">
                  {list.map((app) => {
                    const matchVal = app.scores.match_score.value;
                    const isBeingDragged = draggedApp?.id === app.id;
                    const name = app.candidate.name || "Candidate";
                    const initials = name
                      .split(/[\s@._-]+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0].toUpperCase())
                      .join("") || "C";

                    return (
                      <div
                        key={app.id}
                        draggable={true}
                        onDragStart={() => setDraggedApp(app)}
                        onDragEnd={() => setDraggedApp(null)}
                        onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                        className={cn(
                          "rounded-lg border bg-white p-3 shadow-2xs cursor-grab active:cursor-grabbing transition-all hover:border-zinc-400",
                          isBeingDragged ? "opacity-30 border-dashed border-zinc-500" : "border-zinc-200/80"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white font-bold text-[10px]">
                              {initials}
                            </div>
                            <p className="text-xs font-bold text-zinc-900 truncate">
                              {name}
                            </p>
                          </div>
                          <GripVertical className="h-3 w-3 text-zinc-300 shrink-0" />
                        </div>

                        <p className="text-[11px] text-zinc-500 truncate mt-1 font-medium">
                          {app.candidate.current_role || "Applicant"}
                        </p>

                        <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-1.5 text-[10px]">
                          <span className="text-zinc-500 font-medium">
                            {app.candidate.experience_years !== null ? `${app.candidate.experience_years}y exp` : "—"}
                          </span>
                          {matchVal !== null && (
                            <span className={cn(
                              "font-bold font-mono px-1.5 py-0.2 rounded-full border",
                              matchVal >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"
                            )}>
                              {matchVal}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {list.length === 0 && (
                    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-zinc-400 font-medium">
                      No candidates
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
        <div className="fixed bottom-6 inset-x-0 z-40 mx-auto max-w-md px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-white shadow-xl">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-white">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
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
                className="h-8 rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-xs font-semibold text-white focus:outline-none"
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
                className="h-8 rounded-lg border-zinc-700 bg-zinc-800 text-xs font-semibold text-white hover:bg-zinc-700"
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
          <DialogContent className="sm:max-w-md rounded-xl border-zinc-200 bg-white p-5 shadow-xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-zinc-900">Confirm Rejection</DialogTitle>
              <DialogDescription className="text-xs text-zinc-600 mt-1">
                Move <strong className="text-zinc-900">{pendingRejectApp.candidate.name}</strong> to the Rejected stage?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPendingRejectApp(null)}
                className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmRejection}
                className="h-8 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white"
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

      {/* Edit Position Dialog */}
      <JobFormDialog
        open={editDialogOpen}
        job={job}
        onOpenChange={setEditDialogOpen}
        onSaved={() => {
          setEditDialogOpen(false);
          reload();
        }}
      />

      {/* Delete Position Confirmation Dialog */}
      {deleteConfirmOpen && (
        <Dialog open={deleteConfirmOpen} onOpenChange={(open) => !open && !deleting && setDeleteConfirmOpen(false)}>
          <DialogContent className="sm:max-w-md rounded-xl border-zinc-200 bg-white p-5 shadow-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-zinc-900">Remove Position</DialogTitle>
              <DialogDescription className="text-xs text-zinc-600 mt-1">
                Are you sure you want to remove <strong className="text-zinc-900">{job.title}</strong>? This will permanently delete this role and its associated applications.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
                className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="h-8 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white"
              >
                {deleting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Remove Position
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
