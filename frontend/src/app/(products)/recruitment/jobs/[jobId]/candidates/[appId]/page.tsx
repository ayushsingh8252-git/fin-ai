"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ChevronRight, Clock, ExternalLink, FileText,
  Loader2, MapPin, Mail, Phone, RefreshCw, Shield, User,
  CheckCircle2, XCircle, AlertTriangle, Briefcase,
  Activity, Eye, Download, Calendar, Send, DollarSign, Check,
  Copy, Plus, ShieldCheck, ShieldAlert, Video, ThumbsUp, ThumbsDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  errorMessage, getApplication360, setStage, openResume,
  triggerFraudScan, sendScreeningInvite, scheduleInterview,
  createOffer, updateOffer,
  type Application360, type Score, type Stage, type ActivityEvent,
  type OfferInfo, type InterviewInfo,
} from "@/lib/recruitmentApi";
import { ScoreCell, StageBadge, SkillMatchSvg } from "@/app/(products)/recruitment/_components/indicators";
import { NEXT_STAGES, STAGE_LABEL } from "@/app/(products)/recruitment/_components/stages";
import { useRecruitment } from "@/app/(products)/recruitment/_components/RecruitmentShell";
import { cn } from "@/lib/utils";

type LoadState = { data: Application360 } | { error: string } | null;

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-[#E4E7EC] last:border-0">
      <span className="mt-0.5 text-[#98A2B3]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-[#667085] uppercase tracking-wider">{label}</p>
        <p className="text-xs font-medium text-[#171717] break-words mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function TimelineEvent({ event }: { event: ActivityEvent }) {
  const actorLabel = event.actor_type === "ai" ? "Automated Evaluation" : event.actor_type === "hr" ? "Recruiter" : "System";
  const time = event.created_at ? new Date(event.created_at) : null;
  const payload = event.payload || {};

  return (
    <div className="group relative flex gap-3.5 pb-5 last:pb-0">
      <div className="absolute left-[13px] top-7 bottom-0 w-px bg-[#E4E7EC] group-last:hidden" />
      <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#E4E7EC] bg-white text-[#667085]">
        <Clock className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-xs font-semibold text-[#171717]">{event.summary}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[#667085]">
          <span className="rounded bg-[#F2F4F7] px-1.5 py-0.2 font-medium text-[#171717]">{actorLabel}</span>
          {time && (
            <span>
              {time.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        {Boolean(payload.from && payload.to) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
            <span className="rounded bg-[#F2F4F7] px-2 py-0.5 text-[#667085]">
              {STAGE_LABEL[payload.from as Stage] || String(payload.from)}
            </span>
            <ChevronRight className="h-3 w-3 text-[#98A2B3]" />
            <span className="rounded bg-white px-2 py-0.5 font-semibold text-[#171717] border border-[#E4E7EC]">
              {STAGE_LABEL[payload.to as Stage] || String(payload.to)}
            </span>
          </div>
        )}
        {Boolean(payload.reason) && (
          <p className="mt-1 text-xs text-[#667085] bg-[#F7F8FA] p-2 rounded-md border border-[#E4E7EC]">
            &ldquo;{String(payload.reason)}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

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

  const matched = application.analysis.matched_skills || [];
  const missing = application.analysis.missing_skills || [];
  const atsScore = application.scores.ats_score.value;
  const matchScore = application.scores.match_score.value;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* Left Column: Candidate Info & Document Verification */}
      <div className="lg:col-span-1 space-y-5">
        {/* Candidate Profile Details */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085] mb-3">
            Candidate Profile
          </h3>

          <div className="space-y-0.5">
            <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email Address" value={candidate.email} />
            <InfoRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={candidate.phone} />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={candidate.location} />
            <InfoRow icon={<Briefcase className="h-3.5 w-3.5" />} label="Summary" value={candidate.experience_text} />
          </div>

          {candidate.has_resume && (
            <div className="mt-4 border-t border-[#E4E7EC] pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-md border-[#E4E7EC] hover:bg-[#F2F4F7] text-xs font-medium text-[#171717]"
                onClick={() => openResume(candidate.id)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-[#667085]" />
                Download Original Resume
              </Button>
            </div>
          )}
        </div>

        {/* Document Integrity Card */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn("p-1.5 rounded-md", isSuspicious ? "bg-[#FEF3F2] text-[#F04438]" : "bg-[#ECFDF3] text-[#12B76A]")}>
                {isSuspicious ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              </div>
              <div>
                <h3 className="text-xs font-semibold text-[#171717]">Document Verification</h3>
                <p className="text-[10px] text-[#667085]">Integrity and credential check</p>
              </div>
            </div>
            {fraud ? (
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium uppercase",
                  fraud.status === "complete"
                    ? isSuspicious
                      ? "bg-[#FEF3F2] text-[#F04438] border border-[#FECDCA]"
                      : "bg-[#ECFDF3] text-[#12B76A] border border-[#A6F4C5]"
                    : "bg-[#FFFAEB] text-[#F79009] border border-[#FEDF89]"
                )}
              >
                {fraud.status === "complete" ? (isSuspicious ? "Discrepancy" : "Verified") : fraud.status}
              </span>
            ) : (
              <span className="rounded bg-[#F2F4F7] px-2 py-0.5 text-[10px] font-medium text-[#667085]">
                Not Scanned
              </span>
            )}
          </div>

          {fraud ? (
            <div className="space-y-2 pt-1 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-[#E4E7EC]">
                <span className="text-[#667085]">Status:</span>
                <span className="font-medium text-[#171717] capitalize">{fraud.status}</span>
              </div>
              {fraud.status === "complete" && (
                <>
                  <div className="flex items-center justify-between py-1 border-b border-[#E4E7EC]">
                    <span className="text-[#667085]">Integrity:</span>
                    <span className={cn("font-medium", isSuspicious ? "text-[#F04438]" : "text-[#12B76A]")}>
                      {isSuspicious ? "Flags Detected" : "Clean Document"}
                    </span>
                  </div>
                  {Array.isArray(fraudResult.flags) && fraudResult.flags.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-[#F04438] mb-1">Detected Flags:</p>
                      <ul className="space-y-1">
                        {fraudResult.flags.map((flag: unknown, idx: number) => (
                          <li key={idx} className="text-xs text-[#F04438] bg-[#FEF3F2] rounded p-2 flex items-start gap-1.5 border border-[#FECDCA]">
                            <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                            <span>{String(flag)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-xs text-[#667085] pt-1">
              <p className="font-normal">
                Verifies document authenticity, checks for hidden text stuffing, and timeline consistency.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-md text-xs font-medium border-[#E4E7EC] text-[#171717] hover:bg-[#F2F4F7]"
                disabled={scanningFraud || !candidate.has_resume}
                onClick={handleRunFraud}
              >
                {scanningFraud ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Shield className="h-3.5 w-3.5 mr-1.5 text-[#667085]" />}
                Run Verification Scan
              </Button>
            </div>
          )}
          {fraudError && <ErrorBanner message={fraudError} className="mt-2" />}
        </div>
      </div>

      {/* Right Column: Decision Actions, Score Matrix, Skills, and Evaluation */}
      <div className="space-y-5 lg:col-span-2">
        {/* Stage Progression Action Bar */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#667085] mb-1">Current Stage</p>
              <StageBadge stage={application.stage} />
            </div>
            {job && (
              <div className="text-right">
                <p className="text-xs font-medium text-[#667085] mb-0.5">Role Applied</p>
                <p className="text-xs font-semibold text-[#171717]">{job.title}</p>
              </div>
            )}
          </div>

          {canDecide && nextStages.length > 0 && (
            <div className="pt-3 border-t border-[#E4E7EC]">
              <p className="text-xs font-medium text-[#667085] mb-2">
                Stage Decisions:
              </p>
              <div className="flex flex-wrap gap-2">
                {nextStages.map((s: Stage) => {
                  const isReject = s === "REJECTED" || s === "WITHDRAWN";
                  const isHire = s === "HIRED";
                  return (
                    <Button
                      key={s}
                      variant={isReject ? "outline" : "outline"}
                      size="sm"
                      disabled={stageLoading !== null}
                      onClick={() => handleStage(s)}
                      className={cn(
                        "h-8 rounded-md text-xs font-medium transition-colors border-[#E4E7EC]",
                        isReject && "text-[#F04438] hover:bg-[#FEF3F2] hover:border-[#FECDCA]",
                        isHire && "bg-[#171717] text-white hover:bg-[#262626] border-[#171717]",
                        !isReject && !isHire && "text-[#171717] hover:bg-[#F2F4F7]"
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

        {/* MATCH ANALYSIS MATRIX WITH GEOMETRIC SVG GAUGE */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
              Match Analysis
            </h3>
            <span className="text-[11px] text-[#667085] font-medium">
              Autonomous Competency Matrix
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <SkillMatchSvg
              matchedCount={matched.length}
              totalCount={matched.length + missing.length || 1}
              score={matchScore}
              size={76}
            />

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 flex-1 w-full">
              <div className="rounded-md bg-[#F7F8FA] p-2.5 border border-[#E4E7EC]">
                <p className="text-[10px] text-[#667085] font-medium uppercase tracking-wider">Hard Requirements</p>
                <p className="mt-1 text-lg font-semibold text-[#171717] tabular-nums">
                  {atsScore !== null ? `${atsScore}%` : "—"}
                </p>
              </div>
              <div className="rounded-md bg-[#F7F8FA] p-2.5 border border-[#E4E7EC]">
                <p className="text-[10px] text-[#667085] font-medium uppercase tracking-wider">Semantic Fit</p>
                <p className="mt-1 text-lg font-semibold text-[#171717] tabular-nums">
                  {matchScore !== null ? `${matchScore}%` : "—"}
                </p>
              </div>
              <div className="rounded-md bg-[#F7F8FA] p-2.5 border border-[#E4E7EC]">
                <p className="text-[10px] text-[#667085] font-medium uppercase tracking-wider">Experience Fit</p>
                <p className="mt-1 text-lg font-semibold text-[#171717]">
                  {matchScore !== null && matchScore >= 80 ? "Strong" : matchScore !== null && matchScore >= 65 ? "Good" : "Moderate"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* SKILLS BREAKDOWN */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Skill Verification
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Matched */}
            <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#171717] flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#12B76A]" />
                Required & Verified ({matched.length})
              </p>
              <div className="space-y-1">
                {matched.map((s) => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-[#171717]">
                    <span className="text-[#12B76A] font-semibold">✓</span>
                    <span>{s}</span>
                  </div>
                ))}
                {matched.length === 0 && (
                  <p className="text-xs text-[#98A2B3]">No verified skills mapped.</p>
                )}
              </div>
            </div>

            {/* Missing */}
            <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#171717] flex items-center gap-1.5">
                <XCircle className="h-3.5 w-3.5 text-[#F04438]" />
                Missing / Gaps ({missing.length})
              </p>
              <div className="space-y-1">
                {missing.map((s) => (
                  <div key={s} className="flex items-center gap-1.5 text-xs text-[#667085]">
                    <span className="text-[#F04438] font-semibold">×</span>
                    <span>{s}</span>
                  </div>
                ))}
                {missing.length === 0 && (
                  <p className="text-xs text-[#98A2B3]">No critical skill gaps identified.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* EVALUATION SUMMARY */}
        {application.analysis.ai_summary && (
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Evaluation Summary
              </h3>
              {application.analysis.recommendation && (
                <span className="text-xs font-medium text-[#171717]">
                  Assessment: <strong className="font-semibold">{application.analysis.recommendation}</strong>
                </span>
              )}
            </div>

            <p className="text-xs text-[#171717] leading-relaxed font-normal whitespace-pre-wrap">
              {application.analysis.ai_summary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E7EC] pb-3">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">Pre-Screening Session</h3>
          <p className="text-xs text-[#667085]">Voice-based competency pre-qualification</p>
        </div>
        {screening && (
          <span className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] px-2.5 py-1 text-xs font-medium text-[#171717] capitalize">
            Status: {screening.session_status}
          </span>
        )}
      </div>

      {screening ? (
        <div className="space-y-4">
          <div className="rounded-md bg-[#F7F8FA] border border-[#E4E7EC] p-3.5 space-y-2">
            <p className="text-xs font-medium text-[#667085]">Screening Link</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={interviewLink || ""}
                className="flex-1 h-8 rounded-md border border-[#E4E7EC] bg-white px-2.5 text-xs text-[#171717] font-mono select-all focus:outline-none"
              />
              <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium">
                {copied ? <Check className="h-3 w-3 text-[#12B76A] mr-1" /> : <Copy className="h-3 w-3 mr-1 text-[#667085]" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {interviewLink && (
                <a
                  href={interviewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 rounded-md bg-[#171717] px-3 text-xs font-medium text-white hover:bg-[#262626]"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Session
                </a>
              )}
            </div>
          </div>

          {screening.results && screening.results.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Screening Results</h4>
              {screening.results.map((res) => (
                <div key={res.id} className="rounded-md border border-[#E4E7EC] p-4 space-y-3 bg-[#F7F8FA]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#171717]">
                      Verdict: {res.verdict || "Completed"}
                    </span>
                    {res.jd_match_score !== null && (
                      <span className="text-xs font-semibold text-[#171717] tabular-nums">
                        Score: {res.jd_match_score}%
                      </span>
                    )}
                  </div>
                  {res.summary && (
                    <p className="text-xs text-[#667085] leading-relaxed font-normal">{res.summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 space-y-3">
          <div className="max-w-md mx-auto">
            <h4 className="text-sm font-semibold text-[#171717]">Send Screening Invitation</h4>
            <p className="mt-0.5 text-xs text-[#667085]">
              Invites the candidate to an automated technical pre-screening interview.
            </p>
          </div>
          <Button
            disabled={inviting || !candidate.email}
            onClick={handleInvite}
            className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
          >
            {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
            Send Screening Invitation
          </Button>
        </div>
      )}
      {error && <ErrorBanner message={error} className="mt-3" />}
    </div>
  );
}

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
      setError("Please select date and time.");
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
          <h3 className="text-sm font-semibold text-[#171717]">Team Interviews</h3>
          <p className="text-xs text-[#667085]">Coordinated video and technical rounds</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowSchedule(!showSchedule)}
          className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Schedule Interview
        </Button>
      </div>

      {showSchedule && (
        <form onSubmit={handleSchedule} className="rounded-lg border border-[#E4E7EC] bg-white p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Schedule Interview</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Date & Time</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full h-8 rounded-md border border-[#E4E7EC] px-2.5 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Format</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full h-8 rounded-md border border-[#E4E7EC] px-2 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
              >
                <option value="human">Video Call (Google Meet)</option>
                <option value="telephonic">Phone Call</option>
              </select>
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E7EC]">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)} className="h-8 rounded-md border-[#E4E7EC] text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Calendar className="h-3.5 w-3.5 mr-1" />}
              Confirm
            </Button>
          </div>
        </form>
      )}

      {interviews.length === 0 ? (
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-8 text-center text-xs text-[#667085]">
          No interviews scheduled yet.
        </div>
      ) : (
        <div className="space-y-2">
          {interviews.map((iv: InterviewInfo) => (
            <div key={iv.id} className="rounded-lg border border-[#E4E7EC] bg-white p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#171717] capitalize">{iv.mode} Interview</p>
                <p className="text-[11px] text-[#667085]">
                  {iv.scheduled_at ? new Date(iv.scheduled_at).toLocaleString() : "Date pending"}
                </p>
              </div>
              {iv.meet_link && (
                <a
                  href={iv.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 h-7 rounded-md border border-[#E4E7EC] bg-white px-2.5 text-xs font-medium text-[#171717] hover:bg-[#F2F4F7]"
                >
                  <ExternalLink className="h-3 w-3 text-[#667085]" />
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
      <div className="space-y-4">
        <Skeleton className="h-5 w-60 rounded bg-[#E4E7EC]" />
        <Skeleton className="h-28 w-full rounded-lg bg-[#E4E7EC]" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-lg bg-[#E4E7EC]" />
          <div className="lg:col-span-2 space-y-3">
            <Skeleton className="h-48 rounded-lg bg-[#E4E7EC]" />
          </div>
        </div>
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="space-y-3 py-8 max-w-md">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="h-8 rounded-md border-[#E4E7EC] text-xs">Try again</Button>
      </div>
    );
  }

  const { data } = loaded;
  const candidateName = data.candidate.name || "Unnamed Candidate";

  return (
    <div className="space-y-5">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-1.5 text-xs text-[#667085]">
        <Link href="/recruitment" className="hover:text-[#171717] transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />
          Positions
        </Link>
        <ChevronRight className="h-3 w-3 text-[#E4E7EC]" />
        <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-[#171717] transition-colors">
          {data.job?.title || "Role Workspace"}
        </Link>
        <ChevronRight className="h-3 w-3 text-[#E4E7EC]" />
        <span className="text-[#171717] font-medium">{candidateName}</span>
      </div>

      {/* Candidate Profile Header */}
      <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white font-semibold text-sm shadow-2xs">
              {candidateName
                .split(/[\s@._-]+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0].toUpperCase())
                .join("") || "C"}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight text-[#171717] truncate">
                  {candidateName}
                </h1>
                <StageBadge stage={data.application.stage} />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#667085]">
                {data.candidate.current_role && (
                  <span className="font-medium text-[#171717]">{data.candidate.current_role}</span>
                )}
                {data.candidate.location && (
                  <>
                    <span className="text-[#E4E7EC]">·</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-[#98A2B3]" />
                      {data.candidate.location}
                    </span>
                  </>
                )}
                {data.candidate.experience_years !== null && data.candidate.experience_years !== undefined && (
                  <>
                    <span className="text-[#E4E7EC]">·</span>
                    <span>{data.candidate.experience_years} years experience</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {data.candidate.has_resume && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openResume(data.candidate.id)}
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#171717] hover:bg-[#F2F4F7]"
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-[#667085]" /> Resume PDF
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={reload}
              className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
            >
              <RefreshCw className="h-3 w-3 mr-1 text-[#98A2B3]" /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1 rounded-md bg-[#F2F4F7] p-1 border border-[#E4E7EC]">
          <TabsTrigger value="overview" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            Overview & Evaluation
          </TabsTrigger>
          <TabsTrigger value="screening" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            Voice Screening
          </TabsTrigger>
          <TabsTrigger value="interviews" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            Interviews ({data.interviews.length})
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            Audit Trail ({data.activity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} onStageChange={handleStageChange} onReload={reload} />
        </TabsContent>
        <TabsContent value="screening">
          <ScreeningTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="interviews">
          <InterviewsTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="activity">
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
              Lifecycle Audit Trail ({data.activity.length})
            </h3>
            <div className="pt-2">
              {data.activity.map((event) => (
                <TimelineEvent key={event.id} event={event} />
              ))}
              {data.activity.length === 0 && (
                <p className="text-xs text-[#98A2B3]">No activity events logged yet.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
