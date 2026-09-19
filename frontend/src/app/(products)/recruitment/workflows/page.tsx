"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Filter, Loader2, Play, RefreshCw, Send, ShieldAlert,
  Sparkles, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import {
  getWorkflowTemplates, getWorkflowRuns, triggerWorkflowRun, listJobs,
  type WorkflowTemplate, type WorkflowRunItem, type Job,
  errorMessage,
} from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-5 w-5 text-amber-500" />,
  ShieldAlert: <ShieldAlert className="h-5 w-5 text-red-500" />,
  Send: <Send className="h-5 w-5 text-indigo-500" />,
};

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Trigger modal state
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [paramMinScore, setParamMinScore] = useState<number>(75);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getWorkflowTemplates(), getWorkflowRuns(), listJobs()])
      .then(([tmplRes, runsRes, jobsRes]) => {
        if (!cancelled) {
          setTemplates(tmplRes.templates || []);
          setRuns(runsRes.runs || []);
          setJobs(jobsRes || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      await triggerWorkflowRun(
        selectedTemplate.id,
        selectedJobId || undefined,
        { min_score: paramMinScore }
      );
      setSelectedTemplate(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setTriggerError(errorMessage(err));
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Pipeline Workflows</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Multi-step automated workflows for resume screening, fraud checks, and candidate shortlisting.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Trigger Modal / Form */}
      {selectedTemplate && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              <h3 className="text-base font-bold text-zinc-900">Run {selectedTemplate.name}</h3>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedTemplate(null)}>
              Cancel
            </Button>
          </div>

          <form onSubmit={handleRunSubmit} className="space-y-4 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                  Target Job Position
                </label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Active Jobs</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} ({job.department || "General"})
                    </option>
                  ))}
                </select>
              </div>

              {selectedTemplate.id === "auto_shortlist" && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 uppercase tracking-wider mb-1">
                    Minimum Match Score ({paramMinScore}%)
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    step="5"
                    value={paramMinScore}
                    onChange={(e) => setParamMinScore(parseInt(e.target.value))}
                    className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-3"
                  />
                </div>
              )}
            </div>

            {triggerError && <ErrorBanner message={triggerError} />}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedTemplate(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" size="sm" disabled={triggering}>
                {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Execute Workflow
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Templates Section */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-zinc-900">Available Workflow Templates</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm flex flex-col justify-between hover:border-zinc-300 transition-all space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    {ICONS[tmpl.icon] || <Zap className="h-5 w-5 text-indigo-500" />}
                    <h3 className="text-base font-bold text-zinc-900">{tmpl.name}</h3>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">{tmpl.description}</p>
                  <div className="pt-2">
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                      Steps ({tmpl.steps.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {tmpl.steps.map((st, i) => (
                        <span key={i} className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                          {i + 1}. {st.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  variant="brand"
                  size="sm"
                  className="w-full"
                  onClick={() => setSelectedTemplate(tmpl)}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run Workflow
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Execution Runs Section */}
      <section className="space-y-4">
        <h2 className="text-base font-bold text-zinc-900">Recent Workflow Execution Runs</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center shadow-sm">
            <Clock className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
            <h3 className="text-base font-semibold text-zinc-800">No workflow runs yet</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Choose a workflow template above and run it to automate candidate shortlisting, integrity scanning, and screening.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => {
              const isExpanded = expandedRun === run.id;
              const percent = run.total_steps > 0 ? Math.round((run.completed_steps / run.total_steps) * 100) : 0;
              return (
                <div
                  key={run.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm space-y-3 hover:border-zinc-300 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-zinc-900">{run.title}</h3>
                        <StatusPill tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}>
                          {run.status.toUpperCase()}
                        </StatusPill>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Triggered on {run.created_at ? new Date(run.created_at).toLocaleString() : "Recently"}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                    >
                      {isExpanded ? "Hide Steps" : "Inspect Steps"}
                      <ChevronDown className={cn("h-3.5 w-3.5 ml-1 transition-transform", isExpanded && "rotate-180")} />
                    </Button>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Progress ({run.completed_steps} of {run.total_steps} steps)</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", run.status === "failed" ? "bg-red-500" : "bg-indigo-600")}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {run.summary && (
                    <p className="text-xs text-zinc-600 bg-zinc-50 p-2.5 rounded-lg border border-zinc-100">
                      {run.summary}
                    </p>
                  )}

                  {run.error && (
                    <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-100">
                      Error: {run.error}
                    </p>
                  )}

                  {/* Expanded Steps */}
                  {isExpanded && run.steps && run.steps.length > 0 && (
                    <div className="pt-3 border-t border-zinc-100 space-y-2">
                      <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Step Execution Details</h4>
                      <div className="divide-y divide-zinc-100">
                        {run.steps.map((st) => (
                          <div key={st.id} className="py-2.5 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              {st.status === "completed" ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : st.status === "failed" ? (
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                              ) : (
                                <Clock className="h-4 w-4 text-zinc-400" />
                              )}
                              <span className="font-semibold text-zinc-800">{st.step_index + 1}. {st.name}</span>
                              <span className="text-zinc-400">({st.action})</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <StatusPill tone={st.status === "completed" ? "success" : st.status === "failed" ? "danger" : "neutral"}>
                                {st.status}
                              </StatusPill>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
