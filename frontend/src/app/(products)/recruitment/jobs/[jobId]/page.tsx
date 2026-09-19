"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckSquare, FileUp, Loader2, RefreshCw, Square,
  Users, Search, ChevronRight,
  Building2, MapPin, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  errorMessage, getJob, listCandidates, retryUpload,
  bulkSetStage, bulkAnalyze, setStage,
  type CandidatePage, type Job, type Stage
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
    Promise.all([getJob(jobId), listCandidates(jobId, { pageSize: 100 })])
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
      toast("success", `Queued re-scoring for ${selectedIds.size} candidates.`);
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
        <Skeleton className="h-6 w-36 rounded" />
        <Skeleton className="h-8 w-64 rounded-md" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="max-w-md space-y-3 py-12">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="rounded-md">
          Try again
        </Button>
      </div>
    );
  }

  const { job } = loaded;
  const pipeline = job.pipeline;

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <Link
            href="/recruitment"
            className="mb-1.5 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All Positions
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
              {job.title}
            </h1>
            <StatusPill tone={job.status === "open" ? "success" : "neutral"}>
              {job.status === "open" ? "Active" : job.status === "closed" ? "Closed" : "Draft"}
            </StatusPill>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs text-zinc-500">
            {job.department && (
              <span className="inline-flex items-center gap-1 font-medium text-zinc-700">
                <Building2 className="h-3 w-3 text-zinc-400" />
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1 font-medium text-zinc-600">
                <MapPin className="h-3 w-3 text-zinc-400" />
                {job.location}
              </span>
            )}
            {job.min_experience_years !== null && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.2 text-[10px] font-medium text-zinc-700">
                {job.min_experience_years}+ Yrs Required
              </span>
            )}
            <span className="text-zinc-300">·</span>
            <span>
              <strong className="font-semibold text-zinc-800">{job.total_candidates}</strong> total applicants
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-zinc-500" />
            Refresh
          </Button>

          {can("upload") && job.status !== "closed" && (
            <Button
              size="sm"
              onClick={() => setUploadOpen(true)}
              className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <FileUp className="mr-1.5 h-3.5 w-3.5" />
              Upload Resumes
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200/80 bg-white p-3.5 shadow-xs">
          <p className="text-xs font-medium text-zinc-500">Total Applicants</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">{job.total_candidates}</p>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-white p-3.5 shadow-xs">
          <p className="text-xs font-medium text-zinc-500">Shortlisted</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">{pipeline.SHORTLISTED ?? 0}</p>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-white p-3.5 shadow-xs">
          <p className="text-xs font-medium text-zinc-500">In Interview</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">{pipeline.INTERVIEW ?? 0}</p>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-white p-3.5 shadow-xs">
          <p className="text-xs font-medium text-zinc-500">Offers Extended</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">{pipeline.OFFER ?? 0}</p>
        </div>
      </div>

      {/* Stage Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
        {ALL_STAGES_FILTER.map((st) => {
          const count = st.key === "ALL" ? job.total_candidates : (pipeline[st.key] ?? 0);
          const active = activeStageTab === st.key;
          return (
            <button
              key={st.key}
              onClick={() => setActiveStageTab(st.key)}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0",
                active
                  ? "bg-zinc-900 text-white"
                  : "bg-white border border-zinc-200/80 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              )}
            >
              <span>{st.label}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.2 text-[10px] font-medium tabular-nums",
                  active
                    ? "bg-zinc-800 text-white"
                    : count > 0
                    ? "bg-zinc-100 text-zinc-700"
                    : "bg-zinc-50 text-zinc-400"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search, Score Filters & Controls Bar */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200/80 bg-white p-2.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search applicants by name, email, or past role..."
            className="w-full rounded-md border border-zinc-200 bg-zinc-50/50 py-1.5 pl-8 pr-7 text-xs font-normal text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
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
            className="h-8 rounded-md border border-zinc-200 bg-zinc-50/50 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none"
          >
            <option value={0}>All Match Scores</option>
            <option value={80}>≥ 80% Match</option>
            <option value={70}>≥ 70% Match</option>
            <option value={50}>≥ 50% Match</option>
          </select>

          {/* Sort By Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-md border border-zinc-200 bg-zinc-50/50 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none"
          >
            <option value="match_desc">Sort: Match Score</option>
            <option value="ats_desc">Sort: ATS Quality</option>
            <option value="name">Sort: Candidate Name</option>
          </select>
        </div>
      </div>

      {bulkError && <ErrorBanner message={bulkError} />}

      {/* Main Candidate Table Section */}
      <section className="overflow-hidden rounded-lg border border-zinc-200/80 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-zinc-200/80 bg-zinc-50/50 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Candidate Pool ({filteredCandidates.length})
            </h2>
            {progress && !progress.status.done && (
              <span className="inline-flex items-center gap-1.5 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                Parsing Resumes…
              </span>
            )}
          </div>
        </div>

        {filteredCandidates.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-8 w-8 text-zinc-300" />
            <h3 className="mt-2 text-sm font-semibold text-zinc-900">No candidates found</h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
              {candidatesList.length === 0
                ? "No resumes have been uploaded for this role. Click 'Upload Resumes' to ingest candidate PDF files."
                : "No candidates match the active search and filter criteria."}
            </p>
            {candidatesList.length === 0 && can("upload") && (
              <Button
                size="sm"
                onClick={() => setUploadOpen(true)}
                className="mt-3 h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
              >
                <FileUp className="mr-1.5 h-3.5 w-3.5" />
                Upload PDF Resumes
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs">
              <thead className="bg-zinc-50/80 text-[11px] font-medium uppercase tracking-wider text-zinc-500 border-b border-zinc-200/80">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none"
                    >
                      {allSelected ? <CheckSquare className="h-4 w-4 text-zinc-900" /> : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-medium">Candidate</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="px-3 py-2.5 font-medium">Match Fit</th>
                  <th className="px-3 py-2.5 font-medium">ATS Score</th>
                  <th className="px-3 py-2.5 font-medium">Analysis Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredCandidates.map((app) => {
                  const isSelected = selectedIds.has(app.id);
                  const candInitials = initials(app.candidate.name || "C");
                  const matchVal = app.scores.match_score.value;

                  return (
                    <tr
                      key={app.id}
                      onClick={() => router.push(`/recruitment/jobs/${jobId}/candidates/${app.id}`)}
                      className={cn(
                        "group cursor-pointer transition-colors",
                        isSelected ? "bg-zinc-50" : "hover:bg-zinc-50/70"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-4 py-3" onClick={(e) => toggleSelectOne(app.id, e)}>
                        <button type="button" className="flex items-center text-zinc-400 hover:text-zinc-600 focus:outline-none">
                          {isSelected ? <CheckSquare className="h-4 w-4 text-zinc-900" /> : <Square className="h-4 w-4" />}
                        </button>
                      </td>

                      {/* Candidate Avatar & Details */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold text-white">
                            {candInitials}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-zinc-900 group-hover:text-blue-600 transition-colors">
                              {app.candidate.name || "Unnamed Candidate"}
                            </p>
                            <p className="truncate text-[11px] text-zinc-500 font-normal">
                              {app.candidate.current_role || app.candidate.email || "Applicant"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Current Stage */}
                      <td className="px-3 py-3">
                        <StageBadge stage={app.stage} />
                      </td>

                      {/* Job Match Score */}
                      <td className="px-3 py-3">
                        {matchVal !== null ? (
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-xs font-semibold tabular-nums",
                              matchVal >= 80 ? "text-emerald-700" : matchVal >= 65 ? "text-zinc-900" : "text-zinc-600"
                            )}>
                              {matchVal}%
                            </span>
                            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-200",
                                  matchVal >= 80 ? "bg-emerald-600" : matchVal >= 65 ? "bg-zinc-700" : "bg-zinc-400"
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
                      <td className="px-3 py-3">
                        <ScoreCell score={app.scores.ats_score} />
                      </td>

                      {/* Analysis Indicator */}
                      <td className="px-3 py-3">
                        <AnalysisIndicator status={app.analysis_status} error={app.analysis_error} />
                      </td>

                      {/* Row Action Link */}
                      <td className="px-3 py-3 text-right">
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500 group-hover:text-zinc-900 transition-colors">
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

      {/* Floating Bulk Action Dock */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-5 inset-x-0 z-40 mx-auto max-w-lg px-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-white shadow-xl">
            <div className="flex items-center gap-2.5">
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
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
                className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 focus:outline-none"
              >
                <option value="" disabled>Move to stage…</option>
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
                className="h-7 rounded-md border-zinc-700 bg-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white"
              >
                {bulkLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Re-Score"}
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
