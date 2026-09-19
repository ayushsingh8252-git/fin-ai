"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Brain, ChevronRight, Clock, ExternalLink, FileText,
  Loader2, MapPin, Mail, Phone, RefreshCw, Shield, Star, User,
  CheckCircle2, XCircle, AlertTriangle, Briefcase,
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

  const barFill = degraded
    ? "bg-amber-500"
    : accent === "emerald"
    ? "bg-emerald-600"
    : accent === "indigo"
    ? "bg-zinc-800"
    : "bg-amber-500";

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-zinc-600">
          {icon}
        </div>
      </div>

      {computed || degraded ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", degraded ? "text-amber-700" : "text-zinc-900")}>
              {value}%
            </span>
            {degraded && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                Estimated
              </span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className={cn("h-full rounded-full transition-all duration-300", barFill)}
              style={{ width: `${Math.min(100, Math.max(0, value!))}%` }}
            />
          </div>
          {degraded && score.reason && (
            <p className="text-[11px] text-amber-700 leading-tight">{score.reason}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-2xl font-semibold text-zinc-300">—</span>
          <span className="text-xs text-zinc-400 font-normal">{score.reason || "Pending calculation"}</span>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-zinc-100 last:border-0">
      <span className="mt-0.5 text-zinc-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-xs font-medium text-zinc-800 break-words mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function SkillTag({ skill, tone }: { skill: string; tone: "matched" | "missing" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium",
      tone === "matched"
        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
        : "bg-red-50 text-red-700 border border-red-200",
    )}>
      {tone === "matched" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" /> : <XCircle className="h-3 w-3 text-red-500" />}
      {skill}
    </span>
  );
}

function TimelineEvent({ event }: { event: ActivityEvent }) {
  const icon = event.actor_type === "ai"
    ? <Brain className="h-3.5 w-3.5 text-zinc-700" />
    : event.actor_type === "hr"
    ? <User className="h-3.5 w-3.5 text-zinc-700" />
    : <Clock className="h-3.5 w-3.5 text-zinc-400" />;

  const actorLabel = event.actor_type === "ai" ? "Automated Model" : event.actor_type === "hr" ? "Recruiter / HR" : "System";
  const time = event.created_at ? new Date(event.created_at) : null;
  const payload = event.payload || {};

  return (
    <div className="group relative flex gap-3.5 pb-5 last:pb-0">
      <div className="absolute left-[13px] top-7 bottom-0 w-px bg-zinc-200 group-last:hidden" />
      <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white shadow-2xs">
        {icon}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-xs font-semibold text-zinc-900">{event.summary}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <span className="rounded bg-zinc-100 px-1.5 py-0.2 font-medium text-zinc-600">{actorLabel}</span>
          {time && (
            <span>
              {time.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {Boolean(payload.from && payload.to) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
              {STAGE_LABEL[payload.from as Stage] || String(payload.from)}
            </span>
            <ChevronRight className="h-3 w-3 text-zinc-300" />
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-900 border border-zinc-200">
              {STAGE_LABEL[payload.to as Stage] || String(payload.to)}
            </span>
          </div>
        )}
        {Boolean(payload.reason) && (
          <p className="mt-1 text-xs text-zinc-600 italic bg-zinc-50 p-2 rounded-md border border-zinc-100">
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
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Profile & Document Integrity Column */}
      <div className="lg:col-span-1 space-y-5">
        {/* Candidate Profile Details */}
        <div className="rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
            Candidate Information
          </h3>

          <div className="space-y-0.5">
            <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email Address" value={candidate.email} />
            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={candidate.phone} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={candidate.location} />
            <InfoRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Experience Summary" value={candidate.experience_text} />
          </div>

          {candidate.skills.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                Skills ({candidate.skills.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {candidate.skills.slice(0, 16).map((s) => (
                  <span key={s} className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                    {s}
                  </span>
                ))}
                {candidate.skills.length > 16 && (
                  <span className="rounded bg-zinc-50 px-1.5 py-0.5 text-xs font-normal text-zinc-400">
                    +{candidate.skills.length - 16} more
                  </span>
                )}
              </div>
            </div>
          )}

          {candidate.has_resume && (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-md border-zinc-200 hover:bg-zinc-50 text-xs font-medium"
                onClick={() => openResume(candidate.id)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-zinc-500" />
                Download Original Resume
              </Button>
            </div>
          )}
        </div>

        {/* Fraud / Document Integrity Card */}
        <div className="rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("p-1.5 rounded-md", isSuspicious ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
                {isSuspicious ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-zinc-900">Document Integrity</h3>
                <p className="text-[10px] text-zinc-400">Tampering & credential check</p>
              </div>
            </div>
            {fraud ? (
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium uppercase",
                  fraud.status === "complete"
                    ? isSuspicious
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                )}
              >
                {fraud.status === "complete" ? (isSuspicious ? "Anomaly Flagged" : "Verified Clean") : fraud.status}
              </span>
            ) : (
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                Not Scanned
              </span>
            )}
          </div>

          {fraud ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 text-xs">
                <span className="text-zinc-500">Scan Status:</span>
                <span className="font-medium text-zinc-800 capitalize">{fraud.status}</span>
              </div>
              {fraud.status === "complete" && (
                <>
                  <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 text-xs">
                    <span className="text-zinc-500">Integrity Risk:</span>
                    <span className={cn("font-medium", isSuspicious ? "text-red-600" : "text-emerald-700")}>
                      {isSuspicious ? "Discrepancies Detected" : "Authentic Document"}
                    </span>
                  </div>
                  {Array.isArray(fraudResult.flags) && fraudResult.flags.length > 0 && (
                    <div className="pt-1.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-red-600 mb-1.5">Detected Flags:</p>
                      <ul className="space-y-1.5">
                        {fraudResult.flags.map((flag: unknown, idx: number) => (
                          <li key={idx} className="text-xs text-red-700 bg-red-50 rounded-md p-2 flex items-start gap-1.5 border border-red-100">
                            <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                            <span className="leading-snug">{String(flag)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {fraud.created_at && (
                <p className="text-[11px] text-zinc-400 pt-0.5">
                  Scanned on {new Date(fraud.created_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 text-xs text-zinc-500 pt-1">
              <p className="leading-relaxed font-normal">
                Scans for hidden keyword stuffing, altered dates, and credential discrepancies.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-md text-xs font-medium border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                disabled={scanningFraud || !candidate.has_resume}
                onClick={handleRunFraud}
              >
                {scanningFraud ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Shield className="h-3.5 w-3.5 mr-1.5 text-zinc-500" />}
                Run Integrity Scan
              </Button>
            </div>
          )}
          {fraudError && <ErrorBanner message={fraudError} className="mt-2" />}
        </div>
      </div>

      {/* Main Scoring & Stage Column */}
      <div className="space-y-5 lg:col-span-2">
        {/* Stage Progression Action Bar */}
        <div className="rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-500 mb-1">Current Stage</p>
              <StageBadge stage={application.stage} />
            </div>
            {job && (
              <div className="text-right">
                <p className="text-xs font-medium text-zinc-500 mb-1">Position</p>
                <p className="text-xs font-semibold text-zinc-900">{job.title}</p>
                {job.department && <p className="text-[11px] text-zinc-500">{job.department}</p>}
              </div>
            )}
          </div>

          {canDecide && nextStages.length > 0 && (
            <div className="pt-3 border-t border-zinc-100">
              <p className="text-xs font-medium text-zinc-500 mb-2">
                Advance Candidate:
              </p>
              <div className="flex flex-wrap gap-2">
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
                        "h-8 rounded-md text-xs font-medium transition-colors",
                        isHire && "bg-emerald-600 hover:bg-emerald-700 text-white"
                      )}
                    >
                      {stageLoading === s ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      {STAGE_LABEL[s]}
                    </Button>
                  );
                })}
              </div>
              {stageError && <ErrorBanner message={stageError} className="mt-2" />}
            </div>
          )}
        </div>

        {/* 3 High-Impact Score Gauges */}
        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreCard
            label="ATS Keyword Match"
            score={application.scores.ats_score}
            icon={<Star className="h-3.5 w-3.5" />}
            accent="amber"
          />
          <ScoreCard
            label="JD Semantic Fit"
            score={application.scores.match_score}
            icon={<Brain className="h-3.5 w-3.5" />}
            accent="indigo"
          />
          <ScoreCard
            label="Required Skills Match"
            score={application.scores.skill_match_score}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            accent="emerald"
          />
        </div>

        {/* AI Evaluation Summary */}
        {application.analysis.ai_summary && (
          <div className="rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-100 text-zinc-700">
                  <Brain className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-zinc-900">Automated Evaluation Summary</h3>
                  <p className="text-[11px] text-zinc-400">Semantic requirement mapping</p>
                </div>
              </div>
              <AnalysisIndicator status={application.analysis.analysis_status} error={application.analysis.analysis_error} />
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed font-normal whitespace-pre-wrap bg-zinc-50 p-3.5 rounded-md border border-zinc-100">
              {application.analysis.ai_summary}
            </p>

            {application.analysis.recommendation && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs font-medium text-zinc-500">Guidance Recommendation:</span>
                <span className="rounded bg-zinc-100 text-zinc-800 px-2 py-0.5 text-xs font-medium border border-zinc-200">
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
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
              <Brain className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                {matchScore.value !== null ? `Match Reasoning: ${matchScore.value}% Confidence` : "JD Requirement Mapping"}
              </h3>
              <p className="text-xs text-zinc-400">Requirement cross-verification</p>
            </div>
          </div>
          {matchScore.status === "degraded" && (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
              Keyword Estimation
            </span>
          )}
        </div>

        {matched.length === 0 && missing.length === 0 ? (
          <div className="rounded-md bg-zinc-50 p-6 text-center text-xs text-zinc-500">
            No specific skills mapping available for this candidate.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {matched.length > 0 && (
              <div className="rounded-md border border-zinc-200 bg-zinc-50/50 p-4 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Verified Matched Skills ({matched.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {matched.map((s) => <SkillTag key={s} skill={s} tone="matched" />)}
                </div>
              </div>
            )}
            {missing.length > 0 && (
              <div className="rounded-md border border-zinc-200 bg-zinc-50/50 p-4 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  Skill Gaps / Missing ({missing.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((s) => <SkillTag key={s} skill={s} tone="missing" />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-xs space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Scoring Transparency & Provenance</h3>
          <p className="text-xs text-zinc-400">Models and heuristics used to calculate candidate score percentiles</p>
        </div>
        <div className="divide-y divide-zinc-100">
          {(["ats_score", "match_score", "skill_match_score"] as const).map((key) => {
            const s = application.scores[key];
            return (
              <div key={key} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-800">
                    {key === "ats_score" ? "ATS Keyword Relevance" : key === "match_score" ? "JD Semantic Fit" : "Skill Coverage Score"}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Source: {s.source || "Automated Match Engine"} · State: {s.status}
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
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
              <Video className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Candidate Voice Screening</h3>
              <p className="text-xs text-zinc-400">Interactive voice pre-qualification round</p>
            </div>
          </div>
          {screening ? (
            <StatusPill tone={screening.session_status === "completed" ? "success" : "warning"}>
              {screening.session_status}
            </StatusPill>
          ) : (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              Not Yet Invited
            </span>
          )}
        </div>

        {screening ? (
          <div className="space-y-4">
            <div className="rounded-md bg-zinc-50 border border-zinc-200 p-3.5 space-y-2">
              <p className="text-xs font-medium text-zinc-700">Screening Session Link</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={interviewLink || ""}
                  className="flex-1 h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-xs text-zinc-700 font-mono select-all focus:outline-none"
                />
                <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-8 rounded-md text-xs font-medium">
                  {copied ? <Check className="h-3 w-3 text-emerald-600 mr-1" /> : <Copy className="h-3 w-3 mr-1 text-zinc-500" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                {interviewLink && (
                  <a
                    href={interviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open Session
                  </a>
                )}
              </div>
            </div>

            {/* Results */}
            {screening.results && screening.results.length > 0 ? (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Screening Evaluation</h4>
                {screening.results.map((res) => (
                  <div key={res.id} className="rounded-md border border-zinc-200 p-4 space-y-3 bg-zinc-50/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-zinc-600" />
                        <span className="text-xs font-semibold text-zinc-800">Verdict:</span>
                        <StatusPill tone={res.verdict?.toLowerCase().includes("recommend") ? "success" : "warning"}>
                          {res.verdict || "Under Review"}
                        </StatusPill>
                      </div>
                      {res.jd_match_score !== null && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900">
                          <span>Match Score:</span>
                          <span>{res.jd_match_score}%</span>
                        </div>
                      )}
                    </div>

                    {res.summary && (
                      <p className="text-xs text-zinc-600 leading-relaxed font-normal">{res.summary}</p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 pt-1">
                      {res.strengths && res.strengths.length > 0 && (
                        <div className="rounded-md bg-emerald-50/50 p-3 border border-emerald-100">
                          <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5 mb-1.5">
                            <ThumbsUp className="h-3 w-3 text-emerald-600" /> Key Strengths
                          </p>
                          <ul className="space-y-0.5">
                            {res.strengths.map((str, i) => (
                              <li key={i} className="text-xs text-emerald-700">• {str}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {res.gaps && res.gaps.length > 0 && (
                        <div className="rounded-md bg-amber-50/50 p-3 border border-amber-100">
                          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 mb-1.5">
                            <ThumbsDown className="h-3 w-3 text-amber-600" /> Areas to Probe
                          </p>
                          <ul className="space-y-0.5">
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
              <div className="rounded-md bg-zinc-50 p-6 text-center text-xs text-zinc-500">
                Screening session initialized. Evaluation and transcript will appear once candidate completes the call.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
              <Video className="h-5 w-5" />
            </div>
            <div className="max-w-md mx-auto">
              <h4 className="text-sm font-semibold text-zinc-900">Invite candidate to Voice Screening</h4>
              <p className="mt-0.5 text-xs text-zinc-500">
                Sends an automated screening invitation that evaluates the candidate on role competencies.
              </p>
            </div>
            <Button
              disabled={inviting || !candidate.email}
              onClick={handleInvite}
              className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
            >
              {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send Screening Invitation
            </Button>
            {!candidate.email && (
              <p className="text-xs text-red-500 font-medium">Candidate must have an email address to receive an invitation.</p>
            )}
          </div>
        )}
        {error && <ErrorBanner message={error} className="mt-3" />}
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Interviews & Video Rounds</h3>
          <p className="text-xs text-zinc-500">Coordinate team interviews with Google Meet video rooms</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowSchedule(!showSchedule)}
          className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Schedule Interview
        </Button>
      </div>

      {showSchedule && (
        <form onSubmit={handleSchedule} className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">Schedule Interview</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Format</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2 text-xs focus:border-zinc-900 focus:outline-none"
              >
                <option value="human">Video Call (Google Meet)</option>
                <option value="telephonic">Telephonic Interview</option>
                <option value="ai_screening">Automated Pre-Screen</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1">Interviewer Email</label>
              <input
                type="email"
                placeholder="interviewer@company.com"
                value={interviewerEmail}
                onChange={(e) => setInterviewerEmail(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)} className="h-8 rounded-md text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Calendar className="h-3.5 w-3.5 mr-1" />}
              Confirm Schedule
            </Button>
          </div>
        </form>
      )}

      {interviews.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-10 text-center shadow-xs">
          <Calendar className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
          <h4 className="text-xs font-semibold text-zinc-800">No interviews scheduled</h4>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-sm mx-auto">
            Schedule an interview above to generate calendar invitations and video conferencing links.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {interviews.map((iv: InterviewInfo) => (
            <div key={iv.id} className="rounded-lg border border-zinc-200/80 bg-white p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Video className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="text-xs font-semibold text-zinc-900 capitalize">{iv.mode} Interview</span>
                  <StatusPill tone={iv.status === "completed" ? "success" : "warning"}>{iv.status}</StatusPill>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  {iv.scheduled_at && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(iv.scheduled_at).toLocaleString()}
                    </span>
                  )}
                  {iv.interviewer_email && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
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
                  className="inline-flex items-center gap-1 h-7 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 shadow-2xs hover:bg-zinc-50"
                >
                  <ExternalLink className="h-3 w-3 text-zinc-500" />
                  Join Meeting
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Job Offers & Terms</h3>
          <p className="text-xs text-zinc-500">Formal compensation packages and candidate acceptance tracking</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Create Offer
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">Extend Job Offer</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Annual Base Salary</label>
              <input
                type="number"
                placeholder="140000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2 text-xs focus:border-zinc-900 focus:outline-none"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Equity Grant</label>
              <input
                type="text"
                placeholder="0.25% or 5,000 RSUs"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Target Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1">Notes / Bonus</label>
              <input
                type="text"
                placeholder="e.g. $10k sign-on, 30 days notice"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full h-8 rounded-md border border-zinc-200 px-2.5 text-xs focus:border-zinc-900 focus:outline-none"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} className="h-8 rounded-md text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
              Generate Offer
            </Button>
          </div>
        </form>
      )}

      {offers.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-10 text-center shadow-xs">
          <DollarSign className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
          <h4 className="text-xs font-semibold text-zinc-800">No offers generated yet</h4>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-sm mx-auto">
            Extend an official offer package to initiate compensation tracking.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer: OfferInfo) => (
            <div key={offer.id} className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-zinc-100">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900">{offer.role_title || "Job Offer"}</h4>
                  <p className="text-[11px] text-zinc-400">Issued {offer.created_at ? new Date(offer.created_at).toLocaleDateString() : "Recently"}</p>
                </div>
                <StatusPill tone={offer.status === "accepted" ? "success" : offer.status === "rejected" ? "danger" : offer.status === "sent" ? "warning" : "neutral"}>
                  {offer.status.toUpperCase()}
                </StatusPill>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div className="rounded bg-zinc-50 p-2.5 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase font-medium">Base Salary</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5 tabular-nums">{offer.currency} {offer.salary ? offer.salary.toLocaleString() : "—"}</p>
                </div>
                <div className="rounded bg-zinc-50 p-2.5 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase font-medium">Equity</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{offer.equity || "None"}</p>
                </div>
                <div className="rounded bg-zinc-50 p-2.5 border border-zinc-100">
                  <p className="text-[10px] text-zinc-400 uppercase font-medium">Start Date</p>
                  <p className="text-sm font-semibold text-zinc-900 mt-0.5">{offer.start_date || "Flexible"}</p>
                </div>
              </div>

              {offer.notes && (
                <p className="text-xs text-zinc-600 bg-zinc-50 p-2.5 rounded italic">
                  &ldquo;{offer.notes}&rdquo;
                </p>
              )}

              {offer.status !== "accepted" && offer.status !== "rejected" && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
                  <span className="text-xs text-zinc-500 font-normal mr-1">Action:</span>
                  {offer.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === offer.id}
                      onClick={() => handleStatusChange(offer.id, "sent")}
                      className="h-7 rounded-md text-xs font-medium"
                    >
                      <Send className="h-3 w-3 mr-1 text-zinc-500" />
                      Mark Sent
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-medium text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "accepted")}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" />
                    Accept Offer & Hire
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-xs font-medium text-red-700 hover:bg-red-50 border-red-200"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "rejected")}
                  >
                    <XCircle className="h-3 w-3 mr-1 text-red-600" />
                    Decline
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
      <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center shadow-xs">
        <FileText className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-zinc-800">No Resume Document Available</h3>
        <p className="mt-0.5 text-xs text-zinc-500">This applicant does not have a stored resume PDF.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-zinc-900">{candidate.resume_filename || "Candidate_Resume.pdf"}</h3>
            <p className="text-[10px] text-zinc-400">PDF document</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => openResume(candidate.id)} className="h-8 rounded-md text-xs font-medium">
          <ExternalLink className="h-3.5 w-3.5 mr-1 text-zinc-500" />
          Open PDF in New Window
        </Button>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-10 shadow-xs text-center space-y-3">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-semibold text-zinc-900">Document Review</h4>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-sm mx-auto">
            Review the uploaded original resume PDF for full candidate credentials and history.
          </p>
        </div>
        <Button
          onClick={() => openResume(candidate.id)}
          className="h-8 rounded-md bg-zinc-900 text-xs font-medium text-white hover:bg-zinc-800"
        >
          <Eye className="h-3.5 w-3.5 mr-1.5" />
          View PDF Resume
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
      <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center shadow-xs">
        <Shield className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-zinc-800">Timeline Restricted</h3>
        <p className="mt-0.5 text-xs text-zinc-500">Your role does not have permission to view candidate audit logs.</p>
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-12 text-center shadow-xs">
        <Clock className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
        <h3 className="text-sm font-semibold text-zinc-800">No Activity Logged</h3>
        <p className="mt-0.5 text-xs text-zinc-500">Stage transitions and evaluation events will record an audit trail here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white p-5 shadow-xs space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
          <Activity className="h-3.5 w-3.5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Decision & Event Audit Trail</h3>
          <p className="text-xs text-zinc-400">{activity.length} recorded lifecycle events</p>
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
      <div className="space-y-4 animate-pulse">
        <Skeleton className="h-5 w-60 rounded" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-lg" />
          <div className="lg:col-span-2 space-y-3">
            <Skeleton className="h-24 rounded-lg" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-24 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="space-y-3 py-8 max-w-md">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="h-8 rounded-md text-xs">Try again</Button>
      </div>
    );
  }

  const { data } = loaded;
  const candidateName = data.candidate.name || "Unnamed Candidate";
  const matchScore = data.application.scores.match_score?.value;

  return (
    <div className="space-y-5">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-normal">
        <Link href="/recruitment" className="hover:text-zinc-900 transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />
          Positions
        </Link>
        <ChevronRight className="h-3 w-3 text-zinc-300" />
        <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-zinc-900 transition-colors">
          {data.job?.title || "Role Workspace"}
        </Link>
        <ChevronRight className="h-3 w-3 text-zinc-300" />
        <span className="text-zinc-900 font-medium">{candidateName}</span>
      </div>

      {/* Candidate Profile Header Card */}
      <div className="rounded-lg border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Avatar */}
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white shadow-2xs">
              {initials(candidateName)}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-lg sm:text-xl font-semibold tracking-tight text-zinc-900">
                  {candidateName}
                </h1>
                <StageBadge stage={data.application.stage} />
                <AnalysisIndicator
                  status={data.application.analysis.analysis_status}
                  error={data.application.analysis.analysis_error}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 font-normal">
                {data.candidate.current_role && (
                  <span className="flex items-center gap-1 font-medium text-zinc-700">
                    <Briefcase className="h-3 w-3 text-zinc-400" />
                    {data.candidate.current_role}
                  </span>
                )}
                {data.candidate.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3 text-zinc-400" />
                    {data.candidate.email}
                  </span>
                )}
                {data.candidate.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-zinc-400" />
                    {data.candidate.location}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right match score & refresh */}
          <div className="flex items-center gap-3">
            {matchScore !== null && matchScore !== undefined && (
              <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5">
                <span className="text-[11px] text-zinc-500 font-medium">Match Fit:</span>
                <span className={cn(
                  "text-sm font-semibold tabular-nums",
                  matchScore >= 75 ? "text-emerald-700" : matchScore >= 50 ? "text-zinc-900" : "text-amber-700"
                )}>
                  {matchScore}%
                </span>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              className="h-8 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <RefreshCw className="h-3 w-3 mr-1 text-zinc-500" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1 rounded-md bg-zinc-100/70 p-1 border border-zinc-200/60">
          <TabsTrigger value="overview" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="analysis" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Evaluation
          </TabsTrigger>
          <TabsTrigger value="screening" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Voice Screening
          </TabsTrigger>
          <TabsTrigger value="interviews" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Interviews ({data.interviews.length})
          </TabsTrigger>
          <TabsTrigger value="offers" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Offers ({data.offers?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="resume" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Resume PDF
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-zinc-900 data-[state=active]:shadow-2xs">
            Audit Trail ({data.activity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} onStageChange={handleStageChange} onReload={reload} />
        </TabsContent>
        <TabsContent value="analysis">
          <AnalysisTab data={data} />
        </TabsContent>
        <TabsContent value="screening">
          <ScreeningTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="interviews">
          <InterviewsTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="offers">
          <OffersTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="resume">
          <ResumeTab data={data} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
