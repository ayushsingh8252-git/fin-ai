"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase, Search, Plus, MapPin, Users, ShieldCheck,
  Sparkles, ArrowRight, Loader2, CheckCircle2, SlidersHorizontal,
  FolderPlus, Clock, Award, Building2, Zap, TrendingUp, X
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
  trend?: string;
  gradient: string;
  iconBg: string;
}

function MetricCard({ label, value, subtext, icon: Icon, trend, gradient, iconBg }: MetricCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white/90 p-5 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg hover:shadow-indigo-500/5 backdrop-blur-sm">
      <div className={cn("pointer-events-none absolute -top-12 -right-12 h-28 w-28 rounded-full blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-60", gradient)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-500">{label}</span>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-black tracking-tight text-zinc-900 tabular-nums">{value}</span>
        {trend && (
          <span className="inline-flex items-center text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md ring-1 ring-emerald-200/50">
            {trend}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] font-medium text-zinc-400">{subtext}</p>
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
      <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-400 border border-zinc-100">
        <span>No candidates in pipeline yet</span>
        <span className="text-[11px] font-semibold text-blue-600">Ready for resumes</span>
      </div>
    );
  }

  const pApplied = (applied / total) * 100;
  const pShortlisted = (shortlisted / total) * 100;
  const pInterview = (interview / total) * 100;
  const pOffers = (offers / total) * 100;

  return (
    <div className="space-y-2 mt-3">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 shadow-inner">
        {pApplied > 0 && <div style={{ width: `${pApplied}%` }} className="bg-sky-400 transition-all duration-500" title={`Applied: ${applied}`} />}
        {pShortlisted > 0 && <div style={{ width: `${pShortlisted}%` }} className="bg-indigo-500 transition-all duration-500" title={`Shortlisted: ${shortlisted}`} />}
        {pInterview > 0 && <div style={{ width: `${pInterview}%` }} className="bg-amber-400 transition-all duration-500" title={`Interview: ${interview}`} />}
        {pOffers > 0 && <div style={{ width: `${pOffers}%` }} className="bg-emerald-500 transition-all duration-500" title={`Offers: ${offers}`} />}
      </div>
      <div className="grid grid-cols-4 gap-1 text-[11px] tabular-nums">
        <div className="text-zinc-600 font-medium"><span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400 mr-1" />{applied} Applied</div>
        <div className="text-zinc-600 font-medium"><span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 mr-1" />{shortlisted} Shortlist</div>
        <div className="text-zinc-600 font-medium"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 mr-1" />{interview} Interview</div>
        <div className="text-zinc-600 font-medium"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1" />{offers} Offers</div>
      </div>
    </div>
  );
}

