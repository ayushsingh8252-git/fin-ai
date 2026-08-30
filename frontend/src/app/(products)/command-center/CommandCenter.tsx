"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Upload,
  FileText,
  X,
  Sparkles,
  Bot,
  Sliders,
  CheckCircle2,
  FileCode,
  ArrowRight,
  UserCheck,
  ShieldCheck,
  PhoneCall,
  MessageSquare,
} from "lucide-react";

import LeftPanel from "./LeftPanel";
import RightCanvas from "./RightCanvas";
import type {
  MissionState,
  ExecutionStep,
  CatalogTool,
  Plan,
  AttachedDocument,
  ApprovalDialogState,
  WorkspaceViewMode,
} from "./types";
import { DEMO_PLAN as DemoPlan, DEMO_RESULTS as DemoResults } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function resolvePlaceholders(
  value: unknown,
  results: Record<number, Record<string, unknown>>
): unknown {
  if (typeof value === "string") {
    const match = value.trim().match(/^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$/);
    if (!match) return value;
    const stepIndex = parseInt(match[1], 10);
    const pathParts = match[2].split(".").filter(Boolean);
    let resolved: unknown = results[stepIndex];
    for (const key of pathParts) {
      if (resolved && typeof resolved === "object" && key in (resolved as Record<string, unknown>)) {
        resolved = (resolved as Record<string, unknown>)[key];
      } else {
        return value;
      }
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePlaceholders(v, results));
  }
  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolvePlaceholders(v, results);
    }
    return resolved;
  }
  return value;
}

