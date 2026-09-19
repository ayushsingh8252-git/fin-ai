import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Score, Stage } from "@/lib/recruitmentApi";
import { STAGE_LABEL, STAGE_TONE } from "./stages";

/** A single AI score, honest about where it came from with modern visual telemetry. */
export function ScoreCell({ score, className }: { score: Score; className?: string }) {
  if (score.status === "not_computed" || score.value === null) {
    const why = score.reason || "Not computed";
    return (
      <span className={cn("inline-flex items-center text-zinc-300 font-mono text-xs", className)} title={why}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }

  const degraded = score.status === "degraded";
  const note = degraded
    ? score.reason || "Estimated by keyword overlap because the AI provider was unavailable. Review manually."
    : undefined;
  const val = score.value;

  const textColor = degraded
    ? "text-amber-700"
    : val >= 75
    ? "text-emerald-700"
    : val >= 50
    ? "text-indigo-700"
    : "text-rose-700";

  const barFill = degraded
    ? "bg-amber-400"
    : val >= 75
    ? "bg-gradient-to-r from-emerald-500 to-teal-400"
    : val >= 50
    ? "bg-gradient-to-r from-indigo-500 to-violet-500"
    : "bg-gradient-to-r from-rose-500 to-amber-500";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={note}>
      <span className={cn("w-10 text-xs font-bold tabular-nums", textColor)}>
        {val}%
      </span>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100/90 sm:block shadow-inner" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full transition-all duration-300", barFill)}
          style={{ width: `${Math.max(0, Math.min(100, val))}%` }}
        />
      </span>
      {degraded && (
        <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" aria-hidden="true" />
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

/** Whether the AI work on this candidate finished, partly finished, or failed. */
export function AnalysisIndicator({ status, error }: { status: AnalysisStatus; error: string | null }) {
  const map: Record<AnalysisStatus, { icon: React.ReactNode; label: string }> = {
    completed: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: "AI analysis complete" },
    partial: { icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, label: error || "Some AI results are unavailable" },
    failed: { icon: <XCircle className="h-4 w-4 text-red-500" />, label: error || "AI analysis was unavailable" },
    pending: { icon: <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />, label: "AI analysis in progress" },
    running: { icon: <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />, label: "AI analysis in progress" },
  };
  const { icon, label } = map[status];
  return (
    <span className="inline-flex items-center" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
