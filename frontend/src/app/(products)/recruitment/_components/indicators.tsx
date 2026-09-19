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

/** Geometric SVG Pipeline Step Indicator for Live Batch Processing */
export function PipelineProgressionSvg({
  currentStep,
  totalSteps = 4,
  isRunning = false,
  className,
}: {
  currentStep: number;
  totalSteps?: number;
  isRunning?: boolean;
  className?: string;
}) {
  const stepLabels = ["Ingestion", "Screening", "Evaluation", "Routing"];
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      {stepLabels.slice(0, totalSteps).map((label, idx) => {
        const stepNum = idx + 1;
        const isDone = currentStep > stepNum;
        const isActive = currentStep === stepNum;

        return (
          <div key={label} className="flex items-center gap-1.5">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 transition-colors border",
                isActive
                  ? "border-[#171717] bg-[#171717] text-white font-medium shadow-2xs"
                  : isDone
                  ? "border-[#E4E7EC] bg-[#F7F8FA] text-[#171717]"
                  : "border-[#E4E7EC] bg-white text-[#98A2B3]"
              )}
            >
              {/* Minimal SVG Node Circle */}
              <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                {isDone ? (
                  <>
                    <circle cx="6" cy="6" r="5" fill="#12B76A" />
                    <path d="M3.5 6L5 7.5L8.5 4" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                ) : isActive ? (
                  <>
                    <circle cx="6" cy="6" r="5" fill="white" />
                    <circle cx="6" cy="6" r="2.5" fill="#171717" className={isRunning ? "animate-pulse" : ""} />
                  </>
                ) : (
                  <circle cx="6" cy="6" r="4.5" stroke="#D0D5DD" strokeWidth="1" fill="none" />
                )}
              </svg>
              <span className="text-[11px] whitespace-nowrap">{label}</span>
            </div>

            {idx < totalSteps - 1 && (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-[#D0D5DD] shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M1 5H11M11 5L7.5 1.5M11 5L7.5 8.5"
                  stroke={isDone ? "#171717" : "#D0D5DD"}
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Geometric Skill Match SVG Gauge / Polar Breakdown */
export function SkillMatchSvg({
  matchedCount,
  totalCount,
  score,
  size = 72,
}: {
  matchedCount: number;
  totalCount: number;
  score: number | null;
  size?: number;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : 0;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const strokeColor =
    pct >= 80 ? "#12B76A" : pct >= 65 ? "#171717" : "#F79009";

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 68 68" className="-rotate-90 transform">
        {/* Background Track */}
        <circle
          cx="34"
          cy="34"
          r={radius}
          stroke="#F2F4F7"
          strokeWidth="5"
          fill="none"
        />
        {/* Filled Percentage Arc */}
        <circle
          cx="34"
          cy="34"
          r={radius}
          stroke={strokeColor}
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-xs font-bold text-[#171717] tabular-nums">
          {score !== null ? `${score}%` : "—"}
        </span>
        <span className="text-[9px] text-[#667085] mt-0.5">
          {matchedCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}

/** Minimal Geometric SVG for Clean Empty State */
export function EmptyStateGeometricSvg({ className }: { className?: string }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("mx-auto text-[#98A2B3]", className)}
    >
      <rect x="8" y="10" width="32" height="28" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M16 20H32M16 26H26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="33" cy="29" r="1.5" fill="currentColor" />
    </svg>
  );
}