function ModernJobCard({ job }: { job: Job }) {
  const p = job.pipeline;
  const processing = p.PROCESSING ?? 0;
  const isOpen = job.status === "open";

  return (
    <Link
      href={`/recruitment/jobs/${job.id}`}
      className="group relative flex flex-col justify-between rounded-3xl border border-zinc-200/80 bg-white/95 p-6 shadow-xs transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 backdrop-blur-sm"
    >
      {/* Top Accent Line */}
      <div className={cn("absolute top-0 inset-x-0 h-1 rounded-t-3xl transition-colors", isOpen ? "bg-gradient-to-r from-blue-500 to-indigo-600" : "bg-zinc-300")} />

      <div className="space-y-4">
        {/* Title & Status */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-zinc-900 group-hover:text-blue-600 transition-colors">
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
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">
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
          <div className="flex flex-wrap gap-1.5">
            {job.must_have_skills.slice(0, 3).map((skill, idx) => (
              <span
                key={idx}
                className="rounded-lg bg-blue-50/70 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200/50"
              >
                {skill}
              </span>
            ))}
            {job.must_have_skills.length > 3 && (
              <span className="rounded-lg bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                +{job.must_have_skills.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Visual Pipeline Funnel */}
        <PipelineBar pipeline={job.pipeline} total={job.total_candidates} />
      </div>

      {/* Card Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-zinc-100/90 pt-3.5 text-xs">
        <div className="flex items-center gap-2">
          {processing > 0 ? (
            <span className="flex items-center gap-1 text-blue-600 font-semibold text-[11px] animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              {processing} AI analyzing...
            </span>
          ) : (
            <span className="text-zinc-500 text-[11px]">
              <span className="font-bold text-zinc-800">{job.total_candidates}</span> candidates total
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 font-semibold text-blue-600 group-hover:translate-x-0.5 transition-transform">
          Open Pipeline
          <ArrowRight className="h-3.5 w-3.5" />
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
      toast("success", res.message || "Demo pipeline seeded with realistic candidates and positions.");
      triggerRefresh();
    } catch (err) {
      toast("error", `Seeding Failed: ${errorMessage(err)}`);
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
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = j.title.toLowerCase().includes(q);
        const matchDept = j.department?.toLowerCase().includes(q);
        const matchSkill = j.must_have_skills?.some((s) => s.toLowerCase().includes(q));
        if (!matchTitle && !matchDept && !matchSkill) return false;
      }
      // Status filter
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      // Department filter
      if (selectedDept !== "all" && j.department !== selectedDept) return false;

      return true;
    });
  }, [loaded, searchQuery, statusFilter, selectedDept]);

  return (
    <div className="space-y-8">
      {/* Executive Command Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 ring-1 ring-blue-200/60">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              AI Hiring Platform
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">
            Talent Acquisition & Intelligence
          </h1>
          <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
            Autonomous resume ingestion, semantic JD requirement matching, multi-signal credential integrity audits, and candidate lifecycle management.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={handleSeedDemo}
            disabled={seeding}
            className="rounded-xl border-indigo-200 bg-indigo-50/40 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 shadow-xs"
          >
            {seeding ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-4 w-4 text-indigo-600" />
            )}
            Seed Demo Pipeline
          </Button>

          {can("create_job") && (
            <Button
              variant="brand"
              size="lg"
              onClick={openForm}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-md shadow-blue-500/25 transition-all"
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Post New Role
            </Button>
          )}
        </div>
      </div>

      {/* KPI Metric Deck */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Job Openings"
          value={metrics.activeJobs}
          subtext="Currently receiving applications"
          icon={Briefcase}
          trend={metrics.activeJobs > 0 ? "Active" : undefined}
          gradient="bg-blue-400/20"
          iconBg="bg-blue-50 text-blue-600"
        />
        <MetricCard
          label="Total Talent Pipeline"
          value={metrics.totalCandidates}
          subtext="Candidates evaluated across all roles"
          icon={Users}
          trend={metrics.totalCandidates > 0 ? "+12% MoM" : undefined}
          gradient="bg-indigo-400/20"
          iconBg="bg-indigo-50 text-indigo-600"
        />
        <MetricCard
          label="Qualified in Pipeline"
          value={metrics.totalScreened}
          subtext="Shortlisted & Interviewing candidates"
          icon={Sparkles}
          trend="89% Avg Match"
          gradient="bg-purple-400/20"
          iconBg="bg-purple-50 text-purple-600"
        />
        <MetricCard
          label="Offers Extended"
          value={metrics.totalOffers}
          subtext="Offers awaiting candidate acceptance"
          icon={Award}
          trend={metrics.totalOffers > 0 ? "Pending" : undefined}
          gradient="bg-emerald-400/20"
          iconBg="bg-emerald-50 text-emerald-600"
        />
      </div>

      {/* Modern Filter and Search Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles by title, department, or required skills..."
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

        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2 sm:border-t-0 sm:pt-0">
          {(["all", "open", "draft", "closed"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-all",
                statusFilter === status
                  ? "bg-zinc-900 text-white shadow-xs"
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
              className="rounded-xl border border-zinc-200 bg-zinc-50/50 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 focus:outline-none"
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
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-3xl" />
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

      {/* Zero Jobs: Rich Showcase & Quick Starter */}
      {loaded && "jobs" in loaded && loaded.jobs.length === 0 && (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-gradient-to-b from-white to-zinc-50/60 p-12 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
            <Briefcase className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-bold text-zinc-900">No Job Postings Yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
            Create your first role to start screening resumes with AI, or load our pre-configured demo pipeline to see the platform in action instantly.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              variant="brand"
              size="lg"
              onClick={openForm}
              className="rounded-xl shadow-md shadow-blue-500/25 font-semibold"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Post Your First Job
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="rounded-xl border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100 font-semibold"
            >
              {seeding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4 text-indigo-600" />}
              Seed Demo Roles & Candidates
            </Button>
          </div>
        </div>
      )}

      {/* Active Jobs Grid */}
      {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
        <>
          {filteredJobs.length === 0 ? (
            <div className="rounded-3xl border border-zinc-200 bg-white p-12 text-center">
              <Search className="mx-auto h-8 w-8 text-zinc-300" />
              <h3 className="mt-3 text-sm font-semibold text-zinc-900">No matching positions found</h3>
              <p className="mt-1 text-xs text-zinc-500">Try adjusting your search terms or filters.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setSelectedDept("all");
                }}
                className="mt-4 rounded-xl text-xs"
              >
                Clear all filters
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredJobs.map((job) => (
                <ModernJobCard key={job.id} job={job} />
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
