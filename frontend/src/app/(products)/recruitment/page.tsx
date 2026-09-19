"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { errorMessage, listJobs, type Job } from "@/lib/recruitmentApi";
import { JobFormDialog } from "./_components/JobFormDialog";
import { useRecruitment } from "./_components/RecruitmentShell";

type Loaded = { jobs: Job[] } | { error: string } | null;

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="text-[11px] text-zinc-500">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const p = job.pipeline;
  const processing = p.PROCESSING ?? 0;
  return (
    <Link
      href={`/recruitment/jobs/${job.id}`}
      className="group flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-zinc-900 group-hover:text-blue-700">{job.title}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-500">
            {job.department && <span>{job.department}</span>}
            {job.department && job.location && <span aria-hidden="true">·</span>}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {job.location}
              </span>
            )}
            {!job.department && !job.location && <span>No department or location set</span>}
          </p>
        </div>
        <StatusPill tone={job.status === "open" ? "success" : "neutral"}>
          {job.status === "open" ? "Open" : job.status === "closed" ? "Closed" : "Draft"}
        </StatusPill>
      </div>

      <div className="grid grid-cols-4 gap-2 border-t border-zinc-100 pt-4">
        <Metric label="Candidates" value={job.total_candidates} />
        <Metric label="Shortlisted" value={p.SHORTLISTED ?? 0} />
        <Metric label="Interview" value={p.INTERVIEW ?? 0} />
        <Metric label="Offers" value={p.OFFER ?? 0} />
      </div>

      {processing > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {processing} resume{processing === 1 ? "" : "s"} being analysed
        </p>
      )}
    </Link>
  );
}

export default function JobsPage() {
  const { can } = useRecruitment();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((jobs) => !cancelled && setLoaded({ jobs }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const openForm = () => {
    setFormKey((k) => k + 1); // remount so the form starts empty
    setCreating(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Jobs</h1>
          <p className="text-sm text-zinc-500">Open a job to upload resumes and review candidates.</p>
        </div>
        {can("create_job") && (
          <Button variant="brand" size="lg" onClick={openForm}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New job
          </Button>
        )}
      </div>

      {loaded === null && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      )}

      {loaded && "error" in loaded && (
        <div className="max-w-lg space-y-3">
          <ErrorBanner message={loaded.error} />
          <Button
            variant="outline"
            onClick={() => {
              setLoaded(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {loaded && "jobs" in loaded && loaded.jobs.length === 0 && (
        <EmptyState
          icon={Briefcase}
          title="No jobs yet"
          description={
            can("create_job")
              ? "Create your first job, then upload resumes to see candidates ranked against it."
              : "You will see jobs here once you are given access to one."
          }
          action={
            can("create_job") ? (
              <Button variant="brand" onClick={openForm}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create a job
              </Button>
            ) : undefined
          }
        />
      )}

      {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loaded.jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      <JobFormDialog
        key={formKey}
        open={creating}
        onOpenChange={setCreating}
        onSaved={(job) => router.push(`/recruitment/jobs/${job.id}`)}
      />
    </div>
  );
}