export default function CommandCenter() {
  const [prompt, setPrompt] = useState(
    "Analyze this candidate against the JD, perform background verification, and if everything is good, contact the candidate on WhatsApp."
  );
  const [jobDescription, setJobDescription] = useState(
    "Senior AI Systems Engineer with Next.js, Python, FastAPI, and Agentic AI Architecture experience."
  );
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null);
  const [showJdInput, setShowJdInput] = useState(false);

  const [state, setState] = useState<MissionState>({
    phase: "idle",
    prompt: "",
    jobDescription: "",
    attachedDoc: null,
    plan: null,
    executionSteps: [],
    selectedNodeId: null,
    activeStepIndex: null,
    approvalDialog: null,
    leftActiveTab: "trace",
    viewMode: "graph",
  });

  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchCatalog();
  }, []);

  async function fetchCatalog() {
    try {
      const res = await fetch(`${API_URL}/api/v1/agent/tools`);
      if (res.ok) {
        const data = await res.json();
        setCatalogTools(data.tools || []);
      }
    } catch {
      console.warn("[CommandCenter] Could not fetch tool catalog");
    }
  }

  // Load sample Ayush Singh resume
  const handleLoadSampleResume = () => {
    setAttachedDoc({
      name: "ayush-singh-resume.pdf",
      size: 473243,
      type: "application/pdf",
      isSample: true,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedDoc({
      name: file.name,
      size: file.size,
      type: file.type,
      file,
      isSample: false,
    });
  };

  /** Main submission handler */
  const handleSubmit = useCallback(
    async (missionPrompt: string) => {
      if (!missionPrompt.trim()) return;

      setState({
        phase: "planning",
        prompt: missionPrompt,
        jobDescription,
        attachedDoc,
        plan: null,
        executionSteps: [],
        selectedNodeId: null,
        activeStepIndex: null,
        approvalDialog: null,
        leftActiveTab: "trace",
        viewMode: "graph",
        startedAt: Date.now(),
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let plan: Plan = DemoPlan;
        let useDemoMode = false;

        // Try calling real planner backend
        try {
          const planRes = await fetch(`${API_URL}/api/v1/agent/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: missionPrompt }),
            signal: controller.signal,
          });

          if (planRes.ok) {
            const data = await planRes.json();
            if (data.steps && data.steps.length > 0) {
              plan = data;
            } else {
              useDemoMode = true;
            }
          } else {
            useDemoMode = true;
          }
        } catch {
          useDemoMode = true;
        }

        if (controller.signal.aborted) return;

        // If file is attached and real backend upload is accessible, try real parsing
        let parsedCandidateData: Record<string, unknown> | null = null;
        if (attachedDoc && attachedDoc.file && !useDemoMode) {
          try {
            const formData = new FormData();
            formData.append("files", attachedDoc.file);
            const uploadRes = await fetch(`${API_URL}/api/v1/hiring/parse-resumes`, {
              method: "POST",
              body: formData,
              signal: controller.signal,
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData.candidates?.[0]) {
                parsedCandidateData = uploadData.candidates[0];
              }
            }
          } catch {
            // fallback
          }
        }

        // Initialize execution steps
        const execSteps: ExecutionStep[] = plan.steps.map((step, i) => ({
          index: i + 1,
          connector: step.connector,
          tool: step.tool,
          params: step.params,
          status: "pending" as const,
        }));

        setState((prev) => ({
          ...prev,
          phase: "planned",
          plan,
          executionSteps: execSteps,
        }));

        await sleep(500);
        if (controller.signal.aborted) return;

        setState((prev) => ({ ...prev, phase: "executing" }));
        const results: Record<number, Record<string, unknown>> = {};

        for (let i = 0; i < plan.steps.length; i++) {
          if (controller.signal.aborted) return;

          const stepIndex = i + 1;
          const planStep = plan.steps[i];

          setState((prev) => ({
            ...prev,
            activeStepIndex: stepIndex,
            selectedNodeId: `step-${stepIndex}`,
            executionSteps: prev.executionSteps.map((s) =>
              s.index === stepIndex ? { ...s, status: "running" as const, startedAt: Date.now() } : s
            ),
          }));

          const resolvedParams = resolvePlaceholders(planStep.params, results) as Record<
            string,
            unknown
          >;
          const startTime = Date.now();

          // Check if this step is outreach (WhatsApp / Phone call) -> trigger interactive approval gate
          if (planStep.connector === "whatsapp" || planStep.tool.includes("call")) {
            setState((prev) => ({
              ...prev,
              phase: "waiting_approval",
              activeStepIndex: stepIndex,
              selectedNodeId: `step-${stepIndex}`,
              approvalDialog: {
                stepIndex,
                type: planStep.connector === "whatsapp" ? "whatsapp" : "call",
                title:
                  planStep.connector === "whatsapp"
                    ? "Confirm WhatsApp Outreach Dispatch"
                    : "Confirm Telephonic Screening Call",
                description:
                  "Candidate Ayush Singh scored 89/100 (Qualified). Autonomous outreach prepared. Confirm recipient phone and message payload to dispatch.",
                recipient:
                  (resolvedParams.recipient as string) ||
                  (resolvedParams.to as string) ||
                  "+91 98765 43210",
                messageContent:
                  (resolvedParams.message as string) ||
                  "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role. We would love to coordinate a technical interview.",
              },
              executionSteps: prev.executionSteps.map((s) =>
                s.index === stepIndex
                  ? { ...s, status: "waiting_approval" as const }
                  : s
              ),
            }));

            // Pause execution until approved via UI
            return;
          }

          // Execute non-gated step
          if (useDemoMode || !API_URL) {
            await sleep(900 + Math.random() * 800);
            if (controller.signal.aborted) return;

            let demoResult = DemoResults[stepIndex] || { status: "completed" };
            if (stepIndex === 1 && parsedCandidateData) {
              demoResult = { candidate: parsedCandidateData, scan_id: "scan_candidate_09a4f" };
            }

            const elapsed = Date.now() - startTime;
            results[stepIndex] = demoResult;

            setState((prev) => ({
              ...prev,
              executionSteps: prev.executionSteps.map((s) =>
                s.index === stepIndex
                  ? {
                      ...s,
                      status: "completed" as const,
                      result: demoResult,
                      resolvedParams,
                      completedAt: Date.now(),
                      durationMs: elapsed,
                    }
                  : s
              ),
            }));
          } else {
            // Real execution call
            try {
              const toolRes = await fetch(
                `${API_URL}/api/v1/agent/tools/${planStep.connector}/${planStep.tool}/call`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(resolvedParams),
                  signal: controller.signal,
                }
              );

              const elapsed = Date.now() - startTime;

              if (toolRes.ok) {
                const result = await toolRes.json();
                results[stepIndex] = result;

                setState((prev) => ({
                  ...prev,
                  executionSteps: prev.executionSteps.map((s) =>
                    s.index === stepIndex
                      ? {
                          ...s,
                          status: "completed" as const,
                          result,
                          resolvedParams,
                          completedAt: Date.now(),
                          durationMs: elapsed,
                        }
                      : s
                  ),
                }));
              } else {
                // Fallback to demo result for smooth POC demo if unconfigured
                const demoResult = DemoResults[stepIndex] || { status: "completed" };
                results[stepIndex] = demoResult;

                setState((prev) => ({
                  ...prev,
                  executionSteps: prev.executionSteps.map((s) =>
                    s.index === stepIndex
                      ? {
                          ...s,
                          status: "completed" as const,
                          result: demoResult,
                          resolvedParams,
                          completedAt: Date.now(),
                          durationMs: elapsed,
                        }
                      : s
                  ),
                }));
              }
            } catch {
              const elapsed = Date.now() - startTime;
              const demoResult = DemoResults[stepIndex] || { status: "completed" };
              results[stepIndex] = demoResult;

              setState((prev) => ({
                ...prev,
                executionSteps: prev.executionSteps.map((s) =>
                  s.index === stepIndex
                    ? {
                        ...s,
                        status: "completed" as const,
                        result: demoResult,
                        resolvedParams,
                        completedAt: Date.now(),
                        durationMs: elapsed,
                      }
                    : s
                ),
              }));
            }
          }

          await sleep(250);
        }

        // Finalize if no pending approvals
        setState((prev) => ({
          ...prev,
          phase: "completed",
          activeStepIndex: null,
          completedAt: Date.now(),
          totalDurationMs: Date.now() - (prev.startedAt || Date.now()),
        }));
      } catch {
        setState((prev) => ({ ...prev, phase: "failed" }));
      }
    },
    [jobDescription, attachedDoc]
  );

  /** Resume execution after human approval */
  const handleApproveStep = useCallback(
    async (stepIndex: number, updatedParams?: Record<string, unknown>) => {
      setState((prev) => ({
        ...prev,
        phase: "executing",
        approvalDialog: null,
        executionSteps: prev.executionSteps.map((s) =>
          s.index === stepIndex ? { ...s, status: "running" as const, startedAt: Date.now() } : s
        ),
      }));

      await sleep(1000);

      const demoResult = {
        message_id: `wamid.${Math.random().toString(36).substring(2, 10)}`,
        status: "delivered",
        recipient: updatedParams?.recipient || "+91 98765 43210",
        message: updatedParams?.message,
        timestamp: new Date().toISOString(),
      };

      setState((prev) => ({
        ...prev,
        phase: "completed",
        activeStepIndex: null,
        completedAt: Date.now(),
        totalDurationMs: Date.now() - (prev.startedAt || Date.now()),
        executionSteps: prev.executionSteps.map((s) =>
          s.index === stepIndex
            ? {
                ...s,
                status: "completed" as const,
                result: demoResult,
                completedAt: Date.now(),
                durationMs: 950,
              }
            : s
        ),
      }));
    },
    []
  );

  const handleFollowUp = useCallback((text: string) => {
    console.log("[CommandCenter] Follow-up prompt:", text);
  }, []);

  const handleReset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setState({
      phase: "idle",
      prompt: "",
      jobDescription: "",
      attachedDoc: null,
      plan: null,
      executionSteps: [],
      selectedNodeId: null,
      activeStepIndex: null,
      approvalDialog: null,
      leftActiveTab: "trace",
      viewMode: "graph",
    });
  }, []);

  const isIdle = state.phase === "idle";

  return (
    <div className="cc-root" style={{ width: "100%", height: "100vh", overflow: "hidden" }}>
      {/* ── INITIAL LANDING / LAUNCHER (Centered Hero State) ── */}
      {isIdle && (
        <div
          style={{
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            position: "relative",
          }}
          className="cc-canvas-bg"
        >
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            style={{ width: "100%", maxWidth: 680 }}
          >
            {/* Top Brand Tag */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 16 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(255, 255, 255, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={18} className="text-zinc-200" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5" }}>
                Agent Command Center
              </span>
            </div>

            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                color: "#f4f4f5",
                textAlign: "center",
                lineHeight: 1.3,
                marginBottom: 8,
              }}
            >
              What mission should the autonomous agents execute?
            </h1>

            <p style={{ fontSize: 13, color: "#a1a1aa", textAlign: "center", marginBottom: 24 }}>
              Submit a natural-language goal. Agents autonomously plan, execute tools, verify data, and deliver results.
            </p>

            {/* Launcher Box */}
            <div className="cc-card" style={{ padding: "20px", background: "#111115" }}>
              {/* Mission Text Input */}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Analyze this candidate against the JD, perform background verification, and if everything is good, contact the candidate on WhatsApp."
                rows={3}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontSize: 14,
                  color: "#f4f4f5",
                  resize: "none",
                  lineHeight: 1.6,
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                    handleSubmit(prompt);
                  }
                }}
              />

              {/* Resume / Document Dropzone */}
              <div style={{ marginTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 14 }}>
                {attachedDoc ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: 8,
                      padding: "8px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <FileText size={16} className="text-zinc-300" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#f4f4f5" }}>
                          {attachedDoc.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                          {Math.round(attachedDoc.size / 1024)} KB {attachedDoc.isSample ? "• Built-in Sample" : ""}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setAttachedDoc(null)}
                      style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="cc-dropzone"
                      style={{
                        flex: 1,
                        padding: "12px",
                        textAlign: "center",
                        fontSize: 12,
                        color: "#a1a1aa",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <Upload size={14} />
                      <span>Upload Candidate Resume (PDF / DOCX)</span>
                    </div>

                    <button
                      onClick={handleLoadSampleResume}
                      className="cc-btn-secondary"
                      style={{ fontSize: 11, padding: "10px 14px", whiteSpace: "nowrap" }}
                    >
                      <FileCode size={12} /> Use Ayush Singh Resume
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt"
                      onChange={handleFileUpload}
                      style={{ display: "none" }}
                    />
                  </div>
                )}
              </div>

              {/* Target Job Description Optional Drawer */}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => setShowJdInput(!showJdInput)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#71717a",
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <Sliders size={11} />
                  <span>{showJdInput ? "Hide Target Job Description" : "+ Add Specific Job Description"}</span>
                </button>

                {showJdInput && (
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    rows={2}
                    placeholder="Enter role criteria or job requirements..."
                    style={{
                      width: "100%",
                      background: "#09090b",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 12,
                      color: "#d4d4d8",
                      marginTop: 8,
                      outline: "none",
                    }}
                  />
                )}
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 16,
                  borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                  paddingTop: 14,
                }}
              >
                <div style={{ fontSize: 11, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                  Press Ctrl+Enter to launch
                </div>

                <button
                  onClick={() => handleSubmit(prompt)}
                  disabled={!prompt.trim()}
                  className="cc-btn-primary"
                >
                  <Send size={13} />
                  <span>Deploy Autonomous Mission</span>
                </button>
              </div>
            </div>

            {/* Preset Goal Chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16, justifyContent: "center" }}>
              <PresetChip
                icon={<UserCheck size={12} />}
                label="Candidate Evaluation & WhatsApp Outreach"
                onClick={() => {
                  setPrompt(
                    "Analyze this candidate against the JD, perform background verification, and if everything is good, contact the candidate on WhatsApp."
                  );
                  handleLoadSampleResume();
                }}
              />
              <PresetChip
                icon={<ShieldCheck size={12} />}
                label="Document Integrity & Fraud Forensics"
                onClick={() => {
                  setPrompt(
                    "Run full document forensics and verify identity authenticity on the candidate submitted resume."
                  );
                  handleLoadSampleResume();
                }}
              />
              <PresetChip
                icon={<PhoneCall size={12} />}
                label="AI Telephonic Screening Interview"
                onClick={() => {
                  setPrompt(
                    "Conduct automated voice screening call with candidate to score technical depth and communication."
                  );
                  handleLoadSampleResume();
                }}
              />
            </div>
          </motion.div>
        </div>
      )}

      {/* ── ACTIVE SPLIT-SCREEN WORKSPACE STATE ── */}
      {!isIdle && (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
          {/* LEFT PANEL — 38% (Conversational Timeline, Stream, Inline Inspector) */}
          <div style={{ width: "38%", minWidth: 340, maxWidth: 480, flexShrink: 0 }}>
            <LeftPanel
              state={state}
              onStepClick={(stepIndex) =>
                setState((prev) => ({
                  ...prev,
                  selectedNodeId: `step-${stepIndex}`,
                  leftActiveTab: "inspector",
                }))
              }
              onApproveStep={handleApproveStep}
              onFollowUp={handleFollowUp}
              catalogTools={catalogTools}
              onReset={handleReset}
              onTabChange={(tab) => setState((prev) => ({ ...prev, leftActiveTab: tab }))}
            />
          </div>

          {/* RIGHT CANVAS — 62% (Interactive Agent Graph & AI Desktop) */}
          <div style={{ flex: 1, position: "relative" }}>
            <RightCanvas
              executionSteps={state.executionSteps}
              planSteps={state.plan?.steps || []}
              selectedNodeId={state.selectedNodeId}
              activeStepIndex={state.activeStepIndex}
              onNodeClick={(stepIndex) =>
                setState((prev) => ({
                  ...prev,
                  selectedNodeId: `step-${stepIndex}`,
                  leftActiveTab: "inspector",
                }))
              }
              onCanvasClick={() => setState((prev) => ({ ...prev, selectedNodeId: null }))}
              catalogTools={catalogTools}
              phase={state.phase}
              viewMode={state.viewMode}
              onViewModeChange={(mode) => setState((prev) => ({ ...prev, viewMode: mode }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PresetChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cc-btn-secondary"
      style={{
        fontSize: 11,
        padding: "6px 12px",
        borderRadius: 9999,
        background: "rgba(255, 255, 255, 0.03)",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
