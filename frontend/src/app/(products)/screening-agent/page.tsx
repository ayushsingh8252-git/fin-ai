"use client";

/* ═══════════════════════════════════════════════════════════════
   SCREENING AGENT — live, working demo.

   The live interview panel (setup screen, full-screen interview room,
   proctoring, voice loop) lives in ./_components/InterviewRoom.tsx —
   shared with the invite-link session route at
   ./session/[sessionId]/page.tsx. This file just supplies the
   marketing chrome around it.

   - The candidate video is your actual front camera (getUserMedia).
   - Face-count / gaze / tab-switch / background-noise / cross-talk
     proctoring runs in-browser (see src/hooks/useProctoring.ts).
   - The interviewer's 11 questions are generated once up front by a
     LangChain-based service from the uploaded resume + optional JD
     (POST /api/v1/screening/start) — not a scripted transcript.
   - Your spoken answers are recorded, sent to /api/v1/transcribe
     (server-side faster-whisper), and really transcribed.
   - The interviewer's lines are really spoken back via /api/v1/tts.
   The "Create in Minutes" and report sections below the live demo
   are illustrative mockups (clearly labeled).
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight, Sparkles, ShieldCheck, Video, Mic,
  Bot, Award, Radio, Target, ListChecks, Lightbulb, Gauge,
  CalendarClock, Mail, Loader2,
} from "lucide-react";
import { askAssistant } from "@/components/ai-assistant/AIAssistantWidget";
import InterviewRoom from "./_components/InterviewRoom";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const INTERVIEWER_NAME = "Ayush";

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function ScreeningAgentPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Screening Agent</span>
          </div>
          <Link
            href="/telephonic-agent"
            className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors hidden sm:inline-flex items-center gap-1.5"
          >
            Open Telephonic Agent <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <HeroSection />
      <ScheduledInterviewsSection />
      <FeaturesSection />
      <CreateInMinutesSection />
      <ReportsSection />
      <ClosingCtaBanner />

      <footer className="border-t border-zinc-200 bg-white py-10">
        <div className="max-w-6xl mx-auto px-6 text-center text-[12px] text-zinc-500 font-mono">
          Fin AI · Screening Agent — the live interview above is real (camera, proctoring, Groq, transcription),
          and its report is generated from your actual answers. Only the &ldquo;Create in Minutes&rdquo; step below is a mockup.
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO + LIVE INTERVIEW DEMO
   ═══════════════════════════════════════════════════════════ */

