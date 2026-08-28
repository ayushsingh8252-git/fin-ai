"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { askAssistant } from "@/components/ai-assistant/AIAssistantWidget";
import {
  Phone, Sparkles, ArrowRight, Globe, Clock, MessageSquare, RefreshCw,
  BarChart3, CheckCircle2, Upload, FileText, Code2, MessageCircle,
  User, MapPin, Briefcase, Languages, ShieldCheck, Target, PhoneMissed,
  Loader2, Bot, PhoneCall, AlertTriangle, PhoneOff, CalendarClock, Mail,
} from "lucide-react";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ═══════════════════════════════════════════════════════════
   DATA
   Below the real call panel, the rest of this page (waveform demo,
   agent profile, scorecards, three-step flow) is illustrative marketing
   content — every "call", score, and candidate there is simulated.
   Agent persona is named after this project's builder, matching the
   self-referential branding used across the rest of the demo.
   ═══════════════════════════════════════════════════════════ */

const AGENT_NAME = "Ayush";

const WAVEFORM_HEIGHTS = [40, 68, 52, 88, 60, 76, 44, 92, 62, 72, 48, 82, 58, 38];

const CALL_SCRIPT = [
  { from: "agent", text: "Hi John — got five minutes about the role?" },
  { from: "candidate", text: "Sure, I'm actively looking." },
  { from: "agent", text: "Tell me about a system you scaled recently." },
];

const CALL_REPORT = [
  { label: "Intent & interest", value: 92 },
  { label: "Technical", value: 82 },
  { label: "Communication", value: 88 },
];

const HERO_STATS = [
  { value: "10+", label: "languages & accents" },
  { value: "24/7", label: "candidate outreach" },
  { value: "0", label: "recruiter dials needed" },
  { value: "~2 min", label: "to set up" },
];

const MEET_FEATURES = [
  { title: "Natural & adaptive", desc: "Holds a real conversation and follows the thread. It doesn't feel like an AI call.", icon: MessageSquare },
  { title: "Always on", desc: "Calls 24/7 and retries no-answers — so candidates pick up when it suits them.", icon: Clock },
  { title: "Speaks their language", desc: "The candidate's language and accent, matched on the fly.", icon: Globe },
  { title: "Scores what matters", desc: "Turns every call into a clear, ranked read for your team.", icon: BarChart3 },
];

const SCORES = [
  { label: "Intent & Interest", desc: "Are they genuinely looking, and how keen on this role.", value: 92, icon: Target },
  { label: "Technical & Role Fit", desc: "Depth on the skills the role needs, probed live.", value: 82, icon: Code2 },
  { label: "Communication & Confidence", desc: "Clarity and confidence in how they speak.", value: 88, icon: MessageCircle },
  { label: "Personality & Fit", desc: "Working style and attitude cues from the conversation.", value: 85, icon: User },
];

const CAPTURED_TAGS = [
  { label: "Experience", icon: Briefcase },
  { label: "Location", icon: MapPin },
  { label: "Work mode", icon: Code2 },
  { label: "Compensation", icon: BarChart3 },
  { label: "Notice period", icon: Clock },
  { label: "Availability", icon: CheckCircle2 },
  { label: "+ more", icon: Sparkles },
];

type CandidateStatus = "answered" | "no_answer" | "scheduled";
const DEFAULT_CANDIDATES: { name: string; status: CandidateStatus }[] = [
  { name: "Priya Sharma", status: "answered" },
  { name: "Lia Pareek", status: "answered" },
  { name: "John Doe", status: "answered" },
  { name: "Anjali Menon", status: "no_answer" },
  { name: "Arjun Mehta", status: "scheduled" },
  { name: "Diya Gupta", status: "scheduled" },
];

const HIGHLIGHT_PILLS = [
  { label: "Natural & adaptive", icon: MessageSquare },
  { label: "Accent-matched", icon: Globe },
  { label: "24/7 outreach", icon: Clock },
  { label: "No-bias scoring", icon: ShieldCheck },
  { label: "Auto-retry", icon: RefreshCw },
  { label: "Ranked shortlist", icon: BarChart3 },
  { label: "10+ languages", icon: Languages },
];

