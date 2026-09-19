import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Score, Stage } from "@/lib/recruitmentApi";
import { STAGE_LABEL, STAGE_TONE } from "./stages";

/** A single AI score, honest about where it came from.
 *
 *  computed     -> plain number
 *  degraded     -> number kept but flagged amber: it was estimated without AI
 *  not_computed -> a dash with the reason, never a number
 *
 * The backend already withholds the value for not_computed; this component
 * additionally refuses to render a number for it, so the two agree. */
export function ScoreCell({ score, className }: { score: Score; className?: string }) {
  if (score.status === "not_computed" || score.value === null) {
    const why = score.reason || "Not computed";
    return (
      <span className={cn("inline-flex items-center text-zinc-400", className)} title={why}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }
  const degraded = score.status === "degraded";
  const note = degraded
    ? score.reason || "Estimated by keyword overlap because the AI provider was unavailable. Review manually."
    : undefined;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={note}>
      <span className={cn("w-9 text-sm font-semibold tabular-nums", degraded ? "text-amber-700" : "text-zinc-900")}>
        {score.value}%
      </span>
      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-zinc-100 sm:block" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full", degraded ? "bg-amber-400" : "bg-zinc-700")}
          style={{ width: `${Math.max(0, Math.min(100, score.value))}%` }}
        />
      </span>
      {degraded && (
        <>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <span className="sr-only">{note}</span>
        </>
      )}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <StatusPill tone={STAGE_TONE[stage]}>
      {stage === "PROCESSING" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
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
    pending: { icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />, label: "AI analysis in progress" },
    running: { icon: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />, label: "AI analysis in progress" },
  };
  const { icon, label } = map[status];
  return (
    <span className="inline-flex" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
