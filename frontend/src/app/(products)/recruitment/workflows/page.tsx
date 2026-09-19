"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Loader2, Play, RefreshCw, Layers, SlidersHorizontal,
  FileText, ShieldCheck, Brain, CornerDownRight, Check,
  GripVertical, Settings2, Sparkles, Terminal, ArrowDown
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

interface PipelineNode {
  id: string;
  name: string;
  type: "ingest" | "screen" | "evaluate" | "route" | "branch";
  subtitle: string;
  description: string;
  config: Record<string, string | number>;
}

const DEFAULT_PIPELINE_NODES: PipelineNode[] = [
  {
    id: "ingest",
    name: "Resume Ingestion & Extraction",
    type: "ingest",
    subtitle: "PDF / DOCX normalization & OCR",
    description: "Multi-page PDF parsing, OCR fallback, and structured data normalization.",
    config: {
      max_file_size: "25 MB",
      accepted_formats: "PDF, DOCX",
      ocr_fallback: "Enabled",
    },
  },
  {
    id: "screen",
    name: "Deterministic Screening",
    type: "screen",
    subtitle: "Hard requirements & experience matching",
    description: "Verifies mandatory skills and minimum years of experience before LLM scoring.",
    config: {
      min_experience_years: 3,
      mandatory_skills_match: "100%",
      experience_leeway_months: 6,
    },
  },
  {
    id: "evaluate",
    name: "Semantic Evaluation",
    type: "evaluate",
    subtitle: "LLM & Vector suitability analysis",
    description: "Deep role fit analysis, verified skills coverage, and synthesized candidate summary.",
    config: {
      confidence_threshold: "75%",
      vector_similarity_min: "0.80",
      reasoning_engine: "Standard Evaluator",
    },
  },
  {
    id: "route",
    name: "Decision Router",
    type: "route",
    subtitle: "Autonomous policy branching",
    description: "Routes applicant to Review Queue, Shortlist, or automated Rejection based on score thresholds.",
    config: {
      auto_shortlist_threshold: "85%",
      review_triage_threshold: "65–84%",
      auto_reject_threshold: "< 65%",
    },
  },
];

const BRANCH_NODES: PipelineNode[] = [
  {
    id: "branch_review",
    name: "Review Queue",
    type: "branch",
    subtitle: "Human-in-the-loop review",
    description: "Flags applicants with missing requirements or borderline scores for recruiter decision.",
    config: {
      triage_priority: "Medium",
      auto_assign: "Available Recruiter",
      sla_hours: 24,
    },
  },
  {
    id: "branch_shortlist",
    name: "Shortlist & Pre-Screen",
    type: "branch",
    subtitle: "Autonomous interview invite",
    description: "Fast-tracks high-match candidates directly to automated voice screening and interview booking.",
    config: {
      auto_invite_screening: "Enabled",
      interview_mode: "Voice Screening",
    },
  },
];

interface SimulationLog {
  time: string;
  nodeId: string;
  message: string;
}

