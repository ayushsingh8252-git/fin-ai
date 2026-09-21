"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Upload, FileText, ScanSearch, Mail, Target, ClipboardList,
  Award, ShieldCheck, UserPlus, BookOpen, CheckCircle2, Loader2, X, Search,
  ArrowUpDown, ChevronLeft, ChevronRight, Sparkles, Send, RotateCcw, Users,
  KeyRound, Laptop2, Building2, ScrollText, Video, CalendarClock, ClipboardCheck,
  Plug, Radio, Filter, GitBranch, PartyPopper, Bot, MailCheck, Star, ArrowUpRight,
  AlertTriangle, Calendar, Clock, Phone, Play, CalendarDays, Pause,
} from "lucide-react";
import { writeSyncedHires, clearSyncedHires } from "@/lib/hiringSync";
import { getAuthHeaders } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiConfig";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════
   Bulk Upload → Resume Parser → ATS + Email Extraction → Requirement Matching
   → Assignment Generator all call the real backend (/api/v1/hiring/*): actual
   PDF text extraction (PyMuPDF) plus LLM-based structured extraction/scoring
   (Groq-primary, Gemini-fallback — see backend/app/services/hiring_service.py).
   Bulk-send is now real too: POST /api/v1/hiring/bulk-send dispatches a real
   SMTP send per candidate (backend/app/services/email_service.py) and
   persists a real per-candidate CandidateDeliveryStatus row that this page
   polls — no email is ever reported "Sent" without send_assignment_email()
   actually having returned ok=True. Interview Scheduling's calendar picker
   is also real: it calls the Google Calendar MCP connector's
   check_availability tool for genuine free/busy data (falls back to an
   honest "couldn't check" disclosure, never a fabricated always-free grid,
   if Calendar isn't configured for this deployment). Onboarding and
   Knowledge Transfer still stay simulated — there's no Okta/Slack
   provisioning integration wired into this project — but they run on the
   real parsed candidates, which then hand off via sessionStorage to the
   existing Onboarding / Knowledge Transfer pages. Onboarding and Knowledge
   Transfer are human-triggered (a "Run Agent" click) rather than
   auto-chaining — nothing downstream of HR approval fires without an
   explicit click. */

const API_URL = getApiBaseUrl();

const AVATAR_PALETTE = [
  { bg: "bg-blue-50 border-blue-200", text: "text-blue-600" },
  { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-600" },
  { bg: "bg-violet-50 border-violet-200", text: "text-violet-600" },
  { bg: "bg-amber-50 border-amber-200", text: "text-amber-600" },
  { bg: "bg-rose-50 border-rose-200", text: "text-rose-600" },
  { bg: "bg-cyan-50 border-cyan-200", text: "text-cyan-600" },
];

interface InterviewSlot {
  date: string;
  time: string;
}

interface Candidate {
  id: string;
  filename: string;
  name: string;
  email: string | null;
  phone: string | null;
  experience: string;
  skills: string[];
  summary: string;
  ats: number;
  status: string;
  matchScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  recommendation: "Strong Hire" | "Hire" | "Consider" | "Not a Fit" | null;
  // Real status from CandidateDeliveryStatus (backend/app/models.py), polled
  // from GET /api/v1/hiring/bulk-send/status — not animated client state.
  deliveryId: string | null;
  deliveryStatus: "NOT_SENT" | "PENDING" | "SENDING" | "SENT" | "FAILED" | "REPLIED";
  deliveryError: string | null;
  avatarBg: string;
  avatarText: string;
  telephonicInterview: InterviewSlot | null;
  aiInterview: InterviewSlot | null;
  // Enterprise Orchestration Layer scores table — populated from
  // POST /api/v1/orchestrator/candidates/schedule once a slot is booked.
  // Real when a completed CallRecord / Screening episode already exists for
  // this candidate, otherwise a stable placeholder (isReal flags say which).
  telephonicScore: number | null;
  telephonicScoreIsReal: boolean;
  aiInterviewScore: number | null;
  aiInterviewScoreIsReal: boolean;
}

function candidateFromParsed(raw: Record<string, unknown>, index: number): Candidate {
  const palette = AVATAR_PALETTE[index % AVATAR_PALETTE.length];
  return {
    id: (raw.id as string) || `candidate-${index}`,
    filename: (raw.filename as string) || `resume-${index + 1}.pdf`,
    name: (raw.name as string) || (raw.filename as string) || `Candidate ${index + 1}`,
    email: (raw.email as string) || null,
    phone: (raw.phone as string) || null,
    experience: (raw.experience as string) || "Not specified",
    skills: Array.isArray(raw.skills) ? (raw.skills as string[]) : [],
    summary: (raw.summary as string) || "",
    ats: typeof raw.ats_score === "number" ? raw.ats_score : 0,
    status: "Shortlisted",
    matchScore: null,
    matchedSkills: [],
    missingSkills: [],
    recommendation: null,
    deliveryId: null,
    deliveryStatus: "NOT_SENT",
    deliveryError: null,
    avatarBg: palette.bg,
    avatarText: palette.text,
    telephonicInterview: null,
    aiInterview: null,
    telephonicScore: null,
    telephonicScoreIsReal: false,
    aiInterviewScore: null,
    aiInterviewScoreIsReal: false,
  };
}

// `live: true` marks the 5 stages that call the real backend
// (/api/v1/hiring/*  — see the file-header comment above); `live: false`
// marks the 5 that are simulated/human-triggered in this build (no
// SMTP/MCP/calendar/Okta/Slack integration wired in yet). Surfaced in the
// chip tooltips below rather than silently presenting all 10 as equally
// "live" — see platform-status-audit docs for the same distinction.
const PIPELINE_NODES = [
  { key: "upload", title: "Bulk PDF Upload", shortTitle: "Bulk PDF Upload", desc: "Ingests resumes from HR bulk upload", icon: Upload, live: true },
  { key: "parser", title: "Resume Parser", shortTitle: "Resume Parser", desc: "Extracts structured text & entities", icon: ScanSearch, live: true },
  { key: "ats", title: "ATS + Email Extraction", shortTitle: "ATS + Email", desc: "Scores resumes, extracts contact info", icon: Mail, live: true },
  { key: "matching", title: "Requirement Matching", shortTitle: "Requirement Match", desc: "Matches skills to role requirements", icon: Target, live: true },
  { key: "assignment", title: "Assignment Generator", shortTitle: "Assignment Gen", desc: "Drafts a personalized take-home task", icon: ClipboardList, live: true },
  { key: "evaluation", title: "Candidate Evaluation", shortTitle: "Candidate Eval", desc: "Scores submissions & ranks candidates", icon: Award, live: false },
  { key: "review", title: "HR & Hiring Manager Review", shortTitle: "HR Review", desc: "Human approval gate before onboarding", icon: ShieldCheck, live: false },
  { key: "scheduling", title: "Interview Scheduling", shortTitle: "Interview Schedule", desc: "Checks real Google Calendar availability and books telephonic & AI interview slots", icon: CalendarDays, live: true },
  { key: "onboarding", title: "Onboarding Agent", shortTitle: "Onboarding Agent", desc: "Provisions accounts & equipment", icon: UserPlus, live: false },
  { key: "knowledge", title: "Knowledge Transfer Agent", shortTitle: "Knowledge Transfer", desc: "Assigns docs, videos & training", icon: BookOpen, live: false },
] as const;

function nodeTooltip(node: { desc: string; live: boolean }): string {
  return node.live ? node.desc : `${node.desc} (simulated in this build — no live backend call)`;
}

const ONBOARDING_STEPS = [
  { label: "Create Employee", icon: UserPlus },
  { label: "Generate Credentials", icon: KeyRound },
  { label: "Assign Equipment", icon: Laptop2 },
  { label: "Create Workspace", icon: Building2 },
  { label: "Welcome Email", icon: Mail },
];

const KT_STEPS = [
  { label: "Assign Documents", icon: FileText },
  { label: "Assign Videos", icon: Video },
  { label: "Assign Policies", icon: ScrollText },
  { label: "Schedule Sessions", icon: CalendarClock },
  { label: "Track Completion", icon: ClipboardCheck },
];

const GEN_STEPS = ["Thinking...", "Creating task...", "Personalizing assignment...", "Ready"];
const MCP_STEPS = ["Connecting...", "Personalizing Email...", "Sending...", "Completed"];

const REQUIREMENT_PLACEHOLDER = `Create a backend assignment using FastAPI.

Include:
• Authentication
• CRUD APIs
• Docker
• Unit Tests

Expected completion:
48 Hours`;

type Stage =
  | "idle" | "parsing" | "spreadsheet" | "generating" | "assignment"
  | "sending" | "evaluation" | "scheduling" | "onboarding" | "knowledge" | "done";
type NodeStatus = "pending" | "active" | "done";
type InterviewType = "telephonic" | "ai";

/* "What is the AI doing right now", in plain language, for the persistent
   header — see workflowStatus useMemo in HiringAutomationPage. */
type WorkflowMode = "idle" | "running" | "waiting" | "approval" | "done";
interface WorkflowStatus {
  index: number | null;
  label: string;
  detail: string;
  percent: number | null;
  mode: WorkflowMode;
}

/* Maps a PIPELINE_NODES key to the DOM id of the section that best
   represents it, for header/card click-to-scroll. Several agents share one
   visible section (e.g. parser/ats both land on the candidate table). */
const SCROLL_TARGET: Record<string, string> = {
  upload: "upload", parser: "candidates", ats: "candidates", matching: "requirements",
  assignment: "assignment", evaluation: "evaluation", review: "evaluation",
  scheduling: "scheduling", onboarding: "onboarding", knowledge: "knowledge",
};

interface GeneratedAssignment {
  title: string;
  duration: string;
  requirements: string[];
  submission: string;
}

const DEFAULT_ASSIGNMENT: GeneratedAssignment = {
  title: "Backend Engineer Assessment",
  duration: "48 Hours",
  requirements: ["FastAPI", "JWT Authentication", "Docker", "PostgreSQL", "Unit Tests"],
  submission: "GitHub Repository",
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* Runs a real API call alongside a minimum visible delay, so fast responses
   still read as a deliberate pipeline stage instead of a jarring instant
   flash — but a slow backend call is never cut short to fit the animation. */
async function withMinDelay<T>(promise: Promise<T>, ms: number): Promise<T> {
  const [result] = await Promise.all([promise, sleep(ms)]);
  return result;
}

/* ── Interview scheduling calendar helpers ──
   Deterministic (no backend, no Math.random) so a candidate's slot grid
   doesn't reshuffle itself on every re-render. */
const TIME_SLOTS = [
  "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
  "12:00 PM", "01:00 PM", "01:30 PM", "02:00 PM", "02:30 PM", "03:00 PM",
  "03:30 PM", "04:00 PM", "04:30 PM",
];

function nextWeekdays(count: number): Date[] {
  const dates: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function emailLabel(status: Candidate["deliveryStatus"]): string {
  switch (status) {
    case "NOT_SENT": return "Not sent";
    case "PENDING": return "Queued";
    case "SENDING": return "Sending…";
    case "SENT": return "Sent";
    case "FAILED": return "Failed";
    case "REPLIED": return "Sent";
    default: return status;
  }
}

function emailTone(status: Candidate["deliveryStatus"]): StatusTone {
  switch (status) {
    case "SENT":
    case "REPLIED": return "success";
    case "FAILED": return "danger";
    case "PENDING":
    case "SENDING": return "warning";
    default: return "neutral";
  }
}

interface BusyInterval {
  start: string;
  end: string;
}

const SLOT_DURATION_MINUTES = 30;

/** Parses "09:00 AM"/"01:30 PM" against a given day into a local Date. */
function parseSlotDateTime(day: Date, timeLabel: string): Date {
  const match = timeLabel.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  const d = new Date(day);
  if (!match) return d;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const isPM = match[3].toUpperCase() === "PM";
  if (isPM && hours !== 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function slotOverlapsBusy(slotStart: Date, busy: BusyInterval[]): boolean {
  const slotEnd = new Date(slotStart.getTime() + SLOT_DURATION_MINUTES * 60000);
  return busy.some((b) => {
    const bStart = new Date(b.start);
    const bEnd = new Date(b.end);
    return slotStart < bEnd && slotEnd > bStart;
  });
}

/* Retries a flaky call with backoff — a genuine transient failure (network
   blip, cold backend) gets a real second try; a 4xx (bad request, or
   not_configured because Google Calendar isn't wired up for this deployment)
   is a real rejection that retrying can't change, so it returns immediately. */
async function fetchWithRetry(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxAttempts) await sleep(Math.min(2000, 400 * 2 ** (attempt - 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Request failed after retries");
}

/** Real free/busy check via the existing Google Calendar MCP connector
 * (backend/app/mcp/connectors/google/calendar.py::_check_availability) —
 * the same generic tool-call endpoint the Command Center uses. Returns
 * `null` (not an empty array) when the check genuinely couldn't be
 * completed — e.g. Google Calendar isn't configured for this deployment, or
 * the request failed after retries — so the caller can distinguish "we know
 * this slot is free" from "we don't know," rather than defaulting to a
 * fabricated always-free grid. */
async function fetchDayAvailability(dayStart: Date, dayEnd: Date): Promise<BusyInterval[] | null> {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/v1/agent/tools/google_calendar/check_availability/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        calendar_ids: ["primary"],
        time_min_iso: dayStart.toISOString(),
        time_max_iso: dayEnd.toISOString(),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const primary = data?.calendars?.primary;
    return Array.isArray(primary?.busy) ? primary.busy : [];
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function HiringAutomationPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [completedNodes, setCompletedNodes] = useState<number[]>([]);
  const [activeNode, setActiveNode] = useState<number | null>(null);
  const [parsingLog, setParsingLog] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [requirement, setRequirement] = useState("");
  const [genStep, setGenStep] = useState(0);
  const [assignment, setAssignment] = useState<GeneratedAssignment>(DEFAULT_ASSIGNMENT);
  const [mcpStep, setMcpStep] = useState(0);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [interviewModal, setInterviewModal] = useState<{ candidateId: string; type: InterviewType } | null>(null);
  const [onboardProgress, setOnboardProgress] = useState(0);
  const [onboardRunning, setOnboardRunning] = useState(false);
  const [ktProgress, setKtProgress] = useState(0);
  const [ktRunning, setKtRunning] = useState(false);
  const runId = useRef(0);
  const pipelineCardRef = useRef<HTMLDivElement>(null);
  const [showStickyChain, setShowStickyChain] = useState(false);

  // Invalidates any in-flight animation chain (runNode/sleep timers) on unmount — otherwise
  // a pending setTimeout from a chain still running when the user navigates away (e.g. via
  // the "Open Onboarding Agent" link mid-animation) would call setState after unmount.
  useEffect(() => () => { runId.current += 1; }, []);

  // The compact "AI Agents" chain in the sticky header is redundant while the
  // big in-page Live Agent Workflow card is still on screen — it only needs
  // to appear once that card has scrolled up out of view (not before the
  // user has scrolled to it at all, which is why boundingClientRect.top < 0
  // is checked alongside isIntersecting: the observer's negative rootMargin
  // makes both "not yet scrolled to" and "scrolled past" read as
  // non-intersecting, and only the latter should show the sticky chain).
  useEffect(() => {
    const el = pipelineCardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyChain(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { rootMargin: "-104px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const nodeStatus = (idx: number): NodeStatus =>
    completedNodes.includes(idx) ? "done" : activeNode === idx ? "active" : "pending";

  const runNode = (idx: number, ms: number) =>
    new Promise<void>((resolve) => {
      setActiveNode(idx);
      setTimeout(() => {
        setCompletedNodes((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
        setActiveNode(null);
        resolve();
      }, ms);
    });

  const handleAddFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => [...prev, ...incoming]);
  };
  const handleRemoveFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleProcess = async () => {
    if (files.length === 0 || stage !== "idle") return;
    const myRun = ++runId.current;
    setApiError(null);
    setStage("parsing");
    setParsingLog(`Uploading ${files.length} resume${files.length === 1 ? "" : "s"} to the parsing engine…`);
    await runNode(0, 500);
    if (myRun !== runId.current) return;

    setParsingLog("Resume Parser extracting text, sections & entities (PyMuPDF + LLM)…");
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    let parsed: Record<string, unknown>[];
    try {
      const res = await withMinDelay(
        fetch(`${API_URL}/api/v1/hiring/parse-resumes`, { method: "POST", headers: getAuthHeaders(), body: formData }),
        1200
      );
      if (myRun !== runId.current) return;
      if (!res.ok) throw new Error(`Resume parsing failed (${res.status})`);
      const data = await res.json();
      parsed = data.candidates || [];
    } catch (err) {
      if (myRun !== runId.current) return;
      setApiError(err instanceof Error ? err.message : "Could not reach the resume parsing backend.");
      setStage("idle");
      return;
    }
    if (myRun !== runId.current) return;
    await runNode(1, 300);
    if (myRun !== runId.current) return;

    const failed = parsed.filter((p) => p.status === "failed");
    const ok = parsed.filter((p) => p.status !== "failed").map((p, i) => candidateFromParsed(p, i));
    if (ok.length === 0) {
      setApiError(failed[0]?.reason as string || "No resumes could be parsed.");
      setStage("idle");
      return;
    }

    setParsingLog(`ATS engine scored ${ok.length} resume${ok.length === 1 ? "" : "s"} & extracted contact info.`);
    setCandidates(ok);
    await runNode(2, 500);
    if (myRun !== runId.current) return;
    setStage("spreadsheet");
  };

  const handleGenerateAssignment = async () => {
    if (stage !== "spreadsheet" || !requirement.trim() || candidates.length === 0) return;
    const myRun = runId.current;
    setApiError(null);
    setStage("generating");

    try {
      const matchRes = await withMinDelay(
        fetch(`${API_URL}/api/v1/hiring/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            candidates: candidates.map((c) => ({
              id: c.id, name: c.name, experience: c.experience, skills: c.skills, summary: c.summary, ats_score: c.ats,
            })),
            requirement,
            role_title: "the open role",
          }),
        }),
        1100
      );
      if (myRun !== runId.current) return;
      if (!matchRes.ok) throw new Error(`Requirement matching failed (${matchRes.status})`);
      const matchData = await matchRes.json();
      const byId = new Map((matchData.results || []).map((r: Record<string, unknown>) => [r.id, r]));
      setCandidates((prev) => prev.map((c) => {
        const m = byId.get(c.id) as Record<string, unknown> | undefined;
        if (!m) return c;
        return {
          ...c,
          matchScore: typeof m.match_score === "number" ? m.match_score : c.matchScore,
          matchedSkills: Array.isArray(m.matched_skills) ? (m.matched_skills as string[]) : c.matchedSkills,
          missingSkills: Array.isArray(m.missing_skills) ? (m.missing_skills as string[]) : c.missingSkills,
          recommendation: (m.recommendation as Candidate["recommendation"]) || c.recommendation,
        };
      }));
    } catch (err) {
      if (myRun !== runId.current) return;
      setApiError(err instanceof Error ? err.message : "Could not reach the requirement matching backend.");
      setStage("spreadsheet");
      return;
    }
    if (myRun !== runId.current) return;
    await runNode(3, 400);
    if (myRun !== runId.current) return;

    for (let s = 0; s < GEN_STEPS.length - 1; s++) {
      setGenStep(s);
      await sleep(500);
      if (myRun !== runId.current) return;
    }

    try {
      const asgRes = await withMinDelay(
        fetch(`${API_URL}/api/v1/hiring/assignment`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ requirement, role_title: "the open role" }),
        }),
        600
      );
      if (myRun !== runId.current) return;
      if (!asgRes.ok) throw new Error(`Assignment generation failed (${asgRes.status})`);
      setAssignment(await asgRes.json());
    } catch (err) {
      if (myRun !== runId.current) return;
      setApiError(err instanceof Error ? err.message : "Could not reach the assignment generation backend.");
      setStage("spreadsheet");
      return;
    }
    setGenStep(GEN_STEPS.length - 1);
    if (myRun !== runId.current) return;
    await runNode(4, 500);
    if (myRun !== runId.current) return;
    setStage("assignment");
  };

  /* Real bulk send: POSTs to /hiring/bulk-send (creates one
     CandidateDeliveryStatus row per candidate and dispatches a real SMTP
     send for each, see backend/app/api/hiring.py), then polls
     /hiring/bulk-send/status until every candidate reaches a terminal
     SENT/FAILED state. The MCP_STEPS progress bar below is now purely a
     "something is happening" indicator running alongside the real send —
     it is never what marks a candidate as delivered; only a real polled
     status does that. */
  const handleBulkSend = async () => {
    if (stage !== "assignment") return;
    const myRun = runId.current;
    setStage("sending");
    setApiError(null);

    const animation = (async () => {
      for (let s = 0; s < MCP_STEPS.length - 1; s++) {
        setMcpStep(s);
        await sleep(700);
        if (myRun !== runId.current) return;
      }
    })();

    let deliveryIds: Record<string, string> = {};
    try {
      const res = await fetch(`${API_URL}/api/v1/hiring/bulk-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          candidates: candidates.map((c) => ({ id: c.id, name: c.name, email: c.email })),
          role_title: "the open role",
          assignment: {
            title: assignment.title,
            duration: assignment.duration,
            requirements: assignment.requirements,
            submission: assignment.submission,
          },
        }),
      });
      if (myRun !== runId.current) return;
      if (!res.ok) throw new Error(`Bulk send failed (${res.status})`);
      const data = await res.json();
      deliveryIds = data.delivery_ids || {};
    } catch (err) {
      if (myRun !== runId.current) return;
      setApiError(err instanceof Error ? err.message : "Could not reach the email delivery backend.");
      setStage("assignment");
      return;
    }

    setCandidates((prev) => prev.map((c) => (
      deliveryIds[c.id]
        ? { ...c, deliveryId: deliveryIds[c.id], deliveryStatus: "PENDING", deliveryError: null }
        : c
    )));

    await animation;
    if (myRun !== runId.current) return;
    setMcpStep(MCP_STEPS.length - 1);

    const ids = candidates.map((c) => c.id);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (myRun !== runId.current) return;
      try {
        const res = await fetch(
          `${API_URL}/api/v1/hiring/bulk-send/status?candidate_ids=${encodeURIComponent(ids.join(","))}`,
          { headers: getAuthHeaders() }
        );
        if (myRun !== runId.current) return;
        if (res.ok) {
          const data = await res.json();
          const statuses: Array<{ candidate_id: string; status: Candidate["deliveryStatus"]; error: string | null }> = data.statuses || [];
          setCandidates((prev) => prev.map((c) => {
            const s = statuses.find((x) => x.candidate_id === c.id);
            return s ? { ...c, deliveryStatus: s.status, deliveryError: s.error } : c;
          }));
          const allTerminal = ids.every((id) => {
            const s = statuses.find((x) => x.candidate_id === id);
            return s && (s.status === "SENT" || s.status === "FAILED");
          });
          if (allTerminal) break;
        }
      } catch {
        // Transient poll failure — the loop itself is the retry; just try again next tick.
      }
      await sleep(1500);
    }
    if (myRun !== runId.current) return;

    await runNode(5, 300);
    if (myRun !== runId.current) return;
    setStage("evaluation");
  };

  const handleMarkReplied = async (candidateId: string, deliveryId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/hiring/bulk-send/${deliveryId}/mark-replied`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      setCandidates((prev) => prev.map((c) => (c.id === candidateId ? { ...c, deliveryStatus: "REPLIED" } : c)));
    } catch {
      // Best-effort — the pill just stays at "Sent" if this fails; nothing is fabricated on the frontend.
    }
  };

  /* Evaluation → Scheduling used to advance automatically the instant every
     candidate's approvals[] flipped true — a reactive useEffect watching
     that condition. That meant confirming the last candidate silently
     cascaded straight into the next stage with no user action tying the two
     together (and, since this effect never bumped runId like its sibling
     async chains, an overlapping re-fire could even queue the cascade
     twice). Now the human has to explicitly pick which candidates to send
     ("confirm candidate 1, 2, or any subset") and click Send — that single
     click both records the approvals AND, only once it's the send that
     completes approval for every candidate, advances to Interview
     Scheduling. Nothing happens on its own anymore. */
  const handleSendForApproval = (ids: string[]) => {
    if (ids.length === 0 || stage !== "evaluation") return;
    const myRun = ++runId.current;
    setApprovals((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = true; });
      return next;
    });
    const allApproved = candidates.every((c) => ids.includes(c.id) || approvals[c.id]);
    if (!allApproved) return;
    (async () => {
      await runNode(6, 900);
      if (myRun !== runId.current) return;
      writeSyncedHires(candidates.map((c) => ({
        id: c.id, name: c.name, email: c.email || "unknown@example.com", designation: "Backend Engineer",
        ats: c.ats, experience: c.experience, skills: c.skills,
      })));
      setActiveNode(7);
      setStage("scheduling");
    })();
  };

  const handleScheduleInterview = (candidateId: string, type: InterviewType, slot: InterviewSlot) => {
    setCandidates((prev) => prev.map((c) => (
      c.id === candidateId ? { ...c, [type === "telephonic" ? "telephonicInterview" : "aiInterview"]: slot } : c
    )));
    setInterviewModal(null);

    // Enterprise Orchestration Layer: persist the schedule and pull in the
    // candidate's score (real, if a completed CallRecord/Screening episode
    // already exists — otherwise a stable placeholder) for the scores table.
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/orchestrator/candidates/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            candidate_id: candidate.id,
            candidate_name: candidate.name,
            email: candidate.email,
            interview_type: type,
            slot_date: slot.date,
            slot_time: slot.time,
          }),
        });
        if (!res.ok) return;
        const card = await res.json();
        setCandidates((prev) => prev.map((c) => (
          c.id === candidateId
            ? {
                ...c,
                telephonicScore: card.telephonic_score ?? c.telephonicScore,
                telephonicScoreIsReal: card.telephonic_score_is_real ?? c.telephonicScoreIsReal,
                aiInterviewScore: card.ai_interview_score ?? c.aiInterviewScore,
                aiInterviewScoreIsReal: card.ai_interview_score_is_real ?? c.aiInterviewScoreIsReal,
              }
            : c
        )));
      } catch (err) {
        console.error("Failed to sync candidate scorecard:", err);
      }
    })();
  };

  const handleContinueToOnboarding = () => {
    if (stage !== "scheduling") return;
    setCompletedNodes((prev) => (prev.includes(7) ? prev : [...prev, 7]));
    setActiveNode(null);
    setStage("onboarding");
  };

  const handleRunOnboarding = async () => {
    if (stage !== "onboarding" || onboardRunning || onboardProgress > 0) return;
    const myRun = runId.current;
    setOnboardRunning(true);
    setActiveNode(8);
    for (let s = 0; s <= ONBOARDING_STEPS.length; s++) {
      setOnboardProgress(s);
      await sleep(550);
      if (myRun !== runId.current) return;
    }
    setCompletedNodes((prev) => (prev.includes(8) ? prev : [...prev, 8]));
    setActiveNode(null);
    setOnboardRunning(false);
  };

  const handleContinueToKnowledge = () => {
    if (stage !== "onboarding") return;
    setStage("knowledge");
  };

  const handleRunKnowledgeTransfer = async () => {
    if (stage !== "knowledge" || ktRunning || ktProgress > 0) return;
    const myRun = runId.current;
    setKtRunning(true);
    setActiveNode(9);
    for (let s = 0; s <= KT_STEPS.length; s++) {
      setKtProgress(s);
      await sleep(550);
      if (myRun !== runId.current) return;
    }
    setCompletedNodes((prev) => (prev.includes(9) ? prev : [...prev, 9]));
    setActiveNode(null);
    setKtRunning(false);
  };

  const handleFinish = () => {
    if (stage !== "knowledge") return;
    setStage("done");
  };

  const handleReset = () => {
    runId.current += 1;
    clearSyncedHires();
    setFiles([]);
    setStage("idle");
    setCompletedNodes([]);
    setActiveNode(null);
    setParsingLog("");
    setCandidates([]);
    setApiError(null);
    setRequirement("");
    setGenStep(0);
    setAssignment(DEFAULT_ASSIGNMENT);
    setMcpStep(0);
    setApprovals({});
    setInterviewModal(null);
    setOnboardProgress(0);
    setOnboardRunning(false);
    setKtProgress(0);
    setKtRunning(false);
  };

  const stageIndex: Record<Stage, number> = {
    idle: 0, parsing: 1, spreadsheet: 2, generating: 3, assignment: 4,
    sending: 5, evaluation: 6, scheduling: 7, onboarding: 8, knowledge: 9, done: 10,
  };
  const reached = (s: Stage) => stageIndex[stage] >= stageIndex[s];

  /* Single source of truth for "what is the AI doing right now", reused by
     both the sticky header and the in-page pipeline card. Driven by `stage`
     rather than `activeNode` alone — activeNode goes briefly null between
     some stage transitions (e.g. for the whole generating/sending ticker
     animations), so stage is the more reliable signal for which agent to
     highlight as current. Never fabricates a percentage where the app has
     no real step count to report (parsing is time-based, not step-based). */
  const workflowStatus: WorkflowStatus = useMemo(() => {
    const scheduledCount = candidates.filter((c) => c.telephonicInterview || c.aiInterview).length;
    const pendingApproval = candidates.filter((c) => !approvals[c.id]).length;
    switch (stage) {
      case "idle":
        return { index: null, label: "Ready", detail: "Waiting for resumes to upload", percent: null, mode: "idle" };
      case "parsing": {
        const idx = activeNode ?? 2;
        return { index: idx, label: PIPELINE_NODES[idx].title, detail: parsingLog || "Working…", percent: null, mode: "running" };
      }
      case "spreadsheet":
        return { index: 3, label: PIPELINE_NODES[3].title, detail: "Waiting for HR to enter role requirements", percent: null, mode: "waiting" };
      case "generating":
        return { index: 4, label: PIPELINE_NODES[4].title, detail: GEN_STEPS[genStep], percent: Math.round(((genStep + 1) / GEN_STEPS.length) * 100), mode: "running" };
      case "assignment":
        return { index: 5, label: PIPELINE_NODES[5].title, detail: "Waiting for HR to send the assignment to candidates", percent: null, mode: "waiting" };
      case "sending":
        return { index: 5, label: PIPELINE_NODES[5].title, detail: MCP_STEPS[mcpStep], percent: Math.round(((mcpStep + 1) / MCP_STEPS.length) * 100), mode: "running" };
      case "evaluation":
        return {
          index: 6, label: PIPELINE_NODES[6].title,
          detail: `${pendingApproval} candidate${pendingApproval === 1 ? "" : "s"} ready for review`,
          percent: null, mode: "approval",
        };
      case "scheduling":
        return {
          index: 7, label: PIPELINE_NODES[7].title,
          detail: `${scheduledCount}/${candidates.length} interviews scheduled`,
          percent: candidates.length > 0 ? Math.round((scheduledCount / candidates.length) * 100) : 0,
          mode: "running",
        };
      case "onboarding": {
        if (onboardRunning) {
          const step = ONBOARDING_STEPS[Math.min(onboardProgress, ONBOARDING_STEPS.length - 1)];
          return { index: 8, label: PIPELINE_NODES[8].title, detail: step.label, percent: Math.round((onboardProgress / ONBOARDING_STEPS.length) * 100), mode: "running" };
        }
        if (onboardProgress >= ONBOARDING_STEPS.length) {
          return { index: 8, label: PIPELINE_NODES[8].title, detail: "Onboarding complete — continue to Knowledge Transfer", percent: 100, mode: "running" };
        }
        return { index: 8, label: PIPELINE_NODES[8].title, detail: "Ready — run the onboarding agent", percent: null, mode: "waiting" };
      }
      case "knowledge": {
        if (ktRunning) {
          const step = KT_STEPS[Math.min(ktProgress, KT_STEPS.length - 1)];
          return { index: 9, label: PIPELINE_NODES[9].title, detail: step.label, percent: Math.round((ktProgress / KT_STEPS.length) * 100), mode: "running" };
        }
        if (ktProgress >= KT_STEPS.length) {
          return { index: 9, label: PIPELINE_NODES[9].title, detail: "Knowledge transfer complete — finish the workflow", percent: 100, mode: "running" };
        }
        return { index: 9, label: PIPELINE_NODES[9].title, detail: "Ready — run the knowledge transfer agent", percent: null, mode: "waiting" };
      }
      case "done":
        return { index: null, label: "Complete", detail: "All 10 agents complete", percent: 100, mode: "done" };
    }
  }, [stage, activeNode, parsingLog, genStep, mcpStep, onboardProgress, onboardRunning, ktProgress, ktRunning, candidates, approvals]);

  const onJump = (key: string) => {
    const targetId = SCROLL_TARGET[key] ?? key;
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      {/* PERSISTENT HEADER — application branding (Level 1) + live agent
          workflow (Level 2), both pinned beneath ProductNav while scrolling */}
      <WorkflowHeader
        nodeStatus={nodeStatus}
        workflowStatus={workflowStatus}
        doneCount={completedNodes.length}
        onReset={handleReset}
        onJump={onJump}
        showChain={showStickyChain}
      />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-10 relative z-10">
        {/* HERO */}
        <div className="text-center max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-200 bg-zinc-50 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] font-mono font-bold text-zinc-600">{PIPELINE_NODES.length}-AGENT PIPELINE READY</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 mb-2">End-to-End Agentic Hiring Workflow</h1>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Upload resumes and watch autonomous agents parse, match, assign, evaluate, schedule interviews, and onboard — with a human approval gate before anything touches a real system.
          </p>
        </div>

        {/* PIPELINE VISUALIZATION */}
        <div ref={pipelineCardRef}>
          <PipelineFlow nodeStatus={nodeStatus} workflowStatus={workflowStatus} onJump={onJump} />
        </div>

        {/* UPLOAD */}
        <div id="upload" className="scroll-mt-[220px]">
          <UploadPanel
            files={files}
            stage={stage}
            error={apiError}
            onAdd={handleAddFiles}
            onRemove={handleRemoveFile}
            onProcess={handleProcess}
          />
        </div>

        {/* PARSING TICKER */}
        <AnimatePresence>
          {stage === "parsing" && <ParsingTicker log={parsingLog} />}
        </AnimatePresence>

        {/* CANDIDATE SPREADSHEET */}
        <AnimatePresence>
          {reached("spreadsheet") && candidates.length > 0 && (
            <motion.div id="candidates" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <CandidateSpreadsheet candidates={candidates} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* HUMAN IN THE LOOP */}
        <AnimatePresence>
          {reached("spreadsheet") && (
            <motion.div id="requirements" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <HumanInLoopPanel
                requirement={requirement}
                setRequirement={setRequirement}
                onGenerate={handleGenerateAssignment}
                locked={stage !== "spreadsheet"}
                candidateCount={candidates.length}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ASSIGNMENT GENERATION TICKER */}
        <AnimatePresence>
          {stage === "generating" && <AssignmentTicker step={genStep} />}
        </AnimatePresence>

        {/* ASSIGNMENT CARD */}
        <AnimatePresence>
          {reached("assignment") && (
            <motion.div id="assignment" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
              <AssignmentCard assignment={assignment} onBulkSend={handleBulkSend} locked={stage !== "assignment"} sent={reached("sending")} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* MCP EMAIL TOOL */}
        <AnimatePresence>
          {stage === "sending" && <McpSendPanel step={mcpStep} candidates={candidates} />}
        </AnimatePresence>

        {/* EVALUATION TABLE */}
        <AnimatePresence>
          {reached("evaluation") && (
            <motion.div id="evaluation" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <EvaluationTable candidates={candidates} approvals={approvals} onSend={handleSendForApproval} onMarkReplied={handleMarkReplied} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* INTERVIEW SCHEDULING */}
        <AnimatePresence>
          {reached("scheduling") && (
            <motion.div id="scheduling" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <InterviewSchedulingPanel
                candidates={candidates}
                locked={stage !== "scheduling"}
                onOpenModal={(candidateId, type) => setInterviewModal({ candidateId, type })}
                onContinue={handleContinueToOnboarding}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ENTERPRISE ORCHESTRATION LAYER — candidate scores table, appears
            once at least one interview has been scheduled and grows/updates
            from there. */}
        <AnimatePresence>
          {reached("scheduling") && candidates.some((c) => c.telephonicInterview || c.aiInterview) && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <CandidateScoresTable candidates={candidates} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ONBOARDING AGENT */}
        <AnimatePresence>
          {reached("onboarding") && (
            <motion.div id="onboarding" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <OnboardingPanel
                progress={onboardProgress}
                running={onboardRunning}
                candidateCount={candidates.length}
                onRun={handleRunOnboarding}
                onContinue={handleContinueToKnowledge}
                showContinue={stage === "onboarding"}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* KNOWLEDGE TRANSFER AGENT */}
        <AnimatePresence>
          {reached("knowledge") && (
            <motion.div id="knowledge" className="scroll-mt-[220px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <KnowledgeTransferPanel
                progress={ktProgress}
                running={ktRunning}
                candidateCount={candidates.length}
                onRun={handleRunKnowledgeTransfer}
                onFinish={handleFinish}
                showFinish={stage === "knowledge"}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* COMPLETION */}
        <AnimatePresence>
          {stage === "done" && <CompletionBanner onReset={handleReset} candidates={candidates} />}
        </AnimatePresence>
      </main>

      {/* INTERVIEW CALENDAR MODAL */}
      <AnimatePresence>
        {interviewModal && (() => {
          const candidate = candidates.find((c) => c.id === interviewModal.candidateId);
          if (!candidate) return null;
          return (
            <InterviewCalendarModal
              candidate={candidate}
              type={interviewModal.type}
              onClose={() => setInterviewModal(null)}
              onConfirm={(slot) => handleScheduleInterview(candidate.id, interviewModal.type, slot)}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PIPELINE VISUALIZATION
   ═══════════════════════════════════════════════════════════ */

function PipelineFlow({
  nodeStatus, workflowStatus, onJump,
}: { nodeStatus: (idx: number) => NodeStatus; workflowStatus: WorkflowStatus; onJump: (key: string) => void }) {
  const doneCount = PIPELINE_NODES.filter((_, i) => nodeStatus(i) === "done").length;
  const activeIdx = PIPELINE_NODES.findIndex((_, i) => nodeStatus(i) === "active");
  const isRunning = activeIdx !== -1;
  const isApproval = workflowStatus.mode === "approval";

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-4 sm:p-5 shadow-sm relative overflow-hidden">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex items-center justify-center w-6 h-6 rounded-lg bg-blue-50 border border-blue-200 text-blue-600">
            {isRunning && <span className="absolute inset-0 rounded-lg bg-blue-400/40 animate-ping" />}
            <Bot className="w-3.5 h-3.5 relative" />
          </span>
          <span className="text-xs font-bold text-zinc-900 uppercase tracking-wide">Live Agent Workflow</span>
        </div>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600 flex items-center gap-1.5">
          {isRunning && <Radio className="w-2.5 h-2.5 text-blue-600 animate-pulse" />}
          {doneCount}/{PIPELINE_NODES.length} STAGES COMPLETE
        </span>
      </div>

      <div className="h-1.5 bg-zinc-100 rounded-full relative overflow-hidden mb-4">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"
          animate={{ width: `${(doneCount / PIPELINE_NODES.length) * 100}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {isRunning && (
          <div className="absolute top-0 bottom-0 w-12 bg-gradient-to-r from-transparent via-blue-300 to-transparent animate-track-packet" />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 items-stretch">
        {PIPELINE_NODES.map((node, i) => {
          const status = nodeStatus(i);
          const paused = isApproval && node.key === "review";
          const Icon = node.icon;
          return (
            <motion.button
              key={node.key}
              type="button"
              onClick={() => onJump(node.key)}
              title={nodeTooltip(node)}
              initial={{ opacity: 0, y: 8 }}
              animate={
                status === "active"
                  ? { opacity: 1, y: 0, scale: 1.03, boxShadow: ["0 0 0px rgba(37,99,235,0.0)", "0 0 22px rgba(37,99,235,0.45)", "0 0 0px rgba(37,99,235,0.0)"] }
                  : { opacity: 1, y: 0, scale: 1, boxShadow: "0 0 0px rgba(37,99,235,0)" }
              }
              transition={
                status === "active"
                  ? { boxShadow: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, default: { duration: 0.3 } }
                  : { delay: i * 0.03, duration: 0.3 }
              }
              className={`relative w-full rounded-2xl border p-2.5 flex flex-col items-center justify-center text-center gap-1.5 min-h-[94px] overflow-hidden transition-all cursor-pointer ${
                paused
                  ? "bg-amber-50 border-amber-300 hover:shadow-md"
                  : status === "active"
                  ? "bg-blue-600 border-blue-600 text-white shadow-md"
                  : status === "done"
                  ? "bg-emerald-50/70 border-emerald-300 hover:shadow-md"
                  : "bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-md"
              }`}
            >
              {status === "active" && (
                <motion.div
                  className="absolute inset-x-0 h-6 bg-white/10 pointer-events-none"
                  initial={{ top: "-20%" }}
                  animate={{ top: "110%" }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
                />
              )}
              <div className="flex items-center justify-center relative">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    paused ? "bg-amber-100 text-amber-700" : status === "active" ? "bg-white/20 text-white" : status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600"
                  }`}
                >
                  {paused ? <Pause className="w-3.5 h-3.5" /> : status === "done" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : status === "active" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
              </div>
              <div className="relative flex flex-col items-center justify-center">
                <div className={`text-[10.5px] font-bold leading-snug text-center ${status === "active" ? "text-white" : paused ? "text-amber-800" : "text-zinc-900"}`}>
                  {node.shortTitle}
                </div>
                {!node.live && (
                  <div className={`text-[8px] font-mono font-semibold uppercase tracking-wide mt-0.5 text-center ${status === "active" ? "text-blue-100" : "text-zinc-400"}`}>
                    Simulated
                  </div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PERSISTENT WORKFLOW HEADER — sticky beneath the shared
   ProductNav (top-12 = ProductNav's h-12). Two rows: application
   branding (unchanged content) and the live agent workflow, which
   never disappears while the page scrolls.
   ═══════════════════════════════════════════════════════════ */

function WorkflowHeader({
  nodeStatus, workflowStatus, doneCount, onReset, onJump, showChain,
}: {
  nodeStatus: (idx: number) => NodeStatus;
  workflowStatus: WorkflowStatus;
  doneCount: number;
  onReset: () => void;
  onJump: (key: string) => void;
  /** The big in-page "Live Agent Workflow" card already shows this same
   * chain — the compact header version only needs to appear once that card
   * has scrolled out of view, instead of duplicating it from the first pixel
   * of the page. */
  showChain: boolean;
}) {
  const pct = Math.round((doneCount / PIPELINE_NODES.length) * 100);
  const isApproval = workflowStatus.mode === "approval";
  const isDone = workflowStatus.mode === "done";

  return (
    <>
    <div className="sticky top-12 z-30">
      {/* Level 1 — application header (unchanged branding + Restart Demo) */}
      <div className="border-b border-zinc-200/80 bg-white/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
            <span className="text-sm font-bold text-zinc-900">Agentic Hiring Pipeline</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> AI System Live
            </span>
            <button
              onClick={onReset}
              className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Restart Demo</span>
            </button>
          </div>
        </div>
      </div>
    </div>

      {/* Level 2 — live agent workflow. Only shown once the big in-page
          pipeline card has scrolled out of view (see showStickyChain in
          HiringAutomationPage) so it isn't a redundant duplicate at the top
          of the page. Deliberately `fixed` rather than nested in the sticky
          flow container above: its own height changes as it animates open —
          if it were in-flow, that would shift the document (and therefore
          the pipeline card being observed), which would flip showChain and
          the animation back and forth in a feedback loop. `fixed` removes it
          from flow entirely, so its appearance never moves anything else. */}
      <AnimatePresence>
      {showChain && (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{ position: "fixed", top: 104, left: 0, right: 0, zIndex: 30 }}
        className={`overflow-hidden border-b backdrop-blur-md transition-colors duration-300 ${isApproval ? "bg-amber-50/95 border-amber-200" : "bg-white/95 border-zinc-200/70"}`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="relative flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 border border-blue-200 text-blue-600 shrink-0">
                {!isDone && <span className="absolute inset-0 rounded-md bg-blue-400/30 animate-ping" />}
                <Bot className="w-3 h-3 relative" />
              </span>
              <span className="text-[10px] font-bold text-zinc-900 uppercase tracking-wide">AI Agents</span>
              {!isDone && (
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-600 flex items-center gap-1">
                  <Radio className="w-2 h-2 animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono font-bold text-zinc-500 shrink-0">{doneCount}/{PIPELINE_NODES.length} COMPLETE</span>
          </div>

          {/* Desktop chain — full chips, clickable, horizontally scrollable if needed */}
          <div className="hidden sm:flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1">
            {PIPELINE_NODES.map((node, i) => {
              const status = nodeStatus(i);
              const paused = isApproval && node.key === "review";
              const Icon = node.icon;
              return (
                <Fragment key={node.key}>
                  <button
                    type="button"
                    onClick={() => onJump(node.key)}
                    title={nodeTooltip(node)}
                    className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10.5px] font-bold whitespace-nowrap transition-colors ${
                      paused
                        ? "bg-amber-100 border-amber-300 text-amber-800"
                        : status === "done"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-300"
                        : status === "active"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
                    }`}
                  >
                    {paused ? <Pause className="w-3 h-3" />
                      : status === "done" ? <CheckCircle2 className="w-3 h-3" />
                      : status === "active" ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Icon className="w-3 h-3" />}
                    {node.shortTitle}
                  </button>
                  {i < PIPELINE_NODES.length - 1 && <div className="w-2 h-px bg-zinc-200 shrink-0" />}
                </Fragment>
              );
            })}
          </div>

          {/* Mobile chain — compact dots */}
          <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {PIPELINE_NODES.map((node, i) => {
              const status = nodeStatus(i);
              const paused = isApproval && node.key === "review";
              return (
                <button
                  key={node.key}
                  type="button"
                  onClick={() => onJump(node.key)}
                  title={nodeTooltip(node)}
                  aria-label={node.title}
                  className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
                    paused ? "bg-amber-500" : status === "done" ? "bg-emerald-500" : status === "active" ? "bg-blue-600 animate-pulse" : "bg-zinc-200"
                  }`}
                />
              );
            })}
          </div>

          {/* Overall progress */}
          <div className="h-1 bg-zinc-100 rounded-full overflow-hidden mt-1.5 mb-2">
            <motion.div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full" animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
          </div>

          {/* Current operation */}
          {isApproval ? (
            <button
              type="button"
              onClick={() => onJump("review")}
              className="w-full flex items-center justify-between gap-3 rounded-lg bg-white/80 border border-amber-200 px-3 py-2 text-left hover:bg-white transition-colors"
            >
              <span className="flex items-center gap-2 text-[11px] font-bold text-amber-800">
                <Pause className="w-3.5 h-3.5 shrink-0" /> AI workflow paused — HR approval required · {workflowStatus.detail}
              </span>
              <span className="text-[10px] font-bold text-amber-700 shrink-0 whitespace-nowrap">Review Candidates →</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-[11px]">
              {workflowStatus.mode === "running" && <Loader2 className="w-3 h-3 text-blue-600 animate-spin shrink-0" />}
              {workflowStatus.mode === "done" && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}
              <span className="font-bold text-zinc-900 shrink-0">{workflowStatus.label}</span>
              <span className="text-zinc-300">·</span>
              <span className="text-zinc-500 truncate flex-1">{workflowStatus.detail}</span>
              {workflowStatus.percent !== null && (
                <span className="font-mono font-bold text-blue-600 shrink-0">{workflowStatus.percent}%</span>
              )}
            </div>
          )}
        </div>
      </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   UPLOAD PANEL
   ═══════════════════════════════════════════════════════════ */

function UploadPanel({
  files, stage, error, onAdd, onRemove, onProcess,
}: {
  files: File[]; stage: Stage; error: string | null;
  onAdd: (l: FileList | null) => void; onRemove: (i: number) => void; onProcess: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const locked = stage !== "idle";

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-zinc-900">Bulk PDF Upload</h3>
        </div>
        <span className="text-[10px] font-mono text-zinc-400">Sent to the backend for real PDF parsing & ATS scoring</span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <label
        onDragOver={(e) => { e.preventDefault(); if (!locked) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!locked) onAdd(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 px-6 py-10 rounded-2xl border-2 border-dashed text-center transition-colors ${
          locked
            ? "border-zinc-200 bg-zinc-50 text-zinc-400 cursor-not-allowed"
            : dragOver
            ? "border-blue-400 bg-blue-50/60 text-blue-700 cursor-pointer"
            : "border-zinc-300 bg-zinc-50/60 text-zinc-500 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer"
        }`}
      >
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${locked ? "bg-zinc-100" : "bg-blue-50 border border-blue-200"}`}>
          <Upload className={`w-5 h-5 ${locked ? "text-zinc-400" : "text-blue-600"}`} />
        </div>
        <div className="text-sm font-bold text-zinc-800">Drag & drop resume PDFs here</div>
        <div className="text-xs text-zinc-500">or click to browse · multiple files supported</div>
        <input type="file" accept=".pdf,application/pdf" multiple disabled={locked} className="hidden" onChange={(e) => onAdd(e.target.files)} />
      </label>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-700 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-zinc-400">{(f.size / 1024).toFixed(0)} KB</span>
              {!locked && (
                <button onClick={() => onRemove(i)} className="hover:text-red-600 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span className="text-[11px] font-mono text-zinc-400">
          {files.length === 0 ? "No files added yet" : `${files.length} file(s) queued`}
        </span>
        <button
          onClick={onProcess}
          disabled={files.length === 0 || stage !== "idle"}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {stage === "parsing" ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
          ) : stage !== "idle" ? (
            <><CheckCircle2 className="w-3.5 h-3.5" /> Processed</>
          ) : (
            <><Zap className="w-3.5 h-3.5" /> Process</>
          )}
        </button>
      </div>
    </div>
  );
}

function ParsingTicker({ log }: { log: string }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="rounded-xl bg-blue-50/70 border border-blue-200/90 text-blue-950 font-mono text-[12px] p-4 flex items-center gap-2.5">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
        <AnimatePresence mode="wait">
          <motion.span key={log} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} className="font-semibold">
            {log}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CANDIDATE SPREADSHEET
   ═══════════════════════════════════════════════════════════ */

type SortKey = "name" | "ats" | "experience";

function SortIcon({ active }: { active: boolean }) {
  return <ArrowUpDown className={`w-3 h-3 ${active ? "text-blue-600" : "text-zinc-300"}`} />;
}

function CandidateSpreadsheet({ candidates }: { candidates: Candidate[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("ats");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const rows = candidates.map((c) => ({ ...c, resumeFile: c.filename }));
  const statuses = ["All", ...Array.from(new Set(rows.map((r) => r.status)))];

  const filtered = useMemo(() => rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || r.name.toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q) || r.skills.some((s) => s.toLowerCase().includes(q));
    const matchesStatus = statusFilter === "All" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [rows, search, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "ats") cmp = a.ats - b.ats;
      else cmp = a.experience.localeCompare(b.experience);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const toggleSelectAll = () => setSelected((sel) => (sel.length === paged.length ? [] : paged.map((r) => r.id)));
  const toggleSelect = (id: string) => setSelected((sel) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]));

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" />Candidate Spreadsheet</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Resume Parser + ATS output, ready for human review</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search candidates…"
              className="pl-8 pr-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs focus:outline-none focus:border-blue-400 w-40"
            />
          </div>
          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="pl-8 pr-6 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs appearance-none focus:outline-none focus:border-blue-400"
            >
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-50">
              <TableHead className="px-4 py-2.5 w-8 h-auto">
                <input type="checkbox" checked={paged.length > 0 && selected.length === paged.length} onChange={toggleSelectAll} className="rounded border-zinc-300" />
              </TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold cursor-pointer select-none" onClick={() => toggleSort("name")}>
                <span className="flex items-center gap-1">Candidate Name <SortIcon active={sortKey === "name"} /></span>
              </TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Email</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold cursor-pointer select-none" onClick={() => toggleSort("ats")}>
                <span className="flex items-center gap-1">ATS Score <SortIcon active={sortKey === "ats"} /></span>
              </TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Resume Status</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold cursor-pointer select-none" onClick={() => toggleSort("experience")}>
                <span className="flex items-center gap-1">Experience <SortIcon active={sortKey === "experience"} /></span>
              </TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Skills</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Current Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((r, i) => (
              <TableRow key={r.id} className={`border-zinc-100 hover:bg-blue-50/30 ${i % 2 === 1 ? "bg-zinc-50/40" : ""}`}>
                <TableCell className="px-4 py-3"><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSelect(r.id)} className="rounded border-zinc-300" /></TableCell>
                <TableCell className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${r.avatarBg} ${r.avatarText}`}>{r.name[0]}</div>
                    <div>
                      <div className="font-bold text-zinc-900">{r.name}</div>
                      <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-1"><FileText className="w-2.5 h-2.5" />{r.resumeFile}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-3 font-mono text-zinc-600">{r.email || "—"}</TableCell>
                <TableCell className="px-3 py-3">
                  <span className={`font-mono font-bold px-2 py-0.5 rounded-full border ${r.ats >= 90 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-blue-50 border-blue-200 text-blue-700"}`}>{r.ats}%</span>
                </TableCell>
                <TableCell className="px-3 py-3"><span className="text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Parsed</span></TableCell>
                <TableCell className="px-3 py-3 text-zinc-700">{r.experience}</TableCell>
                <TableCell className="px-3 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {r.skills.map((s) => <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">{s}</span>)}
                  </div>
                </TableCell>
                <TableCell className="px-3 py-3"><StatusPill tone="warning">{r.status}</StatusPill></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="px-5 py-3 flex items-center justify-between border-t border-zinc-100 text-[11px] text-zinc-500">
        <span>{selected.length > 0 ? `${selected.length} selected · ` : ""}Showing {paged.length} of {sorted.length} candidates</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} className="p-1 rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="font-mono">Page {currentPage} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="p-1 rounded border border-zinc-200 disabled:opacity-40 hover:bg-zinc-50"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HUMAN IN THE LOOP + ASSIGNMENT GENERATION
   ═══════════════════════════════════════════════════════════ */

function HumanInLoopPanel({
  requirement, setRequirement, onGenerate, locked, candidateCount,
}: {
  requirement: string; setRequirement: (v: string) => void; onGenerate: () => void; locked: boolean; candidateCount: number;
}) {
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-bold text-zinc-900">Human in the Loop</h3>
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">Review the shortlisted candidates above and define the assignment requirements before the AI drafts and sends tasks.</p>
      <textarea
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        placeholder={REQUIREMENT_PLACEHOLDER}
        rows={8}
        disabled={locked}
        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs font-mono leading-relaxed focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 resize-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <span className="text-[11px] text-zinc-400 font-mono">Applies to {candidateCount} shortlisted candidate{candidateCount === 1 ? "" : "s"}</span>
        <button
          onClick={onGenerate}
          disabled={locked || !requirement.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Generate Assignment
        </button>
      </div>
    </div>
  );
}

function AssignmentTicker({ step }: { step: number }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 flex items-center gap-2">
          {GEN_STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border transition-all ${
                i < step ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : i === step ? "bg-white/10 border-white/30 text-white"
                  : "border-white/10 text-zinc-500"
              }`}>
                {i === step && i < GEN_STEPS.length - 1 && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                {i < step && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                {label}
              </span>
              {i < GEN_STEPS.length - 1 && <span className="text-zinc-700">→</span>}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function AssignmentCard({
  assignment, onBulkSend, locked, sent,
}: { assignment: GeneratedAssignment; onBulkSend: () => void; locked: boolean; sent: boolean }) {
  return (
    <div className="rounded-2xl bg-blue-50/40 border border-blue-200 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-3">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-wide text-blue-600 mb-1 flex items-center gap-1.5"><Sparkles className="w-3 h-3" />AI-Generated Assignment · Short Brief</div>
          <h3 className="text-base font-extrabold text-zinc-900">{assignment.title}</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-zinc-500 font-mono">Duration</div>
          <div className="text-sm font-bold text-blue-700">{assignment.duration}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {assignment.requirements.map((req) => (
          <span key={req} className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-700 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />{req}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-blue-200/60 pt-3 flex-wrap gap-3">
        <div className="text-[11px] text-zinc-600 font-mono flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> Submission: {assignment.submission}</div>
        <button
          onClick={onBulkSend}
          disabled={locked}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        >
          {sent ? <><CheckCircle2 className="w-3.5 h-3.5" /> Sent to Candidates</> : <><Send className="w-3.5 h-3.5" /> Bulk Send Assignment</>}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MCP EMAIL TOOL
   ═══════════════════════════════════════════════════════════ */

function McpSendPanel({ step, candidates }: { step: number; candidates: Candidate[] }) {
  const inFlight = step >= 2 && step < MCP_STEPS.length - 1;
  const allTerminal = candidates.every((c) => c.deliveryStatus === "SENT" || c.deliveryStatus === "FAILED" || c.deliveryStatus === "REPLIED");
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Plug className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold text-zinc-900">Email Delivery</h3>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 flex items-center gap-1">
            <Radio className="w-2.5 h-2.5 animate-pulse" /> {MCP_STEPS[step]}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 ml-auto">Real SMTP send per candidate — status below reflects the actual backend result</span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-24 h-20 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-center gap-1 shrink-0 overflow-hidden">
            {inFlight && !allTerminal && (
              <motion.div
                className="absolute inset-0 bg-amber-400/10"
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <Mail className="w-5 h-5 text-amber-400 relative" />
            <span className="text-[9px] font-mono text-zinc-400 relative">SMTP</span>
          </div>

          <div className="flex-1 grid sm:grid-cols-2 gap-3">
            {candidates.map((c, ci) => {
              const done = c.deliveryStatus === "SENT" || c.deliveryStatus === "REPLIED";
              const failed = c.deliveryStatus === "FAILED";
              const stillGoing = !done && !failed;
              return (
                <div key={c.id} className="relative rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex items-center gap-2.5 overflow-hidden" title={failed ? c.deliveryError || "Delivery failed" : undefined}>
                  {inFlight && stillGoing && [0, 1].map((k) => (
                    <motion.div
                      key={k}
                      className="absolute top-1/2 -translate-y-1/2"
                      initial={{ left: "-10%", opacity: 0 }}
                      animate={{ left: "90%", opacity: [0, 1, 1, 0] }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "linear", delay: k * 0.55 + ci * 0.15 }}
                    >
                      <Mail className="w-3.5 h-3.5 text-amber-500" />
                    </motion.div>
                  ))}
                  <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${c.avatarBg} ${c.avatarText}`}>{c.name[0]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-zinc-900 truncate">{c.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">{c.email || "no email extracted"}</div>
                  </div>
                  {done && <MailCheck className="w-4 h-4 text-emerald-600 shrink-0" />}
                  {failed && <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-4">
          {MCP_STEPS.map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-blue-600" : "bg-zinc-100"}`} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   EVALUATION TABLE
   ═══════════════════════════════════════════════════════════ */

function EvaluationTable({
  candidates, approvals, onSend, onMarkReplied,
}: { candidates: Candidate[]; approvals: Record<string, boolean>; onSend: (ids: string[]) => void; onMarkReplied: (candidateId: string, deliveryId: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const pendingIds = candidates.filter((c) => !approvals[c.id]).map((c) => c.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selected.includes(id));

  const toggleSelectAll = () => setSelected(allPendingSelected ? [] : pendingIds);
  const toggleSelect = (id: string) => setSelected((sel) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]));

  const handleSendClick = () => {
    if (selected.length === 0) return;
    onSend(selected);
    setSelected([]);
  };

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Award className="w-4 h-4 text-blue-600" />Candidate Evaluation</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Match score is real (requirement-to-resume fit) · this demo doesn&apos;t collect real assignment submissions · select candidates and click Send to confirm them — interview scheduling unlocks once every candidate has been sent</p>
        </div>
        <button
          onClick={handleSendClick}
          disabled={selected.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
        >
          <Send className="w-3.5 h-3.5" /> Send{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      </div>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-50">
              <TableHead className="px-4 py-2.5 h-auto">
                <input
                  type="checkbox"
                  checked={allPendingSelected}
                  disabled={pendingIds.length === 0}
                  onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 rounded border-zinc-300 accent-blue-600 disabled:opacity-40"
                  aria-label="Select all pending candidates"
                />
              </TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Candidate</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">ATS</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Match Score</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Email Status</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Reply</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Recommendation</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">HR Approval</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c, i) => {
              const approved = !!approvals[c.id];
              const recTone: StatusTone =
                c.recommendation === "Strong Hire" ? "success"
                  : c.recommendation === "Not a Fit" ? "danger"
                  : c.recommendation === "Consider" ? "warning"
                  : "info";
              return (
                <TableRow key={c.id} className={`border-zinc-100 hover:bg-blue-50/30 ${i % 2 === 1 ? "bg-zinc-50/40" : ""}`}>
                  <TableCell className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(c.id)}
                      disabled={approved}
                      onChange={() => toggleSelect(c.id)}
                      className="w-3.5 h-3.5 rounded border-zinc-300 accent-blue-600 disabled:opacity-40"
                      aria-label={`Select ${c.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${c.avatarBg} ${c.avatarText}`}>{c.name[0]}</div>
                      <span className="font-bold text-zinc-900">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-3 font-mono font-bold text-zinc-700">{c.ats}%</TableCell>
                  <TableCell className="px-3 py-3">
                    <span className="font-mono font-bold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700">{c.matchScore ?? "—"}%</span>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <span title={c.deliveryError || undefined}>
                      <StatusPill tone={emailTone(c.deliveryStatus)}>
                        <MailCheck className="w-3 h-3" />{emailLabel(c.deliveryStatus)}
                      </StatusPill>
                    </span>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    {c.deliveryStatus === "SENT" && c.deliveryId ? (
                      <button
                        onClick={() => onMarkReplied(c.id, c.deliveryId as string)}
                        className="text-[10px] font-mono font-bold px-2 py-1 rounded-full border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50/50 transition-colors inline-flex items-center gap-1"
                        title="Record that you've actually seen a reply from this candidate — there's no automatic inbox integration, so this is a manual confirmation."
                      >
                        <Plug className="w-3 h-3" /> Mark Replied
                      </button>
                    ) : (
                      <StatusPill tone={c.deliveryStatus === "REPLIED" ? "success" : "neutral"}>
                        <Plug className="w-3 h-3" />{c.deliveryStatus === "REPLIED" ? "Replied" : "—"}
                      </StatusPill>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <StatusPill tone={recTone}><Star className="w-3 h-3" />{c.recommendation || "Pending"}</StatusPill>
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <StatusPill tone={approved ? "success" : "neutral"}>
                      {approved ? <><CheckCircle2 className="w-3 h-3" /> Approved</> : "Pending"}
                    </StatusPill>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INTERVIEW SCHEDULING
   ═══════════════════════════════════════════════════════════ */

function InterviewSchedulingPanel({
  candidates, locked, onOpenModal, onContinue,
}: {
  candidates: Candidate[];
  locked: boolean;
  onOpenModal: (candidateId: string, type: InterviewType) => void;
  onContinue: () => void;
}) {
  const scheduledCount = candidates.filter((c) => c.telephonicInterview || c.aiInterview).length;
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-blue-600" />Interview Scheduling</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">Book a telephonic screening and/or AI avatar interview slot for each approved candidate before onboarding.</p>
        </div>
        <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 shrink-0 whitespace-nowrap">
          {scheduledCount}/{candidates.length} candidates scheduled
        </span>
      </div>

      <div className="divide-y divide-zinc-100">
        {candidates.map((c) => (
          <div key={c.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2.5 sm:w-52 shrink-0">
              <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${c.avatarBg} ${c.avatarText}`}>{c.name[0]}</div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900 truncate">{c.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono truncate">{c.email || "no email extracted"}</div>
              </div>
            </div>

            <div className="flex-1 grid sm:grid-cols-2 gap-2.5">
              <InterviewSlotTile
                icon={<Phone className="w-3.5 h-3.5" />}
                label="Telephonic Interview"
                slot={c.telephonicInterview}
                disabled={locked}
                onClick={() => onOpenModal(c.id, "telephonic")}
              />
              <InterviewSlotTile
                icon={<Video className="w-3.5 h-3.5" />}
                label="AI Interview"
                slot={c.aiInterview}
                disabled={locked}
                onClick={() => onOpenModal(c.id, "ai")}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="p-5 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-zinc-50/60">
        <p className="text-[11px] text-zinc-500 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Phone className="w-3 h-3 text-blue-500 shrink-0" /> Telephonic runs on the{" "}
          <Link href="/telephonic-agent" className="font-bold text-blue-600 hover:underline">Telephonic Agent</Link>
          <span className="text-zinc-300 px-1">·</span>
          <Video className="w-3 h-3 text-blue-500 shrink-0" /> AI Interview runs on the{" "}
          <Link href="/screening-agent" className="font-bold text-blue-600 hover:underline">Screening Agent</Link>
        </p>
        <button
          onClick={onContinue}
          disabled={locked}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shrink-0"
        >
          {locked ? <><CheckCircle2 className="w-3.5 h-3.5" /> Continued to Onboarding</> : <>Continue to Onboarding <ArrowUpRight className="w-3.5 h-3.5" /></>}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ENTERPRISE ORCHESTRATION LAYER — CANDIDATE SCORES TABLE
   ═══════════════════════════════════════════════════════════
   Compact Excel-like table: Candidate Name / Telephonic Screening Score /
   AI Interview Agent Score. Rows appear as soon as a candidate has at least
   one interview scheduled, and each score cell fills in independently as
   that interview type gets scheduled. Scores come from
   POST /api/v1/orchestrator/candidates/schedule — real when a completed
   CallRecord (Telephonic Agent) or Screening episode already exists for
   that candidate, otherwise a stable placeholder (dotted "~" badge marks
   which is which, so a placeholder is never presented as a real result). */
function ScoreCell({ score, isReal }: { score: number | null; isReal: boolean }) {
  if (score === null) return <span className="text-zinc-300 font-mono">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-bold px-2 py-0.5 rounded-full border ${
        isReal ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-zinc-100 border-zinc-200 text-zinc-600"
      }`}
      title={isReal ? "From a completed interview" : "Placeholder — interview hasn't run yet"}
    >
      {!isReal && <span className="text-zinc-400">~</span>}
      {score}
    </span>
  );
}

function CandidateScoresTable({ candidates }: { candidates: Candidate[] }) {
  const scheduled = candidates.filter((c) => c.telephonicInterview || c.aiInterview);
  if (scheduled.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-zinc-100">
        <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-blue-600" />Enterprise Orchestration — Interview Scores
        </h3>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Updates as each interview is scheduled · <span className="text-zinc-400">~</span> marks a placeholder score standing in until that candidate&apos;s interview actually runs
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-50">
              <TableHead className="px-4 py-2.5 h-auto font-bold">Candidate Name</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">Telephonic Screening Score</TableHead>
              <TableHead className="px-3 py-2.5 h-auto font-bold">AI Interview Agent Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scheduled.map((c, i) => (
              <TableRow key={c.id} className={`border-zinc-100 hover:bg-blue-50/30 ${i % 2 === 1 ? "bg-zinc-50/40" : ""}`}>
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${c.avatarBg} ${c.avatarText}`}>{c.name[0]}</div>
                    <span className="font-bold text-zinc-900">{c.name}</span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-3">
                  <ScoreCell score={c.telephonicScore} isReal={c.telephonicScoreIsReal} />
                </TableCell>
                <TableCell className="px-3 py-3">
                  <ScoreCell score={c.aiInterviewScore} isReal={c.aiInterviewScoreIsReal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function InterviewSlotTile({
  icon, label, slot, disabled, onClick,
}: { icon: ReactNode; label: string; slot: InterviewSlot | null; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-xl border p-3 transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
        slot ? "bg-emerald-50/60 border-emerald-200 hover:border-emerald-300" : "bg-zinc-50 border-zinc-200 hover:border-blue-300 hover:bg-blue-50/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-[11px] font-bold ${slot ? "text-emerald-700" : "text-zinc-700"}`}>
          {icon} {label}
        </span>
        {slot ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
      </div>
      {slot ? (
        <div className="mt-1.5 text-[11px] text-emerald-800 font-mono flex items-center gap-1.5">
          <CalendarClock className="w-3 h-3 shrink-0" /> {slot.date} · {slot.time}
        </div>
      ) : (
        <div className="mt-1.5 text-[10.5px] text-zinc-400">Click to book a slot</div>
      )}
    </button>
  );
}

/* ── Calendar/time-slot picker modal — real Date arithmetic, and a real
   free/busy check against Google Calendar (via fetchDayAvailability) for
   whichever calendar this deployment's Google Workspace connector is
   configured against. Shared by both interview types via the `type` prop. ── */
function InterviewCalendarModal({
  candidate, type, onClose, onConfirm,
}: { candidate: Candidate; type: InterviewType; onClose: () => void; onConfirm: (slot: InterviewSlot) => void }) {
  const dates = useMemo(() => nextWeekdays(10), []);
  const [selectedDate, setSelectedDate] = useState<Date>(dates[0]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyInterval[]>([]);
  const [availabilityUnknown, setAvailabilityUnknown] = useState(false);
  // `busy` above is only valid for this date once the fetch for it lands —
  // derived (not a separate setState in the effect below) so a re-render
  // never needs a synchronous setState call at the top of the effect body.
  const [availabilityLoadedFor, setAvailabilityLoadedFor] = useState<string | null>(null);
  const loadingAvailability = availabilityLoadedFor !== dateKey(selectedDate);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const dayStart = new Date(selectedDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate); dayEnd.setHours(23, 59, 59, 999);
    fetchDayAvailability(dayStart, dayEnd).then((result) => {
      if (cancelled) return;
      if (result === null) {
        // Real check couldn't be completed (not configured for this
        // deployment, or failed after retries) — disclosed to the user
        // rather than silently presenting every slot as confirmed-free.
        setAvailabilityUnknown(true);
        setBusy([]);
      } else {
        setAvailabilityUnknown(false);
        setBusy(result);
      }
      setAvailabilityLoadedFor(dateKey(selectedDate));
    });
    return () => { cancelled = true; };
  }, [selectedDate]);

  const isTelephonic = type === "telephonic";
  const label = isTelephonic ? "Telephonic Interview" : "AI Interview";
  const Icon = isTelephonic ? Phone : Video;
  const existing = isTelephonic ? candidate.telephonicInterview : candidate.aiInterview;

  const handleConfirm = () => {
    if (!selectedTime) return;
    onConfirm({ date: formatDateLabel(selectedDate), time: selectedTime });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-zinc-900/40 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-zinc-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-2 bg-zinc-50/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-zinc-900 truncate">Schedule {label}</h3>
              <p className="text-[11px] text-zinc-500 truncate">with {candidate.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {existing && (
            <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> Already booked for {existing.date} · {existing.time} — confirming below will reschedule it.
            </div>
          )}

          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Select a date</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {dates.map((d) => {
                const active = dateKey(d) === dateKey(selectedDate);
                return (
                  <button
                    key={dateKey(d)}
                    onClick={() => { setSelectedDate(d); setSelectedTime(null); }}
                    className={`shrink-0 w-14 py-2 rounded-xl border text-center transition-all ${
                      active ? "bg-blue-600 border-blue-600 text-white shadow-sm" : "bg-zinc-50 border-zinc-200 text-zinc-700 hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                  >
                    <div className={`text-[9px] font-mono uppercase ${active ? "text-blue-100" : "text-zinc-400"}`}>{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                    <div className="text-sm font-bold">{d.getDate()}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Select a time · {formatDateLabel(selectedDate)}
              {loadingAvailability && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
            </div>
            {availabilityUnknown && !loadingAvailability && (
              <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-start gap-1.5 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                Live calendar availability couldn&apos;t be checked (Google Calendar isn&apos;t connected, or the check failed after retrying) — every slot is shown as bookable, but this isn&apos;t conflict-checked against a real calendar.
              </div>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {TIME_SLOTS.map((t) => {
                const taken = !loadingAvailability && slotOverlapsBusy(parseSlotDateTime(selectedDate, t), busy);
                const active = selectedTime === t;
                return (
                  <button
                    key={t}
                    disabled={taken || loadingAvailability}
                    onClick={() => setSelectedTime(t)}
                    className={`text-[11px] font-mono font-bold py-2 rounded-lg border transition-all ${
                      taken ? "bg-zinc-50 border-zinc-100 text-zinc-300 cursor-not-allowed line-through"
                        : active ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                        : "bg-white border-zinc-200 text-zinc-700 hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 flex items-center justify-between gap-3 bg-zinc-50/60">
          <span className="text-[11px] text-zinc-500 font-mono truncate">
            {selectedTime ? `${formatDateLabel(selectedDate)} · ${selectedTime}` : "No time selected yet"}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition-colors">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={!selectedTime}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Slot
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ONBOARDING AGENT
   ═══════════════════════════════════════════════════════════ */

function OnboardingPanel({
  progress, running, candidateCount, onRun, onContinue, showContinue,
}: {
  progress: number; running: boolean; candidateCount: number;
  onRun: () => void; onContinue: () => void; showContinue: boolean;
}) {
  const done = progress >= ONBOARDING_STEPS.length;
  const notStarted = progress === 0 && !running;
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-zinc-900">Onboarding Agent</h3>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">ON YOUR COMMAND</span>
        </div>
        {notStarted ? (
          <button
            onClick={onRun}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Play className="w-3 h-3 fill-white" /> Run Onboarding Agent
          </button>
        ) : (
          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
            done ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-blue-50 border-blue-200 text-blue-700"
          }`}>
            {done ? <><CheckCircle2 className="w-3 h-3" /> Completed</> : <><Loader2 className="w-3 h-3 animate-spin" /> Provisioning…</>}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        {notStarted
          ? `${candidateCount} approved hire${candidateCount === 1 ? "" : "s"} ready — run the agent to provision accounts & equipment.`
          : `Handing off ${candidateCount} approved hire${candidateCount === 1 ? "" : "s"} to the existing onboarding system.`}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {ONBOARDING_STEPS.map((s, i) => {
          const stepDone = i < progress;
          const active = i === progress && running;
          const Icon = s.icon;
          return (
            <div key={s.label} className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all ${
              stepDone ? "bg-emerald-50/70 border-emerald-200" : active ? "bg-blue-50 border-blue-200" : "bg-white border-zinc-200"
            }`}>
              <Icon className={`w-4 h-4 ${stepDone ? "text-emerald-600" : active ? "text-blue-600" : "text-zinc-400"}`} />
              <span className="text-[9.5px] sm:text-[10px] font-mono font-bold text-zinc-700 leading-tight">{s.label}</span>
              {stepDone ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : active ? <Loader2 className="w-3 h-3 text-blue-600 animate-spin" /> : null}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mt-4 pt-4 border-t border-zinc-100 gap-3">
              <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> {candidateCount} employee{candidateCount === 1 ? "" : "s"} created — synced to the Onboarding workspace</span>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Link
                  href="/onboarding"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-zinc-200 text-zinc-700 text-xs font-bold hover:border-blue-300 hover:text-blue-700 transition-colors"
                >
                  Open Onboarding Agent <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
                {showContinue && (
                  <button
                    onClick={onContinue}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    Continue to Knowledge Transfer <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   KNOWLEDGE TRANSFER AGENT
   ═══════════════════════════════════════════════════════════ */

function KnowledgeTransferPanel({
  progress, running, candidateCount, onRun, onFinish, showFinish,
}: {
  progress: number; running: boolean; candidateCount: number;
  onRun: () => void; onFinish: () => void; showFinish: boolean;
}) {
  const done = progress >= KT_STEPS.length;
  const notStarted = progress === 0 && !running;
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-bold text-zinc-900">Knowledge Transfer Agent</h3>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">ON YOUR COMMAND</span>
        </div>
        {notStarted ? (
          <button
            onClick={onRun}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Play className="w-3 h-3 fill-white" /> Run Knowledge Transfer Agent
          </button>
        ) : (
          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
            done ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-blue-50 border-blue-200 text-blue-700"
          }`}>
            {done ? <><CheckCircle2 className="w-3 h-3" /> Completed</> : <><Loader2 className="w-3 h-3 animate-spin" /> Syncing…</>}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-500 mb-4">
        {notStarted
          ? `${candidateCount} new hire${candidateCount === 1 ? "" : "s"} ready — run the agent to assign docs, videos & training.`
          : `Assigning onboarding docs, videos & training to ${candidateCount} new hire${candidateCount === 1 ? "" : "s"}.`}
      </p>

      <div className="flex items-center gap-2 sm:gap-4 mb-4">
        <div className="w-16 h-14 sm:w-20 sm:h-16 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col items-center justify-center gap-1 shrink-0">
          <ScrollText className="w-4 h-4 text-amber-400" />
          <span className="text-[8px] sm:text-[9px] font-mono text-zinc-400 text-center px-1">Knowledge Base</span>
        </div>
        <div className="flex-1 min-w-[36px] relative h-8">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-zinc-300" />
          {running && [0, 1, 2].map((k) => (
            <motion.div
              key={k}
              className="absolute top-1/2 -translate-y-1/2"
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: "96%", opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, delay: k * 0.4, ease: "linear" }}
            >
              <FileText className="w-3.5 h-3.5 text-blue-500" />
            </motion.div>
          ))}
        </div>
        <div className="w-16 h-14 sm:w-20 sm:h-16 rounded-xl bg-blue-50 border border-blue-200 flex flex-col items-center justify-center gap-1 shrink-0">
          <Users className="w-4 h-4 text-blue-600" />
          <span className="text-[8px] sm:text-[9px] font-mono text-blue-600 text-center px-1">New Hires</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {KT_STEPS.map((s, i) => {
          const stepDone = i < progress;
          const active = i === progress && running;
          const Icon = s.icon;
          return (
            <div key={s.label} className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all ${
              stepDone ? "bg-emerald-50/70 border-emerald-200" : active ? "bg-blue-50 border-blue-200" : "bg-white border-zinc-200"
            }`}>
              <Icon className={`w-4 h-4 ${stepDone ? "text-emerald-600" : active ? "text-blue-600" : "text-zinc-400"}`} />
              <span className="text-[9.5px] sm:text-[10px] font-mono font-bold text-zinc-700 leading-tight">{s.label}</span>
              {stepDone ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : active ? <Loader2 className="w-3 h-3 text-blue-600 animate-spin" /> : null}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mt-4 pt-4 border-t border-zinc-100 gap-3">
              <span className="text-[11px] text-emerald-700 font-bold flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Docs, videos & policies assigned as new employees</span>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Link
                  href="/knowledge"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-zinc-200 text-zinc-700 text-xs font-bold hover:border-blue-300 hover:text-blue-700 transition-colors"
                >
                  Open Knowledge Transfer <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
                {showFinish && (
                  <button
                    onClick={onFinish}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <PartyPopper className="w-3.5 h-3.5 text-amber-400" /> Finish Workflow
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   COMPLETION BANNER
   ═══════════════════════════════════════════════════════════ */

function CompletionBanner({ onReset, candidates }: { onReset: () => void; candidates: Candidate[] }) {
  const n = candidates.length;
  const scheduledCount = candidates.filter((c) => c.telephonicInterview || c.aiInterview).length;
  const stats = [
    { label: "Candidates Onboarded", value: `${n}/${n}` },
    { label: "Assignments Sent", value: `${n}/${n}` },
    { label: "Interviews Scheduled", value: `${scheduledCount}/${n}` },
    { label: "Knowledge Transfer", value: "100%" },
    { label: "Human Approvals", value: `${n}/${n}` },
  ];
  const names = candidates.map((c) => c.name);
  const namesText = names.length <= 1
    ? names[0] || "The candidate"
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center relative overflow-hidden">
      <div className="absolute -top-16 -right-16 w-56 h-56 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 mx-auto mb-4">
          <PartyPopper className="w-7 h-7" />
        </div>
        <h3 className="text-xl font-extrabold text-white mb-1.5">Hiring Workflow Complete</h3>
        <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6">All {PIPELINE_NODES.length} agents executed end-to-end on real parsed resumes, with a human approval gate before onboarding — {namesText} {n === 1 ? "is" : "are"} fully onboarded.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 max-w-2xl mx-auto mb-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-lg font-extrabold text-white font-mono">{s.value}</div>
              <div className="text-[10px] text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/onboarding" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/20 transition-colors">
            <UserPlus className="w-3.5 h-3.5" /> Open Onboarding Agent
          </Link>
          <Link href="/knowledge" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/20 transition-colors">
            <BookOpen className="w-3.5 h-3.5" /> Open Knowledge Transfer
          </Link>
          <button onClick={onReset} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-zinc-900 text-xs font-bold hover:bg-zinc-100 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Restart Demo
          </button>
        </div>
      </div>
    </motion.div>
  );
}
