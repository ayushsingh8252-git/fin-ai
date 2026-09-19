"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Brain, ChevronRight, Clock, ExternalLink, FileText,
  Loader2, MapPin, Mail, Phone, RefreshCw, Shield, Star, User,
  CheckCircle2, XCircle, AlertTriangle, Briefcase, Sparkles,
  Activity, Eye, Download, Calendar, Send, DollarSign, Check,
  Copy, Plus, ShieldCheck, ShieldAlert, Video, Award, ThumbsUp, ThumbsDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  errorMessage, getApplication360, setStage, openResume,
  triggerFraudScan, sendScreeningInvite, scheduleInterview,
  createOffer, updateOffer,
  type Application360, type Score, type Stage, type ActivityEvent,
  type OfferInfo, type InterviewInfo,
} from "@/lib/recruitmentApi";
import { ScoreCell, StageBadge, AnalysisIndicator } from "@/app/(products)/recruitment/_components/indicators";
import { NEXT_STAGES, STAGE_LABEL, initials } from "@/app/(products)/recruitment/_components/stages";
import { useRecruitment } from "@/app/(products)/recruitment/_components/RecruitmentShell";
import { cn } from "@/lib/utils";

type LoadState = { data: Application360 } | { error: string } | null;

/* ═══════════════════════════════════════════════════════════
   HELPER ATOMS
   ═══════════════════════════════════════════════════════════ */

