"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, X, Loader2, AlertCircle, Clock } from "lucide-react";
import { resolveConnectorMeta, formatToolName } from "./iconResolver";
import type { AgentNodeData } from "./types";

function AgentNodeComponent({ data }: NodeProps) {
  const d = data as unknown as AgentNodeData;
  const meta = resolveConnectorMeta(d.connector, d.tool, d.connectorDisplayName);
  const Icon = meta.icon;

  const nodeClasses = [
    "cc-agent-node",
    d.status === "running" ? "running" : "",
    d.status === "completed" ? "completed" : "",
    d.status === "failed" ? "failed" : "",
    d.status === "waiting_approval" ? "waiting_approval" : "",
    d.isSelected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "transparent", border: "none", width: 6, height: 6 }}
      />

      <div className={nodeClasses}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={16} className={meta.color} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#f4f4f5",
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
                fontFamily: "var(--font-geist-mono), monospace",
                color: "#71717a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {d.tool}
            </div>
          </div>

          {/* Status badge */}
          <div style={{ flexShrink: 0 }}>
            {d.status === "completed" && (
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(16, 185, 129, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check size={12} className="text-emerald-400" />
              </div>
            )}
            {d.status === "failed" && (
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(239, 68, 68, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={12} className="text-red-400" />
              </div>
            )}
            {d.status === "waiting_approval" && (
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(245, 158, 11, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AlertCircle size={12} className="text-amber-400" />
              </div>
            )}
            {d.status === "running" && (
              <Loader2 size={15} className="animate-spin text-zinc-300" />
            )}
            {d.status === "pending" && (
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(255, 255, 255, 0.2)",
                }}
              />
            )}
          </div>
        </div>

        {/* Short description */}
        <div
          style={{
            fontSize: 11,
            color: "#a1a1aa",
            lineHeight: 1.4,
            marginBottom: 8,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {d.toolDescription || "Autonomous task execution"}
        </div>

        {/* Footer info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#71717a",
            fontFamily: "var(--font-geist-mono), monospace",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
            paddingTop: 6,
          }}
        >
          <span>STEP {String(d.stepIndex).padStart(2, "0")}</span>
          {d.durationMs != null ? (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <Clock size={10} /> {(d.durationMs / 1000).toFixed(1)}s
            </span>
          ) : (
            <span style={{ textTransform: "uppercase" }}>{d.status}</span>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "transparent", border: "none", width: 6, height: 6 }}
      />
    </>
  );
}

export default memo(AgentNodeComponent);
