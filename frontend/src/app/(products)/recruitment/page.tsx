"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Briefcase, Download, Loader2, MapPin, MoreHorizontal,
  Pencil, Plus, Power, Search, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage, listJobs, updateJob, deleteJob, type Job } from "@/lib/recruitmentApi";
import { JobFormDialog } from "./_components/JobFormDialog";
import { useRecruitment } from "./_components/RecruitmentShell";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Loaded = { jobs: Job[] } | { error: string } | null;
type StatusFilter = "all" | "open" | "closed";

// Pipeline segments shown in each row's bar, in lifecycle order. One hue
// family, darkening as candidates progress; green is reserved for outcomes.
const SEGMENTS = [
  { key: "APPLIED", label: "Applied", className: "bg-zinc-300" },
  { key: "SHORTLISTED", label: "Shortlisted", className: "bg-blue-300" },
  { key: "INTERVIEW", label: "Interview", className: "bg-blue-600" },
  { key: "OFFER_HIRED", label: "Offer / Hired", className: "bg-emerald-500" },
] as const;

function segmentCounts(job: Job): Record<(typeof SEGMENTS)[number]["key"], number> {
  const p = job.pipeline || {};
  return {
    APPLIED: p.APPLIED ?? 0,
    SHORTLISTED: p.SHORTLISTED ?? 0,
    INTERVIEW: p.INTERVIEW ?? 0,
    OFFER_HIRED: (p.OFFER ?? 0) + (p.HIRED ?? 0),
  };
}

// ── Stat strip ──────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
  onClick,
  active,
}: {
  label: string;
  value: number;
  hint: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "px-5 py-4 text-left transition-colors",
        active ? "bg-blue-50" : "bg-white",
        onClick && !active && "cursor-pointer hover:bg-zinc-50",
        onClick && active && "cursor-pointer"
      )}
    >
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>
    </Comp>
  );
}

// ── Row actions menu ────────────────────────────────────────────────────

