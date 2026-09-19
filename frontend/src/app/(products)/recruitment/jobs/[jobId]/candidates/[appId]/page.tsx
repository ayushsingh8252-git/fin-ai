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

function ScoreCard({ label, score, icon }: { label: string; score: Score; icon: React.ReactNode }) {
  const computed = score.status === "computed" && score.value !== null;
  const degraded = score.status === "degraded" && score.value !== null;
  const value = score.value;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        {icon}
        {label}
      </div>
      {computed || degraded ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className={cn("text-3xl font-bold tabular-nums", degraded ? "text-amber-700" : "text-zinc-900")}>
              {value}%
            </span>
            {degraded && (
              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                Estimated
              </span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
            <div
              className={cn("h-full rounded-full transition-all", degraded ? "bg-amber-400" : score.value! >= 70 ? "bg-emerald-500" : score.value! >= 40 ? "bg-blue-500" : "bg-red-400")}
              style={{ width: `${Math.min(100, value!)}%` }}
            />
          </div>
          {degraded && score.reason && (
            <p className="mt-1 text-[11px] text-amber-600">{score.reason}</p>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold text-zinc-300">—</span>
          <span className="text-xs text-zinc-400">{score.reason || "Not computed"}</span>
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 text-zinc-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-zinc-800 break-words">{value}</p>
      </div>
    </div>
  );
}

function SkillTag({ skill, tone }: { skill: string; tone: "matched" | "missing" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
      tone === "matched" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-red-50 text-red-700 ring-1 ring-red-200",
    )}>
      {tone === "matched" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {skill}
    </span>
  );
}

function TimelineEvent({ event }: { event: ActivityEvent }) {
  const icon = event.actor_type === "ai"
    ? <Sparkles className="h-3.5 w-3.5 text-violet-600" />
    : event.actor_type === "hr"
    ? <User className="h-3.5 w-3.5 text-blue-600" />
    : <Clock className="h-3.5 w-3.5 text-zinc-400" />;

  const actorLabel = event.actor_type === "ai" ? "AI Engine" : event.actor_type === "hr" ? "HR Member" : "System";
  const time = event.created_at ? new Date(event.created_at) : null;
  const payload = event.payload || {};

  return (
    <div className="group relative flex gap-3 pb-6 last:pb-0">
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-zinc-200 group-last:hidden" />
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-sm">
        {icon}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm text-zinc-800">{event.summary}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
          <StatusPill tone="neutral">{actorLabel}</StatusPill>
          {time && <span>{time.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
        {Boolean(payload.from && payload.to) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
            <StatusPill tone="neutral">{STAGE_LABEL[payload.from as Stage] || String(payload.from)}</StatusPill>
            <ChevronRight className="h-3 w-3 text-zinc-300" />
            <StatusPill tone="neutral">{STAGE_LABEL[payload.to as Stage] || String(payload.to)}</StatusPill>
          </div>
        )}
        {Boolean(payload.reason) && (
          <p className="mt-1 text-xs text-zinc-500 italic">&ldquo;{String(payload.reason)}&rdquo;</p>
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
      {/* Profile Card */}
      <div className="lg:col-span-1 space-y-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4 mb-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-lg font-bold text-white shadow-md">
              {initials(candidate.name)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-zinc-900">{candidate.name || "Unnamed Candidate"}</h2>
              {candidate.current_role && <p className="text-sm text-zinc-500">{candidate.current_role}</p>}
            </div>
          </div>

          <div className="space-y-1 border-t border-zinc-100 pt-4">
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={candidate.email} />
            <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={candidate.phone} />
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Location" value={candidate.location} />
            <InfoRow icon={<Briefcase className="h-4 w-4" />} label="Experience" value={candidate.experience_text} />
          </div>

          {candidate.skills.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <p className="mb-2 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.slice(0, 15).map((s) => (
                  <span key={s} className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">{s}</span>
                ))}
                {candidate.skills.length > 15 && (
                  <span className="rounded-full bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-400">+{candidate.skills.length - 15}</span>
                )}
              </div>
            </div>
          )}

          {candidate.has_resume && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <Button
                variant="outline" size="sm" className="w-full"
                onClick={() => openResume(candidate.id)}
              >
                <Download className="h-3.5 w-3.5" />
                Download Resume
              </Button>
            </div>
          )}
        </div>

        {/* Fraud / Document Integrity Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-600" />
              <h3 className="text-sm font-bold text-zinc-900">Document Integrity</h3>
            </div>
            {fraud ? (
              <StatusPill tone={fraud.status === "complete" ? (isSuspicious ? "danger" : "success") : "warning"}>
                {fraud.status === "complete" ? (isSuspicious ? "Flags Found" : "Clean") : fraud.status}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">Not Scanned</StatusPill>
            )}
          </div>

          {fraud ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-zinc-100 text-xs">
                <span className="text-zinc-500">Scan Status:</span>
                <span className="font-semibold text-zinc-800 capitalize">{fraud.status}</span>
              </div>
              {fraud.status === "complete" && (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-zinc-100 text-xs">
                    <span className="text-zinc-500">Integrity Assessment:</span>
                    <span className={cn("font-semibold flex items-center gap-1", isSuspicious ? "text-red-600" : "text-emerald-600")}>
                      {isSuspicious ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {isSuspicious ? "Review Recommended" : "Authentic Document"}
                    </span>
                  </div>
                  {Array.isArray(fraudResult.flags) && fraudResult.flags.length > 0 && (
                    <div className="pt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-red-600 mb-1.5">Anomaly Flags:</p>
                      <ul className="space-y-1">
                        {fraudResult.flags.map((flag: unknown, idx: number) => (
                          <li key={idx} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1 flex items-start gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                            <span>{String(flag)}</span>
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
            <div className="space-y-3 text-xs text-zinc-500">
              <p>Multi-signal analysis checks for resume tampering, duplicate identities, white text, and prompt injections.</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={scanningFraud || !candidate.has_resume}
                onClick={handleRunFraud}
              >
                {scanningFraud ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                Run Integrity Scan
              </Button>
            </div>
          )}
          {fraudError && <ErrorBanner message={fraudError} className="mt-3" />}
        </div>
      </div>

      {/* Main Column */}
      <div className="space-y-6 lg:col-span-2">
        {/* Stage + actions */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Pipeline Stage</p>
              <StageBadge stage={application.stage} />
            </div>
            {job && (
              <div className="text-right">
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Applying for</p>
                <p className="text-sm font-semibold text-zinc-800">{job.title}</p>
                {job.department && <p className="text-xs text-zinc-500">{job.department}</p>}
              </div>
            )}
          </div>

          {canDecide && nextStages.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <p className="mb-2.5 text-xs font-medium text-zinc-500">Move candidate to next stage:</p>
              <div className="flex flex-wrap gap-2">
                {nextStages.map((s: Stage) => {
                  const isReject = s === "REJECTED" || s === "WITHDRAWN";
                  return (
                    <Button
                      key={s}
                      variant={isReject ? "destructive" : "outline"}
                      size="sm"
                      disabled={stageLoading !== null}
                      onClick={() => handleStage(s)}
                    >
                      {stageLoading === s ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {STAGE_LABEL[s]}
                    </Button>
                  );
                })}
              </div>
              {stageError && <ErrorBanner message={stageError} className="mt-3" />}
            </div>
          )}
        </div>

        {/* Score cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <ScoreCard label="ATS Score" score={application.scores.ats_score} icon={<Star className="h-3.5 w-3.5 text-amber-500" />} />
          <ScoreCard label="JD Match" score={application.scores.match_score} icon={<Brain className="h-3.5 w-3.5 text-blue-500" />} />
          <ScoreCard label="Skill Match" score={application.scores.skill_match_score} icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />} />
        </div>

        {/* AI Summary */}
        {application.analysis.ai_summary && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-violet-500" />
              <p className="text-sm font-semibold text-zinc-800">AI Evaluation Summary</p>
              <AnalysisIndicator status={application.analysis.analysis_status} error={application.analysis.analysis_error} />
            </div>
            <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">{application.analysis.ai_summary}</p>
            {application.analysis.recommendation && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500">Recommendation:</span>
                <StatusPill tone={application.analysis.recommendation.toLowerCase().includes("strong") ? "success" : "neutral"}>
                  {application.analysis.recommendation}
                </StatusPill>
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
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="h-5 w-5 text-blue-600" />
          <h3 className="text-base font-bold text-zinc-900">
            {matchScore.value !== null ? `Why ${matchScore.value}% match?` : "JD Match Analysis"}
          </h3>
          {matchScore.status === "degraded" && (
            <StatusPill tone="warning">Estimated without AI</StatusPill>
          )}
        </div>

        {matched.length === 0 && missing.length === 0 ? (
          <p className="text-sm text-zinc-500">No skill comparison data is available for this candidate.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {matched.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  Matched Skills ({matched.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {matched.map((s) => <SkillTag key={s} skill={s} tone="matched" />)}
                </div>
              </div>
            )}
            {missing.length > 0 && (
              <div>
                <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                  <XCircle className="h-4 w-4" />
                  Missing Skills ({missing.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {missing.map((s) => <SkillTag key={s} skill={s} tone="missing" />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-bold text-zinc-900">Score Provenance & Transparency</h3>
        <div className="divide-y divide-zinc-100">
          {(["ats_score", "match_score", "skill_match_score"] as const).map((key) => {
            const s = application.scores[key];
            return (
              <div key={key} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-700">
                    {key === "ats_score" ? "ATS Score" : key === "match_score" ? "JD Match Score" : "Skill Match Score"}
                  </p>
                  <p className="text-xs text-zinc-400">
                    Source: {s.source || "System"} · Status: {s.status}
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
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-bold text-zinc-900">Interactive AI Screening Interview</h3>
          </div>
          {screening ? (
            <StatusPill tone={screening.session_status === "completed" ? "success" : "warning"}>
              {screening.session_status}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">Not Invited</StatusPill>
          )}
        </div>

        {screening ? (
          <div className="space-y-5">
            <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Interview Session Link</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={interviewLink || ""}
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 font-mono select-all focus:outline-none"
                />
                <Button variant="outline" size="sm" onClick={handleCopyLink}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                {interviewLink && (
                  <a
                    href={interviewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </a>
                )}
              </div>
            </div>

            {/* Results */}
            {screening.results && screening.results.length > 0 ? (
              <div className="space-y-4 pt-2">
                <h4 className="text-sm font-bold text-zinc-800">Screening Evaluation Results</h4>
                {screening.results.map((res) => (
                  <div key={res.id} className="rounded-xl border border-zinc-200 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-indigo-600" />
                        <span className="text-sm font-semibold text-zinc-800">Verdict:</span>
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
                      <p className="text-sm text-zinc-600 leading-relaxed">{res.summary}</p>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 pt-2">
                      {res.strengths && res.strengths.length > 0 && (
                        <div className="rounded-lg bg-emerald-50/50 p-3 border border-emerald-100">
                          <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1 mb-2">
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
                        <div className="rounded-lg bg-amber-50/50 p-3 border border-amber-100">
                          <p className="text-xs font-semibold text-amber-800 flex items-center gap-1 mb-2">
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
              <div className="rounded-xl bg-zinc-50 p-6 text-center text-sm text-zinc-500">
                The screening session has been created. Evaluation results will automatically appear here once the candidate completes the interview.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 space-y-4">
            <Sparkles className="mx-auto h-12 w-12 text-indigo-300" />
            <div className="max-w-md mx-auto">
              <h4 className="text-sm font-semibold text-zinc-900">Invite candidate to AI Screening</h4>
              <p className="mt-1 text-xs text-zinc-500">
                Sends an interactive, AI-driven voice/chat screening session to test candidate knowledge against the job description.
              </p>
            </div>
            <Button
              variant="brand"
              disabled={inviting || !candidate.email}
              onClick={handleInvite}
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Screening Invitation
            </Button>
            {!candidate.email && (
              <p className="text-xs text-red-500">Candidate must have an email address to receive an invitation.</p>
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
          <h3 className="text-base font-bold text-zinc-900">Interviews</h3>
          <p className="text-xs text-zinc-500">Schedule and manage team interviews with Google Meet links.</p>
        </div>
        <Button variant="brand" size="sm" onClick={() => setShowSchedule(!showSchedule)}>
          <Plus className="h-3.5 w-3.5" />
          Schedule Interview
        </Button>
      </div>

      {showSchedule && (
        <form onSubmit={handleSchedule} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-zinc-900">Schedule New Interview</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Date & Time (UTC)</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Interview Format</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="human">Video Interview (Google Meet)</option>
                <option value="telephonic">Telephonic Interview</option>
                <option value="ai_screening">AI Guided Panel</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1">Interviewer Email</label>
              <input
                type="email"
                placeholder="interviewer@company.com"
                value={interviewerEmail}
                onChange={(e) => setInterviewerEmail(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
              Confirm Schedule
            </Button>
          </div>
        </form>
      )}

      {interviews.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
          <h4 className="text-sm font-semibold text-zinc-800">No interviews scheduled</h4>
          <p className="text-xs text-zinc-500 mt-1">Schedule an interview to generate a calendar invite and video room.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {interviews.map((iv: InterviewInfo) => (
            <div key={iv.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-indigo-600" />
                  Join Video Call
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
          <h3 className="text-base font-bold text-zinc-900">Job Offers</h3>
          <p className="text-xs text-zinc-500">Formal compensation and terms extended to this candidate.</p>
        </div>
        <Button variant="brand" size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-3.5 w-3.5" />
          Create Offer
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-zinc-900">Extend Job Offer</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Annual Base Salary</label>
              <input
                type="number"
                placeholder="120000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Equity / Options</label>
              <input
                type="text"
                placeholder="0.25% or 5,000 RSUs"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Target Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1">Notes / Conditions</label>
              <input
                type="text"
                placeholder="e.g. Relocation assistance included"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5" />}
              Generate Offer
            </Button>
          </div>
        </form>
      )}

      {offers.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center">
          <DollarSign className="mx-auto h-12 w-12 text-zinc-300 mb-3" />
          <h4 className="text-sm font-semibold text-zinc-800">No offer created yet</h4>
          <p className="text-xs text-zinc-500 mt-1">Create an offer to initiate offer letter tracking and pipeline hire progression.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {offers.map((offer: OfferInfo) => (
            <div key={offer.id} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100">
                <div>
                  <h4 className="text-base font-bold text-zinc-900">{offer.role_title || "Job Offer"}</h4>
                  <p className="text-xs text-zinc-400">Created on {offer.created_at ? new Date(offer.created_at).toLocaleDateString() : "Recently"}</p>
                </div>
                <StatusPill tone={offer.status === "accepted" ? "success" : offer.status === "rejected" ? "danger" : offer.status === "sent" ? "warning" : "neutral"}>
                  {offer.status.toUpperCase()}
                </StatusPill>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Base Salary</p>
                  <p className="font-semibold text-zinc-900">{offer.currency} {offer.salary ? offer.salary.toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Equity</p>
                  <p className="font-semibold text-zinc-900">{offer.equity || "None"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Start Date</p>
                  <p className="font-semibold text-zinc-900">{offer.start_date || "Flexible"}</p>
                </div>
              </div>

              {offer.notes && (
                <p className="text-xs text-zinc-600 bg-zinc-50 p-2.5 rounded-lg italic">
                  &ldquo;{offer.notes}&rdquo;
                </p>
              )}

              {offer.status !== "accepted" && offer.status !== "rejected" && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
                  <span className="text-xs text-zinc-500 mr-2">Update Offer Status:</span>
                  {offer.status === "draft" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === offer.id}
                      onClick={() => handleStatusChange(offer.id, "sent")}
                    >
                      <Send className="h-3.5 w-3.5 text-blue-600" />
                      Mark Sent to Candidate
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-emerald-700 hover:bg-emerald-50"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "accepted")}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Accept Offer & Hire
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-700 hover:bg-red-50"
                    disabled={actionLoading === offer.id}
                    onClick={() => handleStatusChange(offer.id, "rejected")}
                  >
                    <XCircle className="h-3.5 w-3.5 text-red-600" />
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText className="h-12 w-12 text-zinc-300 mb-4" />
        <h3 className="text-base font-semibold text-zinc-800">No Resume Available</h3>
        <p className="mt-1 text-sm text-zinc-500">This candidate does not have an uploaded resume file.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h3 className="text-base font-bold text-zinc-900">{candidate.resume_filename || "Resume.pdf"}</h3>
        </div>
        <Button variant="outline" size="sm" onClick={() => openResume(candidate.id)}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open in new tab
        </Button>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-12 shadow-sm text-center">
        <FileText className="mx-auto h-16 w-16 text-zinc-300 mb-4" />
        <p className="text-sm text-zinc-600 mb-4">
          Resumes are securely downloaded through authorized authentication.
        </p>
        <Button variant="brand" onClick={() => openResume(candidate.id)}>
          <Eye className="h-4 w-4" />
          View Secure PDF Resume
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="h-12 w-12 text-zinc-300 mb-4" />
        <h3 className="text-base font-semibold text-zinc-800">Timeline Protected</h3>
        <p className="mt-1 text-sm text-zinc-500">Your role does not have permission to view candidate audit logs.</p>
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Clock className="h-12 w-12 text-zinc-300 mb-4" />
        <h3 className="text-base font-semibold text-zinc-800">No Activity Yet</h3>
        <p className="mt-1 text-sm text-zinc-500">All stage movements, scans, screenings, and offers will record an audit trail here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <Activity className="h-5 w-5 text-blue-600" />
        <h3 className="text-base font-bold text-zinc-900">Audit & Activity Timeline</h3>
        <span className="text-xs text-zinc-400">({activity.length} events)</span>
      </div>
      <div className="ml-1">
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
      <div className="space-y-5">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-2xl" />
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-32 rounded-2xl" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
              <Skeleton className="h-28 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if ("error" in loaded) {
    return (
      <div className="space-y-3">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" onClick={reload}>Try again</Button>
      </div>
    );
  }

  const { data } = loaded;
  const candidateName = data.candidate.name || "Unnamed Candidate";

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-1 text-xs text-zinc-500">
            <Link href="/recruitment" className="hover:text-zinc-900 font-medium">Jobs</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-zinc-900 font-medium">
              {data.job?.title || "Job"}
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-zinc-700 font-medium">{candidateName}</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-900">{candidateName}</h1>
          <div className="mt-1 flex items-center gap-3">
            <StageBadge stage={data.application.stage} />
            <AnalysisIndicator status={data.application.analysis.analysis_status} error={data.application.analysis.analysis_error} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analysis">AI Analysis</TabsTrigger>
          <TabsTrigger value="screening">Screening</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
          <TabsTrigger value="offers">Offers</TabsTrigger>
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
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
