"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckSquare, FileUp, Loader2, RefreshCw, Square,
  Users, Search, Filter, ShieldCheck, ShieldAlert, Award,
  Sparkles, CheckCircle2, ChevronRight, SlidersHorizontal, ArrowUpDown,
  Building2, MapPin, Briefcase, ExternalLink, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  errorMessage, getJob, listCandidates, retryUpload,
  bulkSetStage, bulkAnalyze, setStage,
  type CandidatePage, type Job, type Stage, type CandidateBrief
} from "@/lib/recruitmentApi";
import { AnalysisIndicator, ScoreCell, StageBadge } from "../../_components/indicators";
import { UploadPanel } from "../../_components/UploadPanel";
import { useBatchProgress } from "../../_components/useBatchProgress";
import { useRecruitment } from "../../_components/RecruitmentShell";
import { STAGE_LABEL, initials } from "../../_components/stages";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type LoadState = { job: Job; candidates: CandidatePage } | { error: string } | null;

const ALL_STAGES_FILTER: { key: Stage | "ALL"; label: string }[] = [
  { key: "ALL", label: "All Applicants" },
  { key: "APPLIED", label: "Applied" },
  { key: "PROCESSING", label: "Processing" },
  { key: "SCREENING", label: "Screening" },
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

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeStageTab, setActiveStageTab] = useState<Stage | "ALL">("ALL");
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"match_desc" | "ats_desc" | "name">("match_desc");

  // Bulk actions state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const progress = useBatchProgress(batchId, reload, pollKey);

  useEffect(() => {
    let cancelled = false;
    setSelectedIds(new Set());
    Promise.all([getJob(jobId), listCandidates(jobId, { pageSize: 150 })])
      .then(([job, candidates]) => !cancelled && setLoaded({ job, candidates }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => { cancelled = true; };
  }, [jobId, refresh]);

  const candidatesList = loaded && "candidates" in loaded ? loaded.candidates.items : [];

  // Filter & sort candidates
  const filteredCandidates = useMemo(() => {
    return candidatesList.filter((app) => {
      // Stage filter
      if (activeStageTab !== "ALL" && app.stage !== activeStageTab) return false;

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
  }, [candidatesList, activeStageTab, minScoreFilter, searchQuery, sortBy]);

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
      toast("success", `Queued AI resume re-analysis for ${selectedIds.size} candidates.`);
      setSelectedIds(new Set());
      reload();
    } catch (err) {
      setBulkError(errorMessage(err));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleSingleStageChange = async (appId: string, stage: Stage, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await setStage(appId, stage);
      toast("success", `Status changed to ${STAGE_LABEL[stage] || stage}.`);
      reload();
    } catch (err) {
      toast("error", `Failed to update stage: ${errorMessage(err)}`);
    }
  };

  if (loaded === null) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="max-w-lg space-y-4 py-12">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" onClick={reload} className="rounded-xl">
          Try again
        </Button>
      </div>
    );
  }

  const { job } = loaded;
  const pipeline = job.pipeline;
  const processing = (pipeline.PROCESSING ?? 0) + (pipeline.SCREENING ?? 0);

  return (
    <div className="space-y-8">
      {/* Workspace Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/recruitment"
            className="mb-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to All Roles
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
              {job.title}
            </h1>
            <StatusPill tone={job.status === "open" ? "success" : "neutral"}>
              {job.status === "open" ? "Active Role" : job.status === "closed" ? "Closed" : "Draft"}
            </StatusPill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {job.department && (
              <span className="inline-flex items-center gap-1 font-medium text-zinc-700">
                <Building2 className="h-3.5 w-3.5 text-zinc-400" />
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1 font-medium text-zinc-600">
                <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                {job.location}
              </span>
            )}
            {job.min_experience_years !== null && (
              <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-bold text-zinc-700">
                {job.min_experience_years}+ Years Required
              </span>
            )}
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-500">
              <strong className="text-zinc-800">{job.total_candidates}</strong> total applicants
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="rounded-xl border-zinc-200 text-xs font-semibold shadow-xs"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>

          {can("upload") && job.status !== "closed" && (
            <Button
              variant="brand"
              onClick={() => setUploadOpen(true)}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-md shadow-blue-500/25"
            >
              <FileUp className="mr-1.5 h-4 w-4" />
              Upload Resumes
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
          <p className="text-xs font-semibold text-zinc-500">Total Applicants</p>
          <p className="mt-1 text-2xl font-black text-zinc-900 tabular-nums">{job.total_candidates}</p>
        </div>
        <div className="rounded-2xl border border-blue-200/80 bg-blue-50/40 p-4 shadow-xs">
          <p className="text-xs font-semibold text-blue-700">Shortlisted</p>
          <p className="mt-1 text-2xl font-black text-blue-900 tabular-nums">{pipeline.SHORTLISTED ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 shadow-xs">
          <p className="text-xs font-semibold text-amber-700">In Interview</p>
          <p className="mt-1 text-2xl font-black text-amber-900 tabular-nums">{pipeline.INTERVIEW ?? 0}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 shadow-xs">
          <p className="text-xs font-semibold text-emerald-700">Offers Extended</p>
          <p className="mt-1 text-2xl font-black text-emerald-900 tabular-nums">{pipeline.OFFER ?? 0}</p>
        </div>
      </div>

      {/* Interactive Kanban-style Stage Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {ALL_STAGES_FILTER.map((st) => {
          const count = st.key === "ALL" ? job.total_candidates : (pipeline[st.key] ?? 0);
          const active = activeStageTab === st.key;
          return (
            <button
              key={st.key}
              onClick={() => setActiveStageTab(st.key)}
              className={cn(
                "group flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-bold transition-all shrink-0",
                active
                  ? "bg-zinc-900 text-white shadow-sm"
                  : "bg-white border border-zinc-200/80 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
              )}
            >
              <span>{st.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                  active
                    ? "bg-white/20 text-white"
                    : count > 0
                    ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200/60"
                    : "bg-zinc-100 text-zinc-400"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search, Score Filters & Controls Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search applicants by candidate name, email, or past role..."
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-8 text-xs font-medium text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 sm:border-t-0 sm:pt-0">
          {/* Min Score Filter */}
          <select
            value={minScoreFilter}
            onChange={(e) => setMinScoreFilter(Number(e.target.value))}
            className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 focus:outline-none"
          >
            <option value={0}>All Match Scores</option>
            <option value={80}>≥ 80% Strong Match</option>
            <option value={70}>≥ 70% Good Match</option>
            <option value={50}>≥ 50% Baseline Match</option>
          </select>

          {/* Sort By Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 focus:outline-none"
          >
            <option value="match_desc">Sort: Match Score (High to Low)</option>
            <option value="ats_desc">Sort: ATS Quality Score</option>
            <option value="name">Sort: Candidate Name</option>
          </select>
        </div>
      </div>

      {bulkError && <ErrorBanner message={bulkError} />}

      {/* Main Candidate Table Section */}
      <section className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-zinc-900">
              Candidate Pool ({filteredCandidates.length})
            </h2>
            {progress && !progress.status.done && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Parsing Resumes...
              </span>
            )}
          </div>
        </div>

        {filteredCandidates.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-zinc-300" />
            <h3 className="mt-3 text-base font-bold text-zinc-900">No candidates found</h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
              {candidatesList.length === 0
                ? "No resumes have been uploaded for this position yet. Click 'Upload Resumes' to feed PDF resumes to the AI engine."
                : "No candidates match the active search and filter criteria."}
            </p>
            {candidatesList.length === 0 && can("upload") && (
              <Button
                variant="brand"
                size="sm"
                onClick={() => setUploadOpen(true)}
                className="mt-4 rounded-xl font-semibold shadow-md shadow-blue-500/25"
              >
                <FileUp className="mr-1.5 h-4 w-4" />
                Upload PDF Resumes
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-zinc-50/80 text-[11px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                <tr>
                  <th className="w-12 px-5 py-3.5">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none"
                    >
                      {allSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-4 py-3.5">Candidate</th>
                  <th className="px-4 py-3.5">Stage</th>
                  <th className="px-4 py-3.5">Match Score</th>
                  <th className="px-4 py-3.5">ATS Score</th>
                  <th className="px-4 py-3.5">Integrity / Analysis</th>
                  <th className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {filteredCandidates.map((app) => {
                  const isSelected = selectedIds.has(app.id);
                  const candInitials = initials(app.candidate.name || "C");
                  const matchVal = app.scores.match_score.value;
                  const atsVal = app.scores.ats_score.value;

                  return (
                    <tr
                      key={app.id}
                      onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                      className={cn(
                        "group cursor-pointer transition-colors",
                        isSelected ? "bg-blue-50/40" : "hover:bg-zinc-50/80"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="w-12 px-5 py-4" onClick={(e) => toggleSelectOne(app.id, e)}>
                        <button type="button" className="flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none">
                          {isSelected ? <CheckSquare className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>

                      {/* Candidate Avatar & Details */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-xs">
                            {candInitials}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-bold text-zinc-900 group-hover:text-blue-600 transition-colors">
                              {app.candidate.name || "Unnamed Candidate"}
                            </p>
                            <p className="truncate text-xs text-zinc-500">
                              {app.candidate.current_role || app.candidate.email || "Applicant"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Current Stage */}
                      <td className="px-4 py-4">
                        <StageBadge stage={app.stage} />
                      </td>

                      {/* Job Match Score Meter */}
                      <td className="px-4 py-4">
                        {matchVal !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <span className={cn(
                                "text-sm font-black tabular-nums",
                                matchVal >= 80 ? "text-emerald-700" : matchVal >= 65 ? "text-blue-700" : "text-amber-700"
                              )}>
                                {matchVal}%
                              </span>
                              <span className="text-[10px] font-semibold text-zinc-400">
                                {matchVal >= 80 ? "Strong Match" : matchVal >= 65 ? "Good Match" : "Baseline"}
                              </span>
                            </div>
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  matchVal >= 80 ? "bg-emerald-500" : matchVal >= 65 ? "bg-blue-500" : "bg-amber-400"
                                )}
                                style={{ width: `${Math.min(100, matchVal)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>

                      {/* ATS Score */}
                      <td className="px-4 py-4">
                        <ScoreCell score={app.scores.ats_score} />
                      </td>

                      {/* Analysis / Integrity Indicator */}
                      <td className="px-4 py-4">
                        <AnalysisIndicator status={app.analysis_status} error={app.analysis_error} />
                      </td>

                      {/* Row Action Link */}
                      <td className="px-4 py-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform">
                          360° Profile
                          <ChevronRight className="h-3.5 w-3.5" />
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

      {/* Floating Bulk Action Dock */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 inset-x-0 z-50 mx-auto max-w-2xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700/60 bg-zinc-950/95 px-6 py-3.5 text-white shadow-2xl backdrop-blur-xl ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center rounded-lg bg-blue-600/30 px-2.5 py-1 text-xs font-bold text-blue-300 ring-1 ring-blue-500/30">
                {selectedIds.size} Selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
              >
                Clear selection
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <select
                defaultValue=""
                disabled={bulkLoading}
                onChange={(e) => {
                  const stage = e.target.value as Stage;
                  if (stage) handleBulkStage(stage);
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus:outline-none"
              >
                <option value="" disabled>Advance to stage...</option>
                <option value="SHORTLISTED">Shortlist</option>
                <option value="INTERVIEW">Interview</option>
                <option value="SELECTED">Select</option>
                <option value="OFFER">Extend Offer</option>
                <option value="REJECTED">Reject</option>
                <option value="WITHDRAWN">Withdrawn</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                disabled={bulkLoading}
                onClick={handleBulkAnalyze}
                className="rounded-xl border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                {bulkLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-blue-400" />}
                Re-Score AI
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Resumes Modal Panel */}
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
