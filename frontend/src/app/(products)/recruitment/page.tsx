"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase, Search, Plus, MapPin, Users,
  ArrowRight, Loader2, CheckCircle2,
  Building2, Database, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { errorMessage, listJobs, seedDemoPipeline, type Job } from "@/lib/recruitmentApi";
import { JobFormDialog } from "./_components/JobFormDialog";
import { useRecruitment } from "./_components/RecruitmentShell";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Loaded = { jobs: Job[] } | { error: string } | null;

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

function MetricCard({ label, value, subtext, icon: Icon, badge }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</span>
        {badge && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-700">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-zinc-400 font-normal">{subtext}</p>
    </div>
  );
}

function PipelineBar({ pipeline, total }: { pipeline: Job["pipeline"]; total: number }) {
  const applied = pipeline.APPLIED ?? 0;
  const shortlisted = pipeline.SHORTLISTED ?? 0;
  const interview = pipeline.INTERVIEW ?? 0;
  const offers = pipeline.OFFER ?? 0;

  if (total === 0) {
    return (
      <div className="mt-3 flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-400 border border-zinc-100">
        <span>No candidates in pipeline</span>
        <span className="text-[11px] font-medium text-zinc-500">Ready for resumes</span>
      </div>
    );
  }

  const pApplied = (applied / total) * 100;
  const pShortlisted = (shortlisted / total) * 100;
  const pInterview = (interview / total) * 100;
  const pOffers = (offers / total) * 100;

  return (
    <div className="space-y-1.5 mt-3">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        {pApplied > 0 && <div style={{ width: `${pApplied}%` }} className="bg-zinc-400 transition-all duration-300" title={`Applied: ${applied}`} />}
        {pShortlisted > 0 && <div style={{ width: `${pShortlisted}%` }} className="bg-blue-600 transition-all duration-300" title={`Shortlisted: ${shortlisted}`} />}
        {pInterview > 0 && <div style={{ width: `${pInterview}%` }} className="bg-amber-500 transition-all duration-300" title={`Interview: ${interview}`} />}
        {pOffers > 0 && <div style={{ width: `${pOffers}%` }} className="bg-emerald-600 transition-all duration-300" title={`Offers: ${offers}`} />}
      </div>
      <div className="grid grid-cols-4 gap-1 text-[11px] tabular-nums text-zinc-500">
        <div className="truncate"><span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400 mr-1" />{applied} Applied</div>
        <div className="truncate"><span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600 mr-1" />{shortlisted} Shortlist</div>
        <div className="truncate"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1" />{interview} Interview</div>
        <div className="truncate"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 mr-1" />{offers} Offers</div>
      </div>
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const p = job.pipeline;
  const processing = p.PROCESSING ?? 0;
  const isOpen = job.status === "open";

  return (
    <Link
      href={`/recruitment/jobs/${job.id}`}
      className="group flex flex-col justify-between rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs transition-all duration-150 hover:border-zinc-300 hover:shadow-sm"
    >
      <div className="space-y-3">
        {/* Title & Status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-900 group-hover:text-blue-600 transition-colors">
              {job.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {job.department && (
                <span className="inline-flex items-center gap-1 font-medium text-zinc-600">
                  <Building2 className="h-3 w-3 text-zinc-400" />
                  {job.department}
                </span>
              )}
              {job.location && (
                <span className="inline-flex items-center gap-1 font-medium text-zinc-500">
                  <MapPin className="h-3 w-3 text-zinc-400" />
                  {job.location}
                </span>
              )}
              {job.min_experience_years !== null && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.2 text-[10px] font-medium text-zinc-600">
                  {job.min_experience_years}+ Yrs
                </span>
              )}
            </div>
          </div>
          <StatusPill tone={isOpen ? "success" : "neutral"}>
            {isOpen ? "Active" : job.status === "closed" ? "Closed" : "Draft"}
          </StatusPill>
        </div>

        {/* Skills Preview */}
        {job.must_have_skills && job.must_have_skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {job.must_have_skills.slice(0, 3).map((skill, idx) => (
              <span
                key={idx}
                className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700"
              >
                {skill}
              </span>
            ))}
            {job.must_have_skills.length > 3 && (
              <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                +{job.must_have_skills.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Visual Pipeline Funnel */}
        <PipelineBar pipeline={job.pipeline} total={job.total_candidates} />
      </div>

      {/* Card Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs">
        <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
          {processing > 0 ? (
            <span className="flex items-center gap-1 text-zinc-600 font-medium">
              <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
              {processing} processing…
            </span>
          ) : (
            <span>
              <strong className="font-semibold text-zinc-800">{job.total_candidates}</strong> candidates
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all">
          Open pipeline
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

export default function JobsPage() {
  const { can, triggerRefresh, refreshCount } = useRecruitment();
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "draft" | "closed">("all");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [seeding, setSeeding] = useState(false);
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

  const openForm = () => {
    setFormKey((k) => k + 1);
    setCreating(true);
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      const res = await seedDemoPipeline();
      toast("success", res.message || "Demo dataset seeded successfully.");
      triggerRefresh();
    } catch (err) {
      toast("error", `Seeding failed: ${errorMessage(err)}`);
    } finally {
      setSeeding(false);
    }
  };

  // Extract unique departments
  const departments = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) return [];
    const set = new Set<string>();
    loaded.jobs.forEach((j) => {
      if (j.department) set.add(j.department);
    });
    return Array.from(set);
  }, [loaded]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) return { activeJobs: 0, totalCandidates: 0, totalScreened: 0, totalOffers: 0 };
    const jobs = loaded.jobs;
    const activeJobs = jobs.filter((j) => j.status === "open").length;
    let totalCandidates = 0;
    let totalScreened = 0;
    let totalOffers = 0;

    jobs.forEach((j) => {
      totalCandidates += j.total_candidates;
      totalScreened += (j.pipeline.SCREENING ?? 0) + (j.pipeline.SHORTLISTED ?? 0) + (j.pipeline.INTERVIEW ?? 0);
      totalOffers += j.pipeline.OFFER ?? 0;
    });

    return { activeJobs, totalCandidates, totalScreened, totalOffers };
  }, [loaded]);

  // Filtered jobs
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
      return true;
    });
  }, [loaded, searchQuery, statusFilter, selectedDept]);

  return (
    <div className="space-y-6">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
            Jobs & Pipeline
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500 max-w-2xl">
            Candidate ingestion, semantic role requirement matching, and lifecycle progression.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeedDemo}
            disabled={seeding}
            className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {seeding ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-zinc-500" />
            ) : (
              <Database className="mr-1.5 h-3.5 w-3.5 text-zinc-500" />
            )}
            Seed Demo Data
          </Button>

          {can("create_job") && (
            <Button
              size="sm"
              onClick={openForm}
              className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Post New Role
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metric Deck */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Positions"
          value={metrics.activeJobs}
          subtext="Open requisitions receiving applicants"
          icon={Briefcase}
          badge={metrics.activeJobs > 0 ? "Active" : undefined}
        />
        <MetricCard
          label="Total Candidate Pool"
          value={metrics.totalCandidates}
          subtext="Evaluated applicants across all roles"
          icon={Users}
        />
        <MetricCard
          label="In Evaluation Pipeline"
          value={metrics.totalScreened}
          subtext="Shortlisted & interviewing candidates"
          icon={CheckCircle2}
        />
        <MetricCard
          label="Offers Extended"
          value={metrics.totalOffers}
          subtext="Formal offers awaiting candidate decision"
          icon={ArrowRight}
          badge={metrics.totalOffers > 0 ? "Pending" : undefined}
        />
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-zinc-200/80 bg-white p-2.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter roles by title, department, or required skill..."
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

        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1 border-t border-zinc-100 pt-2 sm:border-t-0 sm:pt-0">
          {(["all", "open", "draft", "closed"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                statusFilter === status
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              {status === "all" ? "All Roles" : status}
            </button>
          ))}

          {/* Department Filter Dropdown */}
          {departments.length > 0 && (
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="rounded-md border border-zinc-200 bg-zinc-50/50 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Grid of Job Cards */}
      {loaded === null && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-lg" />
          ))}
        </div>
      )}

      {loaded && "error" in loaded && (
        <div className="max-w-lg space-y-3">
          <ErrorBanner message={loaded.error} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoaded(null);
              setAttempt((n) => n + 1);
            }}
            className="rounded-md"
          >
            Try again
          </Button>
        </div>
      )}

      {/* Zero Jobs: Clean Empty State */}
      {loaded && "jobs" in loaded && loaded.jobs.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
            <Briefcase className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-sm font-semibold text-zinc-900">No Job Postings Yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            Create a position to start screening applicants, or load the pre-configured demo dataset.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              onClick={openForm}
              className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Post New Role
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {seeding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Database className="mr-1.5 h-3.5 w-3.5 text-zinc-500" />}
              Seed Demo Data
            </Button>
          </div>
        </div>
      )}

      {/* Active Jobs Grid */}
      {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
        <>
          {filteredJobs.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center">
              <Search className="mx-auto h-6 w-6 text-zinc-300" />
              <h3 className="mt-2 text-xs font-semibold text-zinc-900">No matching positions found</h3>
              <p className="mt-1 text-xs text-zinc-500">Try adjusting your search query or department filter.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setSelectedDept("all");
                }}
                className="mt-3 h-8 rounded-md text-xs"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal to create a new job */}
      <JobFormDialog
        key={formKey}
        open={creating}
        onOpenChange={setCreating}
        onSaved={(job: Job) => {
          setCreating(false);
          router.push(`/recruitment/jobs/${job.id}`);
        }}
      />
    </div>
  );
}
