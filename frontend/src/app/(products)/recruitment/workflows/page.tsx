"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronRight,
  Clock, Loader2, Play, RefreshCw, SlidersHorizontal,
  FileText, ShieldCheck, Check, GripVertical, Settings2,
  Sparkles, ArrowRight, Zap, Bot, UserCheck, ToggleLeft, ToggleRight
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
    name: "Basic Qualifications Check",
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
    name: "AI Role Suitability Score",
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
    subtitle: "Sends candidates to the right stage automatically",
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

  // Friendly simulation test state
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

  // Non-tech simulation runner
  const runSimulation = () => {
    if (simulating) return;
    setSimulating(true);
    setSimLogs([]);

    const demoFlow = [
      { id: "intake", step: "Resume Intake", msg: "Resume received for Priya Sharma · Extracted 5.5 years exp at Swiggy Labs, verified Python & PyTorch.", delay: 600 },
      { id: "screening", step: "Qualifications Check", msg: "Minimum experience met: 5.5 years (Required: 3.0 years) · Core skills verified.", delay: 1300 },
      { id: "scoring", step: "Role Fit Scoring", msg: "Calculated 93% suitability fit · High semantic alignment for Lead AI Systems Engineer.", delay: 2100 },
      { id: "routing", step: "Smart Dispatch", msg: "Score 93% exceeds 80% threshold · Auto-advanced to Shortlist & sent WhatsApp screening invite.", delay: 2900 },
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
    <div className="space-y-6 pb-12">
      {/* Friendly Non-Tech Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200/80 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
            Hiring Automations
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500">
            Automate repetitive recruiting tasks: screen resumes, verify qualifications, and fast-track top candidates.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefresh((n) => n + 1)}
            disabled={loading}
            className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 shadow-2xs cursor-pointer"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5 text-zinc-400", loading && "animate-spin")} />
            Sync Automations
          </Button>

          <Button
            size="sm"
            onClick={runSimulation}
            disabled={simulating}
            className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-3 shadow-2xs cursor-pointer"
          >
            {simulating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Test Hiring Flow
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ── 4-STEP VISUAL HIRING FLOW (SIMPLE FOR NON-TECH) ── */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
              Your Active Hiring Rules
            </h2>
            <p className="text-[11px] text-zinc-500">
              Click any step to view or customize its settings.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Automations Active
          </span>
        </div>

        {/* The 4 Connected Step Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {steps.map((s, idx) => {
            const isSelected = selectedStepId === s.id;
            const isSimActive = simActiveStepId === s.id;

            return (
              <div
                key={s.id}
                onClick={() => setSelectedStepId(s.id)}
                className={cn(
                  "relative rounded-xl border p-4 transition-all cursor-pointer bg-white shadow-2xs space-y-2 select-none",
                  isSimActive
                    ? "border-emerald-600 ring-2 ring-emerald-500/20 shadow-sm"
                    : isSelected
                    ? "border-zinc-900 ring-1 ring-zinc-900/10"
                    : "border-zinc-200/80 hover:border-zinc-300"
                )}
              >
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono">
                    Step {s.number}
                  </span>
                  <span className={cn(
                    "h-2 w-2 rounded-full",
                    isSimActive ? "bg-emerald-500 animate-ping" : "bg-emerald-500"
                  )} />
                </div>

                <h3 className="text-xs font-bold text-zinc-900">{s.name}</h3>
                <p className="text-[11px] text-zinc-500 leading-relaxed">{s.subtitle}</p>

                {idx < steps.length - 1 && (
                  <div className="hidden lg:flex absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 h-5 w-5 items-center justify-center rounded-full bg-zinc-100 border border-zinc-200 text-zinc-500 shadow-2xs">
                    <ChevronRight className="h-3 w-3" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Step Inspector & Simple Settings */}
        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-200/70 pb-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white border border-zinc-200 text-zinc-600 shrink-0">
                <Settings2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </div>
              <h4 className="text-xs font-bold text-zinc-900">
                Settings for: {selectedStep.name}
              </h4>
            </div>
            <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Active Rule
            </span>
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed font-normal">
            {selectedStep.description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {Object.entries(selectedStep.config).map(([label, val]) => (
              <div key={label} className="rounded-lg bg-white border border-zinc-200/80 p-3 text-xs space-y-1 shadow-2xs">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">
                  {label}
                </span>
                <span className="text-xs font-bold text-zinc-900 block font-mono">
                  {String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Simulation Output (Shows when test button clicked) */}
        {simLogs.length > 0 && (
          <div className="rounded-xl border border-zinc-200/80 bg-zinc-900 text-white p-4 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                Live Hiring Simulation Result
              </span>
              <span className="text-[10px] font-bold text-emerald-400">
                {simulating ? "Processing steps…" : "✓ Complete"}
              </span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-xs">
              {simLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="text-emerald-400 font-bold font-mono shrink-0">✓</span>
                  <span className="text-zinc-400 font-medium shrink-0">[{log.stepName}]:</span>
                  <span className="text-zinc-100">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── READY-TO-USE AUTOMATION RECIPES ── */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="border-b border-zinc-100 pb-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
            One-Click Automation Recipes
          </h2>
          <p className="text-[11px] text-zinc-500">
            Pre-built recruiting workflows you can run instantly across any job position.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 flex flex-col justify-between space-y-3 shadow-2xs hover:border-zinc-300 transition-colors"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    {tmpl.steps?.length || 3} Automated Actions
                  </span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <h3 className="text-xs font-bold text-zinc-900">{tmpl.name}</h3>
                <p className="text-[11px] text-zinc-600 leading-relaxed font-normal">
                  {tmpl.description}
                </p>
              </div>

              <Button
                size="sm"
                onClick={() => setSelectedTemplate(tmpl)}
                className="w-full h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold cursor-pointer shadow-2xs"
              >
                Run Automation <ArrowRight className="h-3 w-3 ml-1 text-zinc-400" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Trigger Execution Modal Form */}
      {selectedTemplate && (
        <div className="rounded-xl border border-zinc-200/80 bg-white p-5 space-y-4 shadow-lg">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Run: {selectedTemplate.name}</h3>
              <p className="text-xs text-zinc-500">Select which open role to run this hiring automation on</p>
            </div>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="text-xs text-zinc-400 hover:text-zinc-800 cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {triggerError && <ErrorBanner message={triggerError} />}

          <form onSubmit={handleRunSubmit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Target Job Position</label>
                <select
                  value={selectedJobId}
                  onChange={(e) => setSelectedJobId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-zinc-900"
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
                <label className="block text-xs font-bold text-zinc-700 mb-1">Minimum Score Required (%)</label>
                <input
                  type="number"
                  min="50"
                  max="95"
                  value={paramMinScore}
                  onChange={(e) => setParamMinScore(Number(e.target.value))}
                  className="w-full h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-zinc-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedTemplate(null)}
                className="h-8 rounded-lg text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={triggering}
                className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-2xs cursor-pointer"
              >
                {triggering ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                Confirm & Run
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ── AUTOMATION HISTORY LOG ── */}
      <section className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="border-b border-zinc-100 pb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
            Recent Automation History ({runs.length})
          </h2>
          <span className="text-xs text-zinc-500">Live execution log</span>
        </div>

        <div className="space-y-2">
          {runs.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-zinc-900">{r.title}</h4>
                  <span className={cn(
                    "rounded-full px-2 py-0.2 text-[10px] font-bold capitalize",
                    r.status === "completed" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-200 text-zinc-700"
                  )}>
                    {r.status}
                  </span>
                </div>
                {r.summary && <p className="text-zinc-600 text-[11px] font-normal">{r.summary}</p>}
              </div>

              <div className="flex items-center gap-2 text-[11px] text-zinc-500 shrink-0">
                <Clock className="h-3 w-3 text-zinc-400" />
                <span>{r.created_at ? new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent"}</span>
              </div>
            </div>
          ))}

          {runs.length === 0 && (
            <p className="text-xs text-zinc-400 py-6 text-center">No past automations run yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
