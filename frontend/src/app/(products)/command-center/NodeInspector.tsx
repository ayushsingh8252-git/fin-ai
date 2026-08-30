"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Clock, Shield, RotateCcw, AlertTriangle, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { resolveConnectorMeta, formatToolName } from "./iconResolver";
import type { ExecutionStep, CatalogTool } from "./types";
import { useState } from "react";

interface Props {
  step: ExecutionStep | null;
  catalogTool?: CatalogTool;
  onClose: () => void;
}

export default function NodeInspector({ step, catalogTool, onClose }: Props) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [showInputSchema, setShowInputSchema] = useState(false);

  if (!step) return null;

  const meta = resolveConnectorMeta(step.connector, step.tool);
  const Icon = meta.icon;

  return (
    <AnimatePresence>
      <motion.div
        key="inspector"
        initial={{ x: 320, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 320, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="cc-inspector"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          zIndex: 20,
          overflowY: "auto",
          padding: "20px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${meta.borderColor}`,
                background: `linear-gradient(135deg, ${meta.glowColor.replace("0.35", "0.12")}, transparent)`,
              }}
            >
              <Icon size={18} className={meta.color} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#e4e4e7" }}>
                {formatToolName(step.tool)}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                {step.connector}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Status */}
        <InspectorSection title="Status">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step.status === "completed" && <Check size={14} style={{ color: "#22c55e" }} />}
            {step.status === "failed" && <X size={14} style={{ color: "#ef4444" }} />}
            {step.status === "running" && <Zap size={14} style={{ color: "#818cf8" }} />}
            <span style={{ fontSize: 13, fontWeight: 500, color: statusColor(step.status), textTransform: "capitalize" }}>
              {step.status}
            </span>
            {step.durationMs != null && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={11} /> {(step.durationMs / 1000).toFixed(2)}s
              </span>
            )}
          </div>
        </InspectorSection>

        {/* Description */}
        {catalogTool && (
          <InspectorSection title="Purpose">
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, margin: 0 }}>
              {catalogTool.description}
            </p>
          </InspectorSection>
        )}

        {/* Input */}
        <InspectorSection title="Input">
          <div style={{ fontSize: 12 }}>
            {step.resolvedParams && Object.keys(step.resolvedParams).length > 0 ? (
              Object.entries(step.resolvedParams).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 6 }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontFamily: "monospace", fontSize: 11 }}>{key}:</span>{" "}
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{formatValue(value)}</span>
                </div>
              ))
            ) : step.params && Object.keys(step.params).length > 0 ? (
              Object.entries(step.params).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 6 }}>
                  <span style={{ color: "rgba(255,255,255,0.35)", fontFamily: "monospace", fontSize: 11 }}>{key}:</span>{" "}
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{formatValue(value)}</span>
                </div>
              ))
            ) : (
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>No input parameters</span>
            )}
          </div>
        </InspectorSection>

        {/* Output */}
        {step.result && (
          <InspectorSection title="Output">
            <div style={{ fontSize: 12 }}>
              {renderOutput(step.result)}
            </div>
          </InspectorSection>
        )}

        {/* Error */}
        {step.error && (
          <InspectorSection title="Error">
            <div style={{ fontSize: 12, color: "#f87171", padding: "8px 10px", background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.1)" }}>
              {step.error}
              {step.errorCode && (
                <div style={{ marginTop: 4, fontSize: 10, color: "rgba(248,113,113,0.6)" }}>
                  Code: {step.errorCode}
                </div>
              )}
            </div>
          </InspectorSection>
        )}

        {/* Score visualization (special case) */}
        {step.result && ("overall_score" in step.result || "match_score" in step.result || "risk_score" in step.result) && (
          <InspectorSection title="Score Analysis">
            <ScoreVisualization result={step.result} />
          </InspectorSection>
        )}

        {/* Tool Definition */}
        {catalogTool && (
          <>
            <InspectorSection title="Tool Specification">
              <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <MetaRow icon={<Shield size={12} />} label="Permissions" value={catalogTool.permissions.length > 0 ? catalogTool.permissions.join(", ") : "None required"} />
                <MetaRow icon={<Clock size={12} />} label="Timeout" value={`${catalogTool.timeout}s`} />
                <MetaRow icon={<RotateCcw size={12} />} label="Retry" value={catalogTool.retry_policy ? `${(catalogTool.retry_policy as Record<string, unknown>).max_attempts || 1} attempt(s)` : "No retry"} />
                <MetaRow icon={<AlertTriangle size={12} />} label="Status" value={catalogTool.status} />
              </div>
            </InspectorSection>

            {/* Input Schema (collapsible) */}
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowInputSchema(!showInputSchema)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 0",
                }}
              >
                {showInputSchema ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Input Schema
              </button>
              {showInputSchema && (
                <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10, overflow: "auto", maxHeight: 200, margin: "6px 0 0", border: "1px solid rgba(255,255,255,0.04)" }}>
                  {JSON.stringify(catalogTool.input_schema, null, 2)}
                </pre>
              )}
            </div>
          </>
        )}

        {/* Raw JSON toggle */}
        <div>
          <button
            onClick={() => setShowRawJson(!showRawJson)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            {showRawJson ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Raw JSON
          </button>
          {showRawJson && (
            <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 10, overflow: "auto", maxHeight: 300, margin: "6px 0 0", border: "1px solid rgba(255,255,255,0.04)" }}>
              {JSON.stringify({ step: step.index, connector: step.connector, tool: step.tool, params: step.resolvedParams || step.params, result: step.result, error: step.error }, null, 2)}
            </pre>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Helper components ── */

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "rgba(255,255,255,0.25)" }}>{icon}</span>
      <span style={{ color: "rgba(255,255,255,0.4)", minWidth: 80 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.6)", fontFamily: "monospace", fontSize: 11 }}>{value}</span>
    </div>
  );
}

