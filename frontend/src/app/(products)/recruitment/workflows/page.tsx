"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Loader2, Play, RefreshCw, Send, ShieldAlert,
  Zap, Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getWorkflowTemplates, getWorkflowRuns, triggerWorkflowRun, listJobs,
  type WorkflowTemplate, type WorkflowRunItem, type Job,
  errorMessage,
} from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-4 w-4 text-zinc-700" />,
  ShieldAlert: <ShieldAlert className="h-4 w-4 text-zinc-700" />,
  Send: <Send className="h-4 w-4 text-zinc-700" />,
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
    <div className="space-y-6">
      {/* Enterprise Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
            Pipeline Workflows
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Automated multi-stage pipelines for resume scoring, fraud verification gates, and candidate screening.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-500", loading && "animate-spin")} />
            Sync Runs
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Trigger Execution Modal/Drawer Form */}
      {selectedTemplate && (
        <div className="rounded-lg border border-zinc-300 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                <Zap className="h-3.5 w-3.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Execute: {selectedTemplate.name}</h3>
                <p className="text-[11px] text-zinc-500">Configure parameters for this workflow execution</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTemplate(null)}
              className="h-7 text-xs text-zinc-500 hover:text-zinc-900"
            >
              Dismiss
            </Button>
          </div>

          <form onSubmit={handleRunSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700">
                  Target Job Position
                </label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-xs focus:border-zinc-900 focus:outline-none"
                >
                  <option value="">All Open Positions (Global)</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} — {job.department || "General"}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-400">Limit this run to candidates of a specific position.</p>
              </div>

              {selectedTemplate.id === "auto_shortlist" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-zinc-700">
                      Minimum Match Threshold
                    </label>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-800">
                      {paramMinScore}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    step="5"
                    value={paramMinScore}
                    onChange={(e) => setParamMinScore(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-zinc-900 mt-2"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-400 font-medium">
                    <span>50% (Flexible)</span>
                    <span>75% (Standard)</span>
                    <span>95% (Strict)</span>
                  </div>
                </div>
              )}
            </div>

            {triggerError && <ErrorBanner message={triggerError} />}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedTemplate(null)}
                className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={triggering}
                className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
              >
                {triggering ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Executing…
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Execute Workflow
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Templates Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-900">Workflow Templates</h2>
          </div>
          <span className="text-xs text-zinc-400 font-normal">Available automation rules</span>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-xs flex flex-col justify-between space-y-4 transition-colors hover:border-zinc-300"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                      {ICONS[tmpl.icon] || <Zap className="h-4 w-4 text-zinc-700" />}
                    </div>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                      {tmpl.steps.length} Steps
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      {tmpl.name}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500 leading-relaxed font-normal">
                      {tmpl.description}
                    </p>
                  </div>

                  {/* Multi-step Pipeline Flow */}
                  <div className="pt-1">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 mb-1.5">
                      Stages:
                    </p>
                    <div className="space-y-1">
                      {tmpl.steps.map((st, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-zinc-600">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-100 text-[10px] font-semibold text-zinc-500">
                            {i + 1}
                          </span>
                          <span className="truncate font-normal">{st.name}</span>
                          {i < tmpl.steps.length - 1 && (
                            <ChevronRight className="h-3 w-3 text-zinc-300 ml-auto shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-100">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-800 hover:bg-zinc-50"
                    onClick={() => setSelectedTemplate(tmpl)}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5 text-zinc-500" />
                    Configure & Run
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Execution Runs Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-900">Execution History</h2>
          </div>
          <span className="text-xs text-zinc-400 font-normal">Recent automated workflow runs</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center shadow-xs">
            <Clock className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
            <h3 className="text-sm font-semibold text-zinc-800">No workflow executions logged</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Execute a workflow from the templates above to process candidates through automated pipelines.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {runs.map((run) => {
              const isExpanded = expandedRun === run.id;
              const percent = run.total_steps > 0 ? Math.round((run.completed_steps / run.total_steps) * 100) : 0;
              const isCompleted = run.status === "completed";
              const isFailed = run.status === "failed";

              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900">{run.title}</h3>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] font-medium uppercase",
                            isCompleted
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : isFailed
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          )}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          ) : isFailed ? (
                            <AlertTriangle className="h-3 w-3 text-red-600" />
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                          )}
                          {run.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Triggered {run.created_at ? new Date(run.created_at).toLocaleString() : "Recently"}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                      className="h-7 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {isExpanded ? "Hide Logs" : "View Logs"}
                      <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", isExpanded && "rotate-180")} />
                    </Button>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-zinc-500 font-normal">
                      <span>Progress: {run.completed_steps} of {run.total_steps} steps</span>
                      <span className="font-semibold text-zinc-800 tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          isFailed ? "bg-red-500" : isCompleted ? "bg-emerald-600" : "bg-zinc-800"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {run.summary && (
                    <p className="text-xs text-zinc-700 bg-zinc-50 p-2.5 rounded-md border border-zinc-100 font-mono">
                      {run.summary}
                    </p>
                  )}

                  {run.error && (
                    <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-md border border-red-200">
                      Error: {run.error}
                    </p>
                  )}

                  {/* Expanded Steps */}
                  {isExpanded && run.steps && run.steps.length > 0 && (
                    <div className="pt-3 border-t border-zinc-100 space-y-2">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                        Step Audit Trail
                      </h4>
                      <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-zinc-50/50">
                        {run.steps.map((st) => (
                          <div key={st.id} className="py-2 px-3 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              {st.status === "completed" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              ) : st.status === "failed" ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                              ) : (
                                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                              )}
                              <span className="font-medium text-zinc-900">{st.step_index + 1}. {st.name}</span>
                              <span className="text-zinc-400 font-mono text-[11px]">({st.action})</span>
                            </div>
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.2 text-[10px] font-medium uppercase",
                                st.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : st.status === "failed"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-zinc-200 text-zinc-700"
                              )}
                            >
                              {st.status}
                            </span>
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
