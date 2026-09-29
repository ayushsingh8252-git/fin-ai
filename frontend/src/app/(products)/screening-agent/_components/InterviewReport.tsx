"use client";

import { Award, AlertTriangle, Check, X, ShieldAlert } from "lucide-react";
import type { EvaluationResult } from "./types";
import FeedbackButtons from "@/components/FeedbackButtons";
import AudioIntegrity from "./AudioIntegrity";
import BehavioralAnalysis from "./BehavioralAnalysis";

const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string }> = {
  "Strong Hire": { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700" },
  Hire: { bg: "bg-green-50 border-green-200", text: "text-green-700" },
  "Lean Hire": { bg: "bg-amber-50 border-amber-200", text: "text-amber-700" },
  "No Hire": { bg: "bg-red-50 border-red-200", text: "text-red-700" },
  "Review Needed": { bg: "bg-zinc-100 border-zinc-200", text: "text-zinc-600" },
};

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  const pct = value ?? 0;
  const color = pct >= 70 ? "#22c55e" : pct >= 45 ? "#eab308" : "#ef4444";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="font-semibold text-zinc-700">{value === null ? "—" : `${value}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold text-zinc-700 ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}

function formatDuration(sec: number | null): string {
  if (sec === null || sec < 0 || Number.isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s} min`;
}

/** Real, LLM-grounded report shown once an interview reaches "complete" —
 * replaces the old 3-chip EvaluationCard and the fully-fake marketing
 * ReportsSection with one component fed by the actual /interview/evaluate
 * response (or a persisted GET /interview/report/{id} fetch on reload). */
export default function InterviewReport({
  evaluation,
  sessionId,
}: {
  evaluation: EvaluationResult;
  /** Fallback subject id for feedback when this report has no persisted
   * report_id (ad-hoc practice interviews with no invite-link session). */
  sessionId?: string;
}) {
  const rec = RECOMMENDATION_STYLES[evaluation.recommendation] ?? RECOMMENDATION_STYLES["Review Needed"];
  const isDegraded = evaluation.overall_score === null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm text-left">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-zinc-900">Detailed Interview Report</h3>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${rec.bg} ${rec.text}`}>
          {evaluation.recommendation || "Review Needed"}
        </span>
      </div>

      <FeedbackButtons workflowType="interview" subjectId={evaluation.report_id ?? sessionId} className="mb-4" />

      {isDegraded && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {evaluation.summary}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
        <StatCard
          label="Overall Score"
          value={evaluation.overall_score === null ? "—" : `${evaluation.overall_score}%`}
          valueClass="text-blue-600"
        />
        <StatCard label="Time Taken" value={formatDuration(evaluation.time_taken_sec)} />
        <StatCard label="Questions" value={evaluation.question_count === null ? "—" : String(evaluation.question_count)} />
        <StatCard
          label="Proctor Flags"
          value={evaluation.proctor_flags_count === null ? "—" : String(evaluation.proctor_flags_count)}
          valueClass={(evaluation.proctor_flags_count ?? 0) > 0 ? "text-red-500" : "text-emerald-600"}
        />
      </div>

      {!isDegraded && (
        <div className="grid gap-4 sm:grid-cols-3 mb-5">
          <ScoreBar label="Communication" value={evaluation.communication_score} />
          <ScoreBar label="Relevance" value={evaluation.relevance_score} />
          <ScoreBar label="Confidence" value={evaluation.confidence_score} />
        </div>
      )}

      <p className="text-xs text-zinc-600 leading-relaxed mb-5">{evaluation.summary}</p>

      {(evaluation.matched_skills.length > 0 || evaluation.missing_skills.length > 0) && (
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Skills Observed</p>
          <div className="flex flex-wrap gap-1.5">
            {evaluation.matched_skills.map((s) => (
              <span
                key={`m-${s}`}
                className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700 border border-green-100"
              >
                <Check className="w-3 h-3" /> {s}
              </span>
            ))}
            {evaluation.missing_skills.map((s) => (
              <span
                key={`x-${s}`}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 border border-zinc-200"
              >
                <X className="w-3 h-3" /> {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {(evaluation.strengths.length > 0 || evaluation.areas_for_improvement.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2 mb-5">
          {evaluation.strengths.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 mb-1.5">Strengths</p>
              <ul className="space-y-1">
                {evaluation.strengths.map((s) => (
                  <li key={s} className="text-xs text-zinc-600 flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 rounded-full bg-emerald-500 shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {evaluation.areas_for_improvement.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 mb-1.5">Areas to Improve</p>
              <ul className="space-y-1">
                {evaluation.areas_for_improvement.map((s) => (
                  <li key={s} className="text-xs text-zinc-600 flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 rounded-full bg-amber-500 shrink-0" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(evaluation.key_takeaway || evaluation.suggested_next_step) && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3.5">
          {evaluation.key_takeaway && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600">Key Takeaway</p>
              <p className="mt-0.5 text-xs text-zinc-700">{evaluation.key_takeaway}</p>
            </>
          )}
          {evaluation.suggested_next_step && (
            <>
              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Suggested Next Step</p>
              <p className="mt-0.5 text-xs text-zinc-700">{evaluation.suggested_next_step}</p>
            </>
          )}
        </div>
      )}

      {evaluation.integrity_score !== null && (
        <div className="mt-4 flex items-center gap-1.5 text-[11px] text-zinc-400">
          <ShieldAlert className="w-3.5 h-3.5" /> BrewShield integrity score:{" "}
          <span className="font-semibold text-zinc-600">{evaluation.integrity_score}/100</span>
        </div>
      )}

      <AudioIntegrity sessionId={sessionId} />
      <BehavioralAnalysis sessionId={sessionId} />
    </div>
  );
}
