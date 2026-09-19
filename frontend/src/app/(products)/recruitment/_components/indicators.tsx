import { AlertTriangle, CheckCircle2, Loader2, XCircle, Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Score, Stage } from "@/lib/recruitmentApi";
import { STAGE_LABEL } from "./stages";

/** Clean enterprise score cell */
export function ScoreCell({ score, className }: { score: Score; className?: string }) {
  if (score.status === "not_computed" || score.value === null) {
    const why = score.reason || "Not computed";
    return (
      <span className={cn("inline-flex items-center text-[#98A2B3] text-xs font-normal", className)} title={why}>
        —
      </span>
    );
  }

  const degraded = score.status === "degraded";
  const note = degraded
    ? score.reason || "Estimated by keyword overlap. Review manually."
    : undefined;
  const val = score.value;

  const textColor = degraded
    ? "text-[#F79009]"
    : val >= 75
    ? "text-[#12B76A]"
    : val >= 50
    ? "text-[#171717]"
    : "text-[#667085]";

  const barFill = degraded
    ? "bg-[#F79009]"
    : val >= 75
    ? "bg-[#12B76A]"
    : val >= 50
    ? "bg-[#171717]"
    : "bg-[#98A2B3]";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={note}>
      <span className={cn("w-9 text-xs font-semibold tabular-nums", textColor)}>
        {val}%
      </span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-[#F2F4F7] sm:block" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full transition-all duration-200", barFill)}
          style={{ width: `${Math.max(0, Math.min(100, val))}%` }}
        />
      </span>
      {degraded && (
        <AlertTriangle className="h-3 w-3 text-[#F79009] shrink-0" aria-hidden="true" />
      )}
    </span>
  );
}

const STAGE_DOT_COLOR: Record<Stage, string> = {
  APPLIED: "bg-[#98A2B3]",
  PROCESSING: "bg-[#2E90FA]",
  SCREENING: "bg-[#2E90FA]",
  SHORTLISTED: "bg-[#171717]",
  INTERVIEW: "bg-[#F79009]",
  SELECTED: "bg-[#12B76A]",
  OFFER: "bg-[#12B76A]",
  HIRED: "bg-[#12B76A]",
  REJECTED: "bg-[#F04438]",
  WITHDRAWN: "bg-[#98A2B3]",
};

export function StageBadge({ stage }: { stage: Stage }) {
  const dotColor = STAGE_DOT_COLOR[stage] || "bg-[#98A2B3]";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#E4E7EC] bg-white px-2 py-0.5 text-xs font-medium text-[#171717]">
      {stage === "PROCESSING" ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin text-[#2E90FA]" />
      ) : (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
      )}
      <span>{STAGE_LABEL[stage] || stage}</span>
    </span>
  );
}

/** Operational status indicator for candidate evaluation and analysis pipeline. */
export function AnalysisIndicator({ status, error }: { status: AnalysisStatus; error: string | null }) {
  const map: Record<AnalysisStatus, { icon: React.ReactNode; label: string }> = {
    completed: { icon: <Check className="h-3.5 w-3.5 text-[#12B76A]" />, label: "Evaluation completed" },
    partial: { icon: <AlertTriangle className="h-3.5 w-3.5 text-[#F79009]" />, label: error || "Partial results available" },
    failed: { icon: <XCircle className="h-3.5 w-3.5 text-[#F04438]" />, label: error || "Evaluation unavailable" },
    pending: { icon: <Clock className="h-3.5 w-3.5 text-[#98A2B3]" />, label: "Pending evaluation" },
    running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-[#667085]" />, label: "Evaluation in progress" },
  };
  const { icon, label } = map[status] || map.pending;
  return (
    <span className="inline-flex items-center" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}