function ScoreCard({ label, score, icon, accent }: { label: string; score: Score; icon: React.ReactNode; accent: "emerald" | "indigo" | "amber" }) {
  const computed = score.status === "computed" && score.value !== null;
  const degraded = score.status === "degraded" && score.value !== null;
  const value = score.value;

  const barColors = {
    emerald: "bg-gradient-to-r from-emerald-500 to-teal-400",
    indigo: "bg-gradient-to-r from-indigo-500 to-violet-500",
    amber: "bg-gradient-to-r from-amber-500 to-orange-400",
  };

  const ringColors = {
    emerald: "text-emerald-600 bg-emerald-50/70 border-emerald-200/80",
    indigo: "text-indigo-600 bg-indigo-50/70 border-indigo-200/80",
    amber: "text-amber-600 bg-amber-50/70 border-amber-200/80",
  };

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <div className={cn("rounded-xl border p-2", ringColors[accent])}>
          {icon}
        </div>
      </div>

      {computed || degraded ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-black tabular-nums tracking-tight", degraded ? "text-amber-700" : "text-zinc-900")}>
              {value}%
            </span>
            {degraded && (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                Estimated
              </span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className={cn("h-full rounded-full transition-all duration-500", degraded ? "bg-amber-400" : barColors[accent])}
              style={{ width: `${Math.min(100, Math.max(0, value!))}%` }}
            />
          </div>
          {degraded && score.reason && (
            <p className="mt-1 text-[11px] text-amber-600 leading-tight">{score.reason}</p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-3xl font-bold text-zinc-300">—</span>
          <span className="text-xs text-zinc-400 font-medium">{score.reason || "Pending calculation"}</span>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-zinc-100/70 last:border-0">
      <span className="mt-0.5 text-zinc-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-xs font-semibold text-zinc-800 break-words mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function SkillTag({ skill, tone }: { skill: string; tone: "matched" | "missing" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-semibold shadow-xs transition-transform hover:scale-105",
      tone === "matched"
        ? "bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/80"
        : "bg-red-50/90 text-red-700 ring-1 ring-red-200/80",
    )}>
      {tone === "matched" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
      {skill}
    </span>
  );
}

function TimelineEvent({ event }: { event: ActivityEvent }) {
  const icon = event.actor_type === "ai"
    ? <Sparkles className="h-4 w-4 text-violet-600" />
    : event.actor_type === "hr"
    ? <User className="h-4 w-4 text-indigo-600" />
    : <Clock className="h-4 w-4 text-zinc-400" />;

  const actorLabel = event.actor_type === "ai" ? "AI Engine" : event.actor_type === "hr" ? "Recruiter / HR" : "Automated System";
  const time = event.created_at ? new Date(event.created_at) : null;
  const payload = event.payload || {};

  return (
    <div className="group relative flex gap-4 pb-6 last:pb-0">
      <div className="absolute left-[17px] top-9 bottom-0 w-0.5 bg-zinc-200/80 group-last:hidden" />
      <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white shadow-sm transition-transform group-hover:scale-110">
        {icon}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-xs font-bold text-zinc-900">{event.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-600">{actorLabel}</span>
          {time && (
            <span>
              {time.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {Boolean(payload.from && payload.to) && (
          <div className="mt-2 flex items-center gap-2 text-xs font-medium">
            <span className="rounded-lg bg-zinc-100 px-2.5 py-0.5 text-zinc-700">
              {STAGE_LABEL[payload.from as Stage] || String(payload.from)}
            </span>
            <ChevronRight className="h-3 w-3 text-zinc-300" />
            <span className="rounded-lg bg-indigo-50 px-2.5 py-0.5 font-bold text-indigo-700 border border-indigo-200">
              {STAGE_LABEL[payload.to as Stage] || String(payload.to)}
            </span>
          </div>
        )}
        {Boolean(payload.reason) && (
          <p className="mt-1.5 text-xs text-zinc-500 italic bg-zinc-50/80 p-2.5 rounded-xl border border-zinc-100">
            &ldquo;{String(payload.reason)}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 1: OVERVIEW & FRAUD CARD
   ═══════════════════════════════════════════════════════════ */

function OverviewTab({
  data,
  onStageChange,
  onReload,
}: {
  data: Application360;
  onStageChange: (stage: Stage, reason?: string) => Promise<void>;
  onReload: () => void;
}) {
  const { can } = useRecruitment();
  const { application, candidate, job, fraud } = data;
  const [stageLoading, setStageLoading] = useState<Stage | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [scanningFraud, setScanningFraud] = useState(false);
  const [fraudError, setFraudError] = useState<string | null>(null);

  const nextStages: Stage[] = NEXT_STAGES[application.stage] || [];
  const canDecide = can("decide");

  const handleStage = async (target: Stage) => {
    setStageLoading(target);
    setStageError(null);
    try {
      await onStageChange(target);
    } catch (err) {
      setStageError(errorMessage(err));
    } finally {
      setStageLoading(null);
    }
  };

  const handleRunFraud = async () => {
    setScanningFraud(true);
    setFraudError(null);
    try {
      await triggerFraudScan(application.id);
      onReload();
    } catch (err) {
      setFraudError(errorMessage(err));
    } finally {
      setScanningFraud(false);
    }
  };

  const fraudResult = (fraud?.result || {}) as Record<string, unknown>;
  const isSuspicious = Boolean(
    fraudResult.suspicious ||
    fraudResult.risk_level === "high" ||
    fraudResult.risk_level === "critical" ||
    (Array.isArray(fraudResult.flags) && fraudResult.flags.length > 0)
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Profile & Document Integrity Column */}
      <div className="lg:col-span-1 space-y-6">
        {/* Candidate Profile Details */}
        <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4">
            Candidate Information
          </h3>

          <div className="space-y-1">
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email Address" value={candidate.email} />
            <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone Number" value={candidate.phone} />
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Location" value={candidate.location} />
            <InfoRow icon={<Briefcase className="h-4 w-4" />} label="Experience Summary" value={candidate.experience_text} />
          </div>

          {candidate.skills.length > 0 && (
            <div className="mt-6 border-t border-zinc-100 pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Skills Profile ({candidate.skills.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.slice(0, 16).map((s) => (
                  <span key={s} className="rounded-xl bg-zinc-100/90 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                    {s}
                  </span>
                ))}
                {candidate.skills.length > 16 && (
                  <span className="rounded-xl bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-400">
                    +{candidate.skills.length - 16} more
                  </span>
                )}
              </div>
            </div>
          )}

          {candidate.has_resume && (
            <div className="mt-6 border-t border-zinc-100 pt-5">
              <Button
                variant="outline"
                size="sm"
                className="w-full border-zinc-200 hover:bg-zinc-50 font-semibold"
                onClick={() => openResume(candidate.id)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-zinc-500" />
                Download Original Resume
              </Button>
            </div>
          )}
        </div>

        {/* Fraud / Document Integrity Card */}
        <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn("p-2 rounded-xl", isSuspicious ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
                {isSuspicious ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900">Document Integrity</h3>
                <p className="text-[11px] text-zinc-400">AI Fraud & Tampering Engine</p>
              </div>
            </div>
            {fraud ? (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  fraud.status === "complete"
                    ? isSuspicious
                      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                      : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                )}
              >
                {fraud.status === "complete" ? (isSuspicious ? "Anomaly Detected" : "Verified Clean") : fraud.status}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-bold text-zinc-600">
                Not Scanned
              </span>
            )}
          </div>

          {fraud ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between py-2 border-b border-zinc-100 text-xs">
                <span className="text-zinc-500">Scan Status:</span>
                <span className="font-bold text-zinc-800 capitalize">{fraud.status}</span>
              </div>
              {fraud.status === "complete" && (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-zinc-100 text-xs">
                    <span className="text-zinc-500">Integrity Risk:</span>
                    <span className={cn("font-bold flex items-center gap-1", isSuspicious ? "text-red-600" : "text-emerald-600")}>
                      {isSuspicious ? "High Risk / Discrepancy" : "Authentic Document"}
                    </span>
                  </div>
                  {Array.isArray(fraudResult.flags) && fraudResult.flags.length > 0 && (
                    <div className="pt-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-red-600 mb-2">Detected Flags:</p>
                      <ul className="space-y-2">
                        {fraudResult.flags.map((flag: unknown, idx: number) => (
                          <li key={idx} className="text-xs text-red-700 bg-red-50/80 rounded-xl p-2.5 flex items-start gap-2 border border-red-100">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                            <span className="leading-snug">{String(flag)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {fraud.created_at && (
                <p className="text-[11px] text-zinc-400 pt-1">
                  Scanned on {new Date(fraud.created_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 text-xs text-zinc-500 pt-1">
              <p className="leading-relaxed">
                Multi-signal forensic analysis detects white-text keyword stuffing, altered dates, and credential discrepancies.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full font-semibold border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                disabled={scanningFraud || !candidate.has_resume}
                onClick={handleRunFraud}
              >
                {scanningFraud ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Shield className="h-3.5 w-3.5 mr-1.5" />}
                Run Integrity Scan
              </Button>
            </div>
          )}
          {fraudError && <ErrorBanner message={fraudError} className="mt-3" />}
        </div>
      </div>

      {/* Main Scoring & Stage Column */}
      <div className="space-y-6 lg:col-span-2">
        {/* Stage Progression Action Bar */}
        <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Current Stage</p>
              <StageBadge stage={application.stage} />
            </div>
            {job && (
              <div className="text-right">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Position</p>
                <p className="text-sm font-bold text-zinc-900">{job.title}</p>
                {job.department && <p className="text-xs text-zinc-500">{job.department}</p>}
              </div>
            )}
          </div>

          {canDecide && nextStages.length > 0 && (
            <div className="pt-4 border-t border-zinc-100">
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5">
                Stage Transition Options:
              </p>
              <div className="flex flex-wrap gap-2.5">
                {nextStages.map((s: Stage) => {
                  const isReject = s === "REJECTED" || s === "WITHDRAWN";
                  const isHire = s === "HIRED";
                  return (
                    <Button
                      key={s}
                      variant={isReject ? "destructive" : isHire ? "brand" : "outline"}
                      size="sm"
                      disabled={stageLoading !== null}
                      onClick={() => handleStage(s)}
                      className={cn(
                        "font-semibold transition-all duration-200",
                        isHire && "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
                      )}
                    >
                      {stageLoading === s ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      {STAGE_LABEL[s]}
                    </Button>
                  );
                })}
              </div>
              {stageError && <ErrorBanner message={stageError} className="mt-3" />}
            </div>
          )}
        </div>

        {/* 3 High-Impact Score Gauges */}
        <div className="grid gap-4 sm:grid-cols-3">
          <ScoreCard
            label="ATS Keyword Score"
            score={application.scores.ats_score}
            icon={<Star className="h-4 w-4" />}
            accent="amber"
          />
          <ScoreCard
            label="JD Match Score"
            score={application.scores.match_score}
            icon={<Brain className="h-4 w-4" />}
            accent="indigo"
          />
          <ScoreCard
            label="Skill Match Score"
            score={application.scores.skill_match_score}
            icon={<CheckCircle2 className="h-4 w-4" />}
            accent="emerald"
          />
        </div>

        {/* AI Evaluation Summary */}
        {application.analysis.ai_summary && (
          <div className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">AI Synthesized Assessment</h3>
                  <p className="text-[11px] text-zinc-400">Deep semantic analysis against role requirements</p>
                </div>
              </div>
              <AnalysisIndicator status={application.analysis.analysis_status} error={application.analysis.analysis_error} />
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed font-normal whitespace-pre-wrap bg-white/60 p-4 rounded-2xl border border-indigo-50 shadow-xs">
              {application.analysis.ai_summary}
            </p>

            {application.analysis.recommendation && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Recruiter Guidance:</span>
                <span className="rounded-full bg-indigo-100 text-indigo-800 px-3 py-0.5 text-xs font-bold border border-indigo-200">
                  {application.analysis.recommendation}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 2: AI ANALYSIS
   ═══════════════════════════════════════════════════════════ */

function AnalysisTab({ data }: { data: Application360 }) {
  const { application } = data;
  const analysis = application.analysis;
  const matched = analysis.matched_skills;
  const missing = analysis.missing_skills;
  const matchScore = application.scores.match_score;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900">
                {matchScore.value !== null ? `Evaluation Reasoning: ${matchScore.value}% Confidence` : "JD Match Analysis"}
              </h3>
              <p className="text-xs text-zinc-400">Granular skill requirement cross-check</p>
            </div>
          </div>
          {matchScore.status === "degraded" && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
              Heuristic Match
            </span>
          )}
        </div>

        {matched.length === 0 && missing.length === 0 ? (
          <div className="rounded-2xl bg-zinc-50 p-8 text-center text-xs text-zinc-500">
            No specific skills mapping available for this candidate.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {matched.length > 0 && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/20 p-6 space-y-3">
                <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Verified Matched Skills ({matched.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {matched.map((s) => <SkillTag key={s} skill={s} tone="matched" />)}
                </div>
              </div>
            )}
            {missing.length > 0 && (
              <div className="rounded-2xl border border-red-100 bg-red-50/20 p-6 space-y-3">
                <p className="flex items-center gap-2 text-sm font-bold text-red-800">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Skill Gaps / Missing ({missing.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {missing.map((s) => <SkillTag key={s} skill={s} tone="missing" />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-200/80 bg-white p-8 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-zinc-900">Scoring Transparency & Provenance</h3>
          <p className="text-xs text-zinc-400">Verifiable models and heuristics used to calculate candidate percentiles</p>
        </div>
        <div className="divide-y divide-zinc-100">
          {(["ats_score", "match_score", "skill_match_score"] as const).map((key) => {
            const s = application.scores[key];
            return (
              <div key={key} className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm font-bold text-zinc-800">
                    {key === "ats_score" ? "ATS Keyword Relevance" : key === "match_score" ? "JD Semantic Fit" : "Skill Coverage Score"}
                  </p>
                  <p className="text-xs text-zinc-400">
                    Provider: {s.source || "Neural Match Engine"} · State: {s.status}
                  </p>
                </div>
                <ScoreCell score={s} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 3: AI SCREENING
   ═══════════════════════════════════════════════════════════ */

function ScreeningTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, screening } = data;
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async () => {
    setInviting(true);
    setError(null);
    try {
      await sendScreeningInvite(application.id);
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setInviting(false);
    }
  };

  const interviewLink = screening?.session_id
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/screening-agent/session/${screening.session_id}`
    : null;

  const handleCopyLink = () => {
    if (interviewLink) {
      navigator.clipboard.writeText(interviewLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900">AI Voice & Interactive Screening</h3>
              <p className="text-xs text-zinc-400">Autonomous conversational pre-qualification round</p>
            </div>
          </div>
          {screening ? (
            <StatusPill tone={screening.session_status === "completed" ? "success" : "warning"}>
              {screening.session_status}
            </StatusPill>
          ) : (
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-600">
              Not Yet Invited
            </span>
          )}
        </div>

        {screening ? (
          <div className="space-y-6">
            <div className="rounded-2xl bg-indigo-50/50 border border-indigo-100 p-5 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Screening Session Web Link</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={interviewLink || ""}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs text-zinc-700 font-mono select-all focus:outline-none"
                />
                <Button variant="outline" size="sm" onClick={handleCopyLink} className="font-semibold">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                  {copied ? "Copied" : "Copy Link"}
                </Button>
                {interviewLink && (
                  <a
                    href={interviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-indigo-600/20 hover:bg-indigo-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Session
                  </a>
                )}
              </div>
            </div>

            {/* Results */}
            {screening.results && screening.results.length > 0 ? (
              <div className="space-y-4 pt-2">
                <h4 className="text-sm font-bold text-zinc-800">Screening Evaluation Results</h4>
                {screening.results.map((res) => (
                  <div key={res.id} className="rounded-2xl border border-zinc-200 p-6 space-y-4 bg-zinc-50/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-indigo-600" />
                        <span className="text-sm font-bold text-zinc-800">Verdict:</span>
                        <StatusPill tone={res.verdict?.toLowerCase().includes("recommend") ? "success" : "warning"}>
                          {res.verdict || "Under Review"}
                        </StatusPill>
                      </div>
                      {res.jd_match_score !== null && (
                        <div className="flex items-center gap-1.5 text-sm font-bold text-zinc-900">
                          <span>Match Score:</span>
                          <span className="text-indigo-600">{res.jd_match_score}%</span>
                        </div>
                      )}
                    </div>

                    {res.summary && (
                      <p className="text-xs text-zinc-600 leading-relaxed font-normal">{res.summary}</p>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 pt-2">
                      {res.strengths && res.strengths.length > 0 && (
                        <div className="rounded-xl bg-emerald-50/60 p-4 border border-emerald-100">
                          <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5 mb-2">
                            <ThumbsUp className="h-3.5 w-3.5" /> Key Strengths
                          </p>
                          <ul className="space-y-1">
                            {res.strengths.map((str, i) => (
                              <li key={i} className="text-xs text-emerald-700">• {str}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {res.gaps && res.gaps.length > 0 && (
                        <div className="rounded-xl bg-amber-50/60 p-4 border border-amber-100">
                          <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5 mb-2">
                            <ThumbsDown className="h-3.5 w-3.5" /> Areas to Probe
                          </p>
                          <ul className="space-y-1">
                            {res.gaps.map((gap, i) => (
                              <li key={i} className="text-xs text-amber-700">• {gap}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-zinc-50 p-8 text-center text-xs text-zinc-500">
                The screening session has been initialized. Live transcript and scored evaluation will appear here once candidate completes the call.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-xs">
              <Sparkles className="h-7 w-7" />
            </div>
            <div className="max-w-md mx-auto">
              <h4 className="text-base font-bold text-zinc-900">Invite candidate to AI Screening</h4>
              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                Sends an automated voice screening invite that dynamically interviews the candidate on role-specific competencies.
              </p>
            </div>
            <Button
              variant="brand"
              disabled={inviting || !candidate.email}
              onClick={handleInvite}
              className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/20 font-semibold"
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
              Send Screening Invitation
            </Button>
            {!candidate.email && (
              <p className="text-xs text-red-500 font-medium">Candidate must have an email address to receive an invitation.</p>
            )}
          </div>
        )}
        {error && <ErrorBanner message={error} className="mt-4" />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 4: INTERVIEWS (PHASE 4)
   ═══════════════════════════════════════════════════════════ */

function InterviewsTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, interviews } = data;
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [mode, setMode] = useState("human");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledAt) {
      setError("Please select date and time for the interview.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await scheduleInterview(application.id, {
        scheduled_at: new Date(scheduledAt).toISOString(),
        mode,
        interviewer_email: interviewerEmail || undefined,
        notes: notes || undefined,
      });
      setShowSchedule(false);
      setScheduledAt("");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-zinc-900">Interviews & Video Rounds</h3>
          <p className="text-xs text-zinc-500">Coordinate team interviews with Google Meet video rooms</p>
        </div>
        <Button
          variant="brand"
          size="sm"
          onClick={() => setShowSchedule(!showSchedule)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm font-semibold"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Schedule Interview
        </Button>
      </div>

      {showSchedule && (
        <form onSubmit={handleSchedule} className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/30 via-white to-white p-6 shadow-md space-y-4 animate-in slide-in-from-top-3">
          <h4 className="text-sm font-bold text-zinc-900">Schedule New Interview</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Interview Format</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="human">Video Call (Google Meet)</option>
                <option value="telephonic">Telephonic Interview</option>
                <option value="ai_screening">AI Guided Panel</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Interviewer Email</label>
              <input
                type="email"
                placeholder="interviewer@company.com"
                value={interviewerEmail}
                onChange={(e) => setInterviewerEmail(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={loading} className="font-semibold">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Calendar className="h-3.5 w-3.5 mr-1" />}
              Confirm Schedule
            </Button>
          </div>
        </form>
      )}

      {interviews.length === 0 ? (
        <div className="rounded-3xl border border-zinc-200/80 bg-white p-16 text-center shadow-sm">
          <Calendar className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
          <h4 className="text-base font-bold text-zinc-800">No interviews scheduled</h4>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            Schedule a technical or HR interview above to generate calendar invitations and video conferencing links.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {interviews.map((iv: InterviewInfo) => (
            <div key={iv.id} className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm flex flex-wrap items-center justify-between gap-4 transition-all hover:shadow-md">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-indigo-600" />
                  <span className="text-sm font-bold text-zinc-900 capitalize">{iv.mode} Interview</span>
                  <StatusPill tone={iv.status === "completed" ? "success" : "warning"}>{iv.status}</StatusPill>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500">
                  {iv.scheduled_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(iv.scheduled_at).toLocaleString()}
                    </span>
                  )}
                  {iv.interviewer_email && (
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {iv.interviewer_email}
                    </span>
                  )}
                </div>
              </div>
              {iv.meet_link && (
                <a
                  href={iv.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-indigo-600 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-indigo-600" />
                  Join Google Meet
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 5: OFFERS (PHASE 5)
   ═══════════════════════════════════════════════════════════ */

function OffersTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, job } = data;
  const offers: OfferInfo[] = data.offers || [];
  const [showCreate, setShowCreate] = useState(false);
  const [salary, setSalary] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [equity, setEquity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createOffer(application.id, {
        salary: salary ? parseFloat(salary) : undefined,
        currency,
        equity: equity || undefined,
        role_title: job?.title || undefined,
        start_date: startDate || undefined,
        notes: notes || undefined,
      });
      setShowCreate(false);
      setSalary("");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (offerId: string, newStatus: string) => {
    setActionLoading(offerId);
    try {
      await updateOffer(offerId, { status: newStatus });
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-zinc-900">Job Offers & Terms</h3>
          <p className="text-xs text-zinc-500">Formal compensation packages and candidate acceptance tracking</p>
        </div>
        <Button
          variant="brand"
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Create Formal Offer
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-3xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/30 via-white to-white p-6 shadow-md space-y-4 animate-in slide-in-from-top-3">
          <h4 className="text-sm font-bold text-zinc-900">Extend Job Offer</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Annual Base Salary</label>
              <input
                type="number"
                placeholder="140000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Equity Grant</label>
              <input
                type="text"
                placeholder="0.25% or 5,000 RSUs"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Target Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">Notes / Signing Bonus</label>
              <input
                type="text"
                placeholder="e.g. $10k relocation allowance, 30 days notice period"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={loading} className="font-semibold">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
              Generate & Record Offer
            </Button>
          </div>
        </form>
      )}

      {offers.length === 0 ? (
        <div className="rounded-3xl border border-zinc-200/80 bg-white p-16 text-center shadow-sm">
          <DollarSign className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
          <h4 className="text-base font-bold text-zinc-800">No offers generated yet</h4>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            Extend an official offer package to initiate candidate compensation tracking and hire closure.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {offers.map((offer: OfferInfo) => (
            <div key={offer.id} className="rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100">
                <div>
                  <h4 className="text-base font-bold text-zinc-900">{offer.role_title || "Job Offer"}</h4>
                  <p className="text-xs text-zinc-400">Issued on {offer.created_at ? new Date(offer.created_at).toLocaleDateString() : "Recently"}</p>
                </div>
                <StatusPill tone={offer.status === "accepted" ? "success" : offer.status === "rejected" ? "danger" : offer.status === "sent" ? "warning" : "neutral"}>
                  {offer.status.toUpperCase()}
                </StatusPill>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Base Compensation</p>
                  <p className="text-base font-extrabold text-zinc-900 mt-0.5">{offer.currency} {offer.salary ? offer.salary.toLocaleString() : "—"}</p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Equity</p>
                  <p className="text-base font-extrabold text-zinc-900 mt-0.5">{offer.equity || "None"}</p>
                </div>
                <div className="rounded-xl bg-zinc-50 p-3 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Start Date</p>
                  <p className="text-base font-extrabold text-zinc-900 mt-0.5">{offer.start_date || "Flexible"}</p>
                </div>
              </div>

              {offer.notes && (
                <p className="text-xs text-zinc-600 bg-zinc-50 p-3 rounded-xl italic">
                  &ldquo;{offer.notes}&rdquo;
                </p>
              )}

              {offer.status !== "accepted" && offer.status !== "rejected" && (
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-zinc-100">
                  <span className="text-xs text-zinc-500 font-medium mr-2">Action:</span>
                  {offer.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === offer.id}
                      onClick={() => handleStatusChange(offer.id, "sent")}
                      className="font-semibold"
                    >
                      <Send className="h-3.5 w-3.5 text-blue-600 mr-1.5" />
                      Mark Sent to Candidate
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-emerald-700 hover:bg-emerald-50 border-emerald-200 font-semibold"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "accepted")}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mr-1.5" />
                    Accept Offer & Finalize Hire
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-700 hover:bg-red-50 border-red-200 font-semibold"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "rejected")}
                  >
                    <XCircle className="h-3.5 w-3.5 text-red-600 mr-1.5" />
                    Decline / Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 6: RESUME
   ═══════════════════════════════════════════════════════════ */

function ResumeTab({ data }: { data: Application360 }) {
  const { candidate } = data;

  if (!candidate.has_resume) {
    return (
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-20 text-center shadow-sm">
        <FileText className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-zinc-800">No Resume File Available</h3>
        <p className="mt-1 text-xs text-zinc-500">This candidate does not have a stored resume document.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900">{candidate.resume_filename || "Candidate_Resume.pdf"}</h3>
            <p className="text-xs text-zinc-400">Encrypted PDF document</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => openResume(candidate.id)} className="font-semibold">
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
          Open PDF in New Window
        </Button>
      </div>
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-16 shadow-sm text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-xs">
          <FileText className="h-8 w-8" />
        </div>
        <div>
          <h4 className="text-base font-bold text-zinc-900">Secure Document Inspection</h4>
          <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
            Authorized access token generated for resume review. Click below to stream the full PDF resume in high definition.
          </p>
        </div>
        <Button
          variant="brand"
          onClick={() => openResume(candidate.id)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20"
        >
          <Eye className="h-4 w-4 mr-1.5" />
          View Complete PDF Resume
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TAB 7: ACTIVITY TIMELINE
   ═══════════════════════════════════════════════════════════ */

function ActivityTab({ data }: { data: Application360 }) {
  const { activity } = data;
  const { can } = useRecruitment();

  if (!can("view_timeline")) {
    return (
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-20 text-center shadow-sm">
        <Shield className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-zinc-800">Timeline Restricted</h3>
        <p className="mt-1 text-xs text-zinc-500">Your organization role does not have permission to view candidate audit logs.</p>
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-200/80 bg-white p-20 text-center shadow-sm">
        <Clock className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
        <h3 className="text-base font-bold text-zinc-800">No Activity Logged</h3>
        <p className="mt-1 text-xs text-zinc-500">Stage changes, automated scans, and screening events will record an audit trail here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-zinc-200/80 bg-white p-8 shadow-sm space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600">
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-zinc-900">Audit & Decision Trail</h3>
          <p className="text-xs text-zinc-400">{activity.length} verified lifecycle events recorded</p>
        </div>
      </div>
      <div className="pt-2">
        {activity.map((event) => (
          <TimelineEvent key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE CONTROLLER
   ═══════════════════════════════════════════════════════════ */

export default function CandidateDetailPage() {
  const params = useParams<{ jobId: string; appId: string }>();
  const { jobId, appId } = params;
  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    getApplication360(appId)
      .then((data) => !cancelled && setLoaded({ data }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => { cancelled = true; };
  }, [appId, refresh]);

  const handleStageChange = async (target: Stage) => {
    await setStage(appId, target);
    reload();
  };

  if (loaded === null) {
    return (
      <div className="space-y-6 animate-pulse">
        <Skeleton className="h-10 w-96 rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-3xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-3xl" />
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-32 rounded-3xl" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-32 rounded-3xl" />
              <Skeleton className="h-32 rounded-3xl" />
              <Skeleton className="h-32 rounded-3xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" onClick={reload}>Try again</Button>
      </div>
    );
  }

  const { data } = loaded;
  const candidateName = data.candidate.name || "Unnamed Candidate";
  const matchScore = data.application.scores.match_score?.value;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
        <Link href="/recruitment" className="hover:text-indigo-600 transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Jobs
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
        <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-indigo-600 transition-colors">
          {data.job?.title || "Job Workspace"}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-300" />
        <span className="text-zinc-900 font-bold">{candidateName}</span>
      </div>

      {/* Candidate 360 Hero Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 shadow-xl shadow-zinc-900/5">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-50/50 via-white to-violet-50/30 pointer-events-none" />

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-5">
            {/* Avatar with gradient glow */}
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 text-2xl font-black text-white shadow-lg shadow-indigo-600/30">
                {initials(candidateName)}
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-2 ring-white">
                <span className="h-4 w-4 rounded-full bg-emerald-500" />
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900">
                  {candidateName}
                </h1>
                <StageBadge stage={data.application.stage} />
                <AnalysisIndicator
                  status={data.application.analysis.analysis_status}
                  error={data.application.analysis.analysis_error}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 font-medium">
                {data.candidate.current_role && (
                  <span className="flex items-center gap-1.5 font-bold text-zinc-800">
                    <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
                    {data.candidate.current_role}
                  </span>
                )}
                {data.candidate.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-zinc-400" />
                    {data.candidate.email}
                  </span>
                )}
                {data.candidate.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                    {data.candidate.location}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right match score radial preview & quick actions */}
          <div className="flex items-center gap-4">
            {matchScore !== null && matchScore !== undefined && (
              <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 backdrop-blur-md px-4 py-3 shadow-xs">
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Match Fit</div>
                  <div className="text-xs font-semibold text-zinc-600">AI Confidence</div>
                </div>
                <div className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl font-black text-base shadow-sm",
                  matchScore >= 75
                    ? "bg-emerald-500 text-white shadow-emerald-500/20"
                    : matchScore >= 50
                    ? "bg-indigo-600 text-white shadow-indigo-600/20"
                    : "bg-amber-500 text-white shadow-amber-500/20"
                )}>
                  {matchScore}%
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              className="border-zinc-200 hover:bg-zinc-50 font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap gap-1.5 rounded-2xl bg-zinc-100/80 p-1.5 border border-zinc-200/60 backdrop-blur-md">
          <TabsTrigger value="overview" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Overview
          </TabsTrigger>
          <TabsTrigger value="analysis" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            AI Analysis
          </TabsTrigger>
          <TabsTrigger value="screening" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Voice Screening
          </TabsTrigger>
          <TabsTrigger value="interviews" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Interviews ({data.interviews.length})
          </TabsTrigger>
          <TabsTrigger value="offers" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Offers ({data.offers?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="resume" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Resume
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded-xl px-4 py-2 text-xs font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm">
            Activity Trail ({data.activity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="animate-in fade-in-50 duration-200">
          <OverviewTab data={data} onStageChange={handleStageChange} onReload={reload} />
        </TabsContent>
        <TabsContent value="analysis" className="animate-in fade-in-50 duration-200">
          <AnalysisTab data={data} />
        </TabsContent>
        <TabsContent value="screening" className="animate-in fade-in-50 duration-200">
          <ScreeningTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="interviews" className="animate-in fade-in-50 duration-200">
          <InterviewsTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="offers" className="animate-in fade-in-50 duration-200">
          <OffersTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="resume" className="animate-in fade-in-50 duration-200">
          <ResumeTab data={data} />
        </TabsContent>
        <TabsContent value="activity" className="animate-in fade-in-50 duration-200">
          <ActivityTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
