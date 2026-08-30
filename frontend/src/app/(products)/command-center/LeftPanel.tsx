"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Send,
  Loader2,
  Check,
  X,
  FileText,
  Clock,
  ShieldCheck,
  PhoneCall,
  MessageSquare,
  Mail,
  ChevronRight,
  ChevronDown,
  Sparkles,
  AlertCircle,
  Sliders,
  Terminal,
  Paperclip,
  CheckCircle2,
  ArrowRight,
  User,
  Zap,
} from "lucide-react";
import { resolveConnectorMeta, formatToolName } from "./iconResolver";
import type {
  MissionState,
  ExecutionStep,
  CatalogTool,
  ApprovalDialogState,
  AttachedDocument,
} from "./types";

interface Props {
  state: MissionState;
  onStepClick: (stepIndex: number) => void;
  onApproveStep: (stepIndex: number, updatedParams?: Record<string, unknown>) => void;
  onFollowUp: (text: string) => void;
  catalogTools: CatalogTool[];
  onReset: () => void;
  onTabChange: (tab: "trace" | "inspector" | "artifacts") => void;
}

export default function LeftPanel({
  state,
  onStepClick,
  onApproveStep,
  onFollowUp,
  catalogTools,
  onReset,
  onTabChange,
}: Props) {
  const [followUpText, setFollowUpText] = useState("");
  const [editPhone, setEditPhone] = useState("+91 98765 43210");
  const [editMessage, setEditMessage] = useState(
    "Hi! Your profile has been shortlisted for the Senior AI Systems Engineer role. We would like to coordinate a technical interview. Please let us know your availability."
  );

  React.useEffect(() => {
    if (state.approvalDialog) {
      if (state.approvalDialog.recipient) setEditPhone(state.approvalDialog.recipient);
      if (state.approvalDialog.messageContent) setEditMessage(state.approvalDialog.messageContent);
    }
  }, [state.approvalDialog]);

  const activeTab = state.leftActiveTab;
  const completedSteps = state.executionSteps.filter((s) => s.status === "completed").length;
  const totalSteps = state.executionSteps.length;

  const inspectedStep = state.selectedNodeId
    ? state.executionSteps.find((s) => `step-${s.index}` === state.selectedNodeId) || null
    : null;

  const inspectedCatalogTool = inspectedStep
    ? catalogTools.find((t) => t.connector === inspectedStep.connector && t.tool === inspectedStep.tool)
    : undefined;

  const durationSec = state.totalDurationMs
    ? (state.totalDurationMs / 1000).toFixed(1)
    : state.startedAt
    ? ((Date.now() - state.startedAt) / 1000).toFixed(1)
    : "0.0";

  return (
    <div
      className="cc-left cc-scroll"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* ── Top Header Bar ── */}
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: "rgba(255, 255, 255, 0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Bot size={15} className="text-zinc-200" />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#f4f4f5" }}>
              Agent Command Center
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className={`cc-tag ${
                state.phase === "completed"
                  ? "success"
                  : state.phase === "waiting_approval"
                  ? "amber"
                  : state.phase === "failed"
                  ? "danger"
                  : "neutral"
              }`}
            >
              {state.phase === "planning" && "Planning..."}
              {state.phase === "executing" && "Executing"}
              {state.phase === "waiting_approval" && "Action Required"}
              {state.phase === "completed" && "Mission Complete"}
              {state.phase === "failed" && "Failed"}
              {state.phase === "planned" && "Ready"}
            </span>

            <button
              onClick={onReset}
              className="cc-btn-secondary"
              style={{ padding: "3px 8px", fontSize: 11 }}
            >
              New Mission
            </button>
          </div>
        </div>

        {/* Mission Goal Headline */}
        <div
          style={{
            fontSize: 13,
            color: "#d4d4d8",
            lineHeight: 1.5,
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          {state.prompt}
        </div>

        {/* Runtime info & Document badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 8,
            fontSize: 11,
            color: "#71717a",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Clock size={11} /> Duration: {durationSec}s
          </span>

          {state.attachedDoc && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#a1a1aa" }}>
              <FileText size={11} /> {state.attachedDoc.name} ({Math.round(state.attachedDoc.size / 1024)} KB)
            </span>
          )}
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
          <button
            onClick={() => onTabChange("trace")}
            className={`cc-tab-btn ${activeTab === "trace" ? "active" : ""}`}
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Trace & Stream
          </button>
          <button
            onClick={() => onTabChange("inspector")}
            className={`cc-tab-btn ${activeTab === "inspector" ? "active" : ""}`}
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Inspector {inspectedStep ? `(#${inspectedStep.index})` : ""}
          </button>
          <button
            onClick={() => onTabChange("artifacts")}
            className={`cc-tab-btn ${activeTab === "artifacts" ? "active" : ""}`}
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Artifacts
          </button>
        </div>
      </div>

      {/* ── Scrollable Body Area ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="cc-scroll">
        {/* ── TAB 1: TRACE & STREAM ── */}
        {activeTab === "trace" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Live Planning Thoughts Stream */}
            {state.planningLogs && state.planningLogs.length > 0 && (
              <div className="cc-card" style={{ padding: "14px 16px", background: "#0a0a0d" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {state.phase === "planning" ? (
                      <Loader2 size={13} className="animate-spin text-zinc-400" />
                    ) : (
                      <CheckCircle2 size={13} className="text-emerald-400" />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#a1a1aa", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {state.phase === "planning" ? "Autonomous Reasoning Engine" : "Planning Phase Completed (DAG Ready)"}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                    LIVE TRACE
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {state.planningLogs.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        fontSize: 11,
                        color: i === state.planningLogs.length - 1 && state.phase === "planning" ? "#f4f4f5" : "#a1a1aa",
                        fontFamily: "var(--font-geist-mono), monospace",
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: "#10b981" }}>❯</span>
                      <span>{log}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Human Approval Gate (Interactive Dialog) */}
            <AnimatePresence>
              {state.approvalDialog && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="cc-card"
                  style={{
                    padding: "16px",
                    border: "1px solid rgba(245, 158, 11, 0.4)",
                    background: "rgba(245, 158, 11, 0.04)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <AlertCircle size={16} className="text-amber-400" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#fbbf24" }}>
                      {state.approvalDialog.title}
                    </span>
                  </div>

                  <p style={{ fontSize: 12, color: "#d4d4d8", lineHeight: 1.5, marginBottom: 12 }}>
                    {state.approvalDialog.description}
                  </p>

                  {/* Editable contact / message */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                    <div>
                      <label style={{ fontSize: 10, color: "#a1a1aa", textTransform: "uppercase", fontFamily: "var(--font-geist-mono), monospace" }}>
                        Recipient Contact
                      </label>
                      <input
                        type="text"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        style={{
                          width: "100%",
                          background: "#09090b",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: 12,
                          color: "#f4f4f5",
                          marginTop: 4,
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 10, color: "#a1a1aa", textTransform: "uppercase", fontFamily: "var(--font-geist-mono), monospace" }}>
                        Outreach Message Draft
                      </label>
                      <textarea
                        value={editMessage}
                        onChange={(e) => setEditMessage(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          background: "#09090b",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: 12,
                          color: "#f4f4f5",
                          marginTop: 4,
                          resize: "none",
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() =>
                        onApproveStep(state.approvalDialog!.stepIndex, {
                          recipient: editPhone,
                          message: editMessage,
                        })
                      }
                      className="cc-btn-primary"
                      style={{ flex: 1, justifyContent: "center", padding: "10px 14px", fontSize: 12 }}
                    >
                      {state.approvalDialog.type === "call" ? (
                        <>
                          <PhoneCall size={13} /> Authorize & Place Screening Call
                        </>
                      ) : state.approvalDialog.type === "email" ? (
                        <>
                          <Mail size={13} /> Authorize & Send Email Dispatch
                        </>
                      ) : (
                        <>
                          <MessageSquare size={13} /> Authorize & Dispatch WhatsApp
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sequential Steps List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 2px",
                  fontSize: 11,
                  color: "#71717a",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                <span>EXECUTION TRACE</span>
                <span>
                  {completedSteps}/{totalSteps} COMPLETED
                </span>
              </div>

              {state.executionSteps.map((step) => {
                const meta = resolveConnectorMeta(step.connector, step.tool);
                const StepIcon = meta.icon;
                const isSelected = state.selectedNodeId === `step-${step.index}`;

                return (
                  <div
                    key={step.index}
                    onClick={() => {
                      onStepClick(step.index);
                      onTabChange("inspector");
                    }}
                    className={`cc-step-item ${isSelected ? "active" : ""}`}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div className={`cc-status-dot ${step.status}`} style={{ marginTop: 6 }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: step.status === "running" ? "#ffffff" : "#e4e4e7",
                            }}
                          >
                            {formatToolName(step.tool)}
                          </span>

                          <span
                            style={{
                              fontSize: 10,
                              fontFamily: "var(--font-geist-mono), monospace",
                              color: "#71717a",
                            }}
                          >
                            {step.durationMs != null
                              ? `${(step.durationMs / 1000).toFixed(1)}s`
                              : step.status}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 3,
                            fontSize: 11,
                            color: "#71717a",
                          }}
                        >
                          <StepIcon size={12} className={meta.color} />
                          <span>{meta.label}</span>
                        </div>

                        {/* Inline Result Snippet */}
                        {step.result && step.status === "completed" && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: "rgba(255, 255, 255, 0.03)",
                              fontSize: 11,
                              color: "#a1a1aa",
                              fontFamily: "var(--font-geist-mono), monospace",
                            }}
                          >
                            {renderStepResultSnippet(step.result)}
                          </div>
                        )}

                        {step.error && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: "rgba(239, 68, 68, 0.06)",
                              border: "1px solid rgba(239, 68, 68, 0.15)",
                              fontSize: 11,
                              color: "#f87171",
                            }}
                          >
                            {step.error}
                          </div>
                        )}
                      </div>

                      <ChevronRight size={14} className="text-zinc-600 shrink-0 mt-1" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mission Completion Card */}
            {state.phase === "completed" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="cc-card"
                style={{
                  padding: "16px",
                  background: "#101014",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#f4f4f5" }}>
                    Mission Accomplished
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                  <div className="cc-score-dial" style={{ "--score": 89 } as React.CSSProperties}>
                    <div className="cc-score-dial-inner">
                      <span style={{ fontSize: 18, fontWeight: 700, color: "#10b981" }}>89</span>
                      <span style={{ fontSize: 8, color: "#71717a" }}>SCORE</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e4e4e7" }}>
                      Ayush Singh
                    </div>
                    <div style={{ fontSize: 11, color: "#a1a1aa" }}>
                      Recommendation: <span style={{ color: "#34d399", fontWeight: 600 }}>PROCEED</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#71717a", marginTop: 2 }}>
                      WhatsApp outreach dispatched
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* ── TAB 2: INLINE NODE INSPECTOR ── */}
        {activeTab === "inspector" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {inspectedStep ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f4f5" }}>
                      {formatToolName(inspectedStep.tool)}
                    </div>
                    <div style={{ fontSize: 11, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                      Connector: {inspectedStep.connector}
                    </div>
                  </div>

                  <span
                    className={`cc-tag ${
                      inspectedStep.status === "completed"
                        ? "success"
                        : inspectedStep.status === "failed"
                        ? "danger"
                        : "neutral"
                    }`}
                  >
                    {inspectedStep.status}
                  </span>
                </div>

                {/* Purpose */}
                {inspectedCatalogTool && (
                  <div className="cc-card" style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase", marginBottom: 4 }}>
                      Purpose
                    </div>
                    <div style={{ fontSize: 12, color: "#d4d4d8", lineHeight: 1.5 }}>
                      {inspectedCatalogTool.description}
                    </div>
                  </div>
                )}

                {/* Input Parameters */}
                <div className="cc-card" style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>
                    Input Parameters
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      color: "#a1a1aa",
                      fontFamily: "var(--font-geist-mono), monospace",
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(inspectedStep.resolvedParams || inspectedStep.params, null, 2)}
                  </pre>
                </div>

                {/* Output Result */}
                {inspectedStep.result && (
                  <div className="cc-card" style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#71717a", textTransform: "uppercase", marginBottom: 6 }}>
                      Execution Result
                    </div>
                    <pre
                      style={{
                        fontSize: 11,
                        color: "#a1a1aa",
                        fontFamily: "var(--font-geist-mono), monospace",
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {JSON.stringify(inspectedStep.result, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#71717a" }}>
                <Sliders size={24} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
                <div style={{ fontSize: 13, color: "#a1a1aa" }}>No node selected</div>
                <div style={{ fontSize: 11 }}>Click any step or graph node to inspect live parameters</div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: ARTIFACTS ── */}
        {activeTab === "artifacts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="cc-card" style={{ padding: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <FileText size={14} className="text-zinc-300" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f4f4f5" }}>
                  Candidate Scorecard Artifact
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#a1a1aa", lineHeight: 1.6 }}>
                <strong>Candidate:</strong> Ayush Singh
                <br />
                <strong>Role:</strong> Senior AI Systems Engineer
                <br />
                <strong>ATS Match:</strong> 92% | <strong>Fraud Risk:</strong> 8% (Passed)
                <br />
                <strong>Status:</strong> Shortlisted & Outreach Delivered
              </div>
            </div>

            <div className="cc-card" style={{ padding: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Terminal size={14} className="text-zinc-300" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f4f4f5" }}>
                  Extracted Skills Matrix
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {[
                  "Python",
                  "FastAPI",
                  "React",
                  "Next.js",
                  "TypeScript",
                  "Multi-Agent AI",
                  "PyTorch",
                  "Vector DB",
                  "Docker",
                ].map((skill) => (
                  <span key={skill} className="cc-tag neutral" style={{ fontSize: 10 }}>
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Follow-up Box ── */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          background: "#09090b",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Follow up with the autonomous agents..."
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && followUpText.trim()) {
                onFollowUp(followUpText);
                setFollowUpText("");
              }
            }}
            style={{
              flex: 1,
              background: "#121216",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              color: "#f4f4f5",
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (followUpText.trim()) {
                onFollowUp(followUpText);
                setFollowUpText("");
              }
            }}
            className="cc-btn-primary"
            style={{ padding: "8px 12px" }}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function renderStepResultSnippet(result: Record<string, unknown>): React.ReactNode {
  if ("message_id" in result) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#34d399", fontWeight: 600 }}>✓ WhatsApp Delivered</span>
          <span style={{ color: "#71717a", fontSize: 10 }}>{String(result.recipient || "+91 98765 43210")}</span>
        </div>
        <div
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            borderRadius: 6,
            padding: "6px 8px",
            fontSize: 11,
            color: "#e4e4e7",
            lineHeight: 1.4,
          }}
        >
          {String(result.message || "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role.")}
        </div>
      </div>
    );
  }

  if ("call_id" in result) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>✓ Screening Call Completed ({String(result.duration_seconds || 134)}s)</span>
          <span style={{ color: "#34d399", fontSize: 10 }}>Score: {String(result.technical_score || 91)}%</span>
        </div>
        <div style={{ color: "#a1a1aa", fontSize: 11, lineHeight: 1.4 }}>
          {String(result.summary || "Candidate explained multi-agent decision systems and async event streams with high clarity.")}
        </div>
      </div>
    );
  }

  if ("legitimacy" in result) {
    const leg = result.legitimacy as Record<string, unknown>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#34d399", fontWeight: 600 }}>✓ Background Verified</span>
          <span style={{ color: "#71717a", fontSize: 10 }}>Signal: {String(leg?.score || 92)}/100</span>
        </div>
        <div style={{ color: "#a1a1aa", fontSize: 10 }}>
          Company: {String(result.company || "AgenticFlow AI")} • Official Domain Verified • 0 Scam Flags
        </div>
      </div>
    );
  }

  if ("match_score" in result) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>JD Match Score: <strong style={{ color: "#34d399" }}>{String(result.match_score)}%</strong></span>
        <span className="cc-tag success">{String(result.recommendation || "PROCEED")}</span>
      </div>
    );
  }

  if ("risk_score" in result) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Fraud Risk: <strong style={{ color: "#34d399" }}>{String(result.risk_score)}%</strong></span>
        <span className="cc-tag success">{String(result.verdict || "likely_genuine")}</span>
      </div>
    );
  }

  if ("overall_score" in result) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Executive Scorecard: <strong style={{ color: "#34d399" }}>{String(result.overall_score)}/100</strong></span>
        <span className="cc-tag success">{String(result.recommendation || "PROCEED")}</span>
      </div>
    );
  }

  if ("candidate" in result && typeof result.candidate === "object" && result.candidate !== null) {
    const c = result.candidate as Record<string, unknown>;
    return `Parsed: ${c.name || "Candidate"} (${c.experience || "N/A"}) • ATS: ${c.ats_score || 92}%`;
  }

  const firstKey = Object.keys(result)[0];
  return firstKey ? `${firstKey}: ${String(result[firstKey]).slice(0, 35)}` : "Completed";
}
