import { AlertTriangle, CheckCircle2, Loader2, XCircle, Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, Score, Stage } from "@/lib/recruitmentApi";
import { STAGE_LABEL } from "./stages";

/** Clean enterprise score cell with a refined, simple color scheme */
export function ScoreCell({ score, className }: { score: Score; className?: string }) {
  if (score.status === "not_computed" || score.value === null) {
    const why = score.reason || "Not computed";
    return (
      <span className={cn("inline-flex items-center text-zinc-400 text-xs font-normal", className)} title={why}>
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
    ? "text-amber-700 font-semibold"
    : val >= 80
    ? "text-emerald-700 font-bold"
    : val >= 60
    ? "text-blue-700 font-semibold"
    : "text-zinc-600 font-medium";

  const barFill = degraded
    ? "bg-amber-500"
    : val >= 80
    ? "bg-emerald-600"
    : val >= 60
    ? "bg-blue-600"
    : "bg-zinc-300";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={note}>
      <span className={cn("w-9 text-xs tabular-nums", textColor)}>
        {val}%
      </span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100 sm:block" aria-hidden="true">
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

/** Simple, restrained palette: Graphite, subtle Blue, Emerald for hired, Rose for reject */
const STAGE_CONFIG: Record<Stage, { badge: string; dot: string }> = {
  APPLIED: {
    badge: "bg-zinc-100 text-zinc-700 border-zinc-200/80",
    dot: "bg-zinc-400",
  },
  PROCESSING: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500 animate-pulse",
  },
  SCREENING: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-600",
  },
  SHORTLISTED: {
    badge: "bg-blue-50 text-blue-700 border-blue-200/80 font-medium",
    dot: "bg-blue-600",
  },
  INTERVIEW: {
    badge: "bg-blue-50 text-blue-800 border-blue-200/80 font-medium",
    dot: "bg-blue-600",
  },
  SELECTED: {
    badge: "bg-zinc-100 text-zinc-800 border-zinc-300 font-medium",
    dot: "bg-zinc-700",
  },
  OFFER: {
    badge: "bg-blue-50 text-blue-700 border-blue-200 font-semibold",
    dot: "bg-blue-600",
  },
  HIRED: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-300 font-bold",
    dot: "bg-emerald-600",
  },
  REJECTED: {
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
  },
  WITHDRAWN: {
    badge: "bg-zinc-100 text-zinc-500 border-zinc-200",
    dot: "bg-zinc-400",
  },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const cfg = STAGE_CONFIG[stage] || {
    badge: "bg-zinc-100 text-zinc-700 border-zinc-200",
    dot: "bg-zinc-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors shadow-2xs",
        cfg.badge
      )}
    >
      {stage === "PROCESSING" ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-600" />
      ) : (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      )}
      <span>{STAGE_LABEL[stage] || stage}</span>
    </span>
  );
}

/** Operational status indicator for candidate evaluation and analysis pipeline. */
export function AnalysisIndicator({ status, error }: { status: AnalysisStatus; error: string | null }) {
  const map: Record<AnalysisStatus, { icon: React.ReactNode; label: string }> = {
    completed: { icon: <Check className="h-3.5 w-3.5 text-emerald-600" />, label: "Evaluation completed" },
    partial: { icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />, label: error || "Partial results available" },
    failed: { icon: <XCircle className="h-3.5 w-3.5 text-rose-500" />, label: error || "Evaluation unavailable" },
    pending: { icon: <Clock className="h-3.5 w-3.5 text-zinc-400" />, label: "Pending evaluation" },
    running: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />, label: "Evaluation in progress" },
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
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-all border text-xs",
                isActive
                  ? "border-blue-600 bg-blue-600 text-white font-semibold shadow-xs"
                  : isDone
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 font-medium"
                  : "border-zinc-200 bg-white text-zinc-400"
              )}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
                {isDone ? (
                  <>
                    <circle cx="6" cy="6" r="5" fill="#10B981" />
                    <path d="M3.5 6L5 7.5L8.5 4" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                ) : isActive ? (
                  <>
                    <circle cx="6" cy="6" r="5" fill="white" />
                    <circle cx="6" cy="6" r="2.5" fill="#2563EB" className={isRunning ? "animate-pulse" : ""} />
                  </>
                ) : (
                  <circle cx="6" cy="6" r="4.5" stroke="#CBD5E1" strokeWidth="1" fill="none" />
                )}
              </svg>
              <span className="text-[11px] whitespace-nowrap">{label}</span>
            </div>

            {idx < totalSteps - 1 && (
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="text-zinc-300 shrink-0" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M1 5H11M11 5L7.5 1.5M11 5L7.5 8.5"
                  stroke={isDone ? "#10B981" : "#CBD5E1"}
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

/** Geometric Skill Match SVG Gauge */
export function SkillMatchSvg({
  matchedCount,
  totalCount,
  score,
  size = 64,
}: {
  matchedCount: number;
  totalCount: number;
  score: number | null;
  size?: number;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : 0;
  const strokeDashoffset = circumference - (pct / 100) * circumference;
  const strokeColor = pct >= 80 ? "#10B981" : "#2563EB";

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" className="-rotate-90 transform">
        <circle cx="32" cy="32" r={radius} stroke="#F4F4F5" strokeWidth="4" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          stroke={strokeColor}
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-xs font-bold text-zinc-900 tabular-nums">
          {score !== null ? `${score}%` : "—"}
        </span>
        <span className="text-[9px] text-zinc-500 mt-0.5">
          {matchedCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}

/** Official Google Drive Logo SVG */
export function GoogleDriveSvg({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

/** CATS Internal ATS Node Mark SVG */
export function CatsAtsSvg({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="4" />
      <path d="M7 8h10" />
      <path d="M7 12h5" />
      <path d="M7 16h6" />
      <circle cx="16.5" cy="14.5" r="2.5" fill="#2563EB" stroke="none" />
    </svg>
  );
}

/** Minimal Geometric SVG for Clean Empty State */
export function EmptyStateGeometricSvg({ className }: { className?: string }) {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("mx-auto text-zinc-300", className)}
    >
      <rect x="8" y="10" width="32" height="28" rx="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M16 20H32M16 26H26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="33" cy="29" r="1.5" fill="#2563EB" />
    </svg>
  );
}

/** Premium Geometric Candidate Pool Network SVG */
export function CandidatePoolMetricSvg({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 18C3 15.2386 5.68629 13 9 13C12.3137 13 15 15.2386 15 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="17" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.25" opacity="0.6" />
      <path d="M16 13.5C18.2 13.8 20 15.2 20 17" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** Premium Geometric Radar Scope / Evaluation SVG */
export function EvaluationMetricSvg({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 3V7M12 17V21M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** Premium Geometric Verified Outcomes SVG */
export function OutcomesMetricSvg({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12 2L15.09 5.26L19.5 5.9L18.18 10.24L20.22 14.24L16.09 16L14.77 20.34L10.5 19L7.41 22.26L6.09 17.92L1.78 17.28L3.82 13.28L2.5 8.94L6.91 8.3L8.23 3.96L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Bespoke AgenticFlow AI Talent Engine Logomark SVG */
export function TalentBrandMarkSvg({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M7 8L12 15L17 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="8" r="2" fill="currentColor" />
      <circle cx="17" cy="8" r="2" fill="currentColor" />
      <circle cx="12" cy="15" r="2.5" fill="currentColor" />
    </svg>
  );
}
