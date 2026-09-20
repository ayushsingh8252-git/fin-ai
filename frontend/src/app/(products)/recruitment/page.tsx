"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase, Search, Plus, MapPin, Users,
  ArrowRight, Loader2, CheckCircle2,
  X, Clock, Activity, Download,
  Layers, Inbox, ArrowUpRight, Trash2, Edit2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, listJobs, seedDemoPipeline, updateJob, deleteJob, type Job } from "@/lib/recruitmentApi";
import { JobFormDialog } from "./_components/JobFormDialog";
import { useRecruitment } from "./_components/RecruitmentShell";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Loaded = { jobs: Job[] } | { error: string } | null;

// ── Metric Card ─────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string | number;
  subtext: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold tracking-tight text-zinc-900 font-mono">
          {value}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{subtext}</p>
    </div>
  );
}

// ── Requisition Table Row ───────────────────────────────────────────────────
function JobTableRow({
  job,
  code,
  onEdit,
  onStatusToggle,
  onDelete,
}: {
  job: Job;
  code: string;
  onEdit: (job: Job) => void;
  onStatusToggle: (job: Job, newStatus: "open" | "closed") => void;
  onDelete: (job: Job) => void;
}) {
  const isOpen = job.status === "open";
  const p = job.pipeline;
  const total = job.total_candidates || 0;
  const inReview = (p.APPLIED ?? 0) + (p.SHORTLISTED ?? 0);
  const inInterview = p.INTERVIEW ?? 0;
  const inClosing = (p.OFFER ?? 0) + (p.HIRED ?? 0);

  return (
    <tr className="group hover:bg-zinc-50/70 transition-colors border-b border-zinc-100 last:border-0">
      <td className="px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-bold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
              {code}
            </span>
            <Link
              href={`/recruitment/jobs/${job.id}`}
              className="font-bold text-xs text-zinc-900 hover:text-blue-600 transition-colors truncate max-w-sm block"
            >
              {job.title}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {job.department && (
              <span className="rounded bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 text-[11px]">
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="flex items-center gap-0.5 text-zinc-400 text-[11px]">
                <MapPin className="h-3 w-3" />
                {job.location}
              </span>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-4 text-xs text-zinc-600 font-medium whitespace-nowrap">
        {job.min_experience_years !== null ? (
          <span className="font-mono text-xs font-semibold text-zinc-800">
            {job.min_experience_years}+ yrs
          </span>
        ) : (
          <span className="text-zinc-400 text-xs">Flexible</span>
        )}
      </td>

      <td className="px-4 py-4 whitespace-nowrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-xs text-zinc-900">{total} candidates</span>
          </div>
          <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 font-medium">
            {total === 0 ? (
              <span className="text-zinc-400">No applicants yet</span>
            ) : (
              <span>
                {inReview > 0 && `${inReview} review · `}
                {inInterview > 0 && `${inInterview} interview · `}
                {inClosing > 0 && `${inClosing} offer/hired`}
                {inReview === 0 && inInterview === 0 && inClosing === 0 && `${total} total`}
              </span>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-4 whitespace-nowrap">
        <button
          onClick={() => onStatusToggle(job, isOpen ? "closed" : "open")}
          title={`Click to mark as ${isOpen ? "Closed" : "Active"}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-all",
            isOpen
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
              : "bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200"
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", isOpen ? "bg-emerald-500" : "bg-zinc-400")} />
          <span>{isOpen ? "Active" : "Closed"}</span>
        </button>
      </td>

      <td className="px-5 py-4 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => onEdit(job)}
            title="Edit position"
            className="h-8 px-2.5 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(job)}
            title="Delete position"
            className="h-8 px-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <Link
            href={`/recruitment/jobs/${job.id}`}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 transition-all shadow-2xs"
          >
            <span>Pipeline</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

// ── Main Positions Dashboard ───────────────────────────────────────────────
export default function JobsPage() {
  const { can, triggerRefresh, refreshCount } = useRecruitment();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [pendingDeleteJob, setPendingDeleteJob] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((jobs) => !cancelled && setLoaded({ jobs }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [attempt, refreshCount]);

  const openCreateForm = () => {
    setEditingJob(undefined);
    setFormKey((k) => k + 1);
    setDialogOpen(true);
  };

  const openEditForm = (job: Job) => {
    setEditingJob(job);
    setFormKey((k) => k + 1);
    setDialogOpen(true);
  };

  const handleStatusToggle = async (job: Job, newStatus: "open" | "closed") => {
    try {
      await updateJob(job.id, { status: newStatus });
      toast("success", `Position marked as ${newStatus === "open" ? "Active" : "Closed"}.`);
      triggerRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteJob) return;
    setDeleting(true);
    try {
      await deleteJob(pendingDeleteJob.id);
      toast("success", `Position "${pendingDeleteJob.title}" removed.`);
      setPendingDeleteJob(null);
      triggerRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    if (!loaded || !("jobs" in loaded)) return;
    const headers = [
      "Code", "Title", "Department", "Location", "Min Experience", "Candidates", "Status"
    ];
    const rows = loaded.jobs.map((j, idx) => [
      `REQ-${String(idx + 1040)}`,
      `"${j.title.replace(/"/g, '""')}"`,
      `"${j.department || ""}"`,
      `"${j.location || ""}"`,
      j.min_experience_years ?? "Flexible",
      j.total_candidates,
      j.status,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Positions_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("success", "Exported CSV.");
  };

  const departments = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) return [];
    const set = new Set<string>();
    loaded.jobs.forEach((j) => {
      if (j.department) set.add(j.department);
    });
    return Array.from(set);
  }, [loaded]);

  const { metrics, pipelineTotals } = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) {
      return {
        metrics: { activeJobs: 0, totalCandidates: 0, inScreening: 0, offers: 0 },
        pipelineTotals: { APPLIED: 0, SHORTLISTED: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0 }
      };
    }
    const jobs = loaded.jobs;
    const activeJobs = jobs.filter((j) => j.status === "open").length;
    let totalCandidates = 0;
    let inScreening = 0;
    let offers = 0;
    const pipelineTotals: Record<string, number> = { APPLIED: 0, SHORTLISTED: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0 };

    jobs.forEach((j) => {
      totalCandidates += j.total_candidates;
      inScreening += (j.pipeline.SCREENING ?? 0) + (j.pipeline.SHORTLISTED ?? 0) + (j.pipeline.INTERVIEW ?? 0);
      offers += (j.pipeline.OFFER ?? 0) + (j.pipeline.HIRED ?? 0);
      Object.entries(j.pipeline).forEach(([k, v]) => {
        if (pipelineTotals[k] !== undefined) {
          pipelineTotals[k] += (v || 0);
        }
      });
    });

    return {
      metrics: { activeJobs, totalCandidates, inScreening, offers },
      pipelineTotals
    };
  }, [loaded]);

  const filteredJobs = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) return [];
    return loaded.jobs.filter((j) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = j.title.toLowerCase().includes(q);
        const matchDept = j.department?.toLowerCase().includes(q);
        const matchSkill = j.must_have_skills?.some((s) => s.toLowerCase().includes(q));
        if (!matchTitle && !matchDept && !matchSkill) return false;
      }
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (selectedDept !== "all" && j.department !== selectedDept) return false;
      if (selectedStage && (j.pipeline[selectedStage as keyof typeof j.pipeline] || 0) === 0) return false;
      return true;
    });
  }, [loaded, searchQuery, statusFilter, selectedDept, selectedStage]);

  const STAGE_FILTERS = [
    { key: "APPLIED", label: "Applied", count: pipelineTotals.APPLIED },
    { key: "SHORTLISTED", label: "Shortlisted", count: pipelineTotals.SHORTLISTED },
    { key: "INTERVIEW", label: "Interview", count: pipelineTotals.INTERVIEW },
    { key: "OFFER", label: "Offer", count: pipelineTotals.OFFER },
    { key: "HIRED", label: "Hired", count: pipelineTotals.HIRED },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Executive Clean Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">
            Positions
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            {metrics.activeJobs} active requisitions · {metrics.totalCandidates} candidates in pipeline
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!loaded || !("jobs" in loaded) || loaded.jobs.length === 0}
            className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            <Download className="h-3.5 w-3.5 mr-1 text-zinc-500" />
            Export CSV
          </Button>

          {can("create_job") && (
            <Button
              size="sm"
              onClick={openCreateForm}
              className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs inline-flex items-center gap-1.5 px-3 shadow-2xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Position</span>
            </Button>
          )}
        </div>
      </div>

      {/* 4 Clean Metric Tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Roles"
          value={metrics.activeJobs}
          subtext="Positions open for sourcing"
        />
        <MetricCard
          label="Candidates"
          value={metrics.totalCandidates}
          subtext="Total applicants in pipeline"
        />
        <MetricCard
          label="In Evaluation"
          value={metrics.inScreening}
          subtext="Screening and panel interviews"
        />
        <MetricCard
          label="Offers & Hired"
          value={metrics.offers}
          subtext="Closing and onboarded"
        />
      </div>

      {/* Filter Toolbar with Integrated Stage Funnel */}
      <div className="space-y-3">
        {/* Pipeline Stage Quick Tabs */}
        {metrics.totalCandidates > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setSelectedStage(null)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                selectedStage === null
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              All Stages ({metrics.totalCandidates})
            </button>
            {STAGE_FILTERS.map((st) => (
              <button
                key={st.key}
                onClick={() => setSelectedStage(selectedStage === st.key ? null : st.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all",
                  selectedStage === st.key
                    ? "bg-zinc-900 text-white shadow-xs"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                )}
              >
                <span>{st.label}</span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums",
                  selectedStage === st.key ? "bg-zinc-800 text-zinc-200" : "bg-zinc-100 text-zinc-600"
                )}>
                  {st.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-200/80 bg-white p-2 sm:flex-row sm:items-center sm:justify-between shadow-2xs">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search positions by title, department, or required skill..."
              className="w-full rounded-lg border border-zinc-200/80 bg-zinc-50/60 py-1.5 pl-8 pr-7 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "open", "closed"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-all",
                  statusFilter === status
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                )}
              >
                {status === "all" ? "All Status" : status === "open" ? "Active" : "Closed"}
              </button>
            ))}

            {departments.length > 0 && (
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="rounded-md border border-zinc-200/80 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700 focus:outline-none"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Loading Skeleton */}
        {loaded === null && (
          <div className="rounded-xl border border-zinc-200/80 bg-white p-5 space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg bg-zinc-100" />
            ))}
          </div>
        )}

        {/* Error Message */}
        {loaded && "error" in loaded && (
          <div className="space-y-2">
            <ErrorBanner message={loaded.error} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoaded(null);
                setAttempt((n) => n + 1);
              }}
              className="rounded-lg border-zinc-200 text-xs font-semibold"
            >
              Try again
            </Button>
          </div>
        )}

        {/* Empty State */}
        {loaded && "jobs" in loaded && loaded.jobs.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-12 text-center">
            <Briefcase className="h-7 w-7 text-zinc-400 mx-auto" />
            <p className="mt-2.5 text-xs font-bold text-zinc-900">No Positions Found</p>
            <p className="mt-1 text-xs text-zinc-500">Create a job requisition to start sourcing and evaluating candidates.</p>
            <div className="mt-4 flex justify-center">
              <Button
                size="sm"
                onClick={openCreateForm}
                className="h-8 rounded-lg bg-zinc-900 text-xs font-semibold text-white"
              >
                Create Position
              </Button>
            </div>
          </div>
        )}

        {/* Positions Table */}
        {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
          <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden shadow-2xs">
            {filteredJobs.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500">
                No positions matching the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-100 bg-zinc-50/70 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-5 py-3">Position</th>
                      <th className="px-4 py-3">Experience</th>
                      <th className="px-4 py-3">Candidate Pipeline</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredJobs.map((job, idx) => (
                      <JobTableRow
                        key={job.id}
                        job={job}
                        code={`REQ-${1040 + idx}`}
                        onEdit={openEditForm}
                        onStatusToggle={handleStatusToggle}
                        onDelete={setPendingDeleteJob}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal for Creating / Editing Job */}
      <JobFormDialog
        key={formKey}
        open={dialogOpen}
        job={editingJob}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          triggerRefresh();
        }}
      />

      {/* Remove Position Confirmation Dialog */}
      {pendingDeleteJob && (
        <Dialog open={Boolean(pendingDeleteJob)} onOpenChange={(open) => !open && !deleting && setPendingDeleteJob(null)}>
          <DialogContent className="sm:max-w-md rounded-xl border-zinc-200 bg-white p-5 shadow-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-zinc-900">Remove Position</DialogTitle>
              <DialogDescription className="text-xs text-zinc-600 mt-1">
                Are you sure you want to remove <strong className="text-zinc-900">{pendingDeleteJob.title}</strong>? This will permanently remove this requisition and candidate reviews for this role.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-3 border-t border-zinc-100 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setPendingDeleteJob(null)}
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