const LANGUAGES = ["Hindi", "Gujarati", "Telugu", "Tamil", "English", "German", "中文", "Français"];
const ACCENTS = ["South Indian accent", "American", "British", "+ more"];

const TRANSCRIPT_PREVIEW = [
  { from: "agent", text: "So you led the migration — what was the hardest part?" },
  { from: "candidate", text: "Honestly, the data layer. We had downtime concerns." },
  { from: "agent", text: "Makes sense. How did you handle the cutover without downtime?" },
];

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function TelephonicAgentPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Telephonic Agent</span>
          </div>
          <Link
            href="/hiring-automation"
            className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors hidden sm:inline-flex items-center gap-1.5"
          >
            Open Hiring Pipeline <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <HeroSection />
      <RealCallSection />
      <ScheduledInterviewsSection />
      <MeetAgentSection />
      <ScoresSection />
      <ThreeStepSection />
      <OnTheCallSection />
      <ClosingCtaBanner />

      <footer className="border-t border-zinc-200 bg-white py-10">
        <div className="max-w-6xl mx-auto px-6 text-center text-[12px] text-zinc-500 font-mono">
          Fin AI · Telephonic Agent — the &ldquo;Place a Real Call&rdquo; panel above places a real
          Twilio phone call. Everything below it is an illustrative product demo.
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION 1 — HERO + LIVE CALL DEMO
   ═══════════════════════════════════════════════════════════ */

