"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, X, Loader2 } from "lucide-react";
import { resolveConnectorMeta, formatToolName } from "./iconResolver";
import type { AgentNodeData } from "./types";

/** Custom React Flow node — dark premium card with icon, status, and data. */
function AgentNodeComponent({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const meta = resolveConnectorMeta(d.connector, d.tool, d.connectorDisplayName);
  const Icon = meta.icon;

  const statusClasses = [
    "cc-node",
    d.status === "running" ? "running" : "",
    d.status === "completed" ? "completed" : "",
    d.status === "failed" ? "failed" : "",
    d.isSelected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />

      <div className={statusClasses}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          {/* Icon badge */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              border: `1px solid ${meta.borderColor}`,
              background: `linear-gradient(135deg, ${meta.glowColor.replace("0.35", "0.12")}, transparent)`,
            }}
          >
            <Icon size={18} className={meta.color} />
          </div>

          {/* Name + connector */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#e4e4e7",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {meta.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.4)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {formatToolName(d.tool)}
            </div>
          </div>

          {/* Status indicator */}
          <div style={{ flexShrink: 0 }}>
            {d.status === "completed" && (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "rgba(34,197,94,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check size={13} style={{ color: "#22c55e" }} />
              </div>
            )}
            {d.status === "failed" && (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "rgba(239,68,68,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={13} style={{ color: "#ef4444" }} />
              </div>
            )}
            {d.status === "running" && (
              <Loader2 size={16} style={{ color: "#818cf8" }} className="cc-spin" />
            )}
            {d.status === "pending" && (
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.15)",
                }}
              />
            )}
          </div>
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.35)",
            lineHeight: 1.45,
            marginBottom: 8,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {d.toolDescription || "Processing..."}
        </div>

        {/* Footer meta */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
          }}
        >
          {/* Step badge */}
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.35)",
              fontWeight: 500,
              fontFamily: "monospace",
              fontSize: 10,
            }}
          >
            Step {d.stepIndex}
          </span>

          {/* Category */}
          <span className={`cc-badge ${meta.category === "Agent" ? "info" : "neutral"}`}>
            {meta.category}
          </span>

          {/* Duration */}
          {d.durationMs != null && (
            <span
              style={{
                marginLeft: "auto",
                color: "rgba(255,255,255,0.3)",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              {(d.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        {/* Progress bar */}
        {d.status === "running" && (
          <div className="cc-progress-bar">
            <div
              className="cc-progress-fill running"
              style={{ width: "60%" }}
            />
          </div>
        )}

        {/* Completion result preview */}
        {d.status === "completed" && d.result && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(34,197,94,0.06)",
              border: "1px solid rgba(34,197,94,0.1)",
              fontSize: 10,
              color: "rgba(255,255,255,0.4)",
              maxHeight: 40,
              overflow: "hidden",
            }}
          >
            {renderResultPreview(d.result)}
          </div>
        )}

        {/* Error preview */}
        {d.status === "failed" && d.error && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.1)",
              fontSize: 10,
              color: "rgba(248,113,113,0.8)",
              maxHeight: 40,
              overflow: "hidden",
            }}
          >
            {d.error}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: "transparent", border: "none", width: 8, height: 8 }} />
    </>
  );
}

/** Extract a short preview from a result dict */
function renderResultPreview(result: Record<string, unknown>): string {
  // Common patterns
  if ("match_score" in result) return `Match: ${result.match_score}%`;
  if ("overall_score" in result) return `Score: ${result.overall_score}/100`;
  if ("risk_score" in result) return `Risk: ${result.risk_score}% — ${result.verdict}`;
  if ("ats_score" in result) return `ATS Score: ${result.ats_score}`;
  if ("status" in result && "message_id" in result) return `Sent ✓`;
  if ("candidate" in result && typeof result.candidate === "object") {
    const c = result.candidate as Record<string, unknown>;
    return c.name ? `${c.name}` : "Parsed";
  }
  if ("recommendation" in result) return `${result.recommendation}`;
  if ("verdict" in result) return `${result.verdict}`;
  // Fallback
  const keys = Object.keys(result).slice(0, 3);
  return keys.join(", ");
}

export default memo(AgentNodeComponent);