function HeroSection() {
  return (
    <section className="relative pt-20 pb-16 md:pt-28 overflow-hidden">
      <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
        <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 mb-6">
          <Sparkles className="w-3.5 h-3.5" /> Live, Proctored AI Interviews
        </span>

        <h1 className="text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold tracking-tight leading-[1.1] mb-5">
          <span className="text-blue-600">Screening Agent</span> — AI Interviews Built for Real Screening.
        </h1>

        <p className="text-[16px] text-zinc-600 leading-relaxed max-w-xl mx-auto mb-8">
          {INTERVIEWER_NAME}, our AI interviewer, runs a resume- and JD-aware 11-question first round, proctors the
          session live with BrewShield, and scores every candidate the moment the call ends.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-2">
          <a
            href="#live-demo"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all"
          >
            Try the Live Demo <ArrowRight className="w-4 h-4" />
          </a>
          <button
            onClick={() => askAssistant("I'd like to book a demo of the Screening Agent AI interview product.")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold border border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-all"
          >
            Book a Demo
          </button>
        </div>
      </div>

      <div id="live-demo" className="max-w-6xl mx-auto px-4 sm:px-6 mt-14 relative z-10 scroll-mt-20">
        <InterviewRoom />
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCHEDULED INTERVIEWS — synced with hiring-automation.
   Booking an "AI Interview" slot on the /hiring-automation pipeline
   persists it via POST /api/v1/orchestrator/candidates/schedule. This
   section polls the same GET /api/v1/orchestrator/candidates the
   hiring pipeline's scores table uses, and lists every candidate with an
   AI-interview slot booked — so a slot scheduled from the pipeline shows
   up here without any manual refresh.
   ═══════════════════════════════════════════════════════════ */

interface ScheduledCandidate {
  candidate_id: string;
  candidate_name: string;
  email: string | null;
  ai_interview_slot_date: string | null;
  ai_interview_slot_time: string | null;
}

function ScheduledInterviewsSection() {
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
    const interval = setInterval(fetchScheduled, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const scheduled = candidates.filter((c) => c.ai_interview_slot_date);
  if (!loading && scheduled.length === 0) return null;

  return (
    <section className="py-12 border-t border-zinc-200/80 bg-zinc-50/50">
      <div className="max-w-3xl mx-auto px-6">
        <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b border-zinc-100 flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-600" /> Scheduled AI Interviews
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
                    {c.ai_interview_slot_date} · {c.ai_interview_slot_time}
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

/* ═══════════════════════════════════════════════════════════
   FEATURES STRIP
   ═══════════════════════════════════════════════════════════ */

function FeaturesSection() {
  const features = [
    { title: "Resume + JD aware questions", desc: `${INTERVIEWER_NAME} builds 11 questions from your resume and the job description — driven by a LangChain pipeline, not a fixed script.`, icon: Bot },
    { title: "BrewShield proctoring", desc: "Live multi-face, gaze, tab-switch, and background-noise/cross-talk detection — running in your browser.", icon: ShieldCheck },
    { title: "Real voice, real transcription", desc: "Your spoken answers are transcribed server-side and really drive the next question.", icon: Mic },
    { title: "Instant scored evaluation", desc: "The moment the interview ends, get a communication / relevance / confidence read.", icon: Award },
  ];
  return (
    <section className="py-16 border-t border-zinc-200/80 bg-zinc-50/50">
      <div className="max-w-5xl mx-auto px-6 grid sm:grid-cols-2 md:grid-cols-4 gap-5">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="rounded-2xl bg-white border border-zinc-200 p-5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
                <Icon className="w-4 h-4" />
              </div>
              <h3 className="text-[14px] font-bold text-zinc-900 mb-1">{f.title}</h3>
              <p className="text-[12.5px] text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   CREATE IN MINUTES — illustrative mockup (matches reference design)
   ═══════════════════════════════════════════════════════════ */

function CreateInMinutesSection() {
  const leftFields = ["Role / Title", "Seniority Level", "Tech Stack", "Duration"];
  const rightFields = ["Difficulty", "Question Bank", "Proctoring Rules", "Pass Threshold"];
  return (
    <section className="py-20 border-t border-zinc-200/80 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <div className="overflow-hidden rounded-3xl border border-zinc-200 shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50/60 px-8 py-8 text-left">
            <h2 className="text-2xl font-extrabold text-zinc-900 sm:text-3xl">Create in Minutes</h2>
            <p className="mt-1 text-zinc-500">Define role, skills, duration, and difficulty once.</p>
          </div>
          <div className="relative grid grid-cols-1 gap-6 px-8 py-10 md:grid-cols-2">
            {[leftFields, rightFields].map((fields, i) => (
              <motion.div
                key={i}
                className="rounded-2xl border border-zinc-100 bg-white p-5 text-left shadow-sm"
                animate={{ y: i === 0 ? [0, -10, 0] : [0, 10, 0] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
              >
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Fill Interview Details</p>
                <div className="space-y-3">
                  {fields.map((f) => (
                    <div key={f} className="h-10 rounded-lg border border-zinc-100 bg-zinc-50 flex items-center px-3 text-xs text-zinc-400">
                      {f}
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
            <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
              <div className="flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-700 shadow-[0_10px_30px_-5px_rgba(37,99,235,0.35)] ring-1 ring-zinc-100">
                Create Interview
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   REPORTS — what the real report (generated after your live
   interview above) actually contains. No sample candidate, no
   fake numbers — every field here is a real field the backend
   returns once your interview finishes.
   ═══════════════════════════════════════════════════════════ */

function ReportsSection() {
  const reportContents = [
    {
      icon: Gauge,
      title: "Scored & recommended",
      desc: "Communication, relevance, and confidence sub-scores roll up into one overall score and a clear recommendation — Strong Hire through No Hire.",
    },
    {
      icon: Target,
      title: "Matched vs. missing skills",
      desc: "Skills you actually demonstrated during the interview, checked against your resume and the role's JD — and which relevant ones never came up.",
    },
    {
      icon: ListChecks,
      title: "Strengths & areas to improve",
      desc: "Specific, grounded bullet points tied to what you actually said — not generic filler.",
    },
    {
      icon: Lightbulb,
      title: "A key takeaway & next step",
      desc: "One sentence a hiring manager can act on immediately, plus a concrete suggested next step.",
    },
  ];
  return (
    <section className="py-20 border-t border-zinc-200/80 bg-gradient-to-b from-white to-blue-50/40">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-blue-600 font-semibold px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200">
          <Award className="w-3 h-3" /> Generated from your real interview
        </span>
        <h2 className="text-2xl font-extrabold text-zinc-900 sm:text-3xl mt-4">Your Detailed Interview Report</h2>
        <p className="mt-1 text-zinc-500">
          The moment you finish the live demo above, {INTERVIEWER_NAME} scores your actual transcript and hands you this —
          not a preview, the real thing.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-4 text-left sm:grid-cols-2 px-6">
        {reportContents.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
                <Icon className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-zinc-900 mb-1">{item.title}</h3>
              <p className="text-[12.5px] text-zinc-500 leading-relaxed">{item.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="max-w-4xl mx-auto px-6 mt-8 text-center">
        <a
          href="#live-demo"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-all"
        >
          Get your report — try the live demo <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   CLOSING CTA
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
              <Radio className="w-6 h-6" />
            </div>
            <h2 className="text-[clamp(1.5rem,3.5vw,2.1rem)] font-extrabold text-white tracking-tight mb-3">
              Run your first real screen right now
            </h2>
            <p className="text-blue-100 text-[15px] max-w-lg mx-auto mb-8">
              No setup — scroll up, click Start Interview, and talk to {INTERVIEWER_NAME}.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="#live-demo"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
              >
                Try the Live Demo <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
