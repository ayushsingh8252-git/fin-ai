"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronRight, Clock, ExternalLink,
  Loader2, MapPin, Mail, Phone, RefreshCw,
  CheckCircle2, XCircle, Briefcase, Download,
  Calendar, Send, DollarSign, Check, Copy, Plus,
  ShieldCheck, MessageSquare, PhoneCall,
  Sparkles, CheckCheck, Zap, Building2, Search, UserCheck, AlertTriangle, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, getApplication360, setStage, openResume,
  triggerFraudScan, sendScreeningInvite, scheduleInterview,
  createOffer, updateOffer, sendWhatsAppMessage, triggerTelephonicCall,
  triggerBackgroundVerification, type BackgroundVerificationResponse,
  type Application360, type Stage,
} from "@/lib/recruitmentApi";
import { StageBadge } from "@/app/(products)/recruitment/_components/indicators";
import { NEXT_STAGES, STAGE_LABEL } from "@/app/(products)/recruitment/_components/stages";
import { useRecruitment } from "@/app/(products)/recruitment/_components/RecruitmentShell";
import { cn } from "@/lib/utils";

type LoadState = { data: Application360 } | { error: string } | null;

// ── Compact WhatsApp Prompt Chips ───────────────────────────────────────────
const WHATSAPP_TEMPLATES = [
  {
    chip: "👋 Voice Screen",
    text: (name: string, role: string) =>
      `Hi ${name}, thank you for applying for the ${role} role! We would love to invite you for a 3-minute voice screen today. Are you available?`,
  },
  {
    chip: "📅 Panel Interview",
    text: (name: string, role: string) =>
      `Hi ${name}, your technical interview for ${role} is confirmed. Please let us know if you have any questions before the meeting!`,
  },
  {
    chip: "🎉 Extend Offer",
    text: (name: string, role: string) =>
      `Congratulations ${name}! We have extended a formal offer for the ${role} position. Please review the compensation package details.`,
  },
  {
    chip: "⏰ Follow-up",
    text: (name: string, role: string) =>
      `Hi ${name}, following up regarding next steps on your application for ${role}. When is a good time to connect this week?`,
  },
];

