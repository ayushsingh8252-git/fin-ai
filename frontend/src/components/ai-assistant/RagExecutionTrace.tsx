"use client";

import { useState } from "react";
import {
  Search, Layers, ShieldCheck, GitBranch, ArrowUpDown, Globe, Sparkles,
  Check, Minus, Loader2, ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Mirrors backend/app/services/live_status.py's STAGE_ORDER and stage
// shape one-for-one — every field rendered here comes straight from
// GET /api/v1/observability/live/{request_id}, never invented client-side.
export type StageName =
  | "retrieving" | "hybrid_search" | "crag" | "adaptive"
  | "reranking" | "tools_web" | "generating";

export type StageStatus = "pending" | "running" | "done" | "skipped";

export type StageInfo = {
  status: StageStatus;
  data: Record<string, unknown> | null;
};

export type LiveTraceSnapshot = {
  request_id: string;
  status: "running" | "ok" | "blocked" | "error";
  stages: Record<StageName, StageInfo>;
  stage_order: StageName[];
  final: Record<string, unknown> | null;
  live?: boolean;
};

const STAGE_META: Record<StageName, { label: string; icon: typeof Search }> = {
  retrieving: { label: "Retrieving", icon: Search },
  hybrid_search: { label: "Hybrid Search", icon: Layers },
  crag: { label: "CRAG", icon: ShieldCheck },
  adaptive: { label: "Adaptive/ARAG", icon: GitBranch },
  reranking: { label: "Reranking", icon: ArrowUpDown },
  tools_web: { label: "Tools/Web", icon: Globe },
  generating: { label: "Generating", icon: Sparkles },
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

// One stage's real payload -> a short, human-readable line list. Only
// surfaces fields that are actually present on that stage's data — never
// pads with placeholders for fields the backend didn't send.
function stageDetailLines(name: StageName, data: Record<string, unknown> | null): [string, string][] {
  if (!data) return [];
  switch (name) {
    case "retrieving":
      if ("cache_hit" in data) return [["Cache", data.cache_hit ? "HIT" : "MISS"]];
      if ("document_status" in data) return [["Document status", fmt(data.document_status)]];
      return [];
    case "hybrid_search": {
      const rounds = (data.rounds as Record<string, unknown>[] | undefined) ?? [];
      return rounds.map((r, i) => [
        rounds.length > 1 ? `Round ${i + 1}` : "Retrieval",
        `${fmt(r.mode)} · dense ${fmt(r.dense_count)} · sparse ${fmt(r.sparse_count)} · fused ${fmt(r.fused_count)} · ${fmt(r.latency_ms)}ms`,
      ]);
    }
    case "crag":
      return [
        ["Grade", fmt(data.grade)],
        ["Confidence", typeof data.confidence === "number" ? data.confidence.toFixed(2) : fmt(data.confidence)],
        ["Candidates graded", fmt(data.candidate_count)],
      ];
    case "adaptive":
      return [
        ["Branch", fmt(data.branches_executed)],
        ...(data.step_back_triggered ? ([["Step-back", "triggered"]] as [string, string][]) : []),
      ];
    case "reranking":
      return [
        ["Method", data.used ? "CrossEncoder" : "Heuristic (score sort)"],
        ["Candidates", `${fmt(data.candidate_count)} → ${fmt(data.reranked_count)}`],
        ["Latency", `${fmt(data.latency_ms)}ms`],
      ];
    case "tools_web":
      return [
        ["Web search", data.used ? "triggered" : "not needed"],
        ...(data.used ? ([["Results", fmt(data.result_count)]] as [string, string][]) : []),
      ];
    case "generating":
      return [
        ["Mode", fmt(data.retrieval_mode)],
        ...(data.fallback ? ([["Fallback", fmt(data.fallback)]] as [string, string][]) : []),
      ];
    default:
      return [];
  }
}

function StatusIcon({ status }: { status: StageStatus }) {
  if (status === "done") return <Check className="w-3 h-3" />;
  if (status === "running") return <Loader2 className="w-3 h-3 animate-spin" />;
  if (status === "skipped") return <Minus className="w-3 h-3" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />;
}

function stagePillClasses(status: StageStatus): string {
  switch (status) {
    case "done":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "running":
      return "text-blue-700 bg-blue-50 border-blue-200";
    case "skipped":
      return "text-zinc-400 bg-zinc-50 border-zinc-200";
    default:
      return "text-zinc-400 bg-zinc-50 border-zinc-200";
  }
}

function StagePill({
  name, info, expanded, onToggle,
}: {
  name: StageName;
  info: StageInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STAGE_META[name];
  const Icon = meta.icon;
  const lines = stageDetailLines(name, info.data);
  const canExpand = info.status !== "pending" && (lines.length > 0);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!canExpand}
        onClick={onToggle}
        className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-lg border transition-colors shadow-2xs ${stagePillClasses(info.status)} ${
          canExpand ? "cursor-pointer hover:brightness-95" : "cursor-default"
        }`}
        title={info.status === "skipped" ? `${meta.label} — skipped` : meta.label}
      >
        <Icon className="w-3 h-3" />
        <span>{meta.label}</span>
        <StatusIcon status={info.status} />
        {canExpand && (
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>
      <AnimatePresence initial={false}>
        {expanded && canExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-1 pl-2 border-l-2 border-zinc-200 text-[10.5px] font-mono text-zinc-500 space-y-0.5 py-1">
              {lines.map(([k, v], i) => (
                <div key={i}>
                  <span className="text-zinc-400">{k}:</span> <span className="text-zinc-600">{v}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function summaryLine(snapshot: LiveTraceSnapshot): string {
  const executed = snapshot.stage_order.filter((n) => snapshot.stages[n]?.status !== "pending" && snapshot.stages[n]?.status !== "skipped");
  const grade = snapshot.stages.crag?.data?.grade as string | undefined;
  const branch = (snapshot.stages.adaptive?.data?.branches_executed as string[] | undefined)?.[0];
  const bits = [`${executed.length}/${snapshot.stage_order.length} stages`];
  if (grade) bits.push(`CRAG ${grade}`);
  if (branch) bits.push(branch.replace(/_/g, " ").toLowerCase());
  return bits.join(" · ");
}

/**
 * Live/collapsed view of one query's real execution trace. `collapsed`
 * renders a single clickable summary bar (for a completed message,
 * auto-collapsed so the answer stays the focus); otherwise renders the
 * live stage-pill row directly, updating in place as `snapshot` changes.
 * Every value shown comes from `snapshot` — nothing here is simulated.
 */
export default function RagExecutionTrace({
  snapshot,
  collapsed = false,
  latencyMs,
}: {
  snapshot: LiveTraceSnapshot | null;
  collapsed?: boolean;
  latencyMs?: number;
}) {
  const [expandedStages, setExpandedStages] = useState<Set<StageName>>(new Set());
  const [barOpen, setBarOpen] = useState(false);

  if (!snapshot) return null;

  const toggleStage = (name: StageName) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const pillRow = (
    <div className="flex flex-wrap gap-1.5">
      {snapshot.stage_order.map((name) => (
        <StagePill
          key={name}
          name={name}
          info={snapshot.stages[name]}
          expanded={expandedStages.has(name)}
          onToggle={() => toggleStage(name)}
        />
      ))}
    </div>
  );

  if (!collapsed) {
    return (
      <div className="mb-2 p-2 rounded-xl bg-zinc-50/80 border border-zinc-200">
        {pillRow}
      </div>
    );
  }

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => setBarOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[10.5px] font-mono text-zinc-400 hover:text-zinc-600 transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${barOpen ? "rotate-180" : ""}`} />
        <span>{summaryLine(snapshot)}</span>
        {typeof latencyMs === "number" && <span>· {latencyMs}ms</span>}
      </button>
      <AnimatePresence initial={false}>
        {barOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 p-2 rounded-xl bg-zinc-50/80 border border-zinc-200">
              {pillRow}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