export default function WorkflowsPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [runs, setRuns] = useState<WorkflowRunItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  // Workflow Canvas interactive state
  const [nodes, setNodes] = useState<PipelineNode[]>(DEFAULT_PIPELINE_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("route");
  const [isExecutingRunning, setIsExecutingRunning] = useState(false);

  // Drag & drop node reordering in pipeline
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Simulation test state
  const [simulating, setSimulating] = useState(false);
  const [simActiveNodeId, setSimActiveNodeId] = useState<string | null>(null);
  const [simLogs, setSimLogs] = useState<SimulationLog[]>([]);

  // Trigger modal state
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [paramMinScore, setParamMinScore] = useState<number>(75);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getWorkflowTemplates(), getWorkflowRuns(), listJobs()])
      .then(([tmplRes, runsRes, jobsRes]) => {
        if (!cancelled) {
          setTemplates(tmplRes.templates || []);
          const runItems = runsRes.runs || [];
          setRuns(runItems);
          setJobs(jobsRes || []);
          setIsExecutingRunning(runItems.some((r) => r.status === "running" || r.status === "queued"));
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

  // Drag & drop node re-ordering
  const handleNodeDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleNodeDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleNodeDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const updated = [...nodes];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, moved);
    setNodes(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);
    toast("success", `Pipeline order updated: ${moved.name} moved to stage 0${index + 1}`);
  };

  // Node config update
  const handleConfigChange = (nodeId: string, key: string, value: string | number) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n))
    );
  };

  // DAG Simulation runner
  const runSimulation = () => {
    if (simulating) return;
    setSimulating(true);
    setSimLogs([]);
    const steps = [
      { id: "ingest", msg: "Document Ingestion: 1 candidate PDF received · Normalized 2 pages, extracted 14 skills", delay: 500 },
      { id: "screen", msg: "Deterministic Screening: Experience check passed (5.0 yrs ≥ 3.0 required)", delay: 1100 },
      { id: "evaluate", msg: "Semantic Evaluation: Vector similarity 0.91 · Computed fit: 92% (High confidence)", delay: 1800 },
      { id: "route", msg: "Decision Router: Score 92% ≥ 85% threshold · Directing to Shortlist", delay: 2500 },
      { id: "branch_shortlist", msg: "Autonomous Action: Candidate auto-shortlisted · Pre-screening invite generated", delay: 3200 },
    ];

    steps.forEach(({ id, msg, delay }, i) => {
      setTimeout(() => {
        setSimActiveNodeId(id);
        const now = new Date().toLocaleTimeString("en-US", { hour12: false });
        setSimLogs((prev) => [...prev, { time: now, nodeId: id, message: msg }]);

        if (i === steps.length - 1) {
          setTimeout(() => {
            setSimulating(false);
            setSimActiveNodeId(null);
            toast("success", "Pipeline simulation completed successfully");
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
      toast("success", `Workflow '${selectedTemplate.name}' triggered successfully`);
      setSelectedTemplate(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setTriggerError(errorMessage(err));
    } finally {
      setTriggering(false);
    }
  };

  const allAvailableNodes = [...nodes, ...BRANCH_NODES];
  const selectedNode = allAvailableNodes.find((n) => n.id === selectedNodeId) || nodes[0];
  const isPipelineActive = isExecutingRunning || simulating;

  return (
    <div className="space-y-6">
      {/* Inline styles for subtle SVG dashflow animation */}
      <style>{`
        @keyframes dagFlow {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }
        .dag-flow-active {
          stroke-dasharray: 5 5;
          animation: dagFlow 1s linear infinite;
        }
      `}</style>

      {/* Enterprise Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#E4E7EC] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#171717]">
            Recruitment Workflows
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[#667085]">
            Autonomous candidate evaluation DAGs, policy threshold routers, and execution audit history.
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

      {/* ── ADVANCED INTERACTIVE WORKFLOW CANVAS ── */}
      <section className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E7EC] pb-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
              Autonomous Workflow Canvas
            </h2>
            <p className="text-[11px] text-[#98A2B3]">
              Drag nodes to reorder stages · Click any node to configure policy rules · Test live DAG execution
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#12B76A]">
              <span className={cn("h-2 w-2 rounded-full bg-[#12B76A]", isPipelineActive && "animate-ping")} />
              {isPipelineActive ? "Pipeline Active (Processing)" : "Pipeline Standby"}
            </span>

            <Button
              size="sm"
              onClick={runSimulation}
              disabled={simulating}
              className="h-7 rounded-md bg-[#171717] px-2.5 text-xs font-medium text-white hover:bg-[#262626]"
            >
              {simulating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              Test Run DAG
            </Button>
          </div>
        </div>

        {/* ── DAG Canvas Visual Graph ── */}
        <div className="relative rounded-lg border border-[#E4E7EC] bg-[#F7F8FA] p-4 sm:p-6 overflow-hidden">
          {/* Main 4-Stage Sequential Flow */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative z-10">
            {nodes.map((node, idx) => {
              const isSelected = selectedNodeId === node.id;
              const isSimActive = simActiveNodeId === node.id;
              const isBeingDragged = draggedIndex === idx;
              const isDropTarget = dragOverIndex === idx;

              return (
                <div
                  key={node.id}
                  draggable={true}
                  onDragStart={() => handleNodeDragStart(idx)}
                  onDragOver={(e) => handleNodeDragOver(e, idx)}
                  onDrop={() => handleNodeDrop(idx)}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={cn(
                    "relative rounded-lg border p-3.5 transition-all duration-150 cursor-pointer select-none bg-white",
                    isSimActive
                      ? "border-[#12B76A] ring-2 ring-[#12B76A]/20 shadow-sm"
                      : isSelected
                      ? "border-[#171717] ring-1 ring-[#171717]/10 shadow-xs"
                      : "border-[#E4E7EC] hover:border-[#D0D5DD]",
                    isBeingDragged && "opacity-40",
                    isDropTarget && "border-dashed border-[#171717] bg-[#F2F4F7]"
                  )}
                >
                  {/* Top node bar with drag handle */}
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#E4E7EC]">
                    <div className="flex items-center gap-1.5 text-[#98A2B3] cursor-grab">
                      <GripVertical className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#667085]">
                        Stage 0{idx + 1}
                      </span>
                    </div>
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      isSimActive ? "bg-[#12B76A] animate-pulse" : "bg-[#12B76A]"
                    )} />
                  </div>

                  <h3 className="text-xs font-semibold text-[#171717] truncate">{node.name}</h3>
                  <p className="text-[10px] text-[#667085] mt-0.5 truncate">{node.subtitle}</p>

                  {/* Desktop Right Connection Arrow */}
                  {idx < nodes.length - 1 && (
                    <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-20 h-5 w-5 items-center justify-center rounded-full bg-[#171717] text-white shadow-2xs">
                      <ChevronRight className="h-3 w-3" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Connected Branching Arrow SVGs from Decision Router to Targets */}
          <div className="pt-5 pb-2 relative z-10">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="h-px bg-[#E4E7EC] flex-1" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#98A2B3] px-2 bg-[#F7F8FA]">
                Policy Routing Branches
              </span>
              <div className="h-px bg-[#E4E7EC] flex-1" />
            </div>

            {/* Branch Destination Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
              {BRANCH_NODES.map((bNode) => {
                const isSelected = selectedNodeId === bNode.id;
                const isSimActive = simActiveNodeId === bNode.id;
                const isReview = bNode.id === "branch_review";

                return (
                  <div
                    key={bNode.id}
                    onClick={() => setSelectedNodeId(bNode.id)}
                    className={cn(
                      "rounded-lg border p-3 bg-white transition-all duration-150 cursor-pointer",
                      isSimActive
                        ? "border-[#12B76A] ring-2 ring-[#12B76A]/20 shadow-sm"
                        : isSelected
                        ? "border-[#171717] ring-1 ring-[#171717]/10"
                        : "border-[#E4E7EC] hover:border-[#D0D5DD]"
                    )}
                  >
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#E4E7EC] mb-1.5">
                      <span className={cn(
                        "text-[10px] font-medium uppercase tracking-wider",
                        isReview ? "text-[#F79009]" : "text-[#12B76A]"
                      )}>
                        {isReview ? "Branch ↙ Low / Gaps" : "Branch ↘ High Match"}
                      </span>
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isReview ? "bg-[#F79009]" : "bg-[#12B76A]"
                      )} />
                    </div>
                    <h4 className="text-xs font-semibold text-[#171717]">{bNode.name}</h4>
                    <p className="text-[10px] text-[#667085] mt-0.5">{bNode.subtitle}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live Simulation Audit Logs (Visible during / after simulation) */}
        {simLogs.length > 0 && (
          <div className="rounded-lg border border-[#E4E7EC] bg-[#171717] text-white p-3.5 space-y-2 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#262626] pb-2 text-[11px] font-sans">
              <span className="font-semibold uppercase tracking-wider text-[#98A2B3] flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-[#12B76A]" /> DAG Execution Simulation Output
              </span>
              <span className="text-[10px] text-[#12B76A]">
                {simulating ? "Executing steps…" : "Completed"}
              </span>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {simLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <span className="text-[#667085] select-none">[{log.time}]</span>
                  <span className="text-[#F2F4F7]">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node Policy & Routing Inspector */}
        <div className="rounded-lg border border-[#E4E7EC] bg-[#F7F8FA] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2">
            <div className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-[#667085]" />
              <h3 className="text-xs font-semibold text-[#171717]">
                Configure Node: {selectedNode.name}
              </h3>
            </div>
            <span className="text-[11px] text-[#667085] font-medium uppercase">
              Type: {selectedNode.type}
            </span>
          </div>

          <p className="text-xs text-[#667085] font-normal leading-relaxed">
            {selectedNode.description}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            {Object.entries(selectedNode.config).map(([key, val]) => (
              <div key={key} className="rounded bg-white border border-[#E4E7EC] p-2.5 text-xs space-y-1">
                <label className="text-[10px] uppercase font-medium text-[#98A2B3] tracking-wide block">
                  {key.replace(/_/g, " ")}
                </label>
                <input
                  type="text"
                  value={String(val)}
                  onChange={(e) => handleConfigChange(selectedNode.id, key, e.target.value)}
                  className="w-full rounded border border-[#E4E7EC] bg-[#F7F8FA] px-2 py-1 text-xs font-medium text-[#171717] focus:bg-white focus:border-[#171717] focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

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
                      Stages:
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
