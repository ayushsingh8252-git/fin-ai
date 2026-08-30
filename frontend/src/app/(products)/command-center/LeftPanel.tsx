"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Loader2, Check, X, Brain, Target, Sparkles,
  ChevronRight, FileText, AlertCircle, Trophy, ArrowRight,
} from "lucide-react";
import { resolveConnectorMeta, formatToolName } from "./iconResolver";
import type { MissionState, ExecutionStep } from "./types";

interface Props {
  state: MissionState;
  onSubmit: (prompt: string) => void;
  onStepClick: (stepIndex: number) => void;
  prompt: string;
  setPrompt: (p: string) => void;
}

export default function LeftPanel({ state, onSubmit, onStepClick, prompt, setPrompt }: Props) {
  const isIdle = state.phase === "idle";
  const isPlanning = state.phase === "planning";
  const isRunning = state.phase === "executing" || state.phase === "planning" || state.phase === "planned";
  const isDone = state.phase === "completed" || state.phase === "failed";

  const completedSteps = state.executionSteps.filter((s) => s.status === "completed").length;
  const totalSteps = state.executionSteps.length;

  return (
    <div className="cc-left cc-scroll" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* ── Header ── */}
      <div style={{ padding: "20px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Brain size={16} style={{ color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: "#e4e4e7", margin: 0, lineHeight: 1.2 }}>
              Agent Command Center
            </h1>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              AgenticFlow AI
            </div>
          </div>
          {!isIdle && (
            <div style={{ marginLeft: "auto" }}>
              <span className={`cc-badge ${isDone ? (state.phase === "completed" ? "success" : "error") : "info"}`}>
                {state.phase === "planning" && "Planning..."}
                {state.phase === "planned" && "Ready"}
                {state.phase === "executing" && "Executing"}
                {state.phase === "completed" && "Complete"}
                {state.phase === "failed" && "Failed"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 20px" }} className="cc-scroll">
        {/* ── Mission Input (always shown) ── */}
        <div className="cc-section" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Mission
          </div>
          {isIdle ? (
            <>
              <textarea
                className="cc-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what you want the agents to accomplish...&#10;&#10;e.g. Analyze this candidate against the JD, perform background verification, and if everything is good, contact the candidate on WhatsApp."
                style={{ width: "100%", minHeight: 100, padding: "12px 14px", fontSize: 13, lineHeight: 1.6 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                    onSubmit(prompt);
                  }
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                  Ctrl+Enter to run
                </span>
                <button
                  className="cc-run-btn"
                  disabled={!prompt.trim()}
                  onClick={() => onSubmit(prompt)}
                >
                  <Send size={14} /> Run Mission
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, padding: "4px 0" }}>
              &ldquo;{state.prompt}&rdquo;
            </div>
          )}
        </div>

        {/* ── Planning indicator ── */}
        <AnimatePresence>
          {isPlanning && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="cc-section"
              style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}
            >
              <Loader2 size={16} className="cc-spin" style={{ color: "#818cf8" }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#818cf8" }}>Analyzing mission...</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Selecting optimal agents and tools</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Understanding / Intent ── */}
        <AnimatePresence>
          {state.plan && state.plan.steps.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="cc-section cc-fade-in"
              style={{ marginBottom: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Target size={13} style={{ color: "#818cf8" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Understanding
                </span>
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.3)" }}>Intent: </span>
                {deriveIntent(state.prompt, state.plan.steps)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {deriveInputs(state.plan.steps).map((input, i) => (
                  <span key={i} className="cc-badge neutral" style={{ fontSize: 10 }}>
                    {input}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Plan Steps ── */}
        <AnimatePresence>
          {state.executionSteps.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="cc-section"
              style={{ marginBottom: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FileText size={13} style={{ color: "#818cf8" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Execution Plan
                  </span>
                </div>
                {totalSteps > 0 && (
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                    {completedSteps}/{totalSteps}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {totalSteps > 0 && (
                <div className="cc-progress-bar" style={{ marginBottom: 14 }}>
                  <div
                    className={`cc-progress-fill ${state.phase === "completed" ? "completed" : state.phase === "failed" ? "failed" : "running"}`}
                    style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                  />
                </div>
              )}

              {/* Steps list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {state.executionSteps.map((step) => {
                  const meta = resolveConnectorMeta(step.connector, step.tool);
                  const StepIcon = meta.icon;
                  const isActive = state.selectedNodeId === `step-${step.index}`;

                  return (
                    <div
                      key={step.index}
                      className={`cc-step ${isActive ? "active" : ""}`}
                      onClick={() => onStepClick(step.index)}
                    >
                      <div className={`cc-dot ${step.status}`} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", fontWeight: 600 }}>
                            {String(step.index).padStart(2, "0")}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: step.status === "running" ? "#c7d2fe" : "#e4e4e7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {formatToolName(step.tool)}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <StepIcon size={11} className={meta.color} />
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                            {meta.label}
                          </span>
                          {step.durationMs != null && (
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "monospace", marginLeft: "auto" }}>
                              {(step.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Reasoning ── */}
        <AnimatePresence>
          {state.executionSteps.length > 0 && state.phase !== "planning" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="cc-section"
              style={{ marginBottom: 16 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Sparkles size={13} style={{ color: "#fbbf24" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Why These Agents?
                </span>
              </div>
              {getUniqueConnectors(state.executionSteps).map(({ connector, displayName }) => {
                const meta = resolveConnectorMeta(connector);
                const ConnIcon = meta.icon;
                return (
                  <div key={connector} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <ConnIcon size={13} className={meta.color} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)" }}>{displayName}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                        {deriveRationale(connector, state.prompt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Final Result Card ── */}
        <AnimatePresence>
          {state.phase === "completed" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", damping: 20 }}
              className="cc-result-card"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Trophy size={16} style={{ color: "#22c55e" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#e4e4e7" }}>Mission Complete</span>
              </div>

              {/* Score if available */}
              {renderFinalScore(state.executionSteps)}

              {/* Evidence checklist */}
              <div style={{ marginTop: 14 }}>
                {state.executionSteps.filter((s) => s.status === "completed").map((step) => (
                  <div key={step.index} className="cc-evidence-row">
                    <Check size={13} className="check" />
                    <span>{formatToolName(step.tool)}</span>
                    {step.durationMs != null && (
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                        {(step.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Recommendation */}
              {renderFinalRecommendation(state.executionSteps)}

              {/* Duration */}
              {state.totalDurationMs != null && (
                <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
                  Total execution: {(state.totalDurationMs / 1000).toFixed(1)}s
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Failure card ── */}
        <AnimatePresence>
          {state.phase === "failed" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <AlertCircle size={16} style={{ color: "#ef4444" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "#f87171" }}>Mission Failed</span>
              </div>
              {state.executionSteps.filter((s) => s.status === "failed").map((step) => (
                <div key={step.index} style={{ fontSize: 12, color: "rgba(248,113,113,0.8)", marginBottom: 4 }}>
                  Step {step.index} ({formatToolName(step.tool)}): {step.error}
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                {state.executionSteps.filter((s) => s.status === "completed").map((step) => (
                  <div key={step.index} className="cc-evidence-row">
                    <Check size={13} className="check" />
                    <span>{formatToolName(step.tool)}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ═══ Helper functions ═══ */

function deriveIntent(prompt: string, steps: { connector: string; tool: string }[]): string {
  const p = prompt.toLowerCase();
  if (p.includes("candidate") || p.includes("resume") || p.includes("hire")) return "Candidate Evaluation & Outreach";
  if (p.includes("fraud") || p.includes("verify")) return "Document Verification";
  if (p.includes("screen") || p.includes("interview")) return "Candidate Screening";
  if (p.includes("email") || p.includes("contact")) return "Communication Workflow";
  // Fallback: derive from tools
  const connectors = [...new Set(steps.map((s) => s.connector))];
  if (connectors.length <= 2) return `${connectors.map((c) => c.replace(/_/g, " ")).join(" & ")} workflow`;
  return "Multi-agent orchestration";
}

function deriveInputs(steps: { params: Record<string, unknown> }[]): string[] {
  const inputs = new Set<string>();
  for (const step of steps) {
    for (const [key, value] of Object.entries(step.params)) {
      if (typeof value === "string" && !value.startsWith("$step")) {
        if (key.includes("file") || key.includes("path")) inputs.add("📄 Resume PDF");
        else if (key.includes("requirement") || key.includes("jd")) inputs.add("📋 Job Description");
        else if (key.includes("recipient") || key.includes("phone")) inputs.add("📱 Candidate Contact");
        else if (key.includes("name")) inputs.add("👤 Candidate Name");
      }
    }
  }
  if (inputs.size === 0) inputs.add("Natural Language Mission");
  return [...inputs];
}

function getUniqueConnectors(steps: ExecutionStep[]): { connector: string; displayName: string }[] {
  const seen = new Set<string>();
  const result: { connector: string; displayName: string }[] = [];
  for (const step of steps) {
    if (!seen.has(step.connector)) {
      seen.add(step.connector);
      const meta = resolveConnectorMeta(step.connector);
      result.push({ connector: step.connector, displayName: meta.label });
    }
  }
  return result;
}

function deriveRationale(connector: string, prompt: string): string {
  const c = connector.toLowerCase();
  if (c.includes("hiring")) return "Required to parse, evaluate, and score the candidate against job requirements.";
  if (c.includes("fraud")) return "Required because background verification was explicitly requested in the mission.";
  if (c.includes("whatsapp")) return "Selected because the mission requires contacting the candidate after qualification.";
  if (c.includes("screening")) return "Required for JD-aligned screening analysis of the candidate's interview.";
  if (c.includes("telephonic")) return "Required to conduct an AI-driven phone screening interview.";
  if (c.includes("rag")) return "Required to search the knowledge base for relevant policy/document information.";
  if (c.includes("gmail")) return "Selected for email communication as specified in the mission.";
  if (c.includes("calendar")) return "Required for scheduling meetings or interviews.";
  return "Selected by the AI planner to fulfill the mission requirements.";
}

function renderFinalScore(steps: ExecutionStep[]): React.ReactNode {
  // Find scorecard or match result
  for (const step of steps) {
    if (step.result && ("overall_score" in step.result || "match_score" in step.result)) {
      const score = (step.result.overall_score ?? step.result.match_score) as number;
      const color = score >= 70 ? "#22c55e" : score >= 50 ? "#fbbf24" : "#ef4444";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
          <div className="cc-score-ring" style={{ "--score": score } as React.CSSProperties}>
            <div className="cc-score-inner">
              <span style={{ fontSize: 20, fontWeight: 700, color }}>{score}</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>/ 100</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7" }}>Candidate Score</div>
            {step.result.recommendation ? (
              <div className={`cc-badge ${String(step.result.recommendation) === "PROCEED" ? "success" : "warning"}`} style={{ marginTop: 4 }}>
                {String(step.result.recommendation)}
              </div>
            ) : null}
          </div>
        </div>
      );
    }
  }
  return null;
}

function renderFinalRecommendation(steps: ExecutionStep[]): React.ReactNode {
  for (const step of steps) {
    if (step.result && "recommendation" in step.result) {
      const rec = String(step.result.recommendation);
      return (
        <div style={{
          marginTop: 14,
          padding: "10px 14px",
          borderRadius: 10,
          background: rec === "PROCEED" ? "rgba(34,197,94,0.08)" : "rgba(251,191,36,0.08)",
          border: `1px solid ${rec === "PROCEED" ? "rgba(34,197,94,0.2)" : "rgba(251,191,36,0.2)"}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <ArrowRight size={14} style={{ color: rec === "PROCEED" ? "#22c55e" : "#fbbf24" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: rec === "PROCEED" ? "#4ade80" : "#fbbf24" }}>
            Final Recommendation: {rec}
          </span>
        </div>
      );
    }
  }
  return null;
}
