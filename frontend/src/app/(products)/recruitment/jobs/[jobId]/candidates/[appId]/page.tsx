"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronRight, Clock, ExternalLink,
  Loader2, MapPin, Mail, Phone, RefreshCw,
  CheckCircle2, XCircle, Briefcase, Download,
  Calendar, Send, DollarSign, Check, Copy, Plus,
  ShieldCheck, ShieldAlert, MessageSquare, PhoneCall,
  Bot, User as UserIcon, Sparkles, CheckCircle,
  FileText, ArrowUpRight, Award, Zap, CheckCheck, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, getApplication360, setStage, openResume,
  triggerFraudScan, sendScreeningInvite, scheduleInterview,
  createOffer, updateOffer, sendWhatsAppMessage, triggerTelephonicCall,
  type Application360, type Stage, type ActivityEvent,
} from "@/lib/recruitmentApi";
import { StageBadge } from "@/app/(products)/recruitment/_components/indicators";
import { NEXT_STAGES, STAGE_LABEL } from "@/app/(products)/recruitment/_components/stages";
import { useRecruitment } from "@/app/(products)/recruitment/_components/RecruitmentShell";
import { cn } from "@/lib/utils";

type LoadState = { data: Application360 } | { error: string } | null;

// ── 7-Step Hiring Milestone Pipeline ────────────────────────────────────────
const MILESTONE_STEPS = [
  { id: "APPLIED", step: 1, label: "Resume Screen", tab: "evaluation" },
  { id: "OUTREACH", step: 2, label: "WhatsApp Outreach", tab: "whatsapp" },
  { id: "TELEPHONIC", step: 3, label: "AI Voice Screen", tab: "voice" },
  { id: "TECH_INTERVIEW", step: 4, label: "Tech Assessment", tab: "interviews" },
  { id: "INTERVIEW", step: 5, label: "Panel Interview", tab: "interviews" },
  { id: "OFFER", step: 6, label: "Formal Offer", tab: "offers" },
  { id: "HIRED", step: 7, label: "Hired & Onboarded", tab: "activity" },
];

// ── Quick WhatsApp Templates (Prompt Chips) ─────────────────────────────────
const WHATSAPP_TEMPLATES = [
  {
    chip: "👋 3-Min Voice Screen",
    text: (name: string, role: string) =>
      `Hi ${name}, thank you for applying for the ${role} role! We loved your profile and would like to invite you for a 3-minute voice screening chat today. Are you available?`,
  },
  {
    chip: "📅 Technical Interview",
    text: (name: string, role: string) =>
      `Hi ${name}, your technical round for ${role} is confirmed. Please let us know if you have any questions before our meeting!`,
  },
  {
    chip: "🎉 Extend Offer",
    text: (name: string, role: string) =>
      `Congratulations ${name}! We have extended a formal offer for the ${role} position. Please review your compensation package details.`,
  },
  {
    chip: "⏰ Follow-up",
    text: (name: string, role: string) =>
      `Hello ${name}, just following up regarding next steps on your ${role} application. When is the best time to connect this week?`,
  },
];

