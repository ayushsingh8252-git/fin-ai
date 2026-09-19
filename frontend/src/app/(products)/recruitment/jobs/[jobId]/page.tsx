"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileUp, Loader2, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  errorMessage, getJob, listCandidates, retryUpload, type CandidatePage, type Job,
} from "@/lib/recruitmentApi";
import { AnalysisIndicator, ScoreCell, StageBadge } from "../../_components/indicators";
import { UploadPanel } from "../../_components/UploadPanel";
import { useBatchProgress } from "../../_components/useBatchProgress";
import { useRecruitment } from "../../_components/RecruitmentShell";

type LoadState = { job: Job; candidates: CandidatePage } | { error: string } | null;

export default function JobWorkspacePage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const { can } = useRecruitment();
  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const progress = useBatchProgress(batchId, reload, pollKey);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    Promise.all([getJob(jobId), listCandidates(jobId, { pageSize: 100 })])
      .then(([job, candidates]) => !cancelled && setLoaded({ job, candidates }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => { cancelled = true; };
  }, [jobId, refresh]);

  if (loaded === null) {
    return <div className="space-y-5"><Skeleton className="h-12 w-72" /><Skeleton className="h-72 rounded-2xl" /></div>;
  }
  if ("error" in loaded) {
    return <div className="space-y-3"><ErrorBanner message={loaded.error} /><Button variant="outline" onClick={reload}>Try again</Button></div>;
  }

  const { job, candidates } = loaded;
  const pipeline = job.pipeline;
  const processing = (pipeline.PROCESSING ?? 0) + (pipeline.SCREENING ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/recruitment" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900">
            <ArrowLeft className="h-3.5 w-3.5" /> Jobs
          </Link>
          <h1 className="text-xl font-bold text-zinc-900">{job.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{job.department || "Recruitment workspace"}{job.location ? ` · ${job.location}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          {can("upload") && job.status !== "closed" && <Button variant="brand" onClick={() => setUploadOpen(true)}><FileUp className="h-4 w-4" />Upload resumes</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Candidates", job.total_candidates], ["Processing", processing],
          ["Shortlisted", pipeline.SHORTLISTED ?? 0], ["Interview", pipeline.INTERVIEW ?? 0],
        ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-2xl font-semibold tabular-nums text-zinc-900">{value}</p><p className="text-xs text-zinc-500">{label}</p></div>)}
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <div><h2 className="font-semibold text-zinc-900">Candidates</h2><p className="text-xs text-zinc-500">Persisted applications for this job</p></div>
          {progress && !progress.status.done && <span className="inline-flex items-center gap-1.5 text-xs text-blue-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing resumes</span>}
        </div>
        {candidates.items.length === 0 ? (
          <EmptyState icon={Users} title="No candidates yet" description={can("upload") ? "Upload PDF resumes to start the pipeline." : "Candidates will appear here once resumes are uploaded."} />
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-zinc-50 text-xs text-zinc-500"><tr><th className="px-5 py-3 font-medium">Candidate</th><th className="px-4 py-3 font-medium">Stage</th><th className="px-4 py-3 font-medium">ATS</th><th className="px-4 py-3 font-medium">Job match</th><th className="px-4 py-3 font-medium">Analysis</th></tr></thead><tbody className="divide-y divide-zinc-100">
            {candidates.items.map((app) => <tr key={app.id} className="text-zinc-700"><td className="px-5 py-3"><p className="font-medium text-zinc-900">{app.candidate.name || "Unnamed candidate"}</p><p className="text-xs text-zinc-500">{app.candidate.current_role || app.candidate.email || "Resume uploaded"}</p></td><td className="px-4 py-3"><StageBadge stage={app.stage} /></td><td className="px-4 py-3"><ScoreCell score={app.scores.ats_score} /></td><td className="px-4 py-3"><ScoreCell score={app.scores.match_score} /></td><td className="px-4 py-3"><AnalysisIndicator status={app.analysis_status} error={app.analysis_error} /></td></tr>)}
          </tbody></table></div>
        )}
      </section>

      {can("upload") && <UploadPanel open={uploadOpen} onOpenChange={setUploadOpen} job={job} batchId={batchId} progress={progress} onBatchStarted={setBatchId} onUploaded={() => setPollKey((n) => n + 1)} onRetry={async (id) => { await retryUpload(id); setPollKey((n) => n + 1); }} onViewCandidates={() => { setUploadOpen(false); reload(); }} onStartNew={() => setBatchId(null)} />}
    </div>
  );
}
