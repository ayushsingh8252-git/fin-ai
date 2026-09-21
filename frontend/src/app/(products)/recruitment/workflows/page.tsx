"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronRight,
  Clock, Loader2, Play, RefreshCw, SlidersHorizontal,
  FileText, ShieldCheck, Check, GripVertical, Settings2,
  Sparkles, ArrowRight, Zap, Bot, UserCheck, ToggleLeft, ToggleRight,
  Activity, ArrowUpRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getWorkflowTemplates, getWorkflowRuns, triggerWorkflowRun, listJobs,
  type WorkflowTemplate, type WorkflowRunItem, type Job,
  errorMessage,
} from "@/lib/recruitmentApi";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface PipelineStep {
  id: string;
  number: string;
  name: string;
  subtitle: string;
  description: string;
  enabled: boolean;
  config: Record<string, string | number>;
}

const DEFAULT_PIPELINE_STEPS: PipelineStep[] = [
  {
    id: "intake",
    number: "01",
    name: "Resume Intake & Reading",
    subtitle: "Reads uploaded CVs and extracts skills",
    description: "Automatically pulls out contact details, job history, and technical competencies from PDF or Word documents.",
    enabled: true,
    config: {
      "Supported Formats": "PDF, DOCX",
      "Max File Size": "25 MB",
      "Smart Text Recognition": "Enabled",
    },
  },
  {
    id: "screening",
    number: "02",
    name: "Qualifications Check",
    subtitle: "Verifies minimum years and required skills",
    description: "Filters out applicants who do not meet the baseline criteria before spending valuable team interview time.",
    enabled: true,
    config: {
      "Minimum Experience": "3 Years",
      "Required Skills Match": "80%",
      "Grace Period": "6 Months",
    },
  },
  {
    id: "scoring",
    number: "03",
    name: "AI Suitability Score",
    subtitle: "Scores candidate fit from 0 to 100%",
    description: "Compares the candidate's background against your job description to generate a transparent fit rating.",
    enabled: true,
    config: {
      "Target Fit Threshold": "80%+",
      "Evaluation Depth": "Comprehensive",
      "Explain Verdict": "Enabled",
    },
  },
  {
    id: "routing",
    number: "04",
    name: "Smart Decision Dispatch",
    subtitle: "Dispatches candidates automatically",
    description: "High-scoring applicants are fast-tracked, while borderline candidates are queued for your human review.",
    enabled: true,
    config: {
      "Auto-Shortlist Above": "80% Match",
      "Send to Review Inbox": "65% – 79%",
      "Polite Decline Below": "< 65%",
    },
  },
];