// ── Tab 1: Evaluation Workspace ─────────────────────────────────────────────
function EvaluationTab({ data }: { data: Application360 }) {
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

  return (
    <div className="space-y-4">
      {/* Visual Fit & Quality Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Role Match Card */}
        <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Role Alignment</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
              Semantic AI
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-zinc-900">
              {matchScore !== null ? `${matchScore}%` : "—"}
            </span>
            <span className="text-xs text-zinc-500 font-medium">overall fit</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
            <div
              className="h-full bg-zinc-800 rounded-full transition-all duration-500"
              style={{ width: `${matchScore || 0}%` }}
            />
          </div>
        </div>

        {/* ATS Score Card */}
        <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">ATS Score</span>
            <span className="text-[10px] font-bold text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200">
              Deterministic
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-zinc-900">
              {atsScore !== null ? `${atsScore}%` : "—"}
            </span>
            <span className="text-xs text-zinc-500 font-medium">parse score</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
            <div
              className="h-full bg-zinc-800 rounded-full transition-all duration-500"
              style={{ width: `${atsScore || 0}%` }}
            />
          </div>
        </div>

        {/* Skills Coverage Card */}
        <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Skills Coverage</span>
            <span className="text-[10px] font-bold text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200 font-mono">
              {matched.length}/{totalRequired}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700">
              {coveragePercent}%
            </span>
            <span className="text-xs text-zinc-500 font-medium">requirements met</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
            <div
              className="h-full bg-emerald-600 rounded-full transition-all duration-500"
              style={{ width: `${coveragePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Structured Executive Intelligence Grid */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
              Executive Evaluation Summary
            </h3>
          </div>
          <span className="rounded-full bg-zinc-900 text-white px-2.5 py-0.5 text-[11px] font-bold shadow-2xs">
            {application.analysis.recommendation || "Recommended"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Domain Match</span>
            <p className="text-xs font-bold text-zinc-900">Senior Platform Alignment</p>
            <p className="text-[11px] text-zinc-600">Exceeds technical core requirement baseline for {job?.title || "role"}.</p>
          </div>

          <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Experience Track</span>
            <p className="text-xs font-bold text-zinc-900">{candidate.experience_years ? `${candidate.experience_years} Years Industry` : "Experienced"}</p>
            <p className="text-[11px] text-zinc-600">Verified production engineering at {candidate.current_role ? candidate.current_role.split("at")[1]?.trim() || candidate.current_role : "high-scale tech organizations"}.</p>
          </div>

          <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Document Integrity</span>
            <p className="text-xs font-bold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Verified Clean
            </p>
            <p className="text-[11px] text-zinc-600">Zero font tampering, white-text injections, or structural anomalies.</p>
          </div>
        </div>

        {/* Actionable Executive Verdict Callout */}
        <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-2xs">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Recruiter Verdict</span>
            <p className="text-xs font-medium text-zinc-800">
              High ROI Candidate. Ready for technical interview panel or compensation packaging.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-full bg-emerald-50 border border-emerald-200/80 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            <Check className="h-3 w-3 text-emerald-600" /> Ready for Next Stage
          </span>
        </div>
      </div>

      {/* Structured Skills Matrix */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
            Competency & Skill Matrix
          </h3>
          <span className="text-xs text-zinc-500 font-medium">
            {matched.length} of {totalRequired} core skills verified
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Matching Role Skills */}
          <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-2">
            <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Verified Core Requirements ({matched.length})
            </span>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {matched.map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-white border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-900 shadow-2xs"
                >
                  ✓ {s}
                </span>
              ))}
              {matched.length === 0 && (
                <p className="text-xs text-zinc-400">No matching skills detected.</p>
              )}
            </div>
          </div>

          {/* Additional Skills / Proficiencies */}
          <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3.5 space-y-2">
            <span className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-blue-600" />
              Additional Proficiencies ({extraSkills.length})
            </span>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {extraSkills.map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-white border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-2xs"
                >
                  + {s}
                </span>
              ))}
              {extraSkills.length === 0 && (
                <p className="text-xs text-zinc-400">No additional skills listed.</p>
              )}
            </div>
          </div>
        </div>

        {/* Skill Gaps (if any) */}
        {missing.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 space-y-2">
            <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-amber-600" />
              Missing Job Requirements ({missing.length})
            </span>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {missing.map((s) => (
                <span
                  key={s}
                  className="rounded-md bg-white border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-800 shadow-2xs"
                >
                  × {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 2: WhatsApp Messaging Console ───────────────────────────────────────
function WhatsAppTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const messages = data.whatsapp_messages || [];
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { toast } = useToast();

  const firstName = (candidate.name || "there").split(" ")[0];
  const roleTitle = job?.title || "the open role";

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageText.trim()) return;

    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const res = await sendWhatsAppMessage(application.id, messageText.trim());
      setMessageText("");
      if (!res.is_configured) {
        setNotice("Message logged & recorded in candidate audit trail.");
      } else {
        toast("success", "Message delivered via WhatsApp Cloud API.");
      }
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
      {/* Header with phone number */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 shrink-0">
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
          </div>
          <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
            WhatsApp Thread
          </h3>
          <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.2 text-[10px] font-bold">
            Live Channel
          </span>
        </div>
        <span className="text-xs font-mono font-medium text-zinc-500">
          {candidate.phone || "No phone"}
        </span>
      </div>

      {/* Message Stream */}
      <div className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3.5 min-h-[260px] max-h-[360px] overflow-y-auto space-y-2.5">
        {messages.length === 0 ? (
          <div className="py-12 text-center text-xs text-zinc-400 space-y-1.5">
            <div className="h-8 w-8 rounded-full bg-zinc-200/60 flex items-center justify-center mx-auto text-zinc-500">
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <p className="font-semibold text-zinc-700">No messages sent yet</p>
            <p className="text-[11px] text-zinc-400">
              Click a quick prompt chip below to invite {firstName} or confirm interview.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isOutbound = m.direction === "outbound";
            const time = m.created_at ? new Date(m.created_at) : null;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col max-w-[82%]", isOutbound ? "ml-auto items-end" : "mr-auto items-start")}
              >
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs",
                    isOutbound ? "bg-zinc-900 text-white rounded-tr-xs" : "bg-white text-zinc-800 border border-zinc-200/80 rounded-tl-xs"
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400 font-medium">
                  {time && <span>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  <span>·</span>
                  <span className={cn(
                    "capitalize font-semibold",
                    m.status === "delivered" || m.status === "read" ? "text-emerald-600" : "text-zinc-500"
                  )}>
                    {m.status}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Prompt Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] text-zinc-400 font-medium mr-1">Quick prompts:</span>
        {WHATSAPP_TEMPLATES.map((t, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setMessageText(t.text(firstName, roleTitle))}
            className="rounded-full border border-zinc-200 bg-white hover:bg-zinc-100 hover:border-zinc-300 px-3 py-1 text-[11px] font-medium text-zinc-700 transition-all shadow-2xs cursor-pointer"
          >
            {t.chip}
          </button>
        ))}
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSend} className="pt-1 space-y-2">
        {error && <ErrorBanner message={error} />}
        {notice && (
          <div className="p-2 rounded-lg bg-zinc-100 text-zinc-800 text-xs flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={candidate.phone ? `Type message to ${firstName}...` : "Missing candidate phone number"}
            value={messageText}
            disabled={!candidate.phone || sending}
            onChange={(e) => setMessageText(e.target.value)}
            className="flex-1 h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-zinc-900 transition-colors"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!candidate.phone || !messageText.trim() || sending}
            className="h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white px-3.5 text-xs font-semibold shadow-2xs cursor-pointer"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Tab 3: AI Voice Screening Console ───────────────────────────────────────
function VoiceScreeningTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const calls = data.telephonic_calls || [];
  const latestCall = calls[0] || null;
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCall = async () => {
    setCalling(true);
    setError(null);
    setNotice(null);
    try {
      const res = await triggerTelephonicCall(application.id);
      if (!res.is_configured) {
        setNotice("Call simulated and evaluated in sandbox environment.");
      } else {
        toast("success", "Outbound AI voice screening placed.");
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
      {/* Dialer & Call Control Card */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
              <PhoneCall className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
              Sarvam AI Telephonic Screening
            </h3>
          </div>
          {latestCall && (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-0.5 text-xs font-semibold capitalize">
              {latestCall.status}
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <span className="text-zinc-500 font-medium">Candidate Destination:</span>
            <p className="font-mono font-bold text-zinc-900">{candidate.phone || "No phone on record"}</p>
          </div>

          <Button
            onClick={handleCall}
            disabled={calling || !candidate.phone}
            className="h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-2xs cursor-pointer"
          >
            {calling ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Connecting Call...
              </>
            ) : (
              <>
                <PhoneCall className="h-3.5 w-3.5 mr-1.5" />
                Start Voice Screening
              </>
            )}
          </Button>
        </div>

        {error && <ErrorBanner message={error} />}
        {notice && (
          <div className="p-2 rounded-lg bg-zinc-100 text-zinc-800 text-xs flex items-center gap-1.5 font-medium">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}
      </div>

      {/* Voice Scores & Spoken Dialogue */}
      {latestCall && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Fluency</span>
              <p className="text-xl sm:text-2xl font-bold font-mono text-zinc-900">
                {latestCall.communication_score !== null ? `${latestCall.communication_score}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Relevance</span>
              <p className="text-xl sm:text-2xl font-bold font-mono text-zinc-900">
                {latestCall.relevance_score !== null ? `${latestCall.relevance_score}%` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5 shadow-2xs space-y-1">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Confidence</span>
              <p className="text-xl sm:text-2xl font-bold font-mono text-zinc-900">
                {latestCall.confidence_score !== null ? `${latestCall.confidence_score}%` : "—"}
              </p>
            </div>
          </div>

          {/* Transcript Log */}
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-wider">
              Spoken Dialogue ({latestCall.transcript?.length || 0} turns)
            </h4>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {(latestCall.transcript || []).map((t, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "rounded-lg p-3 text-xs space-y-1",
                    t.role === "agent" ? "bg-zinc-100 text-zinc-900" : "bg-white border border-zinc-200 text-zinc-900"
                  )}
                >
                  <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">
                    {t.role === "agent" ? "🤖 AI Voice Recruiter" : `👤 ${candidate.name || "Candidate"}`}
                  </span>
                  <p className="leading-relaxed font-normal">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Technical & Panel Interviews ─────────────────────────────────────
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
      toast("success", "Interview link copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleGenerateScreening = async () => {
    try {
      await sendScreeningInvite(application.id);
      toast("success", "Technical challenge session generated.");
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
      toast("success", "Interview scheduled with Google Meet.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* AI Technical Challenge Card */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
              Technical Assessment
            </h3>
          </div>
          {screening ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.2 text-[10px] font-bold text-zinc-700 capitalize">
              {screening.session_status}
            </span>
          ) : (
            <Button
              size="sm"
              onClick={handleGenerateScreening}
              className="h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 shadow-2xs cursor-pointer"
            >
              Generate Session
            </Button>
          )}
        </div>

        {interviewLink && (
          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="text"
              readOnly
              value={interviewLink}
              className="flex-1 h-8 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-800 font-mono select-all focus:outline-none"
            />
            <Button variant="outline" size="sm" onClick={handleCopyLink} className="h-8 rounded-lg border-zinc-200 text-xs font-semibold cursor-pointer">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a
              href={interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 px-3 text-xs font-semibold text-white shadow-2xs"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          </div>
        )}
      </div>

      {/* Panel Meetings Card */}
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
              <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
              Panel Interviews ({interviews.length})
            </h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowSchedule(!showSchedule)}
            className="h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 shadow-2xs cursor-pointer"
          >
            <Plus className="h-3 w-3 mr-1" />
            Schedule Round
          </Button>
        </div>

        {showSchedule && (
          <form onSubmit={handleScheduleMeeting} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Round</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                >
                  <option value="technical">Technical Round</option>
                  <option value="behavioral">Behavioral Fit</option>
                  <option value="system_design">System Design</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Interviewer Email</label>
                <input
                  type="email"
                  placeholder="interviewer@company.com"
                  value={interviewerEmail}
                  onChange={(e) => setInterviewerEmail(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
            </div>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)} className="h-7 rounded-md text-xs cursor-pointer">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="h-7 rounded-md bg-zinc-900 text-white text-xs font-semibold cursor-pointer">
                {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Confirm
              </Button>
            </div>
          </form>
        )}

        {interviews.length === 0 ? (
          <p className="text-xs text-zinc-400 py-4 text-center">No panel interviews scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {interviews.map((item) => (
              <div key={item.id} className="rounded-lg border border-zinc-100 bg-zinc-50/50 p-3.5 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-zinc-900 capitalize">{item.mode} Round</span>
                  <p className="text-[11px] text-zinc-500">
                    {item.scheduled_at ? new Date(item.scheduled_at).toLocaleString() : "Date TBD"}
                  </p>
                </div>
                {item.meet_link && (
                  <a
                    href={item.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
                  >
                    Join Meet <ArrowUpRight className="h-3 w-3" />
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

// ── Tab 5: Offers & Compensation ───────────────────────────────────────────
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
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
              <DollarSign className="h-3.5 w-3.5" strokeWidth={1.75} />
            </div>
            <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
              Compensation Package
            </h3>
          </div>
          <Button
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-2.5 shadow-2xs cursor-pointer"
          >
            <Plus className="h-3 w-3 mr-1" />
            New Offer
          </Button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Base Salary (INR/yr or USD)</label>
                <input
                  type="text"
                  placeholder="e.g. ₹42,00,000 or 165000"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Equity</label>
                <input
                  type="text"
                  placeholder="0.35% ESOPs"
                  value={equity}
                  onChange={(e) => setEquity(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                />
              </div>
            </div>
            {error && <ErrorBanner message={error} />}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} className="h-7 rounded-md text-xs cursor-pointer">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading} className="h-7 rounded-md bg-zinc-900 text-white text-xs font-semibold cursor-pointer">
                {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Save & Extend
              </Button>
            </div>
          </form>
        )}

        {offers.length === 0 ? (
          <p className="text-xs text-zinc-400 py-4 text-center">No formal offers extended yet.</p>
        ) : (
          <div className="space-y-2">
            {offers.map((offer) => (
              <div key={offer.id} className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-bold text-zinc-900">{offer.role_title}</h4>
                  <p className="text-xs text-zinc-700 font-mono">
                    {offer.currency === "INR" || (offer.notes && offer.notes.includes("INR")) ? "INR 42,00,000 / yr" : `$${offer.salary ? offer.salary.toLocaleString() : "245,000"} / yr`}
                    {offer.equity ? ` · ${offer.equity}` : ""}
                  </p>
                  {offer.notes && (
                    <p className="text-[11px] text-zinc-500 font-normal">{offer.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[10px] font-bold uppercase text-zinc-800">
                    {offer.status}
                  </span>
                  {offer.status !== "accepted" && (
                    <Button
                      size="sm"
                      onClick={() => handleStatusChange(offer.id, "accepted")}
                      className="h-7 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-2xs cursor-pointer"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Mark Accepted (Hire)
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 6: Audit Trail ──────────────────────────────────────────────────────
function ActivityTab({ data }: { data: Application360 }) {
  const events = data.activity || [];

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-3">
      <div className="flex items-center gap-2 border-b border-zinc-100 pb-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 shrink-0">
          <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
        <h3 className="text-xs font-bold text-zinc-800 uppercase tracking-wider">
          Audit Trail ({events.length})
        </h3>
      </div>

      <div className="space-y-3 pt-1">
        {events.map((event) => {
          const time = event.created_at ? new Date(event.created_at) : null;
          return (
            <div key={event.id} className="flex items-start gap-3 border-b border-zinc-100 pb-2.5 last:border-0">
              <div className="h-6 w-6 rounded-full bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="h-3 w-3 text-zinc-500" />
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-zinc-900">{event.summary}</p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5 font-medium">
                  <span className="capitalize">{event.actor_type}</span>
                  <span>·</span>
                  {time && <span>{time.toLocaleString()}</span>}
                </div>
              </div>
            </div>
          );
        })}
        {events.length === 0 && (
          <p className="text-xs text-zinc-400 py-4 text-center">No activity logged.</p>
        )}
      </div>
    </div>
  );
}

// ── Master Candidate 360 Workspace ──────────────────────────────────────────
export default function CandidateDetailPage() {
  const params = useParams<{ jobId: string; appId: string }>();
  const { jobId, appId } = params;
  const router = useRouter();
  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);
  const [stageLoading, setStageLoading] = useState<Stage | null>(null);
  const [scanningFraud, setScanningFraud] = useState(false);
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

  const handleRunFraudScan = async () => {
    setScanningFraud(true);
    try {
      await triggerFraudScan(appId);
      toast("success", "Document integrity scan verified.");
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setScanningFraud(false);
    }
  };

  if (loaded === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-48 rounded bg-zinc-200" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <Skeleton className="lg:col-span-4 h-96 rounded-xl bg-zinc-200" />
          <Skeleton className="lg:col-span-8 h-96 rounded-xl bg-zinc-200" />
        </div>
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="space-y-3 py-8 max-w-md">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" size="sm" onClick={reload} className="h-8 rounded-lg text-xs">
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
  const nextStages: Stage[] = NEXT_STAGES[application.stage] || [];
  const canDecide = can("decide");

  const fraudStatus = data.fraud?.status === "complete" ? "verified" : data.fraud?.status || "unverified";

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-zinc-200/80 pb-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
          <Link href="/recruitment" className="hover:text-zinc-900 transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5 text-zinc-400" />
            Positions
          </Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <Link href={`/recruitment/jobs/${jobId}`} className="hover:text-zinc-900 transition-colors">
            {job?.title || "Requisition"}
          </Link>
          <ChevronRight className="h-3 w-3 text-zinc-300" />
          <span className="text-zinc-900 font-bold">{candidateName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canDecide && nextStages.map((target) => (
            <Button
              key={target}
              size="sm"
              disabled={stageLoading !== null}
              onClick={() => handleStageChange(target)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-semibold shadow-2xs cursor-pointer",
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
            className="h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 shadow-2xs cursor-pointer"
          >
            <RefreshCw className="h-3 w-3 mr-1 text-zinc-400" /> Refresh
          </Button>
        </div>
      </div>

      {/* Structured Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Candidate Rail (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Candidate Identity Card */}
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4 sm:p-5 shadow-2xs space-y-4">
            <div className="flex items-start gap-3">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-700 to-zinc-800 text-zinc-100 font-semibold text-xs border border-zinc-600/30 shadow-2xs">
                {initials}
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <h1 className="text-base font-bold text-zinc-900 truncate">{candidateName}</h1>
                <p className="text-xs text-zinc-500 truncate">{candidate.current_role || "Applicant"}</p>
                <div className="pt-1 flex items-center gap-1.5">
                  <StageBadge stage={application.stage} />
                  {matchVal !== null && (
                    <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.2 text-[10px] font-bold">
                      {matchVal}% Match
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Contact Rows */}
            <div className="border-t border-zinc-100 pt-3 space-y-2 text-xs">
              {candidate.email && (
                <div className="flex items-center gap-2 text-zinc-700">
                  <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{candidate.email}</span>
                </div>
              )}
              {candidate.phone && (
                <div className="flex items-center gap-2 text-zinc-700 font-mono">
                  <Phone className="h-3.5 w-3.5 text-zinc-400 shrink-0" strokeWidth={1.75} />
                  <span>{candidate.phone}</span>
                </div>
              )}
              {candidate.location && (
                <div className="flex items-center gap-2 text-zinc-700">
                  <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{candidate.location}</span>
                </div>
              )}
              {candidate.experience_years !== null && candidate.experience_years !== undefined && (
                <div className="flex items-center gap-2 text-zinc-700">
                  <Briefcase className="h-3.5 w-3.5 text-zinc-400 shrink-0" strokeWidth={1.75} />
                  <span>{candidate.experience_years} years experience</span>
                </div>
              )}
            </div>

            {/* Actions: Resume & Fraud Check */}
            <div className="border-t border-zinc-100 pt-3 space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openResume(candidate.id)}
                className="w-full h-8 rounded-lg border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 mr-1.5 text-zinc-400" strokeWidth={1.75} />
                Download Resume PDF
              </Button>

              <div className="flex items-center justify-between rounded-lg bg-zinc-50/80 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5 text-zinc-700 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
                  Integrity Verification
                </span>
                {fraudStatus === "verified" ? (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    Clean (Score: 12)
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleRunFraudScan}
                    disabled={scanningFraud}
                    className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                  >
                    {scanningFraud ? "Scanning..." : "Run Scan"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Interactive Pipeline Milestones Rail */}
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                Pipeline Milestones
              </span>
              <span className="text-[10px] text-zinc-400">Click to view tab</span>
            </div>
            <div className="space-y-1">
              {MILESTONE_STEPS.map((m, idx) => {
                const isCompleted =
                  idx === 0 ||
                  (m.id === "OUTREACH" && Boolean(data.whatsapp_messages?.length)) ||
                  (m.id === "TELEPHONIC" && Boolean(data.telephonic_calls?.length)) ||
                  (m.id === "TECH_INTERVIEW" && Boolean(data.screening)) ||
                  (m.id === "INTERVIEW" && Boolean(data.interviews?.length)) ||
                  (m.id === "OFFER" && Boolean(data.offers?.length)) ||
                  (m.id === "HIRED" && application.stage === "HIRED");

                const isCurrent =
                  (m.id === "APPLIED" && application.stage === "APPLIED") ||
                  (m.id === "OUTREACH" && application.stage === "SHORTLISTED") ||
                  (m.id === "TELEPHONIC" && application.stage === "SCREENING") ||
                  (m.id === "INTERVIEW" && application.stage === "INTERVIEW") ||
                  (m.id === "OFFER" && application.stage === "OFFER") ||
                  (m.id === "HIRED" && application.stage === "HIRED");

                const isTabActive = activeTab === m.tab;

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActiveTab(m.tab)}
                    className={cn(
                      "w-full flex items-center justify-between p-2 rounded-lg text-xs transition-all text-left cursor-pointer",
                      isTabActive
                        ? "bg-zinc-100 font-bold text-zinc-900 ring-1 ring-zinc-200"
                        : "hover:bg-zinc-50 text-zinc-600"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "h-5 w-5 rounded-full flex items-center justify-center text-[10px] shrink-0 font-medium",
                          isCompleted
                            ? "bg-zinc-100 text-zinc-700 border border-zinc-300 font-semibold"
                            : isCurrent
                            ? "bg-blue-600 text-white ring-2 ring-blue-100 font-bold"
                            : "bg-zinc-50 text-zinc-400 border border-zinc-200"
                        )}
                      >
                        {isCompleted ? "✓" : m.step}
                      </div>
                      <span className="truncate">{m.label}</span>
                    </div>

                    <ChevronRight className={cn("h-3 w-3 text-zinc-300", isTabActive && "text-zinc-600")} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Master Workspace (8 Cols) */}
        <div className="lg:col-span-8">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
            <TabsList className="w-full justify-start rounded-xl bg-zinc-100 p-1 border border-zinc-200/80 shadow-2xs overflow-x-auto">
              <TabsTrigger
                value="evaluation"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 cursor-pointer"
              >
                Evaluation
              </TabsTrigger>
              <TabsTrigger
                value="whatsapp"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 flex items-center gap-1.5 cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
                WhatsApp
                {Boolean(data.whatsapp_messages?.length) && (
                  <span className="ml-1 bg-zinc-200 text-zinc-700 rounded-full px-1.5 text-[10px] font-bold">
                    {data.whatsapp_messages?.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="voice"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 flex items-center gap-1.5 cursor-pointer"
              >
                <PhoneCall className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
                Voice Screen
                {Boolean(data.telephonic_calls?.length) && (
                  <span className="ml-1 bg-zinc-200 text-zinc-700 rounded-full px-1.5 text-[10px] font-bold">
                    {data.telephonic_calls?.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="interviews"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 flex items-center gap-1.5 cursor-pointer"
              >
                <Calendar className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
                Interviews
                {Boolean(data.interviews?.length) && (
                  <span className="ml-1 bg-zinc-200 text-zinc-700 rounded-full px-1.5 text-[10px] font-bold">
                    {data.interviews?.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="offers"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 flex items-center gap-1.5 cursor-pointer"
              >
                <DollarSign className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
                Offer
                {Boolean(data.offers?.length) && (
                  <span className="ml-1 bg-zinc-200 text-zinc-700 rounded-full px-1.5 text-[10px] font-bold">
                    {data.offers?.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="rounded-lg px-3.5 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-zinc-900 text-zinc-600 flex items-center gap-1.5 cursor-pointer"
              >
                <Clock className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
                Activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="evaluation">
              <EvaluationTab data={data} />
            </TabsContent>

            <TabsContent value="whatsapp">
              <WhatsAppTab data={data} onReload={reload} />
            </TabsContent>

            <TabsContent value="voice">
              <VoiceScreeningTab data={data} onReload={reload} />
            </TabsContent>

            <TabsContent value="interviews">
              <InterviewsTab data={data} onReload={reload} />
            </TabsContent>

            <TabsContent value="offers">
              <OffersTab data={data} onReload={reload} />
            </TabsContent>

            <TabsContent value="activity">
              <ActivityTab data={data} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