function RowActions({
  job,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  job: Job;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-left cursor-pointer";
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Actions for ${job.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <button role="menuitem" type="button" onClick={run(onEdit)} className={cn(item, "text-zinc-700 hover:bg-zinc-50")}>
            <Pencil className="h-4 w-4 text-zinc-400" /> Edit position
          </button>
          <button role="menuitem" type="button" onClick={run(onToggleStatus)} className={cn(item, "text-zinc-700 hover:bg-zinc-50")}>
            <Power className="h-4 w-4 text-zinc-400" /> {job.status === "open" ? "Close position" : "Reopen position"}
          </button>
          <div className="my-1 border-t border-zinc-100" />
          <button role="menuitem" type="button" onClick={run(onDelete)} className={cn(item, "text-rose-600 hover:bg-rose-50")}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function PositionsPage() {
  const { can, triggerRefresh, refreshCount } = useRecruitment();
  const router = useRouter();
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dept, setDept] = useState("all");
  const [stage, setStage] = useState("all");
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canEdit = can("edit_job");
  const canCreate = can("create_job");

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((jobs) => !cancelled && setLoaded({ jobs }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [attempt, refreshCount]);

  const jobs = useMemo(() => (loaded && "jobs" in loaded ? loaded.jobs : []), [loaded]);

  const stats = useMemo(() => {
    let candidates = 0, evaluating = 0, outcomes = 0;
    for (const j of jobs) {
      candidates += j.total_candidates;
      evaluating += (j.pipeline.SCREENING ?? 0) + (j.pipeline.SHORTLISTED ?? 0) + (j.pipeline.INTERVIEW ?? 0);
      outcomes += (j.pipeline.OFFER ?? 0) + (j.pipeline.HIRED ?? 0);
    }
    return { open: jobs.filter((j) => j.status === "open").length, candidates, evaluating, outcomes };
  }, [jobs]);

  const departments = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.department).filter((d): d is string => Boolean(d)))).sort(),
    [jobs]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (q) {
        const hay = [j.title, j.department, j.location, ...(j.must_have_skills || [])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (status !== "all" && j.status !== status) return false;
      if (dept !== "all" && j.department !== dept) return false;
      if (stage !== "all" && (j.pipeline[stage as keyof typeof j.pipeline] ?? 0) === 0) return false;
      return true;
    });
  }, [jobs, query, status, dept, stage]);

  const filtersActive = Boolean(query) || status !== "all" || dept !== "all" || stage !== "all";
  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setDept("all");
    setStage("all");
  };

  const openCreate = () => {
    setEditingJob(undefined);
    setFormKey((k) => k + 1);
    setDialogOpen(true);
  };
  const openEdit = (job: Job) => {
    setEditingJob(job);
    setFormKey((k) => k + 1);
    setDialogOpen(true);
  };

  const toggleStatus = async (job: Job) => {
    const next = job.status === "open" ? "closed" : "open";
    try {
      await updateJob(job.id, { status: next });
      toast("success", `${job.title} ${next === "open" ? "reopened" : "closed"}.`);
      triggerRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteJob(pendingDelete.id);
      toast("success", `${pendingDelete.title} deleted.`);
      setPendingDelete(null);
      triggerRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Title", "Department", "Location", "Min experience (years)", "Candidates",
      "Applied", "Shortlisted", "Interview", "Offer", "Hired", "Status", "Created"];
    const rows = filtered.map((j) => [
      j.title, j.department, j.location, j.min_experience_years, j.total_candidates,
      j.pipeline.APPLIED ?? 0, j.pipeline.SHORTLISTED ?? 0, j.pipeline.INTERVIEW ?? 0,
      j.pipeline.OFFER ?? 0, j.pipeline.HIRED ?? 0, j.status, j.created_at?.slice(0, 10),
    ].map(esc).join(","));
    const blob = new Blob([[header.map(esc).join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `positions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("success", `Exported ${filtered.length} position${filtered.length === 1 ? "" : "s"}.`);
  };

  const control = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-[13px] text-zinc-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15";

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Positions</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {loaded && "jobs" in loaded
              ? `${stats.open} open of ${jobs.length} position${jobs.length === 1 ? "" : "s"} · ${stats.candidates.toLocaleString()} candidates`
              : "Open roles and their candidate pipelines"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="h-9 rounded-md border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700"
          >
            <Download className="mr-1.5 h-4 w-4 text-zinc-400" /> Export
          </Button>
          {canCreate && (
            <Button onClick={openCreate} className="h-9 rounded-md bg-blue-600 px-3.5 text-[13px] font-medium text-white hover:bg-blue-700">
              <Plus className="mr-1.5 h-4 w-4" /> New position
            </Button>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 lg:grid-cols-4">
        <Stat
          label="Open positions"
          value={stats.open}
          hint="Accepting candidates"
          onClick={() => setStatus(status === "open" ? "all" : "open")}
          active={status === "open"}
        />
        <Stat label="Candidates" value={stats.candidates} hint="Across all positions" />
        <Stat label="In evaluation" value={stats.evaluating} hint="Screening, shortlist, interview" />
        <Stat label="Offers & hires" value={stats.outcomes} hint="Offer extended or hired" />
      </div>

      {/* ── Positions table ── */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 border-b border-zinc-200 p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, department, location or skill"
              aria-label="Search positions"
              className={cn(control, "w-full pl-9 pr-8")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Status" className="inline-flex h-9 rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
              {(["all", "open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded px-3 text-[13px] font-medium transition-colors cursor-pointer",
                    status === s ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  {s === "all" ? "All" : s === "open" ? "Open" : "Closed"}
                </button>
              ))}
            </div>

            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Pipeline stage" className={control}>
              <option value="all">Any stage</option>
              <option value="APPLIED">Has applied</option>
              <option value="SCREENING">Has screening</option>
              <option value="SHORTLISTED">Has shortlisted</option>
              <option value="INTERVIEW">Has interviews</option>
              <option value="OFFER">Has offers</option>
              <option value="HIRED">Has hires</option>
            </select>

            {departments.length > 0 && (
              <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className={control}>
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}

            {filtersActive && (
              <button type="button" onClick={clearFilters} className="h-9 px-2 text-[13px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Loading */}
        {loaded === null && (
          <div className="divide-y divide-zinc-100">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-4 w-1/3 rounded bg-zinc-100" />
                <Skeleton className="h-2 w-1/4 rounded bg-zinc-100" />
                <Skeleton className="ml-auto h-4 w-16 rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {loaded && "error" in loaded && (
          <div className="space-y-3 p-5">
            <ErrorBanner message={loaded.error} />
            <Button
              variant="outline"
              onClick={() => {
                setLoaded(null);
                setAttempt((n) => n + 1);
              }}
              className="h-9 rounded-md border-zinc-200 text-[13px] font-medium"
            >
              Try again
            </Button>
          </div>
        )}

        {/* No positions at all */}
        {loaded && "jobs" in loaded && jobs.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={Briefcase}
              title="No positions yet"
              description="Create a position, then upload resumes to it — each one is parsed, scored against the job description, and added to the pipeline."
              action={
                canCreate ? (
                  <Button onClick={openCreate} className="h-9 rounded-md bg-blue-600 px-3.5 text-[13px] font-medium text-white hover:bg-blue-700">
                    <Plus className="mr-1.5 h-4 w-4" /> New position
                  </Button>
                ) : undefined
              }
              className="border-dashed bg-white"
            />
          </div>
        )}

        {/* Table */}
        {jobs.length > 0 && (
          <>
            {filtered.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-zinc-900">No positions match these filters</p>
                <button type="button" onClick={clearFilters} className="mt-2 text-[13px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="border-b border-zinc-200 bg-zinc-50/70">
                    <tr className="text-xs font-medium text-zinc-500">
                      <th className="px-5 py-2.5 font-medium">Position</th>
                      <th className="px-4 py-2.5 font-medium">Pipeline</th>
                      <th className="px-4 py-2.5 font-medium">Experience</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filtered.map((job) => {
                      const counts = segmentCounts(job);
                      const total = job.total_candidates || 0;
                      const href = `/recruitment/jobs/${job.id}`;
                      return (
                        <tr
                          key={job.id}
                          onClick={() => router.push(href)}
                          className="group cursor-pointer transition-colors hover:bg-zinc-50"
                        >
                          <td className="px-5 py-3.5">
                            <Link
                              href={href}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm font-medium text-zinc-900 group-hover:text-blue-700"
                            >
                              {job.title}
                            </Link>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                              {job.department && <span>{job.department}</span>}
                              {job.department && job.location && <span className="text-zinc-300">·</span>}
                              {job.location && (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-zinc-400" /> {job.location}
                                </span>
                              )}
                              {!job.department && !job.location && <span className="text-zinc-400">No department or location</span>}
                            </p>
                          </td>

                          <td className="w-[260px] px-4 py-3.5">
                            <div className="flex items-baseline justify-between text-xs">
                              <span className="font-medium tabular-nums text-zinc-900">
                                {total} <span className="font-normal text-zinc-500">candidate{total === 1 ? "" : "s"}</span>
                              </span>
                              {counts.INTERVIEW > 0 && <span className="text-zinc-500 tabular-nums">{counts.INTERVIEW} interviewing</span>}
                            </div>
                            <div
                              className="mt-1.5 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-zinc-100"
                              title={SEGMENTS.map((s) => `${s.label}: ${counts[s.key]}`).join(" · ")}
                            >
                              {total > 0 &&
                                SEGMENTS.map((s) =>
                                  counts[s.key] > 0 ? (
                                    <div key={s.key} className={cn("h-full", s.className)} style={{ width: `${(counts[s.key] / total) * 100}%` }} />
                                  ) : null
                                )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-[13px] tabular-nums text-zinc-700 whitespace-nowrap">
                            {job.min_experience_years !== null ? `${job.min_experience_years}+ years` : <span className="text-zinc-400">Not set</span>}
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                                job.status === "open"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : job.status === "draft"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-zinc-100 text-zinc-600"
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  job.status === "open" ? "bg-emerald-500" : job.status === "draft" ? "bg-amber-500" : "bg-zinc-400"
                                )}
                              />
                              {job.status === "open" ? "Open" : job.status === "draft" ? "Draft" : "Closed"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center justify-end gap-1">
                              <span className="hidden items-center gap-1 text-[13px] font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100 md:inline-flex">
                                Open <ArrowRight className="h-3.5 w-3.5" />
                              </span>
                              {canEdit && (
                                <RowActions
                                  job={job}
                                  onEdit={() => openEdit(job)}
                                  onToggleStatus={() => toggleStatus(job)}
                                  onDelete={() => setPendingDelete(job)}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer: result count + legend */}
            <div className="flex flex-col gap-2 border-t border-zinc-200 bg-zinc-50/50 px-5 py-2.5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {filtered.length} of {jobs.length} position{jobs.length === 1 ? "" : "s"}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {SEGMENTS.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", s.className)} /> {s.label}
                  </span>
                ))}
              </span>
            </div>
          </>
        )}
      </div>

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

      {pendingDelete && (
        <Dialog open onOpenChange={(open) => !open && !deleting && setPendingDelete(null)}>
          <DialogContent className="rounded-lg border-zinc-200 bg-white p-5 shadow-lg sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-zinc-900">Delete position?</DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-zinc-600">
                <strong className="font-medium text-zinc-900">{pendingDelete.title}</strong> and its candidate reviews will be permanently
                removed. To stop accepting candidates but keep the history, close the position instead.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-3">
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="h-9 rounded-md border-zinc-200 text-[13px] font-medium text-zinc-700"
              >
                Cancel
              </Button>
              <Button
                disabled={deleting}
                onClick={confirmDelete}
                className="h-9 rounded-md bg-rose-600 text-[13px] font-medium text-white hover:bg-rose-700"
              >
                {deleting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Delete position
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
