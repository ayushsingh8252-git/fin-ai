import { AlertTriangle, CheckCircle2, Loader2, XCircle, Clock, Check } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Score, Stage } from "@/lib/recruitmentApi";
import { STAGE_LABEL, STAGE_TONE } from "./stages";

/** A single candidate score with disciplined enterprise visual telemetry. */
export function ScoreCell({ score, className }: { score: Score; className?: string }) {
  if (score.status === "not_computed" || score.value === null) {
    const why = score.reason || "Not computed";
    return (
      <span className={cn("inline-flex items-center text-zinc-400 font-mono text-xs", className)} title={why}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }

  const degraded = score.status === "degraded";
  const note = degraded
    ? score.reason || "Estimated by keyword overlap because the automated model was unavailable. Review manually."
    : undefined;
  const val = score.value;

  const textColor = degraded
    ? "text-amber-700"
    : val >= 75
    ? "text-emerald-700"
    : val >= 50
    ? "text-zinc-800"
    : "text-zinc-600";

  const barFill = degraded
    ? "bg-amber-500"
    : val >= 75
    ? "bg-emerald-600"
    : val >= 50
    ? "bg-zinc-700"
    : "bg-zinc-400";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={note}>
      <span className={cn("w-9 text-xs font-semibold tabular-nums", textColor)}>
        {val}%
      </span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100 sm:block" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full transition-all duration-200", barFill)}
          style={{ width: `${Math.max(0, Math.min(100, val))}%` }}
        />
      </span>
      {degraded && (
        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" aria-hidden="true" />
      )}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <StatusPill tone={STAGE_TONE[stage]}>
      {stage === "PROCESSING" && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden="true" />}
      {STAGE_LABEL[stage]}
    </StatusPill>
  );
}

/** Operational status indicator for candidate evaluation and analysis pipeline. */
export function AnalysisIndicator({ status, error }: { status: AnalysisStatus; error: string | null }) {
  const map: Record<AnalysisStatus, { icon: React.ReactNode; label: string }> = {
    completed: { icon: <Check className="h-3.5 w-3.5 text-emerald-600" />, label: "Analysis completed" },
    partial: { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />, label: error || "Partial results available" },
    failed: { icon: <XCircle className="h-3.5 w-3.5 text-red-600" />, label: error || "Analysis unavailable" },
    pending: { icon: <Clock className="h-3.5 w-3.5 text-zinc-400" />, label: "Pending analysis" },
    running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-600" />, label: "Analysis in progress" },
  };
  const { icon, label } = map[status];
  return (
    <span className="inline-flex items-center" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