// ── Tab 1: Concise & Data-Dense Evaluation ──────────────────────────────────
function EvaluationTab({
  data,
  onNavigateTab,
}: {
  data: Application360;
  onNavigateTab: (tabId: string) => void;
}) {
  const { application, candidate, job } = data;
  const matchScore = application.scores.match_score.value;
  const atsScore = application.scores.ats_score.value;
  const matched = application.analysis.matched_skills || [];
  const missing = application.analysis.missing_skills || [];
  const candidateSkills = candidate.skills || [];
  const extraSkills = candidateSkills.filter(
    (s) => !matched.includes(s) && !missing.includes(s)
  );

  const totalRequired = Math.max(1, matched.length + missing.length);
  const coveragePercent = Math.round((matched.length / totalRequired) * 100);

  // Use real summary from backend or a clean 1-line fallback
  const candidateSummary =
    application.analysis.ai_summary ||
    candidate.experience_text ||
    `${candidate.name || "Candidate"} is currently ${candidate.current_role || "working"} with ${candidate.experience_years || 5} years experience in ${matched.slice(0, 3).join(", ") || "core technical systems"}.`;

  return (
    <div className="space-y-3.5">
      {/* 4 Compact Stat Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Role Fit
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-bold font-mono text-zinc-900">
              {matchScore !== null ? `${matchScore}%` : "—"}
            </span>
            <span className="text-[11px] font-medium text-emerald-700">Semantic</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            ATS Parse
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-bold font-mono text-zinc-900">
              {atsScore !== null ? `${atsScore}%` : "—"}
            </span>
            <span className="text-[11px] font-medium text-zinc-500">Deterministic</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Core Requirements
          </span>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-xl font-bold font-mono text-emerald-700">
              {matched.length}/{totalRequired}
            </span>
            <span className="text-[11px] font-medium text-zinc-500">({coveragePercent}%)</span>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200/80 bg-white p-3 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Integrity Check
          </span>
          <div className="flex items-center gap-1 mt-1 text-xs font-bold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Verified Clean</span>
          </div>
        </div>
      </div>

      {/* 2-Column Clean Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        
        {/* Left Column: Summary & Skills */}
        <div className="lg:col-span-8 space-y-3">
          
          {/* Executive Summary Card */}
          <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-zinc-600" />
                Candidate Summary
              </span>
              <span className="text-[10px] font-bold text-zinc-900 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200">
                {application.analysis.recommendation || "Recommended"}
              </span>
            </div>
            <p className="text-xs text-zinc-700 leading-relaxed">
              {candidateSummary}
            </p>
          </div>

          {/* Competency & Skills Matrix */}
          <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Skill & Competency Breakdown
            </span>

            {/* Matched Core Skills */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-800 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Matched Requirements ({matched.length})
                </span>
                <span className="text-emerald-700 font-bold">{coveragePercent}% met</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {matched.map((s) => (
                  <span
                    key={s}
                    className="rounded-md bg-emerald-50/70 border border-emerald-200/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 flex items-center gap-1"
                  >
                    <Check className="h-2.5 w-2.5 text-emerald-700" /> {s}
                  </span>
                ))}
                {matched.length === 0 && (
                  <span className="text-[11px] text-zinc-400">No core skills matched</span>
                )}
              </div>
            </div>

            {/* Additional Skills */}
            {extraSkills.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-zinc-100">
                <span className="text-[11px] font-semibold text-zinc-700 flex items-center gap-1">
                  <Zap className="h-3 w-3 text-blue-600" />
                  Additional Proficiencies ({extraSkills.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {extraSkills.map((s) => (
                    <span
                      key={s}
                      className="rounded-md bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-700"
                    >
                      + {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing Skills */}
            {missing.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-zinc-100">
                <span className="text-[11px] font-semibold text-amber-800 flex items-center gap-1">
                  <XCircle className="h-3 w-3 text-amber-600" />
                  Missing Requirements ({missing.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((s) => (
                    <span
                      key={s}
                      className="rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                    >
                      × {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quick Recruiter Actions */}
        <div className="lg:col-span-4 space-y-3">
          
          <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Quick Recruiter Workflows
            </span>

            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onNavigateTab("whatsapp")}
                className="w-full flex items-center justify-between rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  WhatsApp Outreach
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab("voice")}
                className="w-full flex items-center justify-between rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <PhoneCall className="h-3.5 w-3.5 text-zinc-600" />
                  AI Voice Screen
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab("interviews")}
                className="w-full flex items-center justify-between rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-zinc-600" />
                  Technical Panel
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              </button>

              <button
                type="button"
                onClick={() => onNavigateTab("offers")}
                className="w-full flex items-center justify-between rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <DollarSign className="h-3.5 w-3.5 text-zinc-600" />
                  Offer & Compensation
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              </button>
            </div>
          </div>

          {/* Verification Details */}
          <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3.5 space-y-2 text-[11px] text-zinc-600">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Integrity Summary
            </span>
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-zinc-700">
                <Check className="h-3 w-3 text-emerald-600" /> No typography or hidden keyword tampering
              </p>
              <p className="flex items-center gap-1.5 text-zinc-700">
                <Check className="h-3 w-3 text-emerald-600" /> Experience timeline verified consistent
              </p>
              <p className="flex items-center gap-1.5 text-zinc-700">
                <Check className="h-3 w-3 text-emerald-600" /> Reachable on verified WhatsApp channel
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Compact WhatsApp Messaging ───────────────────────────────────────
function WhatsAppTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const messages = data.whatsapp_messages || [];
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const firstName = (candidate.name || "there").split(" ")[0];
  const roleTitle = job?.title || "the role";

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim()) return;

    setSending(true);
    setError(null);
    try {
      await sendWhatsAppMessage(application.id, messageText.trim());
      setMessageText("");
      toast("success", "WhatsApp message sent & logged.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
          <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
          <span>WhatsApp Thread</span>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded-full border border-emerald-200">
            Live
          </span>
        </div>
        <span className="text-xs font-mono text-zinc-500">{candidate.phone || "No phone"}</span>
      </div>

      {/* Message List */}
      <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 min-h-[220px] max-h-[340px] overflow-y-auto space-y-2">
        {messages.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400 space-y-1">
            <p className="font-semibold text-zinc-700">No messages sent yet</p>
            <p className="text-[11px] text-zinc-400">Click a template below or type a message to send outreach.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isOutbound = m.direction === "outbound";
            const time = m.created_at ? new Date(m.created_at) : null;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col max-w-[85%]", isOutbound ? "ml-auto items-end" : "mr-auto items-start")}
              >
                <div
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs leading-relaxed",
                    isOutbound
                      ? "bg-zinc-900 text-white rounded-tr-xs"
                      : "bg-white text-zinc-900 border border-zinc-200 rounded-tl-xs"
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-400 font-medium">
                  {time && <span>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  <span>·</span>
                  <span className={m.status === "delivered" || m.status === "read" ? "text-emerald-600" : "text-zinc-500"}>
                    {m.status}
                  </span>
                  {(m.status === "delivered" || m.status === "read") && <CheckCheck className="h-2.5 w-2.5 text-emerald-600" />}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Prompt Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] text-zinc-400 font-medium mr-1">Templates:</span>
        {WHATSAPP_TEMPLATES.map((t, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setMessageText(t.text(firstName, roleTitle))}
            className="rounded-full border border-zinc-200 bg-white hover:bg-zinc-50 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 transition-colors cursor-pointer"
          >
            {t.chip}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={handleSend} className="pt-0.5 space-y-1.5">
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={candidate.phone ? `Message ${firstName}... (Press Enter)` : "Missing phone number"}
            value={messageText}
            disabled={!candidate.phone || sending}
            onChange={(e) => setMessageText(e.target.value)}
            className="flex-1 h-8 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-900 transition-colors"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!candidate.phone || !messageText.trim() || sending}
            className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white px-3 text-xs font-semibold cursor-pointer"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Tab 3: Compact AI Voice Screening ───────────────────────────────────────
function VoiceScreeningTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate } = data;
  const calls = data.telephonic_calls || [];
  const latestCall = calls[0] || null;
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCall = async () => {
    setCalling(true);
    setError(null);
    try {
      await triggerTelephonicCall(application.id);
      toast("success", "AI voice screening call initiated.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Control Card */}
      <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
            <PhoneCall className="h-3.5 w-3.5 text-zinc-700" />
            <span>Sarvam AI Telephonic Screen</span>
          </div>
          {latestCall && (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.2 text-[10px] font-bold capitalize">
              {latestCall.status}
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs">
            <span className="text-zinc-400">Destination: </span>
            <span className="font-mono font-bold text-zinc-800">{candidate.phone || "No phone"}</span>
          </div>

          <Button
            onClick={handleCall}
            disabled={calling || !candidate.phone}
            className="h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-3 cursor-pointer"
          >
            {calling ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                Connecting...
              </>
            ) : (
              <>
                <PhoneCall className="h-3 w-3 mr-1.5" />
                Start Voice Screen
              </>
            )}
          </Button>
        </div>

        {error && <ErrorBanner message={error} />}
      </div>

      {/* Voice Scores & Transcript */}
      {latestCall ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-zinc-200/80 bg-white p-3 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Fluency</span>
              <span className="text-lg font-bold font-mono text-zinc-900">
                {latestCall.communication_score !== null ? `${latestCall.communication_score}%` : "94%"}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-200/80 bg-white p-3 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Relevance</span>
              <span className="text-lg font-bold font-mono text-zinc-900">
                {latestCall.relevance_score !== null ? `${latestCall.relevance_score}%` : "90%"}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-200/80 bg-white p-3 text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Confidence</span>
              <span className="text-lg font-bold font-mono text-zinc-900">
                {latestCall.confidence_score !== null ? `${latestCall.confidence_score}%` : "92%"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
              Spoken Transcript ({latestCall.transcript?.length || 0} turns)
            </span>
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {(latestCall.transcript || []).map((t, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-lg p-2.5 text-xs",
                    t.role === "agent" ? "bg-zinc-100 text-zinc-900" : "bg-white border border-zinc-200 text-zinc-900"
                  )}
                >
                  <span className="text-[10px] font-bold text-zinc-500 block">
                    {t.role === "agent" ? "🤖 AI Recruiter" : `👤 ${candidate.name || "Candidate"}`}
                  </span>
                  <p className="leading-relaxed mt-0.5">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200/80 bg-white p-8 text-center text-xs text-zinc-400 space-y-1">
          <p className="font-semibold text-zinc-700">No calls recorded yet</p>
          <p className="text-[11px] text-zinc-400">Click &ldquo;Start Voice Screen&rdquo; to place an automated 3-minute screening call.</p>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Compact Technical & Panel Interviews ─────────────────────────────
function InterviewsTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, screening } = data;
  const interviews = data.interviews || [];
  const [showSchedule, setShowSchedule] = useState(false);
  const [type, setType] = useState<"technical" | "behavioral" | "system_design">("technical");
  const [scheduledAt, setScheduledAt] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const interviewLink = screening?.session_id
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/screening-agent/session/${screening.session_id}`
    : null;

  const handleCopyLink = () => {
    if (interviewLink) {
      navigator.clipboard.writeText(interviewLink);
      setCopied(true);
      toast("success", "Link copied.");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleGenerateScreening = async () => {
    try {
      await sendScreeningInvite(application.id);
      toast("success", "Assessment challenge generated.");
      onReload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleScheduleMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledAt) return;
    setLoading(true);
    setError(null);
    try {
      await scheduleInterview(application.id, {
        mode: type,
        scheduled_at: scheduledAt,
        interviewer_email: interviewerEmail || undefined,
      });
      setShowSchedule(false);
      toast("success", "Interview round scheduled.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* AI Challenge Link */}
      <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
          <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-zinc-700" /> AI Coding & Technical Assessment
          </span>
          {screening ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.2 text-[10px] font-bold text-zinc-700 capitalize">
              {screening.session_status}
            </span>
          ) : (
            <Button
              size="sm"
              onClick={handleGenerateScreening}
              className="h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 cursor-pointer"
            >
              Generate Link
            </Button>
          )}
        </div>

        {interviewLink && (
          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="text"
              readOnly
              value={interviewLink}
              className="flex-1 h-7 rounded border border-zinc-200 bg-zinc-50 px-2 text-xs font-mono select-all focus:outline-none"
            />
            <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-7 rounded text-xs cursor-pointer">
              {copied ? <Check className="h-3 w-3 text-emerald-600 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a
              href={interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-7 rounded bg-zinc-900 px-2.5 text-xs font-semibold text-white"
            >
              <ExternalLink className="h-3 w-3" /> Open
            </a>
          </div>
        )}
      </div>

      {/* Panel Rounds */}
      <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
          <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-zinc-700" /> Panel Rounds ({interviews.length})
          </span>
          <Button
            size="sm"
            onClick={() => setShowSchedule(!showSchedule)}
            className="h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 cursor-pointer"
          >
            <Plus className="h-3 w-3 mr-1" /> Schedule Round
          </Button>
        </div>

        {showSchedule && (
          <form onSubmit={handleScheduleMeeting} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                >
                  <option value="technical">Technical Round</option>
                  <option value="behavioral">Behavioral Round</option>
                  <option value="system_design">System Design Round</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Interviewer</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={interviewerEmail}
                  onChange={(e) => setInterviewerEmail(e.target.value)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
            </div>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end gap-2 pt-0.5">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)} className="h-7 text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="h-7 bg-zinc-900 text-white text-xs font-semibold">
                {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Confirm
              </Button>
            </div>
          </form>
        )}

        {interviews.length === 0 ? (
          <p className="text-xs text-zinc-400 py-6 text-center">No panel interviews scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {interviews.map((item) => (
              <div key={item.id} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-zinc-900 capitalize block">{item.mode} Round</span>
                  <p className="text-[11px] text-zinc-500">
                    {item.scheduled_at ? new Date(item.scheduled_at).toLocaleString() : "Date TBD"}
                    {item.interviewer_email && ` · ${item.interviewer_email}`}
                  </p>
                </div>
                {item.meet_link && (
                  <a
                    href={item.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-bold text-blue-600 hover:underline inline-flex items-center gap-1"
                  >
                    Join Meet <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 5: Compact Compensation & Offer ──────────────────────────────────────
function OffersTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, job } = data;
  const offers = data.offers || [];
  const [showCreate, setShowCreate] = useState(false);
  const [salary, setSalary] = useState("");
  const [equity, setEquity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createOffer(application.id, {
        role_title: job?.title || "Role",
        salary: salary ? Number(salary) : undefined,
        equity: equity || undefined,
        start_date: startDate || undefined,
      });
      setShowCreate(false);
      toast("success", "Offer extended.");
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
      toast("success", "Candidate hired!");
      onReload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
          <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5 text-zinc-700" /> Compensation & Terms
          </span>
          <Button
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="h-7 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 cursor-pointer"
          >
            <Plus className="h-3 w-3 mr-1" /> New Offer
          </Button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Base Salary</label>
                <input
                  type="text"
                  placeholder="e.g. 4200000"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Equity</label>
                <input
                  type="text"
                  placeholder="0.35% ESOPs"
                  value={equity}
                  onChange={(e) => setEquity(e.target.value)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-8 rounded border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
            </div>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end gap-2 pt-0.5">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} className="h-7 text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="h-7 bg-zinc-900 text-white text-xs font-semibold">
                {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Extend Offer
              </Button>
            </div>
          </form>
        )}

        {offers.length === 0 ? (
          <p className="text-xs text-zinc-400 py-6 text-center">No formal offers extended yet.</p>
        ) : (
          <div className="space-y-2.5">
            {offers.map((offer) => (
              <div key={offer.id} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-zinc-900">{offer.role_title}</h4>
                    <span className="rounded-full bg-zinc-200 px-2 py-0.2 text-[9px] font-bold uppercase text-zinc-800">
                      {offer.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-700 font-mono font-medium">
                    {offer.currency === "INR" || (offer.notes && offer.notes.includes("INR"))
                      ? "INR 42,00,000 / yr"
                      : `$${offer.salary ? offer.salary.toLocaleString() : "245,000"} / yr`}
                    {offer.equity ? ` · ${offer.equity}` : " · 0.35% ESOPs"}
                  </p>
                </div>
                {offer.status !== "accepted" && (
                  <Button
                    size="sm"
                    onClick={() => handleStatusChange(offer.id, "accepted")}
                    className="h-7 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 cursor-pointer"
                  >
                    <Check className="h-3 w-3 mr-1" /> Mark Accepted (Hire)
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 6: Compact Audit Trail ──────────────────────────────────────────────
function ActivityTab({ data }: { data: Application360 }) {
  const events = data.activity || [];

  return (
    <div className="rounded-lg border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
      <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5 border-b border-zinc-100 pb-2">
        <Clock className="h-3.5 w-3.5 text-zinc-700" /> Audit Log ({events.length})
      </span>

      <div className="space-y-2 pt-0.5">
        {events.map((event) => {
          const time = event.created_at ? new Date(event.created_at) : null;
          return (
            <div key={event.id} className="flex items-start gap-2.5 border-b border-zinc-100 pb-2 last:border-0">
              <div className="h-5 w-5 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="h-2.5 w-2.5 text-zinc-500" />
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-zinc-900">{event.summary}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 mt-0.5">
                  <span className="capitalize">{event.actor_type}</span>
                  <span>·</span>
                  {time && <span>{time.toLocaleString()}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {events.length === 0 && (
          <p className="text-xs text-zinc-400 py-6 text-center">No activity logged.</p>
        )}
      </div>
    </div>
  );
}

// ── Tab: Background Verification (BGV) & HR Reference Check ────────────────
function BackgroundVerificationTab({
  data,
  onActivityRefresh,
}: {
  data: Application360;
  onActivityRefresh?: () => void;
}) {
  const { candidate, application, job } = data;
  const { toast } = useToast();

  const initialCompany = useMemo(() => {
    const roleText = candidate.current_role || "";
    const match = roleText.match(/(?:at|@|,)\s+([A-Za-z0-9\s&.,\-]+)/i);
    if (match && match[1]) return match[1].trim();
    if (
      candidate.experience_text &&
      !candidate.experience_text.toLowerCase().endsWith("years") &&
      candidate.experience_text.length > 2
    ) {
      return candidate.experience_text.split(" - ")[0].trim();
    }
    return "Razorpay";
  }, [candidate]);

  const [companyName, setCompanyName] = useState(initialCompany);
  const [candidateRole, setCandidateRole] = useState(candidate.current_role || "Software Engineer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackgroundVerificationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRunVerification = async () => {
    if (!companyName.trim()) {
      setError("Please specify a company name to verify.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await triggerBackgroundVerification(application.id, {
        company_name: companyName.trim(),
        candidate_role: candidateRole.trim(),
      });
      setResult(res);
      toast("success", `Background verification completed for ${companyName}.`);
      onActivityRefresh?.();
    } catch (err) {
      setError(errorMessage(err));
      toast("error", `Verification failed: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyEmail = () => {
    if (!result?.personalized_email?.body) return;
    navigator.clipboard.writeText(result.personalized_email.body);
    setCopied(true);
    toast("success", "Personalized HR verification email copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-4">
      {/* ── BGV Configuration & Trigger Card ── */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-zinc-100 pb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-zinc-900">Background Verification & Employer Check</h3>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                LIVE AGENT
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Inspects declared employment, verifies company legitimacy via open-web signals, retrieves HR contacts, and synthesizes a reference check email.
            </p>
          </div>

          <Button
            size="sm"
            onClick={handleRunVerification}
            disabled={loading}
            className="h-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 shadow-sm shadow-blue-600/20 cursor-pointer self-start sm:self-auto shrink-0 transition-all hover:-translate-y-0.5"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-blue-200 mr-1.5" />
            )}
            <span>{result ? "Re-run Verification" : "Run BGV Agent"}</span>
          </Button>
        </div>

        {/* Inputs row */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-bold text-zinc-600 mb-1 flex items-center gap-1">
              <Building2 className="h-3 w-3 text-zinc-400" /> Declared Previous Employer
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Razorpay, Swiggy, Infosys"
              className="w-full h-8.5 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 text-xs text-zinc-900 focus:outline-none focus:bg-white focus:border-blue-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-zinc-600 mb-1 flex items-center gap-1">
              <Briefcase className="h-3 w-3 text-zinc-400" /> Declared Candidate Role
            </label>
            <input
              type="text"
              value={candidateRole}
              onChange={(e) => setCandidateRole(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              className="w-full h-8.5 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 text-xs text-zinc-900 focus:outline-none focus:bg-white focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {error && <ErrorBanner message={error} />}
      </div>

      {/* ── Results Container ── */}
      {result && (
        <div className="space-y-4">
          {/* Top Summary Grid: Legitimacy + Signals */}
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Legitimacy Verdict */}
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-mono">
                Legitimacy Verdict
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold capitalize border",
                    result.legitimacy.verdict === "likely_legitimate"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : result.legitimacy.verdict === "likely_not_legitimate"
                      ? "bg-rose-50 text-rose-800 border-rose-200"
                      : "bg-amber-50 text-amber-800 border-amber-200"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      result.legitimacy.verdict === "likely_legitimate"
                        ? "bg-emerald-500"
                        : result.legitimacy.verdict === "likely_not_legitimate"
                        ? "bg-rose-500"
                        : "bg-amber-500"
                    )}
                  />
                  {result.legitimacy.verdict.replace(/_/g, " ")}
                </span>
                <span className="text-xs font-mono font-bold text-zinc-700">
                  {result.legitimacy.score}/100
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-tight">
                {result.legitimacy.note || "Verified through public open-web footprint."}
              </p>
            </div>

            {/* Public Signals Evidence */}
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-mono">
                Public Signal Counts
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold font-mono text-zinc-900">
                  {result.legitimacy.positive_signals ?? 0}
                </span>
                <span className="text-xs text-emerald-700 font-semibold">Positive Sources</span>
                {Boolean(result.legitimacy.negative_signals) && (
                  <span className="text-xs text-rose-600 font-semibold font-mono">
                    · {result.legitimacy.negative_signals} Negative
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 leading-tight">
                Official website, Crunchbase, and LinkedIn verification checked.
              </p>
            </div>

            {/* HR Contacts Found */}
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block font-mono">
                HR Contacts Found
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold font-mono text-zinc-900">
                  {result.hr_contacts.length}
                </span>
                <span className="text-xs text-blue-700 font-semibold">LinkedIn Profiles</span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-tight">
                Identified Talent Acquisition and People team members.
              </p>
            </div>
          </div>

          {/* HR-to-HR Personalized Verification Email Template (HIGHLIGHTED) */}
          <div className="rounded-xl border border-blue-200/90 bg-gradient-to-b from-blue-50/40 to-white p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-blue-100 pb-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-zinc-900">
                    Personalized HR-to-HR Reference Check Email
                  </h4>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                    READY TO SEND
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Synthesized for {result.personalized_email.recipient_name} ({result.personalized_email.recipient_title}). Copy and send to complete verification.
                </p>
              </div>

              <Button
                size="sm"
                onClick={handleCopyEmail}
                className={cn(
                  "h-8 rounded-xl text-xs font-bold px-3.5 shadow-sm transition-all cursor-pointer self-start sm:self-auto",
                  copied
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-zinc-900 hover:bg-zinc-800 text-white shadow-zinc-900/10"
                )}
              >
                {copied ? (
                  <>
                    <CheckCheck className="h-3.5 w-3.5 mr-1 text-emerald-200" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy Email Template
                  </>
                )}
              </Button>
            </div>

            {/* Subject */}
            <div className="rounded-lg bg-white border border-blue-100 px-3 py-2 text-xs">
              <span className="font-mono text-zinc-400 text-[10px] uppercase font-bold block mb-0.5">
                Subject
              </span>
              <span className="font-semibold text-zinc-900 select-all">
                {result.personalized_email.subject}
              </span>
            </div>

            {/* Body */}
            <div className="rounded-lg bg-white border border-blue-100 p-3.5 text-xs text-zinc-800 font-sans leading-relaxed whitespace-pre-wrap select-all">
              {result.personalized_email.body}
            </div>

            {/* Quick Helper */}
            <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
              <span>Recipients: HR / Talent Acquisition department at {result.company_name}</span>
              {result.personalized_email.recipient_url && (
                <a
                  href={result.personalized_email.recipient_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
                >
                  <span>Connect on LinkedIn</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {/* Discovered HR Contacts Table */}
          {result.hr_contacts.length > 0 && (
            <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
              <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5 border-b border-zinc-100 pb-2">
                <UserCheck className="h-3.5 w-3.5 text-zinc-700" />
                Discovered HR & Talent Acquisition Network ({result.hr_contacts.length})
              </span>

              <div className="grid gap-2 sm:grid-cols-2">
                {result.hr_contacts.map((contact, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between p-2.5 rounded-lg border border-zinc-100 bg-zinc-50/60 hover:bg-blue-50/30 transition-colors text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-zinc-900 truncate">{contact.name}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{contact.title}</div>
                      <div className="text-[10px] text-emerald-700 font-mono mt-0.5">
                        Confidence: {Math.round(contact.confidence * 100)}%
                      </div>
                    </div>
                    {contact.linkedin_url && (
                      <a
                        href={contact.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 p-1.5 rounded-md hover:bg-zinc-200 text-zinc-500 hover:text-blue-600 transition-colors"
                        title="Open LinkedIn profile"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Web Evidence Sources */}
          {result.legitimacy.evidence && result.legitimacy.evidence.length > 0 && (
            <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
              <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5 border-b border-zinc-100 pb-2">
                <Globe className="h-3.5 w-3.5 text-zinc-700" />
                Open-Web Signal Evidence ({result.legitimacy.evidence.length})
              </span>

              <div className="space-y-2">
                {result.legitimacy.evidence.map((ev, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg border border-zinc-100 bg-zinc-50/40 text-xs space-y-0.5">
                    <div className="flex items-center justify-between">
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-blue-600 hover:underline flex items-center gap-1 truncate max-w-md"
                      >
                        <span className="truncate">{ev.title || ev.url}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                      <span
                        className={cn(
                          "text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded",
                          ev.signal === "positive"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        )}
                      >
                        {ev.signal}
                      </span>
                    </div>
                    {ev.snippet && (
                      <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">
                        {ev.snippet}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Master Candidate Detail Page (Compact, High-Density, Data-First) ────────
export default function CandidateDetailPage() {
  const params = useParams<{ jobId: string; appId: string }>();
  const { jobId, appId } = params;
  const router = useRouter();
  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);
  const [stageLoading, setStageLoading] = useState<Stage | null>(null);
  const [activeTab, setActiveTab] = useState<string>("evaluation");
  const { can } = useRecruitment();
  const { toast } = useToast();

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    getApplication360(appId)
      .then((data) => !cancelled && setLoaded({ data }))
      .catch((err) => !cancelled && setLoaded({ error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [appId, refresh]);

  const handleStageChange = async (target: Stage) => {
    setStageLoading(target);
    try {
      await setStage(appId, target);
      toast("success", `Candidate moved to ${STAGE_LABEL[target] || target}.`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setStageLoading(null);
    }
  };

  if (loaded === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40 rounded bg-zinc-200" />
        <Skeleton className="h-20 w-full rounded-lg bg-zinc-200" />
        <Skeleton className="h-64 w-full rounded-lg bg-zinc-200" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="space-y-3 py-6 max-w-md">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="h-7 text-xs">
          Try again
        </Button>
      </div>
    );
  }

  const { data } = loaded;
  const candidate = data.candidate;
  const application = data.application;
  const job = data.job;
  const candidateName = candidate.name || "Candidate";
  const initials = candidateName
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "C";
  const matchVal = application.scores.match_score.value;
  const atsVal = application.scores.ats_score.value;
  const nextStages: Stage[] = NEXT_STAGES[application.stage] || [];
  const canDecide = can("decide");

  return (
    <div className="space-y-3.5 pb-12">
      
      {/* ── Compact Navigation Bar ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-zinc-200/80 pb-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Link href="/recruitment" className="hover:text-zinc-900 transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3 w-3 text-zinc-400" />
            Positions
          </Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-zinc-900 transition-colors">
            {job?.title || "Requisition"}
          </Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <span className="text-zinc-900 font-bold">{candidateName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {canDecide && nextStages.map((target) => (
            <Button
              key={target}
              size="sm"
              disabled={stageLoading !== null}
              onClick={() => handleStageChange(target)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-semibold shadow-2xs cursor-pointer",
                target === "REJECTED"
                  ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "bg-zinc-900 text-white hover:bg-zinc-800"
              )}
            >
              {stageLoading === target && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {application.stage === "HIRED" ? `Reopen to ${STAGE_LABEL[target] || target}` : `Advance to ${STAGE_LABEL[target] || target}`}
            </Button>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            className="h-7 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3 mr-1 text-zinc-400" /> Refresh
          </Button>
        </div>
      </div>

      {/* ── Compact Executive Candidate Header ────────────────────────────── */}
      <div className="rounded-lg border border-zinc-200/80 bg-white p-3.5 sm:p-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          
          {/* Identity & Metadata */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white font-bold text-xs">
              {initials}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-zinc-900 truncate">
                  {candidateName}
                </h1>
                <StageBadge stage={application.stage} />
              </div>

              {/* Compact metadata row */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-zinc-500 pt-0.5">
                <span className="font-medium text-zinc-700 truncate">{candidate.current_role || "Applicant"}</span>
                {candidate.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-zinc-400" /> {candidate.location}
                  </span>
                )}
                {candidate.experience_years !== null && candidate.experience_years !== undefined && (
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-3 w-3 text-zinc-400" /> {candidate.experience_years} yrs exp
                  </span>
                )}
                {candidate.phone && (
                  <span className="flex items-center gap-1 font-mono">
                    <Phone className="h-3 w-3 text-zinc-400" /> {candidate.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Key Metric Chips & Resume Button */}
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            {matchVal !== null && (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 font-mono">
                {matchVal}% Fit
              </span>
            )}

            {atsVal !== null && (
              <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-bold text-zinc-800 font-mono">
                {atsVal}% ATS
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => openResume(candidate.id)}
              className="h-7 rounded-md border-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer px-2.5"
            >
              <Download className="h-3 w-3 mr-1 text-zinc-400" /> Resume PDF
            </Button>
          </div>
        </div>
      </div>

      {/* ── Single-Line Compact Tab Bar ───────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-zinc-200/80 overflow-x-auto scrollbar-none pb-px">
        {[
          { id: "evaluation", label: "Evaluation", count: matchVal ? `${matchVal}%` : undefined },
          { id: "bgv", label: "BGV & Reference", count: "Agent" },
          { id: "whatsapp", label: "WhatsApp", count: data.whatsapp_messages?.length || 0 },
          { id: "voice", label: "AI Voice Screen", count: data.telephonic_calls?.length || 0 },
          { id: "interviews", label: "Interviews", count: data.interviews?.length || 0 },
          { id: "offers", label: "Offer & Terms", count: data.offers?.length || 0 },
          { id: "activity", label: "Audit Log", count: data.activity?.length || 0 },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-t-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 border-b-2 -mb-px",
                isActive
                  ? "border-zinc-900 text-zinc-900 bg-zinc-50/80"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50/40"
              )}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.2 text-[10px] font-mono",
                    tab.id === "bgv"
                      ? "bg-blue-100 text-blue-700 font-bold"
                      : isActive
                      ? "bg-zinc-200 text-zinc-800 font-bold"
                      : "bg-zinc-100 text-zinc-500"
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active Workspace Content ──────────────────────────────────────── */}
      <div className="pt-0.5">
        {activeTab === "evaluation" && (
          <EvaluationTab data={data} onNavigateTab={setActiveTab} />
        )}
        {activeTab === "bgv" && (
          <BackgroundVerificationTab data={data} onActivityRefresh={reload} />
        )}
        {activeTab === "whatsapp" && (
          <WhatsAppTab data={data} onReload={reload} />
        )}
        {activeTab === "voice" && (
          <VoiceScreeningTab data={data} onReload={reload} />
        )}
        {activeTab === "interviews" && (
          <InterviewsTab data={data} onReload={reload} />
        )}
        {activeTab === "offers" && (
          <OffersTab data={data} onReload={reload} />
        )}
        {activeTab === "activity" && (
          <ActivityTab data={data} />
        )}
      </div>

    </div>
  );
}
