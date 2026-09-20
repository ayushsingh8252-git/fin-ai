"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ChevronRight, Clock, ExternalLink,
  Loader2, MapPin, Mail, Phone, RefreshCw,
  CheckCircle2, XCircle, AlertTriangle, Briefcase,
  Download, Calendar, Send, DollarSign, Check,
  Copy, Plus, ShieldCheck, ShieldAlert,
  MessageSquare, PhoneCall, Bot, User as UserIcon,
  Sparkles, CheckCircle, Info, HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  errorMessage, getApplication360, setStage, openResume,
  triggerFraudScan, sendScreeningInvite, scheduleInterview,
  createOffer, updateOffer, sendWhatsAppMessage, triggerTelephonicCall,
  type Application360, type Stage, type ActivityEvent,
  type OfferInfo, type InterviewInfo, type WhatsAppMessageItem, type TelephonicCallItem
} from "@/lib/recruitmentApi";
import { StageBadge } from "@/app/(products)/recruitment/_components/indicators";
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
  const actorLabel = event.actor_type === "ai" ? "AI Automation" : event.actor_type === "hr" ? "Hiring Team" : "System";
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
          <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 font-medium text-[#171717]">{actorLabel}</span>
          {time && (
            <span>
              {time.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at{" "}
              {time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
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

// ── Chronological Hiring Journey Stepper ────────────────────────────────
const JOURNEY_STEPS = [
  { id: "APPLIED", stepNumber: 1, label: "Resume & Screening", subtitle: "Hard skill match & fraud scan" },
  { id: "OUTREACH", stepNumber: 2, label: "WhatsApp Outreach", subtitle: "Direct message & pre-invite" },
  { id: "TELEPHONIC", stepNumber: 3, label: "AI Phone Call", subtitle: "Automated qualification call" },
  { id: "TECH_INTERVIEW", stepNumber: 4, label: "AI Tech Interview", subtitle: "Coding & technical session" },
  { id: "INTERVIEW", stepNumber: 5, label: "Panel Interview", subtitle: "Live team interview" },
  { id: "OFFER", stepNumber: 6, label: "Job Offer", subtitle: "Compensation & start date" },
  { id: "HIRED", stepNumber: 7, label: "Hired", subtitle: "Accepted & onboarding" },
];

function ChronologicalHiringJourney({
  stage,
  hasWhatsApp,
  hasPhoneCall,
  hasScreening,
  hasInterviews,
  hasOffers,
}: {
  stage: Stage;
  hasWhatsApp: boolean;
  hasPhoneCall: boolean;
  hasScreening: boolean;
  hasInterviews: boolean;
  hasOffers: boolean;
}) {
  const getStepStatus = (index: number) => {
    // 0: Resume
    if (index === 0) return "completed";
    // 1: WhatsApp
    if (index === 1) return hasWhatsApp ? "completed" : stage !== "PROCESSING" && stage !== "APPLIED" ? "completed" : "current";
    // 2: Telephonic
    if (index === 2) return hasPhoneCall ? "completed" : stage === "SHORTLISTED" ? "current" : stage === "INTERVIEW" || stage === "SELECTED" || stage === "OFFER" || stage === "HIRED" ? "completed" : "pending";
    // 3: Tech Interview
    if (index === 3) return hasScreening ? "completed" : stage === "SHORTLISTED" ? "current" : stage === "INTERVIEW" || stage === "SELECTED" || stage === "OFFER" || stage === "HIRED" ? "completed" : "pending";
    // 4: Panel Interview
    if (index === 4) return stage === "INTERVIEW" ? "current" : stage === "SELECTED" || stage === "OFFER" || stage === "HIRED" || hasInterviews ? "completed" : "pending";
    // 5: Offer
    if (index === 5) return stage === "OFFER" ? "current" : stage === "HIRED" || hasOffers ? "completed" : "pending";
    // 6: Hired
    if (index === 6) return stage === "HIRED" ? "completed" : "pending";
    return "pending";
  };

  return (
    <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5">
        <div>
          <h2 className="text-xs font-semibold text-[#171717] uppercase tracking-wider">
            Chronological Candidate Progression
          </h2>
          <p className="text-[11px] text-[#667085] mt-0.5">
            Step-by-step progress from resume upload to final offer acceptance
          </p>
        </div>
        <span className="text-xs font-medium text-[#171717] bg-[#F7F8FA] border border-[#E4E7EC] rounded px-2.5 py-1">
          Current Stage: <strong className="capitalize">{STAGE_LABEL[stage] || stage}</strong>
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-1">
        {JOURNEY_STEPS.map((step, idx) => {
          const status = getStepStatus(idx);
          const isCompleted = status === "completed";
          const isCurrent = status === "current";

          return (
            <div
              key={step.id}
              className={cn(
                "rounded-md border p-2.5 text-xs transition-all flex flex-col justify-between",
                isCurrent && "border-[#171717] bg-[#F7F8FA] shadow-xs",
                isCompleted && "border-[#E4E7EC] bg-white text-[#171717]",
                !isCurrent && !isCompleted && "border-[#F2F4F7] bg-[#FAFBFD] text-[#98A2B3]"
              )}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  isCompleted ? "bg-[#12B76A] text-white" : isCurrent ? "bg-[#171717] text-white" : "bg-[#E4E7EC] text-[#667085]"
                )}>
                  {isCompleted ? "✓" : step.stepNumber}
                </span>
                <span className={cn(
                  "text-[9px] font-semibold uppercase tracking-wider",
                  isCompleted ? "text-[#12B76A]" : isCurrent ? "text-[#171717]" : "text-[#98A2B3]"
                )}>
                  {isCompleted ? "Done" : isCurrent ? "Active" : "Upcoming"}
                </span>
              </div>
              <div>
                <p className={cn("text-xs font-semibold leading-snug", isCurrent ? "text-[#171717]" : isCompleted ? "text-[#171717]" : "text-[#667085]")}>
                  {step.label}
                </p>
                <p className="text-[10px] text-[#98A2B3] line-clamp-1 mt-0.5">
                  {step.subtitle}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab 1: Overview & Resume Tab ─────────────────────────────────────────
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
              <span className="rounded px-2 py-0.5 text-[10px] font-medium uppercase bg-[#F2F4F7] text-[#667085]">
                Unchecked
              </span>
            )}
          </div>

          {fraud ? (
            <div className="space-y-2 text-xs">
              <p className="text-[11px] text-[#667085]">
                Scanned {fraud.created_at ? new Date(fraud.created_at).toLocaleDateString() : ""}
              </p>
              {isSuspicious ? (
                <div className="rounded bg-[#FEF3F2] p-2.5 text-[#F04438] space-y-1">
                  <p className="font-semibold text-xs">Document Flags Identified</p>
                  <p className="text-[11px]">
                    {String(fraudResult.recommendation || "Discrepancy detected in text layout or metadata.")}
                  </p>
                </div>
              ) : (
                <div className="rounded bg-[#ECFDF3] p-2.5 text-[#027A48]">
                  <p className="font-medium text-xs">No tampering or hidden prompt injections detected.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-8 rounded-md border-[#E4E7EC] hover:bg-[#F2F4F7] text-xs font-medium text-[#171717]"
                disabled={scanningFraud || !candidate.has_resume}
                onClick={handleRunFraud}
              >
                {scanningFraud ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5 text-[#667085]" />}
                Run Document Verification Scan
              </Button>
            </div>
          )}
          {fraudError && <ErrorBanner message={fraudError} />}
        </div>
      </div>

      {/* Right Column: AI Analysis & Provenance */}
      <div className="lg:col-span-2 space-y-5">
        {/* ACTION / DECISION BANNER */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Hiring Stage Progression
              </h3>
              <p className="text-xs text-[#171717] mt-0.5">
                Current stage: <strong className="font-semibold">{STAGE_LABEL[application.stage]}</strong>
              </p>
            </div>
            {canDecide && nextStages.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {nextStages.map((target) => (
                  <Button
                    key={target}
                    size="sm"
                    disabled={stageLoading !== null}
                    onClick={() => handleStage(target)}
                    className={cn(
                      "h-8 rounded-md px-3 text-xs font-medium transition-all",
                      target === "REJECTED"
                        ? "border border-[#E4E7EC] bg-white text-[#F04438] hover:bg-[#FEF3F2]"
                        : target === "SHORTLISTED" || target === "INTERVIEW"
                        ? "bg-[#171717] text-white hover:bg-[#262626]"
                        : "border border-[#E4E7EC] bg-white text-[#171717] hover:bg-[#F2F4F7]"
                    )}
                  >
                    {stageLoading === target && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    Move to {STAGE_LABEL[target]}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {stageError && <ErrorBanner message={stageError} />}
        </div>

        {/* SCORES OVERVIEW */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085] mb-3">
            Role Suitability Scores
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-[#667085]">Job Description Fit</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-[#171717] tabular-nums">
                  {matchScore !== null ? `${matchScore}%` : "—"}
                </span>
                {application.scores.match_score.status === "computed" ? (
                  <span className="text-[10px] text-[#12B76A] font-medium">Verified AI Fit</span>
                ) : (
                  <span className="text-[10px] text-[#98A2B3]">Standard Fallback</span>
                )}
              </div>
              <p className="text-[10px] text-[#98A2B3]">Relevance against must-have criteria</p>
            </div>

            <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3.5 space-y-1">
              <span className="text-[11px] font-medium text-[#667085]">Resume Structure Score</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-[#171717] tabular-nums">
                  {atsScore !== null ? `${atsScore}%` : "—"}
                </span>
                <span className="text-[10px] text-[#667085]">Completeness</span>
              </div>
              <p className="text-[10px] text-[#98A2B3]">Grammar, layout, and work history clarity</p>
            </div>
          </div>
        </div>

        {/* SKILLS BREAKDOWN */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Skill Verification
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
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
                {matched.length === 0 && <p className="text-xs text-[#98A2B3]">No verified skills mapped.</p>}
              </div>
            </div>

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
                {missing.length === 0 && <p className="text-xs text-[#98A2B3]">No critical skill gaps identified.</p>}
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

// ── Tab 2: WhatsApp Outreach Tab ─────────────────────────────────────────
function WhatsAppTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const messages = data.whatsapp_messages || [];
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const candidateFirstName = (candidate.name || "there").split(" ")[0];
  const roleName = job?.title || "our open position";

  const QUICK_TEMPLATES = [
    {
      label: "Pre-Screening Invite",
      text: `Hi ${candidateFirstName}, thank you for applying for the ${roleName} role. We loved your background and would like to invite you for a 3-minute voice screening chat. Are you available today?`,
    },
    {
      label: "Interview Confirmation",
      text: `Hi ${candidateFirstName}, your technical interview round for ${roleName} is confirmed! Please let us know if you have any questions before we connect.`,
    },
    {
      label: "Formal Offer Notice",
      text: `Congratulations ${candidateFirstName}! We have extended a formal offer for the ${roleName} role. Please check your candidate portal to review the compensation and benefits details.`,
    },
    {
      label: "Quick Availability Check",
      text: `Hello ${candidateFirstName}, just checking in regarding your availability for next steps on your ${roleName} application. When is the best time to connect this week?`,
    },
  ];

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim()) return;

    setSending(true);
    setError(null);
    setSuccessNotice(null);

    try {
      const res = await sendWhatsAppMessage(application.id, messageText.trim());
      setMessageText("");
      if (!res.is_configured) {
        setSuccessNotice("Message logged & queued. (Meta WhatsApp Cloud API credentials in .env needed to send live to candidate's mobile).");
      } else {
        setSuccessNotice("Message sent successfully via Meta WhatsApp Cloud API!");
      }
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Informative Guidance Banner */}
      <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFBFD] p-3.5 flex items-start gap-3 text-xs">
        <Info className="h-4 w-4 text-[#171717] mt-0.5 shrink-0" />
        <div className="space-y-0.5 flex-1">
          <p className="font-semibold text-[#171717]">Direct WhatsApp Candidate Communication</p>
          <p className="text-[11px] text-[#667085] leading-relaxed">
            Send real-time updates directly to <strong>{candidate.phone || "the candidate's phone"}</strong>.
            Outbound messages use Meta Cloud API. If WhatsApp credentials in <code className="bg-[#F2F4F7] px-1 rounded text-[10px]">.env</code> are pending, messages are recorded and queued locally so your audit history stays intact.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left: Chat Thread & History */}
        <div className="lg:col-span-2 rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 flex flex-col justify-between space-y-4 min-h-[420px]">
          <div>
            <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#171717]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                  Conversation History ({messages.length})
                </h3>
              </div>
              <span className="text-[11px] text-[#667085] font-medium">
                To: {candidate.phone || "No phone on record"}
              </span>
            </div>

            {messages.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <div className="h-8 w-8 rounded-full bg-[#F2F4F7] flex items-center justify-center mx-auto text-[#667085]">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <p className="text-xs font-medium text-[#171717]">No WhatsApp messages yet</p>
                <p className="text-[11px] text-[#98A2B3] max-w-xs mx-auto">
                  Click a template below or type a message to start direct communication with {candidateFirstName}.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {messages.map((m) => {
                  const isOutbound = m.direction === "outbound";
                  const time = m.created_at ? new Date(m.created_at) : null;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col max-w-[82%]",
                        isOutbound ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-lg p-3 text-xs leading-relaxed",
                          isOutbound
                            ? "bg-[#171717] text-white rounded-br-none"
                            : "bg-[#F7F8FA] border border-[#E4E7EC] text-[#171717] rounded-bl-none"
                        )}
                      >
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#98A2B3]">
                        {time && <span>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                        <span>·</span>
                        <span className={cn(
                          "capitalize font-medium",
                          m.status === "delivered" || m.status === "read" ? "text-[#12B76A]" : m.status === "sent" ? "text-[#171717]" : "text-[#F79009]"
                        )}>
                          {m.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Message Composer Form */}
          <form onSubmit={handleSend} className="border-t border-[#E4E7EC] pt-3 space-y-2">
            {error && <ErrorBanner message={error} />}
            {successNotice && (
              <div className="p-2 rounded bg-[#ECFDF3] border border-[#A6F4C5] text-[#027A48] text-[11px] flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{successNotice}</span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={candidate.phone ? `Type message to ${candidateFirstName}...` : "Candidate missing phone number"}
                value={messageText}
                disabled={!candidate.phone || sending}
                onChange={(e) => setMessageText(e.target.value)}
                className="flex-1 h-9 rounded-md border border-[#E4E7EC] bg-white px-3 text-xs text-[#171717] placeholder:text-[#98A2B3] focus:border-[#171717] focus:outline-none"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!candidate.phone || !messageText.trim() || sending}
                className="h-9 rounded-md bg-[#171717] text-white px-3.5 text-xs font-medium hover:bg-[#262626]"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Send
              </Button>
            </div>
          </form>
        </div>

        {/* Right: Quick Template Prompts */}
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Quick Message Templates
          </h3>
          <p className="text-[11px] text-[#667085]">
            Click any message below to auto-fill the composer with pre-approved outreach text:
          </p>

          <div className="space-y-2 pt-1">
            {QUICK_TEMPLATES.map((tmpl, i) => (
              <div
                key={i}
                onClick={() => setMessageText(tmpl.text)}
                className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 text-xs hover:border-[#171717] hover:bg-white cursor-pointer transition-all space-y-1"
              >
                <p className="font-semibold text-[#171717] text-xs flex items-center justify-between">
                  <span>{tmpl.label}</span>
                  <span className="text-[10px] text-[#98A2B3]">Click to use</span>
                </p>
                <p className="text-[11px] text-[#667085] line-clamp-2">{tmpl.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 3: AI Telephonic Screening Call Tab ──────────────────────────────
function TelephonicTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const calls = data.telephonic_calls || [];
  const latestCall = calls[0] || null;

  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCall = async () => {
    setCalling(true);
    setError(null);
    setNotice(null);

    try {
      const res = await triggerTelephonicCall(application.id);
      if (!res.is_configured) {
        setNotice("Telephonic screening evaluated! (Sarvam AI credentials in .env needed to dial real telephone carriers live).");
      } else {
        setNotice("Outbound phone call placed successfully via Sarvam AI voice agent!");
      }
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Plain Language Explanatory Banner */}
      <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFBFD] p-3.5 flex items-start gap-3 text-xs">
        <Bot className="h-4 w-4 text-[#171717] mt-0.5 shrink-0" />
        <div className="space-y-0.5 flex-1">
          <p className="font-semibold text-[#171717]">AI Telephonic Voice Pre-Screening</p>
          <p className="text-[11px] text-[#667085] leading-relaxed">
            The AI Telephonic agent calls the candidate directly over the phone, asks 3-4 role-specific qualification questions in natural human voice, records the full conversational transcript, and scores their communication fluency, technical relevance, and confidence.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left Column: Call Actions & Scores */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
              Initiate Voice Call
            </h3>
            <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-1 text-xs">
              <p className="text-[10px] text-[#98A2B3] uppercase tracking-wider font-semibold">Candidate Phone</p>
              <p className="font-semibold text-[#171717] text-sm">{candidate.phone || "No phone number available"}</p>
              <p className="text-[11px] text-[#667085]">Target Role: {job?.title || "Position"}</p>
            </div>

            <Button
              onClick={handleCall}
              disabled={calling || !candidate.phone}
              className="w-full h-9 rounded-md bg-[#171717] text-white text-xs font-medium hover:bg-[#262626]"
            >
              {calling ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Initiating Call...
                </>
              ) : (
                <>
                  <PhoneCall className="h-3.5 w-3.5 mr-1.5" />
                  Call Candidate (AI Voice Agent)
                </>
              )}
            </Button>

            {error && <ErrorBanner message={error} />}
            {notice && (
              <div className="p-2 rounded bg-[#ECFDF3] border border-[#A6F4C5] text-[#027A48] text-[11px]">
                {notice}
              </div>
            )}
          </div>

          {/* Evaluation Scores (if available) */}
          {latestCall && (
            <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Screening Call Scores
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded bg-[#F7F8FA] border border-[#E4E7EC] text-xs">
                  <span className="text-[#667085]">Communication Fluency</span>
                  <span className="font-semibold text-[#171717] tabular-nums">
                    {latestCall.communication_score !== null ? `${latestCall.communication_score}%` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-[#F7F8FA] border border-[#E4E7EC] text-xs">
                  <span className="text-[#667085]">Domain Relevance</span>
                  <span className="font-semibold text-[#171717] tabular-nums">
                    {latestCall.relevance_score !== null ? `${latestCall.relevance_score}%` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-[#F7F8FA] border border-[#E4E7EC] text-xs">
                  <span className="text-[#667085]">Confidence Score</span>
                  <span className="font-semibold text-[#171717] tabular-nums">
                    {latestCall.confidence_score !== null ? `${latestCall.confidence_score}%` : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Audio Call Transcript & Summary */}
        <div className="lg:col-span-2 rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2.5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                Call Transcript & Audio Log
              </h3>
              <p className="text-[11px] text-[#98A2B3]">Turn-by-turn conversational recording</p>
            </div>
            {latestCall && (
              <span className={cn(
                "rounded px-2 py-0.5 text-[10px] font-semibold uppercase border",
                latestCall.status === "completed" ? "bg-[#ECFDF3] text-[#12B76A] border-[#A6F4C5]" : "bg-[#FFFAEB] text-[#F79009] border-[#FEDF89]"
              )}>
                {latestCall.status}
              </span>
            )}
          </div>

          {!latestCall ? (
            <div className="text-center py-16 space-y-2 text-xs">
              <div className="h-8 w-8 rounded-full bg-[#F2F4F7] flex items-center justify-center mx-auto text-[#667085]">
                <PhoneCall className="h-4 w-4" />
              </div>
              <p className="font-medium text-[#171717]">No telephonic screening calls conducted yet</p>
              <p className="text-[11px] text-[#98A2B3] max-w-xs mx-auto">
                Click &ldquo;Call Candidate (AI Voice Agent)&rdquo; to place an automated qualification call.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {latestCall.evaluation_summary && (
                <div className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] p-3 text-xs space-y-1">
                  <p className="font-semibold text-[#171717]">Evaluation Summary:</p>
                  <p className="text-[#667085] leading-relaxed">{latestCall.evaluation_summary}</p>
                </div>
              )}

              <div className="space-y-2.5 pt-1">
                <h4 className="text-[11px] font-semibold text-[#667085] uppercase tracking-wider">
                  Dialogue Transcript ({latestCall.transcript?.length || 0} turns)
                </h4>
                <div className="space-y-2">
                  {(latestCall.transcript || []).map((turn, idx) => {
                    const isAgent = turn.role === "agent";
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "rounded-md p-3 text-xs space-y-1",
                          isAgent ? "bg-[#FAFBFD] border border-[#E4E7EC]" : "bg-white border border-[#E4E7EC]"
                        )}
                      >
                        <span className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider inline-flex items-center gap-1",
                          isAgent ? "text-[#171717]" : "text-[#027A48]"
                        )}>
                          {isAgent ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
                          {isAgent ? "AI Voice Agent" : candidate.name || "Candidate"}
                        </span>
                        <p className="text-[#171717] leading-relaxed">{turn.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab 4: AI Technical Interview Tab ────────────────────────────────────
function AiInterviewTab({ data, onReload }: { data: Application360; onReload: () => void }) {
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

  const results = screening?.results || [];

  return (
    <div className="space-y-4">
      {/* Explanatory Callout Banner */}
      <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFBFD] p-3.5 flex items-start gap-3 text-xs">
        <Sparkles className="h-4 w-4 text-[#171717] mt-0.5 shrink-0" />
        <div className="space-y-0.5 flex-1">
          <p className="font-semibold text-[#171717]">AI Technical & Scenario Screening</p>
          <p className="text-[11px] text-[#667085] leading-relaxed">
            Candidates complete an interactive, online interview session with adaptive technical challenges, automated audio/video proctoring, and instant JD alignment scoring.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[#E4E7EC] bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E7EC] pb-3">
          <div>
            <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wider">
              Technical Screening Session
            </h3>
            <p className="text-[11px] text-[#667085]">Adaptive questions, code challenges & proctoring</p>
          </div>
          {screening && (
            <span className="rounded-md border border-[#E4E7EC] bg-[#F7F8FA] px-2.5 py-1 text-xs font-medium text-[#171717] capitalize">
              Status: {screening.session_status}
            </span>
          )}
        </div>

        {screening ? (
          <div className="space-y-4">
            {/* Candidate Link Box */}
            <div className="rounded-md bg-[#F7F8FA] border border-[#E4E7EC] p-3.5 space-y-2">
              <p className="text-xs font-medium text-[#667085]">Candidate Interview URL</p>
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

            {/* Screening Results Report */}
            {results.length > 0 ? (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Evaluation Results</h4>
                {results.map((res) => (
                  <div key={res.id} className="rounded-md border border-[#E4E7EC] p-4 space-y-3 bg-[#F7F8FA]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4E7EC] pb-2">
                      <span className="text-xs font-semibold text-[#171717]">
                        Recommendation: <strong className="text-[#027A48]">{res.verdict || "Completed"}</strong>
                      </span>
                      {res.jd_match_score !== null && (
                        <span className="text-xs font-semibold text-[#171717] tabular-nums">
                          Technical Fit: {res.jd_match_score}%
                        </span>
                      )}
                    </div>

                    {res.summary && (
                      <p className="text-xs text-[#171717] leading-relaxed font-normal">{res.summary}</p>
                    )}

                    {res.strengths && res.strengths.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[11px] font-semibold text-[#12B76A]">Demonstrated Strengths:</span>
                        <ul className="text-xs text-[#667085] space-y-0.5 pl-4 list-disc">
                          {res.strengths.map((str, i) => (
                            <li key={i}>{str}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-[#E4E7EC] bg-white p-4 text-center text-xs text-[#667085]">
                Candidate has been invited. Results will appear here once the session is completed.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 space-y-3">
            <div className="max-w-md mx-auto">
              <h4 className="text-sm font-semibold text-[#171717]">Send AI Technical Interview Invitation</h4>
              <p className="mt-0.5 text-xs text-[#667085]">
                Generates a personalized interview session link for {candidate.email || "the candidate"}.
              </p>
            </div>
            <Button
              disabled={inviting || !candidate.email}
              onClick={handleInvite}
              className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
            >
              {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Generate Interview Link & Email Invite
            </Button>
          </div>
        )}
        {error && <ErrorBanner message={error} className="mt-3" />}
      </div>
    </div>
  );
}

// ── Tab 5: Panel Interviews Tab ──────────────────────────────────────────
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
          <h3 className="text-sm font-semibold text-[#171717]">Panel & Team Interviews</h3>
          <p className="text-xs text-[#667085]">Coordinated video and hiring manager rounds</p>
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
          No team interviews scheduled yet.
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

// ── Tab 6: Job Offers Tab ────────────────────────────────────────────────
function OffersTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const offers = data.offers || [];
  const [showCreate, setShowCreate] = useState(false);
  const [salary, setSalary] = useState<number | "">("");
  const [currency, setCurrency] = useState("USD");
  const [equity, setEquity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createOffer(application.id, {
        salary: salary ? Number(salary) : undefined,
        currency,
        equity: equity || undefined,
        role_title: job?.title || "Role",
        start_date: startDate || undefined,
        notes: notes || undefined,
      });
      setShowCreate(false);
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (offerId: string, status: string) => {
    try {
      await updateOffer(offerId, { status });
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">Offer Letters & Terms</h3>
          <p className="text-xs text-[#667085]">Compensation packages and acceptance status</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
          className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Create Formal Offer
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-lg border border-[#E4E7EC] bg-white p-4 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#667085]">Offer Details</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Annual Salary</label>
              <input
                type="number"
                placeholder="e.g. 150000"
                value={salary}
                onChange={(e) => setSalary(e.target.value ? Number(e.target.value) : "")}
                className="w-full h-8 rounded-md border border-[#E4E7EC] px-2.5 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-8 rounded-md border border-[#E4E7EC] px-2 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="INR">INR (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Equity</label>
              <input
                type="text"
                placeholder="e.g. 0.25% or 10,000 RSUs"
                value={equity}
                onChange={(e) => setEquity(e.target.value)}
                className="w-full h-8 rounded-md border border-[#E4E7EC] px-2.5 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#171717] mb-1">Target Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-8 rounded-md border border-[#E4E7EC] px-2.5 text-xs text-[#171717] focus:border-[#171717] focus:outline-none"
            />
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E7EC]">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} className="h-8 rounded-md border-[#E4E7EC] text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading} className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
              Save & Extend Offer
            </Button>
          </div>
        </form>
      )}

      {offers.length === 0 ? (
        <div className="rounded-lg border border-[#E4E7EC] bg-white p-8 text-center text-xs text-[#667085]">
          No formal offers generated yet.
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => (
            <div key={offer.id} className="rounded-lg border border-[#E4E7EC] bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E4E7EC] pb-2.5">
                <div>
                  <h4 className="text-xs font-semibold text-[#171717]">{offer.role_title}</h4>
                  <p className="text-[11px] text-[#667085]">
                    {offer.currency} {offer.salary ? offer.salary.toLocaleString() : "—"}/yr
                    {offer.equity ? ` · Equity: ${offer.equity}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase bg-[#F2F4F7] text-[#171717]">
                    {offer.status}
                  </span>
                  {offer.status !== "accepted" && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(offer.id, "accepted")}
                      className="h-7 rounded-md bg-[#12B76A] text-white text-xs font-medium hover:bg-[#027A48]"
                    >
                      Mark Accepted (Hire)
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────────────
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

      {/* Chronological Hiring Stepper */}
      <ChronologicalHiringJourney
        stage={data.application.stage}
        hasWhatsApp={Boolean(data.whatsapp_messages && data.whatsapp_messages.length > 0)}
        hasPhoneCall={Boolean(data.telephonic_calls && data.telephonic_calls.length > 0)}
        hasScreening={Boolean(data.screening)}
        hasInterviews={Boolean(data.interviews && data.interviews.length > 0)}
        hasOffers={Boolean(data.offers && data.offers.length > 0)}
      />

      {/* Tabs Navigation */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1 rounded-md bg-[#F2F4F7] p-1 border border-[#E4E7EC]">
          <TabsTrigger value="overview" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            1. Overview & Resume
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717] flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            2. WhatsApp Outreach {Boolean(data.whatsapp_messages?.length) && `(${data.whatsapp_messages?.length})`}
          </TabsTrigger>
          <TabsTrigger value="telephonic" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717] flex items-center gap-1.5">
            <PhoneCall className="h-3.5 w-3.5" />
            3. AI Phone Screening {Boolean(data.telephonic_calls?.length) && `(${data.telephonic_calls?.length})`}
          </TabsTrigger>
          <TabsTrigger value="screening" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717] flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            4. AI Tech Interview
          </TabsTrigger>
          <TabsTrigger value="interviews" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            5. Panel Interviews ({data.interviews.length})
          </TabsTrigger>
          <TabsTrigger value="offers" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            6. Offers ({data.offers?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="activity" className="rounded px-3 py-1.5 text-xs font-medium transition-colors data-[state=active]:bg-white data-[state=active]:text-[#171717]">
            Audit Trail ({data.activity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab data={data} onStageChange={handleStageChange} onReload={reload} />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsAppTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="telephonic">
          <TelephonicTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="screening">
          <AiInterviewTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="interviews">
          <InterviewsTab data={data} onReload={reload} />
        </TabsContent>
        <TabsContent value="offers">
          <OffersTab data={data} onReload={reload} />
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