function HeroSection() {
  return (
    <section className="relative pt-24 pb-16 md:pt-32 overflow-hidden">
      <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
        <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 mb-6">
          <Sparkles className="w-3.5 h-3.5" /> AI Voice Screening for Hiring Teams
        </span>

        <h1 className="text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold tracking-tight leading-[1.1] mb-5">
          <span className="text-blue-600">Telephonic Agent</span> AI Voice Screening for Recruitment.
        </h1>

        <p className="text-[16px] text-zinc-600 leading-relaxed max-w-xl mx-auto mb-8">
          {AGENT_NAME}, our AI voice agent, calls your candidates in 10+ languages, screens for role fit, and delivers a ranked shortlist to your dashboard the same day. No calls. No coordination. Just decisions.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-5">
          <a
            href="#real-call"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all"
          >
            Try Telephonic Agent <ArrowRight className="w-4 h-4" />
          </a>
          <button
            onClick={() => askAssistant("I'd like to book a demo of the Telephonic Agent voice screening product.")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold border border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-all"
          >
            Book a Demo
          </button>
        </div>

        <p className="text-[12px] text-zinc-500 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" /> Works with your existing process. <span className="font-semibold text-zinc-700">No new ATS.</span>
        </p>
      </div>

      <div className="max-w-3xl mx-auto px-6 mt-14 relative z-10">
        <LiveCallDemoCard />
      </div>

      <div className="max-w-4xl mx-auto px-6 mt-16 pt-10 border-t border-zinc-200 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {HERO_STATS.map((s) => (
            <div key={s.label}>
              <div className="text-xl sm:text-2xl font-extrabold text-blue-600 font-mono">{s.value}</div>
              <div className="text-[12px] text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LiveCallDemoCard() {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
      <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
            AS
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-zinc-900 truncate">{AGENT_NAME} · Telephonic Agent</div>
            <div className="text-[11px] text-emerald-600 font-mono flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> On a call · 02:14
            </div>
          </div>
        </div>
        <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 flex items-center gap-1 shrink-0">
          <Globe className="w-3 h-3" /> English
        </span>
      </div>

      {/* live waveform */}
      <div className="flex items-center gap-1 h-10 px-5 py-3 bg-zinc-50/60">
        {WAVEFORM_HEIGHTS.map((h, i) => (
          <motion.div
            key={i}
            className="flex-1 bg-blue-500 rounded-full"
            style={{ minHeight: 3 }}
            animate={{ height: [`${h * 0.35}%`, `${h}%`, `${h * 0.5}%`] }}
            transition={{ duration: 0.9 + (i % 5) * 0.15, repeat: Infinity, ease: "easeInOut", delay: i * 0.05 }}
          />
        ))}
      </div>

      <div className="relative p-5 space-y-3 min-h-[170px]">
        {CALL_SCRIPT.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.5, duration: 0.4 }}
            className={`flex ${line.from === "candidate" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] sm:max-w-[60%] px-3.5 py-2 rounded-xl text-[13px] leading-snug ${
                line.from === "agent" ? "bg-blue-50 text-blue-900 border border-blue-100" : "bg-zinc-100 text-zinc-700"
              }`}
            >
              {line.text}
            </div>
          </motion.div>
        ))}

        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 1.6, duration: 0.4 }}
          className="absolute bottom-2 right-2 sm:right-3 w-52 rounded-xl border border-zinc-200 shadow-lg bg-white p-3"
        >
          <div className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider mb-2">Call Report</div>
          <div className="space-y-2">
            {CALL_REPORT.map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between text-[10.5px] mb-1">
                  <span className="text-zinc-600">{r.label}</span>
                  <span className="font-bold text-blue-700">{r.value}%</span>
                </div>
                <div className="h-1 bg-zinc-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-blue-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${r.value}%` }}
                    transition={{ delay: 1.9, duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   REAL CALL PANEL — actually places a Twilio phone call via the backend
   (/api/v1/telephonic/call), polls the call record for live status +
   transcript. Everything else on this page is illustrative; this isn't.
   ═══════════════════════════════════════════════════════════ */

interface CallTranscriptTurn {
  role: "agent" | "candidate";
  text: string;
}

interface CallRecordState {
  id: string;
  call_sid: string | null;
  to_number: string;
  candidate_name: string;
  role_title: string;
  status: string;
  transcript: CallTranscriptTurn[];
  duration_sec: number | null;
  error_message: string | null;
  created_at: string | null;
}

const ACTIVE_CALL_STATUSES = new Set(["queued", "initiated", "ringing", "in-progress", "answered"]);

function RealCallSection() {
  const [toNumber, setToNumber] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [roleTitle, setRoleTitle] = useState("Backend Engineer");
  const [call, setCall] = useState<CallRecordState | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollCall = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/telephonic/calls/${id}`);
        if (!res.ok) return;
        const data: CallRecordState = await res.json();
        setCall(data);
        if (!ACTIVE_CALL_STATUSES.has(data.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // transient — the next tick will retry
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  };

  const placeCall = async () => {
    setError(null);
    if (!toNumber.trim()) {
      setError("Enter a phone number in E.164 format, e.g. +14155551234.");
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/telephonic/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: toNumber.trim(),
          candidate_name: candidateName.trim() || "there",
          role_title: roleTitle.trim() || "the open role",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `Call failed (${res.status})`);
      setCall(data);
      pollCall(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not place the call.");
    } finally {
      setPlacing(false);
    }
  };

  const isActive = call ? ACTIVE_CALL_STATUSES.has(call.status) : false;

  return (
    <section id="real-call" className="py-16 sm:py-20 border-t border-zinc-200/80 bg-zinc-50/50 scroll-mt-16">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-10">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-emerald-700 font-semibold px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
            <PhoneCall className="w-3.5 h-3.5" /> Real call — not a demo
          </span>
          <h2 className="text-[clamp(1.5rem,3vw,2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
            Place a real call right now
          </h2>
          <p className="text-zinc-600 text-[14px] mt-2 leading-relaxed">
            Enter a real phone number and {AGENT_NAME} will actually call it via Twilio, ask real
            questions, and adapt to what&rsquo;s said — live, right now.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
          <div className="grid sm:grid-cols-2 gap-4 p-5 sm:p-6 border-b border-zinc-100">
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">Phone number (E.164 format)</span>
              <input
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="+14155551234"
                disabled={isActive}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">Candidate name (optional)</span>
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="Priya"
                disabled={isActive}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">Role being screened for</span>
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                disabled={isActive}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white disabled:bg-zinc-50 disabled:text-zinc-400"
              />
            </label>
          </div>

          <div className="p-5 sm:p-6">
            <button
              onClick={placeCall}
              disabled={placing || isActive}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {placing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Placing call…
                </>
              ) : isActive ? (
                <>
                  <PhoneCall className="w-4 h-4" /> Call in progress — {call?.status}
                </>
              ) : (
                <>
                  <Phone className="w-4 h-4" /> Call this number
                </>
              )}
            </button>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}

            {call && (
              <div className="mt-5 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wide text-zinc-500">
                    Call status
                  </span>
                  <CallStatusBadge status={call.status} />
                </div>

                {call.error_message && (
                  <p className="text-xs text-red-600 mb-3">{call.error_message}</p>
                )}

                {call.transcript.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {call.transcript.map((turn, i) => (
                      <div key={i} className={`flex ${turn.role === "candidate" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] px-3 py-2 rounded-xl text-[13px] leading-snug ${
                            turn.role === "agent"
                              ? "bg-blue-50 text-blue-900 border border-blue-100"
                              : "bg-white text-zinc-700 border border-zinc-200"
                          }`}
                        >
                          {turn.text}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">Waiting for the call to connect…</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCHEDULED INTERVIEWS — synced with hiring-automation.
   Booking a "Telephonic Interview" slot on the /hiring-automation pipeline
   persists it via POST /api/v1/orchestrator/candidates/schedule. This
   section polls the same GET /api/v1/orchestrator/candidates the
   Enterprise Orchestration scores table uses, and lists every candidate
   with a telephonic slot booked — so a slot scheduled from the pipeline
   shows up here without any manual refresh.
   ═══════════════════════════════════════════════════════════ */

interface ScheduledCandidate {
  candidate_id: string;
  candidate_name: string;
  email: string | null;
  telephonic_slot_date: string | null;
  telephonic_slot_time: string | null;
  ai_interview_slot_date: string | null;
  ai_interview_slot_time: string | null;
  telephonic_score: number | null;
  telephonic_score_is_real: boolean;
}

function useScheduledCandidates(pollMs = 8000) {
  const [candidates, setCandidates] = useState<ScheduledCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchScheduled = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/orchestrator/candidates`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCandidates(data.candidates || []);
      } catch {
        // transient — the next poll will retry
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchScheduled();
    const interval = setInterval(fetchScheduled, pollMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollMs]);

  return { candidates, loading };
}

function ScheduledInterviewsSection() {
  const { candidates, loading } = useScheduledCandidates();
  const scheduled = candidates.filter((c) => c.telephonic_slot_date);

  if (!loading && scheduled.length === 0) return null;

  return (
    <section className="py-12 border-t border-zinc-200/80 bg-white">
      <div className="max-w-3xl mx-auto px-6">
        <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-100 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-600" /> Scheduled Telephonic Interviews
            </h3>
            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 shrink-0">
              Synced from Hiring Pipeline
            </span>
          </div>
          <div className="divide-y divide-zinc-100">
            {loading ? (
              <div className="p-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading scheduled interviews…
              </div>
            ) : (
              scheduled.map((c) => (
                <div key={c.candidate_id} className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full border bg-blue-50 border-blue-200 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                    {c.candidate_name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-zinc-900 truncate">{c.candidate_name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate flex items-center gap-1">
                      <Mail className="w-2.5 h-2.5" /> {c.email || "no email extracted"}
                    </div>
                  </div>
                  <div className="text-[11px] font-mono font-bold text-zinc-700 flex items-center gap-1.5 shrink-0">
                    <CalendarClock className="w-3.5 h-3.5 text-blue-500" />
                    {c.telephonic_slot_date} · {c.telephonic_slot_time}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CallStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: StatusTone; icon: ComponentType<{ className?: string }> }> = {
    queued: { label: "Queued", tone: "neutral", icon: Loader2 },
    initiated: { label: "Initiated", tone: "info", icon: Loader2 },
    ringing: { label: "Ringing", tone: "info", icon: PhoneCall },
    "in-progress": { label: "In progress", tone: "success", icon: PhoneCall },
    answered: { label: "Answered", tone: "success", icon: PhoneCall },
    completed: { label: "Completed", tone: "success", icon: CheckCircle2 },
    "no-answer": { label: "No answer", tone: "warning", icon: PhoneMissed },
    busy: { label: "Busy", tone: "warning", icon: PhoneMissed },
    failed: { label: "Failed", tone: "danger", icon: PhoneOff },
    canceled: { label: "Canceled", tone: "neutral", icon: PhoneOff },
  };
  const entry = map[status] || { label: status, tone: "neutral" as StatusTone, icon: Loader2 };
  const Icon = entry.icon;
  const spin = Icon === Loader2;
  return (
    <StatusPill tone={entry.tone} className="text-[11px] font-semibold px-2.5 py-1">
      <Icon className={`w-3 h-3 ${spin ? "animate-spin" : ""}`} /> {entry.label}
    </StatusPill>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION 2 — MEET THE AGENT
   ═══════════════════════════════════════════════════════════ */

function MeetAgentSection() {
  const [left, right] = [MEET_FEATURES.slice(0, 2), MEET_FEATURES.slice(2)];
  return (
    <section className="py-20 sm:py-24 border-t border-zinc-200/80 bg-zinc-50/50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-14">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
            Meet {AGENT_NAME}
          </span>
          <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
            The voice on your first-round calls
          </h2>
          <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">
            {AGENT_NAME} is the AI agent inside Telephonic Agent. It calls, listens, adapts, and scores every conversation.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5 items-stretch">
          <div className="flex flex-col gap-5">
            {left.map((f) => <FeatureMiniCard key={f.title} {...f} />)}
          </div>

          <AgentProfileCard />

          <div className="flex flex-col gap-5">
            {right.map((f) => <FeatureMiniCard key={f.title} {...f} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureMiniCard({ title, desc, icon: Icon }: { title: string; desc: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="flex-1 rounded-2xl bg-white border border-zinc-200 p-5">
      <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
        <Icon className="w-4 h-4" />
      </div>
      <h3 className="text-[14px] font-bold text-zinc-900 mb-1">{title}</h3>
      <p className="text-[12.5px] text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function AgentProfileCard() {
  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 p-8 flex flex-col items-center justify-center text-center shadow-xl shadow-blue-600/20 overflow-hidden min-h-[260px]">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
      <div className="relative w-20 h-20 rounded-full bg-white/95 border-4 border-white/40 flex items-center justify-center text-blue-700 font-extrabold text-2xl shadow-lg mb-4">
        AS
      </div>
      <div className="relative text-lg font-extrabold text-white">{AGENT_NAME}</div>
      <div className="relative text-[12px] text-blue-100 font-mono mt-1">Telephonic Agent · Fin AI</div>
      <div className="relative flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-[11px] font-mono text-white">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Always on
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION 3 — SCORECARDS
   ═══════════════════════════════════════════════════════════ */

function ScoresSection() {
  return (
    <section className="py-20 sm:py-24 border-t border-zinc-200/80">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-14">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
            What You Get Back
          </span>
          <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
            A clear read on <span className="text-blue-600">every candidate</span>
          </h2>
          <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">
            The moment a call ends, {AGENT_NAME} turns the conversation into a scored, ranked profile.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5 mb-10">
          {SCORES.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-2xl bg-white border border-zinc-200 p-5">
                <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-4">
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className="text-[14px] font-bold text-zinc-900 mb-1">{s.label}</h3>
                <p className="text-[12px] text-zinc-500 leading-relaxed mb-4 min-h-[36px]">{s.desc}</p>
                <div className="flex items-center gap-2.5">
                  <span className="text-[15px] font-extrabold text-blue-700 font-mono shrink-0">{s.value}%</span>
                  <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-600 rounded-full"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${s.value}%` }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ duration: 0.9, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider mb-3">Also Captured on Every Call</div>
          <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
            {CAPTURED_TAGS.map((t) => {
              const Icon = t.icon;
              return (
                <span key={t.label} className="text-[12px] font-medium px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </span>
              );
            })}
          </div>
          <p className="text-[12px] text-zinc-500">Every score links back to the full call transcript.</p>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION 4 — THREE STEPS (interactive)
   ═══════════════════════════════════════════════════════════ */

function ThreeStepSection() {
  const [step, setStep] = useState(1);
  const [jobTitle, setJobTitle] = useState("Frontend Developer");
  const [location, setLocation] = useState("Bangalore");
  const [experience, setExperience] = useState("3");
  const [workType, setWorkType] = useState("Full Time");

  return (
    <section className="py-20 sm:py-24 border-t border-zinc-200/80 bg-zinc-50/50">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-14">
          <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight">
            From role to first calls in <span className="text-blue-600">three steps</span>
          </h2>
          <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">
            Set the role, hand over your list, let {AGENT_NAME} call.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 items-start">
          {/* Step 1 */}
          <StepShell num={1} label="Define Your Role" state={step > 1 ? "done" : "active"}>
            <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-100 text-[12px] font-bold text-zinc-700">New Role</div>
              <div className="p-4 space-y-3">
                <LabeledInput label="Job Title" icon={Briefcase} value={jobTitle} onChange={setJobTitle} disabled={step > 1} />
                <LabeledInput label="Location" icon={MapPin} value={location} onChange={setLocation} disabled={step > 1} />
                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="Experience" value={experience} onChange={setExperience} disabled={step > 1} />
                  <LabeledSelect label="Work Type" value={workType} onChange={setWorkType} options={["Full Time", "Part Time", "Contract"]} disabled={step > 1} />
                </div>
                <button
                  onClick={() => setStep((s) => Math.max(s, 2))}
                  disabled={step > 1}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-default flex items-center justify-center gap-1.5"
                >
                  {step > 1 ? <><CheckCircle2 className="w-3.5 h-3.5" /> Role Launched</> : "Launch Role"}
                </button>
              </div>
            </div>
          </StepShell>

          {/* Step 2 */}
          <StepShell num={2} label="Upload Your Data" state={step > 2 ? "done" : step === 2 ? "active" : "pending"}>
            <div className={`rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden transition-opacity ${step < 2 ? "opacity-50 pointer-events-none" : ""}`}>
              <div className="px-4 py-2.5 border-b border-zinc-100 text-[12px] font-bold text-zinc-700">Upload CSV</div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[12px] font-semibold">
                  <Upload className="w-3.5 h-3.5" /> Upload the file
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-500 text-[12px]">
                  <FileText className="w-3.5 h-3.5" /> Resume / pdf
                </div>
                <div className="px-3 py-3 rounded-lg border border-dashed border-zinc-300 text-zinc-400 text-[11.5px] text-center">
                  Drop your file here or browse
                </div>
                <button
                  onClick={() => setStep((s) => Math.max(s, 3))}
                  disabled={step < 2 || step > 2}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-default flex items-center justify-center gap-1.5"
                >
                  {step > 2 ? <><CheckCircle2 className="w-3.5 h-3.5" /> Uploaded</> : "Upload"}
                </button>
              </div>
            </div>
          </StepShell>

          {/* Step 3 */}
          <StepShell num={3} label="Start Scheduling" state={step >= 3 ? "done" : "pending"}>
            <div className={`rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden transition-opacity ${step < 3 ? "opacity-50 pointer-events-none" : ""}`}>
              <div className="px-4 py-2.5 border-b border-zinc-100 text-[12px] font-bold text-zinc-700">Candidate Status</div>
              <div className="p-2">
                {DEFAULT_CANDIDATES.map((c, i) => (
                  <motion.div
                    key={c.name}
                    initial={false}
                    animate={step >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
                    transition={{ delay: step >= 3 ? 0.15 * i : 0, duration: 0.35 }}
                    className="flex items-center justify-between px-2.5 py-2 rounded-lg"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-700 shrink-0">
                        {c.name[0]}
                      </div>
                      <span className="text-[12.5px] text-zinc-800 truncate">{c.name}</span>
                    </div>
                    <CandidateStatusBadge status={c.status} />
                  </motion.div>
                ))}
              </div>
            </div>
          </StepShell>
        </div>

        <p className="text-center text-[12.5px] text-zinc-500 mt-8 flex items-center justify-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-500" /> Setting up a role takes about <span className="font-bold text-zinc-800">2 minutes.</span>
        </p>
      </div>
    </section>
  );
}

function StepShell({ num, label, state, children }: { num: number; label: string; state: "pending" | "active" | "done"; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
          state === "done" ? "bg-emerald-500 text-white" : state === "active" ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-500"
        }`}>
          {state === "done" ? <CheckCircle2 className="w-3.5 h-3.5" /> : num}
        </span>
        <span className={`text-[11px] font-mono font-bold uppercase tracking-wider ${state === "pending" ? "text-zinc-400" : "text-zinc-700"}`}>{label}</span>
      </div>
      {children}
    </div>
  );
}

function LabeledInput({
  label, icon: Icon, value, onChange, disabled,
}: { label: string; icon?: ComponentType<{ className?: string }>; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">{label}</span>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 focus-within:border-blue-400">
        {Icon && <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-[13px] text-zinc-800 focus:outline-none disabled:text-zinc-500"
        />
      </div>
    </label>
  );
}

function LabeledSelect({
  label, value, onChange, options, disabled,
}: { label: string; value: string; onChange: (v: string) => void; options: string[]; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-[13px] text-zinc-800 focus:outline-none focus:border-blue-400 disabled:text-zinc-500 appearance-none"
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  if (status === "answered") {
    return <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Answered</span>;
  }
  if (status === "no_answer") {
    return <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-1"><PhoneMissed className="w-3.5 h-3.5" /> No answer</span>;
  }
  return <span className="text-[11px] font-semibold text-blue-600 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5" /> Scheduled</span>;
}

/* ═══════════════════════════════════════════════════════════
   SECTION 5 — ON THE CALL
   ═══════════════════════════════════════════════════════════ */

function OnTheCallSection() {
  return (
    <section className="py-20 sm:py-24 border-t border-zinc-200/80">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-10">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
            On the Call
          </span>
          <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
            Calls candidates <span className="text-blue-600">actually take</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-14">
          {HIGHLIGHT_PILLS.map((p) => {
            const Icon = p.icon;
            return (
              <span key={p.label} className="text-[12px] font-medium px-3.5 py-1.5 rounded-full bg-white border border-zinc-200 text-zinc-700 flex items-center gap-1.5 shadow-2xs">
                <Icon className="w-3.5 h-3.5 text-blue-600" /> {p.label}
              </span>
            );
          })}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-[18px] font-bold text-zinc-900 mb-2">Multilingual &amp; accent-aware</h3>
            <p className="text-[13.5px] text-zinc-600 leading-relaxed">
              {AGENT_NAME} speaks Hindi, Gujarati, Telugu, Tamil and English — and matches the accent, from South Indian to American or British. Screen a multi-city or global pipeline without a recruiter for every language.
            </p>
          </div>

          <div className="rounded-2xl bg-white border border-zinc-200 p-5">
            <div className="flex flex-wrap gap-2 mb-3">
              {LANGUAGES.map((l) => (
                <span key={l} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700">{l}</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <span key={a} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">{a}</span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-zinc-200 p-5 space-y-2.5">
            {TRANSCRIPT_PREVIEW.map((line, i) => (
              <div key={i} className={`flex ${line.from === "candidate" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-[12.5px] leading-snug ${
                  line.from === "agent" ? "bg-blue-50 text-blue-900 border border-blue-100" : "bg-zinc-100 text-zinc-700"
                }`}>
                  {line.text}
                </div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-[18px] font-bold text-zinc-900 mb-2">Natural, adaptive, responsive</h3>
            <p className="text-[13.5px] text-zinc-600 leading-relaxed">
              {AGENT_NAME} listens and responds as the candidate speaks, follows the thread, and adjusts to each person. It holds a real conversation — it doesn&apos;t feel like an AI call at all.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION 6 — CLOSING CTA
   ═══════════════════════════════════════════════════════════ */

function ClosingCtaBanner() {
  return (
    <section className="py-20 border-t border-zinc-200/80 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <div className="relative rounded-[2rem] overflow-hidden p-10 sm:p-14 text-center bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 shadow-2xl shadow-blue-600/25">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white mx-auto mb-5">
              <Bot className="w-6 h-6" />
            </div>
            <h2 className="text-[clamp(1.5rem,3.5vw,2.1rem)] font-extrabold text-white tracking-tight mb-3">
              Your recruiters have better things to do than dial
            </h2>
            <p className="text-blue-100 text-[15px] max-w-lg mx-auto mb-8">
              Hand the first round to {AGENT_NAME}. Get a ranked shortlist — and your team&apos;s week back.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => askAssistant("I'd like to book a demo of the Telephonic Agent voice screening product.")}
                className="px-6 py-3 rounded-xl text-[14px] font-semibold bg-white/15 border border-white/25 text-white hover:bg-white/25 transition-colors"
              >
                Book a Demo
              </button>
              <a
                href="#real-call"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
              >
                Try Telephonic Agent <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
