"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Filter, Loader2, Play, RefreshCw, Send, ShieldAlert,
  Sparkles, Zap, ArrowRight, Sliders, CheckCircle, Layers, Cpu
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
  Zap: <Zap className="h-5 w-5 text-indigo-500" />,
  ShieldAlert: <ShieldAlert className="h-5 w-5 text-red-500" />,
  Send: <Send className="h-5 w-5 text-emerald-500" />,
};

const TEMPLATE_ACCENTS: Record<string, { border: string; bg: string; badge: string }> = {
  auto_shortlist: {
    border: "hover:border-indigo-400/80 hover:shadow-indigo-500/10",
    bg: "from-indigo-500/10 via-indigo-500/5 to-transparent",
    badge: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  fraud_gate: {
    border: "hover:border-red-400/80 hover:shadow-red-500/10",
    bg: "from-red-500/10 via-red-500/5 to-transparent",
    badge: "bg-red-50 text-red-700 border-red-200",
  },
  screening_trigger: {
    border: "hover:border-emerald-400/80 hover:shadow-emerald-500/10",
    bg: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
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
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-gradient-to-r from-zinc-900 via-indigo-950 to-zinc-900 p-8 text-white shadow-xl shadow-indigo-950/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300 backdrop-blur-md">
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              <span>Automated Intelligence Engine</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Pipeline Workflows
            </h1>
            <p className="text-sm text-zinc-300/90 leading-relaxed">
              Trigger autonomous multi-step pipelines for high-throughput resume scoring, fraud detection gates, and AI voice screening invitations.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefresh((n) => n + 1)}
              disabled={loading}
              className="border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Sync Runs
            </Button>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Trigger Dialog / Interactive Form */}
      {selectedTemplate && (
        <div className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/50 p-6 sm:p-8 shadow-xl shadow-indigo-500/5 space-y-6 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between border-b border-indigo-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900">Configure & Execute: {selectedTemplate.name}</h3>
                <p className="text-xs text-zinc-500">Run this automated pipeline across applications</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedTemplate(null)} className="text-zinc-500 hover:text-zinc-900">
              Dismiss
            </Button>
          </div>

          <form onSubmit={handleRunSubmit} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700">
                  Target Job Position
                </label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm font-medium text-zinc-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">All Active Positions (Global Run)</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} — {job.department || "General"}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-400">Limit this workflow to candidates for a specific open role.</p>
              </div>

              {selectedTemplate.id === "auto_shortlist" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700">
                      Minimum Match Score
                    </label>
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700">
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
                    className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2"
                  />
                  <div className="flex justify-between text-[11px] text-zinc-400 font-medium">
                    <span>50% (Flexible)</span>
                    <span>75% (Standard)</span>
                    <span>95% (Elite)</span>
                  </div>
                </div>
              )}
            </div>

            {triggerError && <ErrorBanner message={triggerError} />}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedTemplate(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="brand"
                size="sm"
                disabled={triggering}
                className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-violet-700"
              >
                {triggering ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Executing Pipeline...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Execute Workflow Now
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Templates Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-zinc-500" />
            <h2 className="text-base font-bold text-zinc-900">Workflow Templates</h2>
          </div>
          <span className="text-xs text-zinc-400">Ready to execute on demand</span>
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-3">
            {templates.map((tmpl) => {
              const accent = TEMPLATE_ACCENTS[tmpl.id] || {
                border: "hover:border-zinc-300",
                bg: "from-zinc-500/5 to-transparent",
                badge: "bg-zinc-100 text-zinc-700 border-zinc-200",
              };

              return (
                <div
                  key={tmpl.id}
                  className={cn(
                    "group relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1 flex flex-col justify-between space-y-6",
                    accent.border
                  )}
                >
                  <div className={cn("absolute inset-0 bg-gradient-to-b opacity-50 pointer-events-none", accent.bg)} />

                  <div className="relative z-10 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-50 border border-zinc-100 shadow-sm transition-transform group-hover:scale-105">
                        {ICONS[tmpl.icon] || <Zap className="h-6 w-6 text-indigo-500" />}
                      </div>
                      <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", accent.badge)}>
                        {tmpl.steps.length} Steps
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-zinc-900 group-hover:text-indigo-600 transition-colors">
                        {tmpl.name}
                      </h3>
                      <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                        {tmpl.description}
                      </p>
                    </div>

                    {/* Visual Multi-step Pipeline Flow */}
                    <div className="pt-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                        Pipeline Stages:
                      </p>
                      <div className="space-y-1.5">
                        {tmpl.steps.map((st, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-zinc-600">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-500">
                              {i + 1}
                            </span>
                            <span className="truncate font-medium">{st.name}</span>
                            {i < tmpl.steps.length - 1 && (
                              <ChevronRight className="h-3 w-3 text-zinc-300 ml-auto shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="relative z-10 pt-2">
                    <Button
                      variant="brand"
                      size="sm"
                      className="w-full bg-zinc-900 text-white hover:bg-indigo-600 shadow-sm transition-all duration-200"
                      onClick={() => setSelectedTemplate(tmpl)}
                    >
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      Configure & Run
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Execution Runs Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            <h2 className="text-base font-bold text-zinc-900">Execution History & Audit Trail</h2>
          </div>
          <span className="text-xs text-zinc-400">Real-time status updates</span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-3xl border border-zinc-200/80 bg-white/80 backdrop-blur-xl p-16 text-center shadow-sm">
            <Clock className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
            <h3 className="text-base font-bold text-zinc-800">No workflow executions logged</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto leading-relaxed">
              Launch a workflow template from above to process candidates through automated AI shortlisting, fraud gates, and voice screening.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => {
              const isExpanded = expandedRun === run.id;
              const percent = run.total_steps > 0 ? Math.round((run.completed_steps / run.total_steps) * 100) : 0;
              const isCompleted = run.status === "completed";
              const isFailed = run.status === "failed";

              return (
                <div
                  key={run.id}
                  className="group rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-base font-bold text-zinc-900">{run.title}</h3>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            isCompleted
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                              : isFailed
                              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          )}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          ) : isFailed ? (
                            <AlertTriangle className="h-3 w-3 text-red-600" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                          )}
                          {run.status}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Triggered on {run.created_at ? new Date(run.created_at).toLocaleString() : "Recently"}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                      className="border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                    >
                      {isExpanded ? "Hide Steps" : "Inspect Step Logs"}
                      <ChevronDown className={cn("h-3.5 w-3.5 ml-1 transition-transform duration-200", isExpanded && "rotate-180")} />
                    </Button>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-zinc-500 font-medium">
                      <span>Execution Progress ({run.completed_steps} of {run.total_steps} steps)</span>
                      <span className="font-bold text-zinc-800">{percent}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          isFailed
                            ? "bg-red-500"
                            : isCompleted
                            ? "bg-gradient-to-r from-indigo-600 via-violet-600 to-emerald-500"
                            : "bg-indigo-600"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {run.summary && (
                    <p className="text-xs text-zinc-700 bg-zinc-50/80 p-3 rounded-xl border border-zinc-100 font-mono">
                      {run.summary}
                    </p>
                  )}

                  {run.error && (
                    <p className="text-xs text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
                      Error: {run.error}
                    </p>
                  )}

                  {/* Expanded Steps */}
                  {isExpanded && run.steps && run.steps.length > 0 && (
                    <div className="pt-4 border-t border-zinc-100 space-y-3 animate-in fade-in-50 duration-200">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                        Step-by-Step Execution Record
                      </h4>
                      <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 bg-zinc-50/50 p-2">
                        {run.steps.map((st) => (
                          <div key={st.id} className="py-2.5 px-2 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2.5">
                              {st.status === "completed" ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : st.status === "failed" ? (
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                              ) : (
                                <Clock className="h-4 w-4 text-zinc-400" />
                              )}
                              <span className="font-bold text-zinc-900">{st.step_index + 1}. {st.name}</span>
                              <span className="text-zinc-400 font-mono text-[11px]">({st.action})</span>
                            </div>
                            <div>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
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