function ScoreVisualization({ result }: { result: Record<string, unknown> }) {
  const score = (result.overall_score ?? result.match_score ?? result.risk_score) as number;
  const isRisk = "risk_score" in result;
  const color = isRisk ? (score > 50 ? "#ef4444" : "#22c55e") : (score >= 70 ? "#22c55e" : score >= 50 ? "#fbbf24" : "#ef4444");

  const bars: { label: string; value: number }[] = [];
  if (result.skills_score) bars.push({ label: "Skills", value: result.skills_score as number });
  if (result.experience_score) bars.push({ label: "Experience", value: result.experience_score as number });
  if (result.education_score) bars.push({ label: "Education", value: result.education_score as number });
  if (result.cultural_fit_score) bars.push({ label: "Culture Fit", value: result.cultural_fit_score as number });

  return (
    <div>
      {/* Score circle */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: bars.length > 0 ? 16 : 0 }}>
        <div className="cc-score-ring" style={{ "--score": score } as React.CSSProperties}>
          <div className="cc-score-inner">
            <span style={{ fontSize: 22, fontWeight: 700, color }}>{score}</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{isRisk ? "risk" : "/ 100"}</span>
          </div>
        </div>
        <div>
          {result.recommendation ? (
            <div className={`cc-badge ${String(result.recommendation) === "PROCEED" ? "success" : "warning"}`} style={{ marginBottom: 6 }}>
              {String(result.recommendation)}
            </div>
          ) : null}
          {result.verdict ? (
            <div className={`cc-badge ${String(result.verdict) === "likely_genuine" ? "success" : "warning"}`} style={{ marginBottom: 6 }}>
              {String(result.verdict).replace(/_/g, " ")}
            </div>
          ) : null}
          {result.match_grade ? (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{String(result.match_grade)}</div>
          ) : null}
        </div>
      </div>

      {/* Sub-score bars */}
      {bars.map((bar) => (
        <div key={bar.label} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: "rgba(255,255,255,0.4)" }}>{bar.label}</span>
            <span style={{ color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>{bar.value}%</span>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${bar.value}%`, background: color, borderRadius: 2, transition: "width 0.5s ease" }} />
          </div>
        </div>
      ))}

      {/* Strengths / weaknesses */}
      {Array.isArray(result.strengths) ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Strengths</div>
          {(result.strengths as string[]).slice(0, 4).map((s, i) => (
            <div key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 3 }}>
              <Check size={10} style={{ color: "#22c55e", flexShrink: 0, marginTop: 2 }} /> {s}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "#22c55e";
    case "failed": return "#ef4444";
    case "running": return "#818cf8";
    default: return "rgba(255,255,255,0.4)";
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (value.startsWith("$step")) return value; // placeholder reference
    if (value.length > 80) return value.slice(0, 77) + "...";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === "object") return `{${Object.keys(value).length} fields}`;
  return String(value);
}

function renderOutput(result: Record<string, unknown>): React.ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {Object.entries(result).slice(0, 12).map(([key, value]) => (
        <div key={key}>
          <span style={{ color: "rgba(255,255,255,0.35)", fontFamily: "monospace", fontSize: 11 }}>{key}:</span>{" "}
          <span style={{ color: "rgba(255,255,255,0.6)" }}>{formatValue(value)}</span>
        </div>
      ))}
      {Object.keys(result).length > 12 && (
        <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 10 }}>
          +{Object.keys(result).length - 12} more fields
        </span>
      )}
    </div>
  );
}
