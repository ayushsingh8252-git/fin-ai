"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Loader2, Play, RefreshCw, Layers, Sliders
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

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Trigger modal / configuration state
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E4E7EC] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#171717]">
            Recruitment Workflows
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#667085]">
            Automated multi-stage pipelines for resume parsing, hard requirement matching, and decision routing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-[#98A2B3]", loading && "animate-spin")} />
            Sync Status
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* CORE 4-STAGE PIPELINE OVERVIEW */}
      <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Standard Evaluation Pipeline</h2>
            <p className="text-[11px] text-[#98A2B3] mt-0.5">End-to-end candidate processing flow</p>
          </div>
          <span className="text-xs font-medium text-[#12B76A]">● Active System</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-4">
          <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-1">
            <span className="text-[10px] font-semibold text-[#667085] uppercase tracking-wider">Stage 1</span>
            <h3 className="text-xs font-semibold text-[#171717]">Document Ingestion</h3>
            <p className="text-[11px] text-[#667085]">PDF & DOCX text extraction</p>
          </div>
          <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-1">
            <span className="text-[10px] font-semibold text-[#667085] uppercase tracking-wider">Stage 2</span>
            <h3 className="text-xs font-semibold text-[#171717]">Hard Requirements</h3>
            <p className="text-[11px] text-[#667085]">Experience & mandatory skills</p>
          </div>
          <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-1">
            <span className="text-[10px] font-semibold text-[#667085] uppercase tracking-wider">Stage 3</span>
            <h3 className="text-xs font-semibold text-[#171717]">Semantic Evaluation</h3>
            <p className="text-[11px] text-[#667085]">Role relevance & skill depth</p>
          </div>
          <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-1">
            <span className="text-[10px] font-semibold text-[#667085] uppercase tracking-wider">Stage 4</span>
            <h3 className="text-xs font-semibold text-[#171717]">Decision Routing</h3>
            <p className="text-[11px] text-[#667085]">Shortlist, triage, or reject</p>
          </div>
        </div>
      </div>

      {/* Trigger Execution Modal/Drawer Form */}
      {selectedTemplate && (
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#171717]">Execute: {selectedTemplate.name}</h3>
              <p className="text-xs text-[#667085]">Configure parameters for this workflow execution</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTemplate(null)}
              className="h-7 text-xs text-[#667085] hover:text-[#171717]"
            >
              Cancel
            </Button>
          </div>

          <form onSubmit={handleRunSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#171717]">
                  Target Position
                </label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full h-8 rounded-md border border-[#E4E7EC] bg-white px-2.5 text-xs font-medium text-[#171717] focus:border-[#171717] focus:outline-none"
                >
                  <option value="">All Open Positions (Global)</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} — {job.department || "General"}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#98A2B3]">Limit execution to applicants of a specific role.</p>
              </div>

              {selectedTemplate.id === "auto_shortlist" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-[#171717]">
                      Minimum Match Threshold
                    </label>
                    <span className="text-xs font-semibold tabular-nums text-[#171717]">
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
                    className="w-full h-1.5 bg-[#E4E7EC] rounded-lg appearance-none cursor-pointer accent-[#171717] mt-2"
                  />
                  <div className="flex justify-between text-[10px] text-[#98A2B3] font-medium">
                    <span>50% (Flexible)</span>
                    <span>75% (Standard)</span>
                    <span>95% (Strict)</span>
                  </div>
                </div>
              )}
            </div>

            {triggerError && <ErrorBanner message={triggerError} />}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E4E7EC]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedTemplate(null)}
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={triggering}
                className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Workflow Rules & Templates ({templates.length})
          </h2>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-lg bg-[#E4E7EC]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-lg border border-[#E4E7EC] bg-white p-4 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[#171717]">
                      {tmpl.name}
                    </h3>
                    <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 text-[10px] font-medium text-[#667085]">
                      {tmpl.steps.length} Steps
                    </span>
                  </div>

                  <p className="text-xs text-[#667085] leading-relaxed font-normal">
                    {tmpl.description}
                  </p>

                  <div className="pt-2 border-t border-[#E4E7EC]">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[#98A2B3] mb-1">
                      Steps:
                    </p>
                    <div className="space-y-1">
                      {tmpl.steps.map((st, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs text-[#667085]">
                          <span className="text-[10px] text-[#98A2B3]">{i + 1}.</span>
                          <span className="truncate">{st.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#E4E7EC]">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#171717] hover:bg-[#F2F4F7]"
                    onClick={() => setSelectedTemplate(tmpl)}
                  >
                    <Play className="h-3 w-3 mr-1.5 text-[#667085]" />
                    Run Workflow
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Execution History
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg bg-[#E4E7EC]" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-8 text-center text-xs text-[#667085]">
            No workflow executions logged yet.
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
                  className="rounded-lg border border-[#E4E7EC] bg-white p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-[#171717]">{run.title}</h3>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.2 text-[10px] font-medium uppercase",
                            isCompleted
                              ? "bg-[#ECFDF3] text-[#12B76A]"
                              : isFailed
                              ? "bg-[#FEF3F2] text-[#F04438]"
                              : "bg-[#FFFAEB] text-[#F79009]"
                          )}
                        >
                          {run.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#98A2B3]">
                        {run.created_at ? new Date(run.created_at).toLocaleString() : "Recently"}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                      className="h-7 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
                    >
                      {isExpanded ? "Hide Logs" : "View Logs"}
                      <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", isExpanded && "rotate-180")} />
                    </Button>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-[#667085]">
                      <span>{run.completed_steps} of {run.total_steps} steps</span>
                      <span className="font-semibold text-[#171717] tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[#F2F4F7] overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          isFailed ? "bg-[#F04438]" : isCompleted ? "bg-[#12B76A]" : "bg-[#171717]"
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  {run.summary && (
                    <p className="text-xs text-[#667085] bg-[#F7F8FA] p-2.5 rounded-md border border-[#E4E7EC]">
                      {run.summary}
                    </p>
                  )}

                  {/* Expanded Steps */}
                  {isExpanded && run.steps && run.steps.length > 0 && (
                    <div className="pt-2 border-t border-[#E4E7EC] space-y-1.5">
                      {run.steps.map((st) => (
                        <div key={st.id} className="py-1 px-2.5 flex items-center justify-between text-xs rounded bg-[#F7F8FA]">
                          <div className="flex items-center gap-2">
                            {st.status === "completed" ? (
                              <CheckCircle2 className="h-3 w-3 text-[#12B76A]" />
                            ) : st.status === "failed" ? (
                              <AlertTriangle className="h-3 w-3 text-[#F04438]" />
                            ) : (
                              <Clock className="h-3 w-3 text-[#98A2B3]" />
                            )}
                            <span className="font-medium text-[#171717]">{st.name}</span>
                          </div>
                          <span className="text-[10px] text-[#667085] uppercase">{st.status}</span>
                        </div>
                      ))}
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