interface SimulationLog {
  time: string;
  stepName: string;
  message: string;
}

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Workflow steps
  const [steps, setSteps] = useState<PipelineStep[]>(DEFAULT_PIPELINE_STEPS);
  const [selectedStepId, setSelectedStepId] = useState<string>("routing");

  // Simulation test state
  const [simulating, setSimulating] = useState(false);
  const [simActiveStepId, setSimActiveStepId] = useState<string | null>(null);
  const [simLogs, setSimLogs] = useState<SimulationLog[]>([]);

  // Trigger modal state
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [paramMinScore, setParamMinScore] = useState<number>(75);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const { toast } = useToast();

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

  const runSimulation = () => {
    if (simulating) return;
    setSimulating(true);
    setSimLogs([]);

    const demoFlow = [
      { id: "intake", step: "Resume Intake", msg: "Resume received for Priya Sharma · Extracted 5.5 years exp, verified Python & PyTorch.", delay: 600 },
      { id: "screening", step: "Qualifications Check", msg: "Minimum experience met: 5.5 years (Required: 3.0 years) · Core skills verified.", delay: 1300 },
      { id: "scoring", step: "Role Fit Scoring", msg: "Calculated 93% suitability fit · High semantic alignment for Lead AI Systems Engineer.", delay: 2100 },
      { id: "routing", step: "Smart Dispatch", msg: "Score 93% exceeds 80% threshold · Auto-advanced to Shortlist & sent screening invite.", delay: 2900 },
    ];

    demoFlow.forEach(({ id, step, msg, delay }, i) => {
      setTimeout(() => {
        setSimActiveStepId(id);
        const now = new Date().toLocaleTimeString("en-US", { hour12: false });
        setSimLogs((prev) => [...prev, { time: now, stepName: step, message: msg }]);

        if (i === demoFlow.length - 1) {
          setTimeout(() => {
            setSimulating(false);
            setSimActiveStepId(null);
            toast("success", "Sample hiring flow completed: Candidate Priya Sharma successfully fast-tracked!");
          }, 800);
        }
      }, delay);
    });
  };

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
      toast("success", `Automation '${selectedTemplate.name}' started.`);
      setSelectedTemplate(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setTriggerError(errorMessage(err));
    } finally {
      setTriggering(false);
    }
  };

  const selectedStep = steps.find((s) => s.id === selectedStepId) || steps[3];

  return (
    <div className="space-y-6 pb-14">
      {/* ─── Clean Enterprise Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-blue-600 bg-blue-50/90 border border-blue-200/60 px-2 py-0.5 rounded">
              Rule Engine
            </span>
            <span className="text-zinc-300">/</span>
            <span className="text-xs text-zinc-500 font-medium">Pipeline Workflows</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
            Hiring Automations
          </h1>
          <p className="mt-0.5 text-xs text-zinc-500 font-medium">
            Automated qualification screening, AI semantic scoring, and candidate stage routing rules.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8.5 rounded-xl border-zinc-200 bg-white text-xs font-semibold text-zinc-700 hover:bg-zinc-50 shadow-2xs cursor-pointer transition-all"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-400", loading && "animate-spin text-blue-600")} />
            Sync Rules
          </Button>

          <Button
            size="sm"
            onClick={runSimulation}
            disabled={simulating}
            className="h-8.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3.5 shadow-sm shadow-blue-600/20 cursor-pointer transition-all"
          >
            {simulating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5 fill-white" />}
            Test Hiring Flow
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ── 4-STEP VISUAL HIRING FLOW ── */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3.5">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
              Active Pipeline Automation Stages
            </h2>
            <p className="text-[11px] text-zinc-500 font-medium mt-0.5">
              Select any stage below to configure its trigger criteria and scoring thresholds.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full shadow-2xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Automations Live
          </span>
        </div>

        {/* The 4 Connected Step Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {steps.map((s, idx) => {
            const isSelected = selectedStepId === s.id;
            const isSimActive = simActiveStepId === s.id;

            return (
              <div
                key={s.id}
                onClick={() => setSelectedStepId(s.id)}
                className={cn(
                  "relative rounded-2xl border p-4.5 transition-all cursor-pointer bg-white space-y-2.5 select-none",
                  isSimActive
                    ? "border-emerald-600 ring-2 ring-emerald-500/20 shadow-md scale-[1.02]"
                    : isSelected
                    ? "border-blue-600 ring-2 ring-blue-600/15 shadow-sm"
                    : "border-zinc-200/80 hover:border-zinc-300 shadow-2xs"
                )}
              >
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 font-mono bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
                    STAGE {s.number}
                  </span>
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    isSimActive ? "bg-emerald-500 animate-ping" : "bg-emerald-500"
                  )} />
                </div>

                <h3 className="text-xs font-extrabold text-zinc-900">{s.name}</h3>
                <p className="text-[11px] text-zinc-500 leading-relaxed font-medium">{s.subtitle}</p>

                {idx < steps.length - 1 && (
                  <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 h-6 w-6 items-center justify-center rounded-full bg-white border border-zinc-200 text-zinc-500 shadow-2xs">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Step Inspector & Simple Settings */}
        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-200/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-zinc-200 text-blue-600 shadow-2xs">
                <Settings2 className="h-4 w-4" strokeWidth={2} />
              </div>
              <h4 className="text-xs font-extrabold text-zinc-900">
                Configuration for: {selectedStep.name}
              </h4>
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
              Active Criteria
            </span>
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed max-w-2xl font-medium">
            {selectedStep.description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {Object.entries(selectedStep.config).map(([label, val]) => (
              <div key={label} className="rounded-xl bg-white border border-zinc-200/80 p-3.5 text-xs space-y-1 shadow-2xs">
                <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider block">
                  {label}
                </span>
                <span className="text-xs font-bold text-zinc-900 block font-mono">
                  {String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Simulation Output (matching Main Website AutomationCardInteractive) */}
        {simLogs.length > 0 && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 text-white p-5 space-y-3 shadow-xl relative overflow-hidden">
            <div className="pointer-events-none absolute -top-10 -right-10 w-44 h-44 bg-blue-500/10 rounded-full blur-2xl" />
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live Agent Execution Trace
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-400">
                {simulating ? "Executing steps…" : "✓ Pipeline Completed"}
              </span>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1 text-xs">
              {simLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="text-emerald-400 font-bold font-mono shrink-0">✓</span>
                  <span className="text-zinc-400 font-mono text-[11px] shrink-0">[{log.stepName}]:</span>
                  <span className="text-zinc-100 font-medium">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── READY-TO-USE AUTOMATION RECIPES (.cpu-burn-card Design System) ── */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-2xs space-y-5">
        <div className="border-b border-zinc-100 pb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
            One-Click Automation Recipes
          </h2>
          <p className="text-[11px] text-zinc-500 font-medium mt-0.5">
            Pre-configured recruitment workflows you can execute across active job requisitions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="cpu-burn-card flex flex-col justify-between space-y-4 cursor-default"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="card-icon-badge">
                    <Zap className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {tmpl.steps?.length || 3} Actions
                  </span>
                </div>
                <h3 className="text-sm font-extrabold text-zinc-900">{tmpl.name}</h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  {tmpl.description}
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => setSelectedTemplate(tmpl)}
                className="w-full h-8.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-sm shadow-blue-600/20 transition-all hover:-translate-y-0.5 active:translate-y-0"
              >
                Run Automation <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Trigger Execution Modal Form */}
      {selectedTemplate && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div>
              <h3 className="text-sm font-extrabold text-zinc-900">Run Automation: {selectedTemplate.name}</h3>
              <p className="text-xs text-zinc-500 font-medium mt-0.5">Select which open role to execute this hiring workflow on</p>
            </div>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="text-xs text-zinc-400 hover:text-zinc-800 cursor-pointer font-semibold"
            >
              Cancel
            </button>
          </div>

          {triggerError && <ErrorBanner message={triggerError} />}

          <form onSubmit={handleRunSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">Target Job Position</label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full h-9 rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-900 focus:outline-none focus:border-blue-500"
                >
                  <option value="">All Active Positions</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} ({j.department || "General"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">Minimum Score Threshold (%)</label>
                <input
                  type="number"
                  min="50"
                  max="95"
                  value={paramMinScore}
                  onChange={(e) => setParamMinScore(Number(e.target.value))}
                  className="w-full h-9 rounded-xl border border-zinc-200 bg-white px-3 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 font-mono font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedTemplate(null)}
                className="h-8.5 rounded-xl text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={triggering}
                className="h-8.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 cursor-pointer"
              >
                {triggering ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5 fill-white" />}
                Confirm & Run
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── AUTOMATION HISTORY LOG ── */}
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-2xs space-y-4">
        <div className="border-b border-zinc-100 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
              Execution History ({runs.length})
            </h2>
            <p className="text-[11px] text-zinc-500 font-medium">Audit trail of automated recruitment workflows</p>
          </div>
          <span className="text-xs text-zinc-500 font-mono">Real-time log</span>
        </div>

        <div className="space-y-2.5">
          {runs.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:border-zinc-200 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h4 className="font-extrabold text-zinc-900 text-xs sm:text-sm">{r.title}</h4>
                  <span className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold capitalize border",
                    r.status === "completed"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-zinc-100 text-zinc-700 border-zinc-200"
                  )}>
                    {r.status}
                  </span>
                </div>
                {r.summary && <p className="text-zinc-600 text-xs font-medium">{r.summary}</p>}
              </div>

              <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono shrink-0">
                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                <span>{r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent"}</span>
              </div>
            </div>
          ))}

          {runs.length === 0 && (
            <p className="text-xs text-zinc-400 py-8 text-center font-medium">No past automations run yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
