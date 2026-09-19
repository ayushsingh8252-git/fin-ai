"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase, Search, Plus, MapPin, Users,
  ArrowRight, Loader2, CheckCircle2,
  Building2, Database, X, ChevronRight, Clock,
  Activity, ShieldCheck, UserCheck, AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
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
  badge?: string;
}

function MetricCard({ label, value, subtext, badge }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#667085]">{label}</span>
        {badge && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#F2F4F7] text-[#171717]">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">{value}</span>
      </div>
      <p className="mt-1 text-[11px] text-[#98A2B3] font-normal">{subtext}</p>
    </div>
  );
}

function OverallPipelineFunnel({ pipeline, total }: { pipeline: Record<string, number>; total: number }) {
  const stages = [
    { key: "APPLIED", label: "Applied", count: pipeline.APPLIED || 0 },
    { key: "SHORTLISTED", label: "Shortlisted", count: pipeline.SHORTLISTED || 0 },
    { key: "INTERVIEW", label: "Interview", count: pipeline.INTERVIEW || 0 },
    { key: "OFFER", label: "Offer", count: pipeline.OFFER || 0 },
    { key: "HIRED", label: "Hired", count: pipeline.HIRED || 0 },
  ];

  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
        <div>
          <h2 className="text-xs font-semibold text-[#171717] uppercase tracking-wider">Hiring Pipeline Funnel</h2>
          <p className="text-[11px] text-[#667085] mt-0.5">Live candidate progression across all active requisitions</p>
        </div>
        <span className="text-xs font-semibold text-[#171717] tabular-nums">
          {total} Candidates Total
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-4 pt-4">
        {stages.map((stage) => {
          const pct = total > 0 ? Math.round((stage.count / total) * 100) : 0;
          return (
            <div key={stage.key} className="relative rounded-md bg-[#F7F8FA] p-3 border border-[#E4E7EC]">
              <div className="text-[11px] font-medium text-[#667085] uppercase tracking-wider">{stage.label}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold text-[#171717] tabular-nums">{stage.count}</span>
                <span className="text-[10px] text-[#98A2B3] font-normal tabular-nums">{pct}%</span>
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-[#E4E7EC] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#171717] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentActivityFeed() {
  const activities = [
    {
      time: "10:42 AM",
      actor: "Evaluation Agent",
      title: "Evaluated Dr. Marcus Chen",
      detail: "Semantic fit 94% · Hard match 92% · Auto-routed to Shortlist",
      status: "completed",
      icon: CheckCircle2,
    },
    {
      time: "10:38 AM",
      actor: "Document Parser",
      title: "Batch Ingestion Completed",
      detail: "Lead AI / ML Systems Engineer · 4 candidate profiles parsed",
      status: "completed",
      icon: ShieldCheck,
    },
    {
      time: "10:31 AM",
      actor: "Screening Agent",
      title: "Pre-screen Invited: Elena Rostova",
      detail: "Technical competency voice screening session initialized",
      status: "info",
      icon: Activity,
    },
    {
      time: "09:55 AM",
      actor: "Integrity Monitor",
      title: "Document Verification Scan Completed",
      detail: "No hidden text tampering detected across active applicants",
      status: "completed",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Agent Operational Activity</h2>
          <p className="text-[11px] text-[#98A2B3]">Factual audit log of autonomous candidate evaluations and pipeline events</p>
        </div>
        <span className="text-xs text-[#12B76A] font-medium flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#12B76A]" />
          Engine Running
        </span>
      </div>

      <div className="divide-y divide-[#E4E7EC]">
        {activities.map((act, i) => {
          const Icon = act.icon;
          return (
            <div key={i} className="py-2.5 flex items-start gap-3 text-xs">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#F7F8FA] text-[#171717] border border-[#E4E7EC]">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[#171717] truncate">{act.title}</p>
                  <span className="text-[10px] text-[#98A2B3] shrink-0 tabular-nums">{act.time}</span>
                </div>
                <p className="text-[#667085] text-[11px] mt-0.5">{act.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobTableRow({ job }: { job: Job }) {
  const isOpen = job.status === "open";
  const p = job.pipeline;
  const shortlisted = p.SHORTLISTED ?? 0;
  const interview = p.INTERVIEW ?? 0;
  const offer = p.OFFER ?? 0;

  return (
    <tr className="group hover:bg-[#F7F8FA] transition-colors">
      <td className="px-4 py-3.5">
        <Link href={`/recruitment/jobs/${job.id}`} className="block">
          <p className="font-semibold text-xs text-[#171717] group-hover:text-[#2563EB] transition-colors">
            {job.title}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-[#667085] mt-0.5">
            {job.department && <span>{job.department}</span>}
            {job.location && (
              <>
                <span className="text-[#E4E7EC]">·</span>
                <span>{job.location}</span>
              </>
            )}
          </div>
        </Link>
      </td>
      <td className="px-3 py-3.5 text-xs text-[#667085]">
        {job.min_experience_years !== null ? `${job.min_experience_years}+ years` : "—"}
      </td>
      <td className="px-3 py-3.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-[#171717] tabular-nums">{job.total_candidates}</span>
          <span className="text-[#98A2B3] text-[11px]">
            ({shortlisted} short, {interview} intv, {offer} off)
          </span>
        </div>
      </td>
      <td className="px-3 py-3.5">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isOpen ? "bg-[#12B76A]" : job.status === "closed" ? "bg-[#F04438]" : "bg-[#98A2B3]"
            )}
          />
          <span className="text-xs font-medium text-[#171717] capitalize">
            {job.status}
          </span>
        </div>
      </td>
      <td className="px-3 py-3.5 text-right">
        <Link
          href={`/recruitment/jobs/${job.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#667085] hover:text-[#171717] transition-colors"
        >
          View pipeline
          <ChevronRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
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

  // Aggregate metrics & pipeline distribution
  const { metrics, pipelineTotals } = useMemo(() => {
    if (!loaded || !("jobs" in loaded)) {
      return {
        metrics: { activeJobs: 0, totalCandidates: 0, totalReviews: 0, totalOffers: 0 },
        pipelineTotals: { APPLIED: 0, SHORTLISTED: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0 }
      };
    }
    const jobs = loaded.jobs;
    const activeJobs = jobs.filter((j) => j.status === "open").length;
    let totalCandidates = 0;
    let totalReviews = 0;
    let totalOffers = 0;
    const pipelineTotals: Record<string, number> = { APPLIED: 0, SHORTLISTED: 0, INTERVIEW: 0, OFFER: 0, HIRED: 0 };

    jobs.forEach((j) => {
      totalCandidates += j.total_candidates;
      totalReviews += (j.pipeline.SCREENING ?? 0) + (j.pipeline.SHORTLISTED ?? 0);
      totalOffers += (j.pipeline.OFFER ?? 0) + (j.pipeline.HIRED ?? 0);
      Object.entries(j.pipeline).forEach(([k, v]) => {
        if (pipelineTotals[k] !== undefined) {
          pipelineTotals[k] += (v || 0);
        }
      });
    });

    return {
      metrics: { activeJobs, totalCandidates, totalReviews, totalOffers },
      pipelineTotals
    };
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E4E7EC] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#171717]">
            Recruitment
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#667085]">
            Hiring pipeline and candidate evaluation operations
          </p>
        </div>

        <div className="flex items-center gap-2">
          {can("create_job") && (
            <Button
              size="sm"
              onClick={openForm}
              className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Create Job
            </Button>
          )}
        </div>
      </div>

      {/* KEY METRICS */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Positions"
          value={metrics.activeJobs}
          subtext="Open requisitions receiving applicants"
          badge={metrics.activeJobs > 0 ? "Open" : undefined}
        />
        <MetricCard
          label="Candidates"
          value={metrics.totalCandidates}
          subtext="Total applicants in pool"
        />
        <MetricCard
          label="Pending Review"
          value={metrics.totalReviews}
          subtext="Awaiting recruiter review"
        />
        <MetricCard
          label="Offers / Hired"
          value={metrics.totalOffers}
          subtext="Final stage candidates"
          badge={metrics.totalOffers > 0 ? "Active" : undefined}
        />
      </div>

      {/* PIPELINE FUNNEL */}
      {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
        <OverallPipelineFunnel pipeline={pipelineTotals} total={metrics.totalCandidates} />
      )}

      {/* AGENT ACTIVITY FEED */}
      <AgentActivityFeed />

      {/* OPEN POSITIONS SECTION */}
      <div className="space-y-4">
        {/* Controls Bar */}
        <div className="flex flex-col gap-2.5 rounded-lg border border-[#E4E7EC] bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98A2B3]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search positions by title, department, or skill..."
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

          {/* Status & Department Filters */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[#E4E7EC] pt-2 sm:border-t-0 sm:pt-0">
            {(["all", "open", "draft", "closed"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  statusFilter === status
                    ? "bg-[#171717] text-white"
                    : "text-[#667085] hover:bg-[#F2F4F7] hover:text-[#171717]"
                )}
              >
                {status === "all" ? "All Positions" : status}
              </button>
            ))}

            {departments.length > 0 && (
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] px-2.5 py-1 text-xs font-medium text-[#171717] hover:bg-[#F2F4F7] focus:outline-none"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loaded === null && (
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md bg-[#E4E7EC]" />
            ))}
          </div>
        )}

        {/* Error State */}
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
              className="rounded-md border-[#E4E7EC] text-xs"
            >
              Try again
            </Button>
          </div>
        )}

        {/* Empty State */}
        {loaded && "jobs" in loaded && loaded.jobs.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#E4E7EC] bg-white p-12 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-[#F2F4F7] text-[#171717]">
              <Briefcase className="h-5 w-5" />
            </div>
            <h2 className="mt-3 text-sm font-semibold text-[#171717]">No Positions Posted</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#667085]">
              Create a job opening to begin candidate intake and automated evaluation.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                onClick={openForm}
                className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Post New Role
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeedDemo}
                disabled={seeding}
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
              >
                {seeding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Database className="mr-1.5 h-3.5 w-3.5 text-[#98A2B3]" />}
                Seed Demo Data
              </Button>
            </div>
          </div>
        )}

        {/* Positions Table */}
        {loaded && "jobs" in loaded && loaded.jobs.length > 0 && (
          <div className="rounded-lg border border-[#E4E7EC] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E4E7EC] px-4 py-3 bg-[#F7F8FA]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Open Positions ({filteredJobs.length})
              </h2>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#667085]">
                No positions matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E4E7EC] bg-[#F7F8FA] text-[11px] font-medium uppercase tracking-wider text-[#667085]">
                    <tr>
                      <th className="px-4 py-2.5">Position & Department</th>
                      <th className="px-3 py-2.5">Experience</th>
                      <th className="px-3 py-2.5">Candidates</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E7EC]">
                    {filteredJobs.map((job) => (
                      <JobTableRow key={job.id} job={job} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

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
