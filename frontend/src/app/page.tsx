"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { askAssistant } from "@/components/ai-assistant/AIAssistantWidget";
import { reopenCookieConsent } from "@/components/CookieConsent";
import { BrandMark } from "@/components/BrandMark";
import { VoiceCommandButton } from "@/components/VoiceCommandButton";
import {
  Database, UserPlus, Brain, Bot, BarChart3, Shield,
  ArrowRight, Menu, X, Zap, Users, Globe, CheckCircle2,
  Sparkles, Search, FileText, Cpu, Play, ArrowUpRight, Radio, Pause, SkipForward,
  MessageSquare, Layers, Server, Cloud, Plug, Share2, CheckSquare,
  Wallet, CalendarCheck, FileCheck,
  FolderOpen,
  Phone, Video, Minus, Plus, ShieldCheck, BadgeCheck, Lock, Calculator,
  Scale, UserCheck, ClipboardX, ShieldAlert, MousePointer2,
  Award, Mail, ClipboardList, Target, FileSearch, ChevronDown,
} from "lucide-react";

/* ── Inline GitHub Icon ── */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

/* ── Inline LinkedIn Icon ── */
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.7a1.63 1.63 0 1 0 1.63 1.63A1.63 1.63 0 0 0 7.86 6.7z" />
    </svg>
  );
}

/* ── Doodle Underline ── */
function DoodleUnderline({ className = "w-48 text-blue-600" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 11C40 4 90 13 197 6M15 14C65 8 135 12 185 10"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        className="doodle-path"
      />
    </svg>
  );
}

/* ── Floating Hero Doodles: payroll / attendance / policy ──
   Clickable shortcuts into the AI Assistant widget — each one opens it with a
   relevant question already asked, via the same window event the widget listens
   for (see askAssistant in AIAssistantWidget), so no prop-drilling is needed. */
function FloatingHeroDoodles() {
  const doodles = [
    {
      label: "Payroll",
      icon: <Wallet className="w-3.5 h-3.5" />,
      className: "top-2 right-6 sm:right-10",
      delay: "0s",
      cursorDelay: 0,
      query: "Tell me about our payroll process and salary cycles.",
    },
    {
      label: "Attendance",
      icon: <CalendarCheck className="w-3.5 h-3.5" />,
      className: "-bottom-16 left-4 sm:left-10",
      delay: "1.2s",
      cursorDelay: 0.5,
      query: "How does attendance and leave tracking work?",
    },
    {
      label: "Policy",
      icon: <FileCheck className="w-3.5 h-3.5" />,
      className: "-bottom-10 right-16 sm:right-28",
      delay: "2.1s",
      cursorDelay: 1.1,
      query: "What HR policies should I know about?",
    },
  ];

  return (
    <div className="hidden md:block absolute inset-0 pointer-events-none">
      {doodles.map((d) => (
        <button
          key={d.label}
          type="button"
          onClick={() => askAssistant(d.query)}
          title={`Ask the AI assistant about ${d.label.toLowerCase()}`}
          className={`absolute pointer-events-auto animate-doodle-float hover:[animation-play-state:paused] group ${d.className}`}
          style={{ animationDelay: d.delay }}
        >
          <div className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-sm border border-zinc-200 shadow-sm text-zinc-500 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:border-blue-300 group-hover:bg-white group-hover:text-blue-700 cursor-pointer">
            <span className="text-blue-500 group-hover:text-blue-600">{d.icon}</span>
            <span className="text-[11px] font-mono font-semibold tracking-wide">{d.label}</span>
            {/* tiny idle cursor — sells "this is live and clickable" */}
            <motion.span
              className="absolute -bottom-1 -right-1 text-blue-400/80 pointer-events-none"
              animate={{ x: [0, 3, 1, -2, 0], y: [0, 2, -1, 2, 0] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: d.cursorDelay }}
            >
              <MousePointer2 className="w-2.5 h-2.5 fill-white" />
            </motion.span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [archModalOpen, setArchModalOpen] = useState(false);

  const navLinks = [
    { label: "Platform", href: "#platform" },
    { label: "Capabilities", href: "#capabilities" },
    { label: "Architecture", href: "#architecture" },
    { label: "Pricing", href: "#pricing" },
  ];

  // The mobile menu panel occupies real layout height while open, so it pushes every
  // section below it further down the page. A plain <a href="#..."> jump fires the
  // instant the link is tapped — before the menu has finished collapsing — so the
  // browser scrolls to where the target *was* under the still-open menu, then the
  // collapse shifts everything back up and the scroll effectively cancels itself
  // (the URL hash updates but the viewport never actually moves). Closing the menu
  // first and scrolling only once it's collapsed avoids that race.
  const handleMobileNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setMobileMenu(false);
    const id = href.slice(1);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 overflow-x-hidden bg-white-grid relative selection:bg-blue-500/20">
      {/* ─── NAVIGATION ─── */}
      <nav className="fixed top-0 left-0 right-0 z-40">
        <div className="absolute inset-0 bg-white/80 backdrop-blur-md border-b border-zinc-200/80" />
        <div className="relative max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <BrandMark variant="dark" />
            <span className="font-bold text-[16px] tracking-tight text-zinc-900">
              Fin AI
            </span>
          </Link>

          <div className="hidden lg:flex items-center gap-1">
            {navLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="px-3.5 py-1.5 text-[13px] font-medium text-zinc-600 hover:text-zinc-900 transition-colors rounded-md hover:bg-zinc-100/80"
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-2.5">
            <a
              href="https://www.linkedin.com/in/ayush-singh-aiml/"
              target="_blank"
              rel="noreferrer"
              title="Ayush Singh - LinkedIn"
              className="p-2 text-zinc-600 hover:text-blue-600 transition-colors rounded-lg hover:bg-zinc-100"
            >
              <LinkedinIcon className="w-4 h-4" />
            </a>

            <Link
              href="/rag"
              className="text-[13px] font-mono text-blue-600 hover:text-blue-700 transition-colors px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 font-semibold"
            >
              Open /rag Workspace
            </Link>
            <button
              onClick={() => setArchModalOpen(true)}
              className="text-[13px] font-medium bg-zinc-900 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              View Architecture
            </button>
          </div>

          <button onClick={() => setMobileMenu(!mobileMenu)} className="lg:hidden p-2 text-zinc-700">
            {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <AnimatePresence>
          {mobileMenu && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden relative bg-white border-b border-zinc-200 px-6 pb-5 overflow-hidden"
            >
              {navLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={(e) => handleMobileNavClick(e, l.href)}
                  className="block py-2 text-sm text-zinc-700 hover:text-blue-600 font-medium"
                >
                  {l.label}
                </a>
              ))}
              <div className="flex items-center gap-3 pt-2 pb-3 border-t border-zinc-100 mt-2">
                <a
                  href="https://www.linkedin.com/in/ayush-singh-aiml/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-blue-600 font-medium"
                >
                  <LinkedinIcon className="w-4 h-4" /> LinkedIn
                </a>
              </div>
              <Link href="/rag" className="block text-sm font-bold bg-blue-600 text-white px-4 py-2.5 rounded-lg text-center">
                Open /rag Workspace
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ─── HERO SECTION ─── */}
      <section id="platform" className="relative pt-20 pb-10 md:pt-28 md:pb-16 overflow-hidden z-10">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-[1fr_440px] gap-12 items-start">
            {/* Left Column */}
            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-200 bg-zinc-50 mb-6">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[12px] font-medium text-zinc-600">The #1 Enterprise Agentic AI Engine</span>
              </div>

              <h1 className="text-[clamp(2.1rem,4.6vw,3.6rem)] font-extrabold leading-[1.08] tracking-tight text-zinc-900 mb-6">
                Fin AI — Enterprise AI{" "}
                <span className="relative inline-block text-blue-600">
                  Agent Orchestration
                  <DoodleUnderline className="absolute left-0 -bottom-2.5 w-full text-blue-600" />
                </span>
                <br />
                Platform
              </h1>

              <p className="text-[16px] text-zinc-600 leading-relaxed mb-10 max-w-lg">
                Automate complex enterprise policy extraction, orchestrate autonomous multi-agent reasoning, index document vectors with hybrid RAG, and execute deterministic actions.
              </p>

              <div className="flex items-center gap-4">
                <Link
                  href="/command-center"
                  className="group relative inline-flex items-center gap-3 px-7 py-4 rounded-2xl text-[15px] font-semibold bg-zinc-950 text-white hover:bg-zinc-900 shadow-2xl shadow-zinc-950/30 transition-all border border-zinc-800 hover:border-zinc-700 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-transparent to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <Bot className="w-4 h-4 text-emerald-400 relative z-10" />
                  <span className="relative z-10">Launch Command Center</span>
                  <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:translate-x-1 transition-transform relative z-10" />
                </Link>
              </div>

              <FloatingHeroDoodles />
            </div>

            {/* Right Column: Hero Agent Matrix */}
            <div className="hidden lg:block relative">
              <HeroAgentMatrixDynamic />
            </div>
          </div>
        </div>
      </section>

      {/* ─── CAPABILITIES BENTO GRID ─── */}
      <section id="capabilities" className="py-24 relative z-10 border-t border-zinc-200/80 bg-zinc-50/50">
        <div className="max-w-6xl mx-auto px-6">
          <SectionHeader
            badge="Live Product Tour"
            title="Every Card Below Is a Real, Working Agent"
            subtitle="Not slides. Click in — RAG retrieval, fraud checks, voice screening, and interviews, running for real."
          />

          {/* ── Working today — tested end-to-end against the real backend.
              Paired by actual shape instead of arbitrary spans: RAG, Screening,
              and the Hiring Orchestration Layer all have a wide content+sidebar
              layout, so each gets the full row; Fraud Detection and Telephonic
              are both simple single-column cards, so they sit side by side at
              equal width — every row has cards that genuinely match. ── */}
          <div className="grid md:grid-cols-2 gap-8 mt-16 items-stretch">
            <div className="md:col-span-2">
              <RAGCardInteractive />
            </div>
            <FraudDetectionCard />
            <TelephonicAgentCard />
            <div className="md:col-span-2">
              <ScreeningAgentCard />
            </div>
            <div className="md:col-span-2">
              <AutomationCardInteractive />
            </div>
          </div>

          {/* Divider: everything below is an illustrative preview, not wired live */}
          <div className="flex items-center justify-center gap-4 pt-10 pb-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-zinc-200" />
            <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-zinc-200">
              <FileSearch className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-500">More Capabilities</span>
              <span className="hidden sm:inline text-[10px] text-zinc-400 font-medium normal-case">· illustrative previews</span>
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-zinc-200" />
          </div>

          {/* ── Illustrative previews — three equal cards up top, then
              Integrations spans full width since its content (a wrapped row
              of brand chips) reads better wide than squeezed into a third
              column. ── */}
          <div className="grid md:grid-cols-3 gap-8 items-start">
            <OnboardingCardInteractive />
            <KnowledgeCardInteractive />
            <SecurityCardWhite />

            <div className="md:col-span-3">
              <IntegrationsCardInteractive />
            </div>
          </div>
        </div>
      </section>

      {/* ─── AGENT ORCHESTRATOR ─── */}
      <section id="architecture" className="py-24 border-t border-zinc-200/80 bg-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-6">
          <SectionHeader
            badge="Agent Orchestrator"
            title="Every Agent, Mapped to What It Actually Does"
            subtitle="From foundational retrieval engines to outcome-facing automation — the full roster powering Fin AI."
          />
        </div>
        <div className="max-w-[1360px] mx-auto px-6 mt-16">
          <AgentConstellation />
        </div>
      </section>

      {/* ─── OUR MISSION ─── */}
      <section className="py-24 border-t border-zinc-200/80 bg-white">
        <div className="max-w-5xl mx-auto px-6">
          <SectionHeader
            badge="Our Mission"
            title="Built to be fair, human-led, and secure by default"
            subtitle="The principles behind every automated decision this platform makes."
          />
          <div className="mt-14 grid sm:grid-cols-2 gap-5">
            {MISSION_PILLARS.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.title} className="cpu-burn-card h-full">
                  <div className="card-icon-badge mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-[16px] font-bold text-zinc-900 mb-2">{m.title}</h3>
                  <p className="text-[13.5px] text-zinc-600 leading-relaxed">{m.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── ARCHITECTURE MODAL WITH BURNING LINES ─── */}
      <BurningArchitectureModal isOpen={archModalOpen} onClose={() => setArchModalOpen(false)} />

      {/* ─── THE MATH: COST COMPARISON ─── */}
      <section id="pricing" className="py-28 border-t border-zinc-200/80 bg-gradient-to-b from-white to-blue-50/40 relative">
        <div className="max-w-4xl mx-auto px-6 relative z-10">
          <SectionHeader
            badge="The Math"
            title="What 100 first-round screenings actually cost"
            subtitle="Compare the full manual process: sourcing, screening, coordination, and interviews against Fin AI."
          />

          <MathComparisonCard />

          <div className="mt-20">
            <CostCalculator />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-10 text-[12px] text-zinc-500">
            <span className="flex items-center gap-1.5"><BadgeCheck className="w-3.5 h-3.5 text-emerald-600" /> GST invoice on every purchase</span>
            <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-emerald-600" /> No setup fees</span>
            <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Cancel anytime</span>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SITE FOOTER — company-wide sitemap footer. Column items are static
   labels, not routes: most of the pages they name (Blogs, Careers,
   Glossary, Terms, Privacy, …) don't exist in this POC, so they're
   deliberately non-interactive rather than linking to nowhere.
   ═══════════════════════════════════════════════════════════════ */

const FOOTER_COLUMNS = [
  { title: "Features", items: ["RAG Workspace", "Rule Extraction", "Knowledge Graph", "Fraud Detection"] },
  { title: "For Organization", items: ["AI Interviews", "Telephonic Agent", "Hiring Automation", "Employee Onboarding"] },
  { title: "Company", items: ["About Us", "Blogs", "Pricing", "Careers", "Glossary", "Contact Us", "Schedule Demo"] },
  { title: "Industry Usecase", items: ["Technical Hiring", "Campus Hiring", "GCC Hiring", "Staff Hiring"] },
  { title: "Policies", items: ["Terms and Conditions", "Privacy Policy"] },
] as const;

function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-zinc-950 text-zinc-400">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid lg:grid-cols-[280px_1fr] gap-12">
          <div>
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <BrandMark variant="light" />
              <span className="font-bold text-[16px] tracking-tight text-white">
                Fin AI
              </span>
            </Link>
            <p className="text-[13px] text-zinc-400 leading-relaxed max-w-xs mb-5">
              We empower organizations with an AI-driven platform for grounded policy intelligence and scalable, agentic hiring workflows.
            </p>
            <div className="flex items-center gap-2">
              <a
                href="https://www.linkedin.com/in/ayush-singh-aiml/"
                target="_blank"
                rel="noreferrer"
                title="Ayush Singh - LinkedIn"
                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <LinkedinIcon className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="text-[11px] font-mono font-bold text-zinc-500 uppercase tracking-wider mb-3.5">{col.title}</div>
                <ul className="space-y-2.5">
                  {col.items.map((item) => (
                    <li key={item} className="text-[13px] text-zinc-400">{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-14 pt-6 border-t border-white/10">
          <p className="text-[12px] text-zinc-500 font-mono">
            Fin AI · Autonomous Enterprise AI Platform · © {new Date().getFullYear()}
          </p>
          <button
            onClick={() => reopenCookieConsent()}
            className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
          >
            Cookie Preferences
          </button>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   AGENT ORCHESTRATOR — every agent on the platform, fanned across
   concentric arcs from the layer it operates at (foundation engines →
   orchestration kernel → reasoning agents → candidate-facing agents →
   outcome agents), each tagged with what it actually does.
   ═══════════════════════════════════════════════════════════════ */

const AGENT_LAYERS = [
  {
    key: "foundation",
    label: "Foundation Engines",
    radius: 230,
    gradient: "from-zinc-400 to-zinc-600",
    labelClass: "bg-zinc-100 border-zinc-300 text-zinc-700",
    agents: [
      { name: "RAG Engine", tag: "Dual-Tier Retrieval", icon: Database },
      { name: "Vector Index", tag: "Pinecone + SQL", icon: Layers },
      { name: "Validator", tag: "85%+ Confidence Gate", icon: CheckCircle2 },
    ],
  },
  {
    key: "orchestration",
    label: "Orchestration Kernel",
    radius: 310,
    gradient: "from-sky-400 to-blue-600",
    labelClass: "bg-blue-50 border-blue-200 text-blue-700",
    agents: [
      { name: "Orchestrator", tag: "Intent Parsing", icon: Bot },
      { name: "MCP Router", tag: "Tool Selection", icon: Plug },
      { name: "Approval Gate", tag: "Human-in-the-Loop", icon: ShieldCheck },
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence Agents",
    radius: 390,
    gradient: "from-violet-400 to-purple-600",
    labelClass: "bg-violet-50 border-violet-200 text-violet-700",
    agents: [
      { name: "Matching", tag: "Requirement Fit", icon: Target },
      { name: "Evaluation", tag: "Candidate Scoring", icon: Award },
      { name: "Fraud Detect", tag: "Pre/Post-Join Scan", icon: ShieldAlert },
      { name: "PIP Agent", tag: "Performance Plans", icon: ClipboardX },
    ],
  },
  {
    key: "engagement",
    label: "Engagement Agents",
    radius: 470,
    gradient: "from-amber-400 to-orange-500",
    labelClass: "bg-amber-50 border-amber-200 text-amber-700",
    agents: [
      { name: "Resume Parse", tag: "Structured Extraction", icon: FileText },
      { name: "ATS Extract", tag: "Email + ATS Sync", icon: Mail },
      { name: "Telephonic", tag: "Voice Screening", icon: Phone },
      { name: "Screening", tag: "3D Avatar Interviews", icon: Video },
      { name: "Assignment", tag: "AI-Drafted Tasks", icon: ClipboardList },
    ],
  },
  {
    key: "outcome",
    label: "Outcome Agents",
    radius: 550,
    gradient: "from-emerald-400 to-emerald-600",
    labelClass: "bg-emerald-50 border-emerald-200 text-emerald-700",
    agents: [
      { name: "Onboarding", tag: "One-Click Provisioning", icon: UserPlus },
      { name: "Knowledge", tag: "Transfer Graph", icon: Brain },
      { name: "Insights", tag: "Executive Digests", icon: BarChart3 },
      { name: "Security", tag: "RBAC + Audit Logs", icon: Shield },
    ],
  },
];

const ARC_CX = 650;
const ARC_CY = 590;
const ARC_VB_W = 1300;
const ARC_VB_H = 620;

function arcXY(radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: ARC_CX + radius * Math.cos(rad), y: ARC_CY - radius * Math.sin(rad) };
}

function arcPercent(radius: number, angleDeg: number) {
  const { x, y } = arcXY(radius, angleDeg);
  // Fixed precision matters here: Math.cos/Math.sin aren't guaranteed bit-identical
  // across JS engines (server V8 vs browser V8), so an unrounded float can render a
  // different string during SSR than on client hydration and trigger a mismatch.
  return { left: `${((x / ARC_VB_W) * 100).toFixed(3)}%`, top: `${((y / ARC_VB_H) * 100).toFixed(3)}%` };
}

// Converts a target pixel clearance/drift into degrees FOR A GIVEN RADIUS, so the
// same physical distance holds regardless of how tight or wide a given arc is.
function pxToDeg(px: number, radius: number): number {
  return (px / radius) * (180 / Math.PI);
}

// Distributes badges outward from the label at 90° on both sides, with the
// angular gap computed FROM the radius so physical (pixel) clearance stays
// constant however tight or wide a given arc is — a fixed-degree gap would
// be roomy on the outer arcs but collide on the tight inner ones. Gaps are
// sized generously so the whole roster fans out wide, rainbow-style, rather
// than clustering tight around the top of each arc.
function layerAngles(count: number, radius: number): number[] {
  if (count <= 1) return [55];
  const labelGapDeg = pxToDeg(178, radius); // clearance between the layer label and its nearest badge
  const badgeGapDeg = pxToDeg(148, radius); // clearance between two adjacent badges

  const leftCount = Math.ceil(count / 2);
  const rightCount = count - leftCount;
  const angles: number[] = [];
  for (let i = 0; i < leftCount; i++) {
    angles.push(90 + labelGapDeg + i * badgeGapDeg);
  }
  for (let i = 0; i < rightCount; i++) {
    angles.push(90 - labelGapDeg - i * badgeGapDeg);
  }
  return angles;
}

function AgentConstellation() {
  return (
    <div>
      {/* Desktop: radial arc fan */}
      <div className="hidden lg:block relative mx-auto" style={{ maxWidth: ARC_VB_W, aspectRatio: `${ARC_VB_W} / ${ARC_VB_H}` }}>
        <svg viewBox={`0 0 ${ARC_VB_W} ${ARC_VB_H}`} className="absolute inset-0 w-full h-full" fill="none">
          {AGENT_LAYERS.map((layer) => {
            const p1 = arcXY(layer.radius, 173);
            const p2 = arcXY(layer.radius, 7);
            const fmt = (n: number) => n.toFixed(2);
            const d = `M ${fmt(p1.x)} ${fmt(p1.y)} A ${layer.radius} ${layer.radius} 0 0 1 ${fmt(p2.x)} ${fmt(p2.y)}`;
            return (
              <path
                key={layer.key}
                d={d}
                stroke="#a1a1aa"
                strokeWidth="1.5"
                strokeDasharray="2 6"
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {AGENT_LAYERS.map((layer) => {
          const labelPos = arcPercent(layer.radius, 90);
          const angles = layerAngles(layer.agents.length, layer.radius);
          return (
            <div key={layer.key}>
              <div
                className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap px-3 py-1.5 rounded-full border text-[12px] xl:text-[13px] font-mono font-bold uppercase tracking-wide shadow-sm z-10 ${layer.labelClass}`}
                style={labelPos}
              >
                {layer.label}
              </div>
              {layer.agents.map((agent, i) => {
                const pos = arcPercent(layer.radius, angles[i]);
                const Icon = agent.icon;
                return (
                  <div
                    key={agent.name}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group cursor-default"
                    style={pos}
                  >
                    <div className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full bg-white border border-zinc-200 shadow-sm group-hover:shadow-md group-hover:border-blue-300 group-hover:-translate-y-0.5 transition-all whitespace-nowrap">
                      <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${layer.gradient} ring-2 ring-white shadow flex items-center justify-center shrink-0`}>
                        <Icon className="w-2.5 h-2.5 text-white" />
                      </span>
                      <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-zinc-700">{agent.name}</span>
                    </div>
                    <div className="w-px h-2 bg-zinc-300 group-hover:bg-blue-300" />
                    <span className="text-[8.5px] text-zinc-400 font-medium whitespace-nowrap group-hover:text-blue-500 transition-colors">{agent.tag}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Mobile / tablet: stacked layer list */}
      <div className="lg:hidden space-y-7">
        {AGENT_LAYERS.map((layer) => (
          <div key={layer.key}>
            <div className="text-[13.5px] font-extrabold text-zinc-800 mb-2.5">{layer.label}</div>
            <div className="flex flex-wrap gap-2">
              {layer.agents.map((agent) => {
                const Icon = agent.icon;
                return (
                  <span key={agent.name} className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-white border border-zinc-200 shadow-sm">
                    <span className={`w-6 h-6 rounded-full bg-gradient-to-br ${layer.gradient} ring-2 ring-white shadow flex items-center justify-center shrink-0`}>
                      <Icon className="w-3 h-3 text-white" />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wide text-zinc-700">{agent.name}</span>
                      <span className="text-[9px] text-zinc-400 font-medium">{agent.tag}</span>
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MISSION_PILLARS = [
  {
    title: "Avoiding Bias",
    icon: Scale,
    body: "AI should evaluate ability, not identity. Our layered approach combines AI, psychology, and statistical validation to continuously detect and reduce bias — helping make hiring fairer, more consistent, and job-relevant.",
  },
  {
    title: "Human-in-the-Loop",
    icon: UserCheck,
    body: "AI recommends. Humans decide. Our technology provides evidence-based insights while keeping final hiring decisions with people — ensuring accountability, context, and human judgment remain at the center.",
  },
  {
    title: "Adaptive, Inclusive & Explainable",
    icon: Layers,
    body: "Our AI adapts to roles, skills, and candidates rather than using a one-size-fits-all approach. Every assessment is designed to be relevant, consistent, and explainable.",
  },
  {
    title: "Privacy & Security",
    icon: Lock,
    body: "Candidate data is protected by design. We apply strict controls across collection, processing, storage, and access, while minimizing PII exposure and supporting applicable privacy and security requirements.",
  },
];

const KERNEL_SUB_AGENTS = [
  { label: "Reasoning Agent", icon: <Bot className="w-3 h-3" />, color: "bg-blue-500" },
  { label: "Retrieval Agent", icon: <Search className="w-3 h-3" />, color: "bg-indigo-500" },
  { label: "Tool Agent", icon: <Zap className="w-3 h-3" />, color: "bg-amber-500" },
  { label: "Validator Agent", icon: <CheckCircle2 className="w-3 h-3" />, color: "bg-emerald-500" },
];

const KERNEL_TRACE_LINES = [
  "Reasoning Agent → parsing intent, dispatching retrieval request ↓",
  "Retrieval Agent → querying Pinecone HNSW index, top-k=5 ↓",
  "Tool Agent → invoking MCP connector, awaiting response ↓",
  "Validator Agent → scoring extraction confidence ≥ 85% ↓",
];

function BurningArchitectureModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [selectedNode, setSelectedNode] = useState(0);
  const [kernelLine, setKernelLine] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const iv = setInterval(() => {
      setKernelLine((prev) => (prev + 1) % KERNEL_TRACE_LINES.length);
    }, 2000);
    return () => clearInterval(iv);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const nodes = [
    { title: "Document Ingestion", sub: "PDF / OCR / Audio Transcribe", latency: "14ms", details: "Parses PDF bounding boxes & transcribes audio files with Faster-Whisper.", icon: <FileText className="w-4 h-4" />, agentIndex: 1 },
    { title: "Vector Embedding Engine", sub: "BGE / Pinecone HNSW Vector Store", latency: "22ms", details: "Generates high-dimensional vector embeddings and indexes into Pinecone.", icon: <Database className="w-4 h-4" />, agentIndex: 1 },
    { title: "Multi-Agent Reasoning", sub: "Gemini 2.5 / Dual-Tier RAG", latency: "180ms", details: "Dual-tier fallback reasoning engine (Rule-based -> Raw Chunk RAG -> Missing).", icon: <Bot className="w-4 h-4" />, agentIndex: 0 },
    { title: "Tool & MCP Orchestration", sub: "Slack, GitHub, Jira, Teams APIs", latency: "45ms", details: "Orchestrates Model Context Protocol server tools and webhook connectors.", icon: <Plug className="w-4 h-4" />, agentIndex: 2 },
    { title: "Human Gate Approval", sub: "RBAC Zero-Trust Audit Log", latency: "Immediate", details: "Enforces Level 4 human-in-the-loop authorization gates for system safety.", icon: <Shield className="w-4 h-4" />, agentIndex: 3 },
    { title: "Deterministic Output", sub: "JSON Payload & Voice Synthesis", latency: "8ms", details: "Dispatches signed structured payloads and triggers gTTS Voice Output.", icon: <Zap className="w-4 h-4" />, agentIndex: 0 },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-zinc-900/40 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.96, y: 15 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 15 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-zinc-200/90 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans relative"
          >
            {/* Modal Header */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-zinc-50/90 border-b border-zinc-200/80 flex items-start sm:items-center justify-between gap-2 z-20">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-2xs shrink-0">
                  <Bot className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-zinc-900 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>System Execution Architecture</span>
                    <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white text-blue-700 border border-blue-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      {KERNEL_SUB_AGENTS.length} AGENTS LIVE
                    </span>
                  </h3>
                  <p className="hidden sm:block text-xs text-zinc-500 mt-0.5">Multi-agent kernel streaming reasoning, retrieval, and tool-execution traces to each node below</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6 bg-zinc-50/40 relative scrollbar-thin">
              {/* AGENT STATUS BAR — unified kernel control strip */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-2xl bg-zinc-900 border border-zinc-800 p-4 sm:p-5 shadow-lg shadow-zinc-900/10 overflow-hidden"
              >
                <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
                <div className="relative flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center text-blue-400">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-white text-sm font-bold flex items-center gap-2">
                        Multi-Agent Kernel
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                      </div>
                      <div className="text-[10px] text-zinc-400 font-mono">Orchestrating {nodes.length} pipeline nodes</div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-wrap items-center gap-1.5 md:justify-end">
                    {KERNEL_SUB_AGENTS.map((agent, i) => (
                      <div
                        key={agent.label}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono font-bold transition-all ${
                          kernelLine === i ? "bg-white/10 border-white/30 text-white" : "border-white/10 text-zinc-400"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${agent.color} ${kernelLine === i ? "animate-ping" : "opacity-40"}`} />
                        {agent.icon}
                        <span>{agent.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative mt-4 pt-3 border-t border-white/10 flex items-center gap-1.5 text-[11px] font-mono text-blue-300">
                  <Radio className="w-3.5 h-3.5 animate-pulse shrink-0" />
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={kernelLine}
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -3 }}
                      transition={{ duration: 0.2 }}
                    >
                      {KERNEL_TRACE_LINES[kernelLine]}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </motion.div>

              {/* SECTION DIVIDER */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                  {nodes.length} Pipeline Nodes
                </span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              {/* NODE CARDS GRID */}
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5 relative z-20">
                {nodes.map((node, index) => {
                  const isSelected = selectedNode === index;
                  const agent = KERNEL_SUB_AGENTS[node.agentIndex];
                  return (
                    <motion.div
                      key={node.title}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => setSelectedNode(index)}
                      className={`relative p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer overflow-hidden group ${
                        isSelected
                          ? "bg-blue-50/40 border-blue-500 ring-2 ring-blue-500/20 shadow-md"
                          : "bg-white border-zinc-200/90 hover:border-blue-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                            isSelected ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600"
                          }`}>
                            {node.icon}
                          </div>
                          <span className="text-xs font-bold text-zinc-900 leading-tight">{node.title}</span>
                        </div>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                          isSelected ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-zinc-100 text-zinc-600 border-zinc-200"
                        }`}>
                          {node.latency}
                        </span>
                      </div>

                      <p className="text-[12px] text-zinc-500 font-mono mb-3 leading-relaxed">{node.sub}</p>

                      <div className={`p-3 rounded-xl border text-[11px] font-sans leading-relaxed transition-all mb-3 ${
                        isSelected
                          ? "bg-white border-blue-200 text-zinc-800 shadow-2xs font-medium"
                          : "bg-zinc-50/70 border-zinc-200/70 text-zinc-600"
                      }`}>
                        {node.details}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${agent.color}`} />
                        <span className="text-[10px] font-mono font-bold text-zinc-500">{agent.label}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 sm:px-6 py-3 sm:py-4 bg-zinc-50/90 border-t border-zinc-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 z-20">
              <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 text-center sm:text-left">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{KERNEL_SUB_AGENTS.length} agents orchestrating {nodes.length} execution nodes</span>
              </div>
              <Link
                href="/command-center"
                onClick={onClose}
                className="w-full sm:w-auto text-center px-5 py-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs transition-all shadow-md shadow-zinc-950/20 border border-zinc-800"
              >
                Launch Command Center →
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SectionHeader({ badge, title, subtitle }: { badge: string; title: string; subtitle?: string }) {
  return (
    <div className="text-center max-w-xl mx-auto">
      <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
        {badge}
      </span>
      <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
        {title}
      </h2>
      {subtitle && <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

/* ── Shared capability-card status badges ──
   "Working" = actually tested end-to-end against the real backend this
   session (RAG, Fraud Detection, Telephonic Agent, Screening Agent).
   "Preview" = the rest — illustrative UI, not wired to a live backend. */
function WorkingBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
    </span>
  );
}

function PreviewBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-500 shrink-0">
      <FileSearch className="w-2.5 h-2.5" /> PREVIEW
    </span>
  );
}

/* ── 1. AGENT TRACE — plain-language walkthrough of what the agent is doing,
   with the underlying technical detail tucked behind an optional disclosure
   rather than shown by default. ── */
function HeroAgentMatrixDynamic() {
  const [activeStep, setActiveStep] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);

  const steps = [
    {
      num: 1,
      name: "Request Received",
      sub: "Understanding your request",
      icon: <Users className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Incoming request parsed and queued for handling.",
    },
    {
      num: 2,
      name: "Understanding Intent",
      sub: "Identifying what you need and determining the best way to help",
      icon: <Bot className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Intent classified; retrieval plan selected.",
    },
    {
      num: 3,
      name: "Finding Relevant Information",
      sub: "Searching your organization's connected knowledge",
      icon: <Database className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Vector search returned 4 passages above the confidence threshold.",
    },
    {
      num: 4,
      name: "Checking Context",
      sub: "Reviewing relevant company information and previous context",
      icon: <Brain className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Cross-referenced source document, page 2, for citation accuracy.",
    },
    {
      num: 5,
      name: "Taking Action",
      sub: "Using connected tools to complete the task",
      icon: <Globe className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Dispatched to connected tools (e.g. GitHub, Jira) as needed.",
    },
    {
      num: 6,
      name: "Final Review",
      sub: "Checking the result before responding",
      icon: <Zap className="w-3.5 h-3.5 text-blue-600" />,
      detail: "Response validated and signed off before returning to the user.",
    },
  ];

  useEffect(() => {
    if (isPaused) return;
    const iv = setInterval(() => {
      setActiveStep((prev) => {
        if (prev === steps.length) {
          setJustCompleted(true);
          window.setTimeout(() => setJustCompleted(false), 1500);
        }
        return (prev % steps.length) + 1;
      });
    }, 2200);
    return () => clearInterval(iv);
  }, [isPaused, steps.length]);

  const currentStep = steps[activeStep - 1];

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-xl relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3 mb-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
          <span className="font-bold text-zinc-900">Agent Trace</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1 rounded hover:bg-zinc-100 text-zinc-600 transition-colors"
            title={isPaused ? "Play trace" : "Pause trace"}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-blue-600 fill-blue-600" /> : <Pause className="w-3.5 h-3.5 text-zinc-600" />}
          </button>
          <button
            onClick={() => setActiveStep((prev) => (prev % steps.length) + 1)}
            className="p-1 rounded hover:bg-zinc-100 text-zinc-600 transition-colors"
            title="Next Step"
          >
            <SkipForward className="w-3.5 h-3.5 text-zinc-600" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {steps.map((s) => {
          const isDone = s.num < activeStep;
          const isCurrent = s.num === activeStep;

          return (
            <div key={s.num}>
              <div
                onClick={() => {
                  setIsPaused(true);
                  setActiveStep(s.num);
                }}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isCurrent
                    ? "bg-blue-50/80 border-blue-300 shadow-sm"
                    : isDone
                    ? "bg-white border-zinc-200/70 opacity-90"
                    : "bg-zinc-50/50 border-zinc-200/50 opacity-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-lg text-[10px] font-bold flex items-center justify-center shrink-0 ${isCurrent ? "bg-blue-600 text-white" : isDone ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-600"}`}>
                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                  </div>
                  <div>
                    <div className={`text-xs font-bold ${isCurrent ? "text-blue-900" : "text-zinc-800"}`}>
                      {s.name}
                    </div>
                    <div className="text-[10px] text-zinc-500">{s.sub}</div>
                  </div>
                </div>

                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isCurrent ? "bg-blue-600 text-white border-blue-600 animate-pulse" : isDone ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-100 text-zinc-500 border-zinc-200"}`}>
                  {isCurrent ? "In progress" : isDone ? "Completed" : "Waiting"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Plain-language result, with the technical trace tucked behind an optional disclosure */}
      <div className="mt-4 rounded-xl bg-blue-50/70 border border-blue-200/90 text-blue-950 text-[11px] shadow-xs overflow-hidden">
        <AnimatePresence mode="wait">
          {justCompleted ? (
            <motion.div
              key="completed"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              className="flex items-center gap-2 p-3.5 font-semibold text-blue-950"
            >
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              Task completed — your request was processed successfully.
            </motion.div>
          ) : (
            <motion.div
              key={currentStep.num}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              className="p-3.5 font-semibold leading-relaxed"
            >
              {currentStep.sub}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setShowTechnical((v) => !v)}
          className="w-full flex items-center justify-between px-3.5 py-1.5 border-t border-blue-200/70 text-[10px] font-medium text-blue-700 hover:bg-blue-100/50 transition-colors"
        >
          Technical details
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTechnical ? "rotate-180" : ""}`} />
        </button>
        <AnimatePresence initial={false}>
          {showTechnical && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-3.5 pb-3 pt-1 font-mono text-[10px] text-blue-800/80 border-t border-blue-200/50">
                {currentStep.detail}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RAGCardInteractive() {
  const sampleQueries = [
    { query: "Expense Policy Limits", match: 98.4, page: 2 },
    { query: "Termination Notice", match: 94.2, page: 5 },
    { query: "NDA & IP Ownership", match: 99.1, page: 1 },
  ];
  const [selectedIdx, setSelectedIdx] = useState(0);

  return (
    <div className="cpu-burn-card h-full flex flex-col md:flex-row gap-7">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-5">
          <div className="card-icon-badge">
            <Database className="w-5 h-5" />
          </div>
          <WorkingBadge />
        </div>
        <h3 className="text-[16px] font-bold text-zinc-900 mb-2">Advanced Enterprise RAG</h3>
        <p className="text-[13px] text-zinc-600 leading-relaxed mb-5">
          Index millions of PDFs, emails, SharePoint files, and policies with semantic search, hybrid reranking, and citation tracing.
        </p>

        <div className="space-y-2 mb-5">
          <div className="text-[11px] font-mono text-zinc-500">Test Vector Queries:</div>
          <div className="flex flex-wrap gap-1.5">
            {sampleQueries.map((q, i) => (
              <button
                key={q.query}
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedIdx(i);
                }}
                className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all ${
                  selectedIdx === i
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm font-bold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <Search className="w-3 h-3 shrink-0" /> {q.query}
              </button>
            ))}
          </div>
        </div>

        <Link
          href="/rag"
          className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-blue-600 hover:text-blue-700"
        >
          Open RAG Workspace <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="w-full md:w-56 shrink-0 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-3">Result preview</div>
        <div className="space-y-3">
          <div>
            <div className="text-[10px] text-zinc-500">Matched page</div>
            <div className="text-[13px] font-bold text-zinc-900">Page {sampleQueries[selectedIdx].page}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500">Match confidence</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${sampleQueries[selectedIdx].match}%` }} />
              </div>
              <span className="text-[11px] font-bold text-zinc-900 shrink-0">{sampleQueries[selectedIdx].match}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingCardInteractive() {
  const steps = ["Outlook Account", "Teams Channel", "GitHub Access", "Jira License", "Software Provision"];
  const [active] = useState(2);

  return (
    <div className="cpu-burn-card h-full">
      <div className="flex items-center justify-between mb-5">
        <div className="card-icon-badge">
          <UserPlus className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-1.5">
          <PreviewBadge />
          <Link
            href="/onboarding"
            className="text-[10px] font-mono font-bold bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-all flex items-center gap-1"
          >
            <Play className="w-3 h-3 fill-white" />
            <span>Run Agent</span>
          </Link>
        </div>
      </div>

      <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">One-click Employee Onboarding</h3>
      <p className="text-[12px] text-zinc-600 leading-relaxed mb-5">
        Automatically provision accounts, access permissions, and software in seconds.
      </p>

      <div className="space-y-2">
        {steps.map((s, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <div key={s} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200/80">
              <span className={`text-[11.5px] ${done ? "text-zinc-700 font-medium" : current ? "text-blue-700 font-bold" : "text-zinc-400"}`}>
                {s}
              </span>
              <span className={`text-[10px] font-mono ${done ? "text-emerald-600 font-bold" : current ? "text-blue-600 font-bold animate-pulse" : "text-zinc-400"}`}>
                {done ? "✓ Done" : current ? "Processing..." : "Pending"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeCardInteractive() {
  const nodes = [
    { label: "Senior Staff", desc: "Transcripts & Meeting Records" },
    { label: "Docs", desc: "PDF & Policy Index" },
    { label: "AI Agent", desc: "Active Knowledge Synthesizer" },
    { label: "Graph", desc: "HNSW Semantic Knowledge Mesh" },
    { label: "Hire", desc: "Instant Access for New Employees" },
  ];
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % nodes.length);
    }, 2200);
    return () => clearInterval(iv);
  }, [nodes.length]);

  const activeNode = nodes[activeIdx];

  return (
    <div className="cpu-burn-card h-full">
      <div className="flex items-center justify-between mb-5">
        <div className="card-icon-badge">
          <Brain className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-1.5">
          <PreviewBadge />
          <Link
            href="/knowledge"
            className="text-[10px] font-mono font-bold bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-all flex items-center gap-1"
          >
            <ArrowUpRight className="w-3 h-3" />
            <span>Try Engine</span>
          </Link>
        </div>
      </div>
      <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">Knowledge Transfer Engine</h3>
      <p className="text-[12px] text-zinc-600 leading-relaxed mb-4">
        Capture senior employee knowledge, meeting notes, and codebases into an active graph.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {nodes.map((n, idx) => (
          <button
            key={n.label}
            onClick={() => setActiveIdx(idx)}
            className={`text-[10.5px] px-2.5 py-1 rounded-md border transition-all ${
              activeIdx === idx
                ? "bg-blue-600 text-white border-blue-600 font-bold shadow-xs"
                : "bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200"
            }`}
          >
            {n.label}
          </button>
        ))}
      </div>

      <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-[11.5px] text-blue-900">
        <span className="font-bold">{activeNode.label}:</span> {activeNode.desc}
      </div>
    </div>
  );
}

function AutomationCardInteractive() {
  const [activeTab, setActiveTab] = useState(0);
  const stages = [
    { title: "Live Agent Workflow", detail: "Multi-agent kernel orchestrates the end-to-end hiring pipeline autonomously." },
    { title: "Resume Intelligence", detail: "Parses bulk resumes, extracting ATS scores, skills, and contact signals." },
    { title: "Candidate Processing", detail: "Matches requirements, generates assignments, and evaluates submissions." },
    { title: "Human Review & Approval", detail: "HR & hiring managers confirm every candidate before scheduling opens up." },
    { title: "Hiring Automation", detail: "Interview scheduling, onboarding, and knowledge transfer — each one runs on your command." },
  ];

  useEffect(() => {
    const iv = setInterval(() => {
      setActiveTab((prev) => (prev + 1) % stages.length);
    }, 2400);
    return () => clearInterval(iv);
  }, [stages.length]);

  return (
    <div className="cpu-burn-card h-full relative overflow-hidden">
      {/* Subtle corner wash — a restrained accent instead of decorative doodles */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-bl from-amber-100/50 to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row gap-7 relative z-10">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="card-icon-badge amber">
              <Bot className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <WorkingBadge />
              <Link
                href="/hiring-automation"
                className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold bg-zinc-900 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition-all shadow-sm"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                <span>Test Power</span>
              </Link>
            </div>
          </div>
          <h3 className="text-[16px] font-bold text-zinc-900 mb-2">Enterprise Orchestration Layer</h3>
          <p className="text-[13px] text-zinc-600 leading-relaxed mb-5">
            One agent runs the full hiring pipeline — reasoning, tool calls, and human approval — end to end.
          </p>

          <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl text-xs text-zinc-800">
            <div className="font-bold text-amber-800 mb-1 flex items-center justify-between font-mono">
              <span>{stages[activeTab].title}</span>
              <span className="text-[10px] text-amber-700/80 font-normal">STEP {activeTab + 1}/{stages.length}</span>
            </div>
            <div className="text-[11px] text-zinc-600">{stages[activeTab].detail}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5 md:w-48 shrink-0">
          {stages.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setActiveTab(i)}
              className={`p-2.5 rounded-lg border text-left text-[11px] font-medium transition-all ${
                activeTab === i
                  ? "bg-amber-500 text-zinc-950 font-bold border-amber-500 shadow-xs"
                  : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-amber-50 hover:border-amber-200"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Fraud Detection — a live agent, continuously scanning the pre/post-join lifecycle ── */
function FraudDetectionCard() {
  const preJoin = ["Resume authenticity check", "Duplicate identity scan"];
  const postJoin = ["Credential re-verification", "Expense anomaly detection"];
  const allChecks = [...preJoin, ...postJoin];

  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setActiveIdx((p) => (p + 1) % allChecks.length), 2200);
    return () => clearInterval(iv);
  }, [allChecks.length]);
  const activeLabel = allChecks[activeIdx];

  return (
    <div className="cpu-burn-card h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="card-icon-badge">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <WorkingBadge />
      </div>

      <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">Fraud Detection</h3>
      <p className="text-[13px] text-zinc-600 leading-relaxed mb-5">
        Screens every candidate and employee before and after they join — catching duplicate identities and fabricated credentials before they get costly.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
          <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Before joining</div>
          {preJoin.map((f) => {
            const active = f === activeLabel;
            return (
              <div key={f} className={`flex items-center gap-1.5 text-[11.5px] py-0.5 transition-colors ${active ? "text-blue-700 font-semibold" : "text-zinc-700"}`}>
                <CheckCircle2 className={`w-3 h-3 shrink-0 ${active ? "text-blue-600" : "text-emerald-600"}`} />{f}
              </div>
            );
          })}
        </div>
        <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl">
          <div className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1.5">After joining</div>
          {postJoin.map((f) => {
            const active = f === activeLabel;
            return (
              <div key={f} className={`flex items-center gap-1.5 text-[11.5px] py-0.5 transition-colors ${active ? "text-blue-900 font-bold" : "text-blue-800"}`}>
                <CheckCircle2 className={`w-3 h-3 shrink-0 ${active ? "text-blue-700" : "text-blue-600"}`} />{f}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto pt-5">
        <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blue-50/70 border border-blue-200">
          <div className="w-8 h-8 rounded-lg bg-white border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
            <Brain className="w-4 h-4" />
          </div>
          <p className="text-[12px] text-zinc-700 leading-snug">
            <span className="font-bold text-zinc-900">One shared fraud memory</span> — no duplicate checks, no blind spots.
          </p>
        </div>

        <Link
          href="/fraud-detection"
          className="mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm"
        >
          Open Fraud Detection <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

/* ── Telephonic Agent — pay-per-connect voice screening ── */
function TelephonicAgentCard() {
  const features = [
    "Up to 500 calls/day",
    "Auto hand-off to interviews",
    "WhatsApp verified numbers",
  ];

  return (
    <div className="cpu-burn-card h-full flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="card-icon-badge">
            <Phone className="w-5 h-5" />
          </div>
          <WorkingBadge />
        </div>
        <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">Telephonic Agent</h3>
        <p className="text-[13px] text-zinc-500 mb-5">AI voice screening · pay only for connects</p>

        <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-xl mb-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[22px] font-extrabold text-zinc-900 leading-none">8–10<span className="text-[11px] font-medium text-zinc-500 ml-1">min</span></div>
              <div className="text-[10px] text-zinc-500 mt-1.5">Call duration</div>
            </div>
            <div>
              <div className="text-[22px] font-extrabold text-zinc-900 leading-none">10+</div>
              <div className="text-[10px] text-zinc-500 mt-1.5">Languages</div>
            </div>
          </div>
        </div>

        <div className="space-y-2 mb-6">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-1.5 text-[12px] text-zinc-700 leading-snug">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              {f}
            </div>
          ))}
        </div>

        <Link
          href="/telephonic-agent"
          className="mt-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Phone className="w-3.5 h-3.5" /> Call Now
        </Link>
    </div>
  );
}

/* ── Screening Agent — 3D avatar interviews, tiered per-interview pricing ── */
function ScreeningAgentCard() {
  const tiers = [
    { name: "AI Standard Interview", detail: "15–20 min · adaptive avatar · resume aware" },
    { name: "AI Deep Interview", detail: "25–30 min · probing follow-ups" },
    { name: "Structured Interview", detail: "You write the questions · AI conducts" },
  ];
  const features = [
    { label: "BrewShield proctoring", icon: <ShieldCheck className="w-3 h-3 text-blue-600" /> },
    { label: "PDF report per candidate", icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" /> },
    { label: "JD + resume aware", icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" /> },
  ];

  return (
    <div className="cpu-burn-card h-full">
        <div className="flex flex-col md:flex-row gap-7">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="card-icon-badge">
                <Video className="w-5 h-5" />
              </div>
              <WorkingBadge />
            </div>
            <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">Screening Agent</h3>
            <p className="text-[13px] text-zinc-500 mb-5">3D avatar interviews · pay per interview</p>

            <div className="flex flex-wrap gap-2">
              {features.map((f) => (
                <span key={f.label} className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-zinc-50 text-zinc-700 border border-zinc-200 flex items-center gap-1.5">
                  {f.icon}
                  {f.label}
                </span>
              ))}
            </div>

            <Link
              href="/screening-agent"
              className="mt-auto pt-6 md:pt-0 md:mt-6 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Video className="w-3.5 h-3.5" /> Try Screening Agent
            </Link>
          </div>

          <div className="w-full md:w-64 shrink-0 space-y-2.5">
            {tiers.map((t) => (
              <div key={t.name} className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-xl">
                <span className="text-[12px] font-bold text-zinc-900 leading-tight">{t.name}</span>
                <div className="text-[10px] text-zinc-500 leading-tight mt-1.5">{t.detail}</div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}

/* ── Security folder taxonomy — mirrors what a real enterprise security/compliance
   surface tracks. Each "folder" drills down into the concrete data points it covers. ── */
const SECURITY_CATEGORY_LABELS = [
  "Role Based Access Control (RBAC)",
  "Audit Logs",
  "Activity Monitoring",
  "Backup & Disaster Recovery",
  "Secure File Uploads",
];

function SecurityCardWhite() {
  return (
    <div className="cpu-burn-card h-full">
      <div className="flex items-center justify-between mb-5">
        <div className="card-icon-badge">
          <Shield className="w-5 h-5" />
        </div>
        <div className="flex items-center gap-1.5">
          <PreviewBadge />
          <Link
            href="/security"
            className="text-[10px] font-mono font-bold bg-blue-600 text-white px-2.5 py-1 rounded-lg hover:bg-blue-700 transition-all flex items-center gap-1"
          >
            <FolderOpen className="w-3 h-3" />
            <span>View</span>
          </Link>
        </div>
      </div>
      <h3 className="text-[16px] font-bold text-zinc-900 mb-4">Enterprise Ready Security</h3>
      <div className="divide-y divide-zinc-100">
        {SECURITY_CATEGORY_LABELS.map((item) => (
          <div key={item} className="flex items-center gap-2 text-[12.5px] text-zinc-700 py-2 first:pt-0 last:pb-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 3. NATIVE INTEGRATIONS CARD WITH BRAND ICONS ── */
function IntegrationsCardInteractive() {
  const integrations = [
    { name: "Teams", icon: <MessageSquare className="w-3.5 h-3.5 text-indigo-600" /> },
    { name: "Slack", icon: <Users className="w-3.5 h-3.5 text-purple-600" /> },
    { name: "Jira", icon: <CheckSquare className="w-3.5 h-3.5 text-blue-600" /> },
    { name: "GitHub", icon: <GithubIcon className="w-3.5 h-3.5 text-zinc-800" /> },
    { name: "Salesforce", icon: <Cloud className="w-3.5 h-3.5 text-sky-500" /> },
    { name: "SAP", icon: <Server className="w-3.5 h-3.5 text-blue-800" /> },
    { name: "SharePoint", icon: <Share2 className="w-3.5 h-3.5 text-teal-600" /> },
    { name: "MCP", icon: <Plug className="w-3.5 h-3.5 text-amber-600" /> },
  ];

  return (
    <div className="cpu-burn-card h-full flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="card-icon-badge">
            <Globe className="w-5 h-5" />
          </div>
          <PreviewBadge />
        </div>
        <h3 className="text-[16px] font-bold text-zinc-900 mb-1.5">18+ Native Integrations</h3>
        <p className="text-[12px] text-zinc-600 leading-relaxed mb-5">
          Teams, Slack, Jira, GitHub, Salesforce, SAP, SharePoint, and custom MCP connectors.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {integrations.map((item) => (
          <span
            key={item.name}
            className="text-[11px] px-2.5 py-1.5 rounded-lg bg-zinc-50 text-zinc-800 border border-zinc-200 flex items-center gap-1.5 shadow-2xs hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            {item.icon}
            <span className="font-semibold">{item.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   THE MATH — cost comparison + interactive usage calculator

   Every number below is derived from the same per-unit prices the
   calculator uses (CALC_PRICES) and from the Telephonic Agent / Screening
   Agent capability cards above, rather than being hardcoded independently —
   so "the math" and "the calculator" can never drift apart.
   ═══════════════════════════════════════════════════════════ */

const CALC_PRICES = { standard: 250, deep: 450, structured: 90, voice: 60 };
const CALC_BONUS_THRESHOLD = 15000;
const CALC_BONUS_RATE = 0.05;

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// A first-round screen here = one Telephonic Agent voice call (replaces the
// recruiter's initial phone screen) + one Screening Agent AI Standard
// Interview (replaces the hiring manager's first-round interview).
const MATH_CANDIDATES = 100;
const MATH_RECRUITER_RATE = 500; // ₹/hr — sourcing, phone screens, scheduling & coordination
const MATH_ENGINEER_RATE = 1200; // ₹/hr — conducting + scoring first-round interviews
const MATH_RECRUITER_HOURS = 140; // 84 min/candidate: sourcing + phone screen + coordination, for 100 candidates
const MATH_ENGINEER_HOURS = 110; // 66 min/candidate: first-round interview + scorecard, for 100 candidates
const MATH_MANUAL_COST = MATH_RECRUITER_HOURS * MATH_RECRUITER_RATE + MATH_ENGINEER_HOURS * MATH_ENGINEER_RATE;
const MATH_AI_COST_PER_CANDIDATE = CALC_PRICES.voice + CALC_PRICES.standard;
const MATH_AI_COST = MATH_CANDIDATES * MATH_AI_COST_PER_CANDIDATE;
const MATH_SAVINGS = MATH_MANUAL_COST - MATH_AI_COST;
const MATH_SAVINGS_PCT = Math.round((MATH_SAVINGS / MATH_MANUAL_COST) * 100);

function MathComparisonCard() {
  return (
    <div className="relative mt-8 rounded-[2rem] overflow-hidden p-8 sm:p-12 text-center bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 shadow-2xl shadow-blue-600/25">
      <div className="absolute -top-24 -right-24 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-blue-100 mb-3">
          Manual vs. Fin AI · {MATH_CANDIDATES} candidates
        </div>
        <p className="text-[19px] sm:text-[26px] font-bold text-white mb-8 leading-snug">
          You spend <span className="line-through decoration-2 decoration-orange-200/80 text-orange-100">{inr(MATH_MANUAL_COST)}</span> doing this by hand.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
          <div className="p-5 rounded-2xl bg-white/5 ring-1 ring-white/10">
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">{inr(MATH_MANUAL_COST)}</div>
            <div className="text-[13px] font-bold text-blue-50 mt-1.5">Manual cost</div>
            <div className="text-[11px] text-blue-100/80 mt-0.5">{MATH_RECRUITER_HOURS} recruiter hrs + {MATH_ENGINEER_HOURS} engineer hrs</div>
          </div>
          <div className="p-5 rounded-2xl bg-white/15 ring-1 ring-white/25 shadow-lg shadow-black/10">
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-300 font-mono">{inr(MATH_AI_COST)}</div>
            <div className="text-[13px] font-bold text-white mt-1.5">Fin AI cost</div>
            <div className="text-[11px] text-blue-100/80 mt-0.5">Telephonic Agent + Screening Agent, end to end</div>
          </div>
          <div className="p-5 rounded-2xl bg-white/5 ring-1 ring-white/10">
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">{inr(MATH_SAVINGS)}</div>
            <div className="text-[13px] font-bold text-blue-50 mt-1.5">You save</div>
            <div className="text-[11px] text-blue-100/80 mt-0.5">~{MATH_SAVINGS_PCT}% reduction + time back</div>
          </div>
        </div>

        <p className="text-[11px] text-blue-100/70 mt-8 max-w-md mx-auto leading-relaxed">
          {MATH_CANDIDATES} × ({inr(CALC_PRICES.voice)} AI Voice Call + {inr(CALC_PRICES.standard)} AI Standard Interview) = {inr(MATH_AI_COST)}.
          Recruiter time at {inr(MATH_RECRUITER_RATE)}/hr, engineer time at {inr(MATH_ENGINEER_RATE)}/hr. Your numbers may vary — use the calculator below.
        </p>
      </div>
    </div>
  );
}

function CostCalculator() {
  const [standard, setStandard] = useState(20);
  const [deep, setDeep] = useState(2);
  const [structured, setStructured] = useState(0);
  const [voice, setVoice] = useState(200);

  const lineItems = [
    { key: "standard", label: "AI Standard Interview", qty: standard, set: setStandard, price: CALC_PRICES.standard, detail: `${inr(CALC_PRICES.standard)} each` },
    { key: "deep", label: "AI Deep Interview", qty: deep, set: setDeep, price: CALC_PRICES.deep, detail: `${inr(CALC_PRICES.deep)} each` },
    { key: "structured", label: "Structured Interview", qty: structured, set: setStructured, price: CALC_PRICES.structured, detail: `${inr(CALC_PRICES.structured)} each` },
    { key: "voice", label: "AI Voice Call", qty: voice, set: setVoice, price: CALC_PRICES.voice, detail: `${inr(CALC_PRICES.voice)} each` },
  ];

  const subtotal = lineItems.reduce((sum, i) => sum + i.qty * i.price, 0);
  const totalUnits = lineItems.reduce((sum, i) => sum + i.qty, 0);
  const bonusEligible = subtotal >= CALC_BONUS_THRESHOLD;
  const bonusAmount = bonusEligible ? subtotal * CALC_BONUS_RATE : 0;
  const activeItems = lineItems.filter((i) => i.qty > 0);

  return (
    <div>
      <div className="text-center max-w-xl mx-auto mb-10">
        <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200 inline-flex items-center gap-1.5">
          <Calculator className="w-3.5 h-3.5" /> Estimate Your Usage
        </span>
        <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
          What will your next hire cycle cost <span className="text-blue-600">in total?</span>
        </h2>
        <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">
          Enter your numbers below to estimate your monthly spend.
        </p>
        <p className="text-emerald-600 text-[13px] font-bold mt-1.5">
          Bonus credit of 5% applies above {inr(CALC_BONUS_THRESHOLD)}.
        </p>
      </div>

      <div className="grid md:grid-cols-2 rounded-3xl overflow-hidden border border-zinc-200 shadow-xl bg-white">
        {/* LEFT: quantity steppers */}
        <div className="p-6 sm:p-8">
          <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider mb-1">Screening Agent</div>
          <StepperRow label="AI Standard Interview" detail={lineItems[0].detail} value={standard} onChange={setStandard} />
          <StepperRow label="AI Deep Interview" detail={lineItems[1].detail} value={deep} onChange={setDeep} />
          <StepperRow label="Structured Interview" detail={lineItems[2].detail} value={structured} onChange={setStructured} />

          <div className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider mb-1 mt-6">Telephonic Agent</div>
          <StepperRow label="AI Voice Call" detail={lineItems[3].detail} value={voice} onChange={setVoice} isLast />
        </div>

        {/* RIGHT: live summary */}
        <div className="p-6 sm:p-8 bg-gradient-to-br from-blue-600 to-blue-700 text-white flex flex-col">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-blue-100">Your Estimated Total</div>
          <div className="text-4xl sm:text-5xl font-extrabold font-mono mt-2 mb-1">{inr(subtotal)}</div>
          <div className="text-[12px] text-blue-100">{totalUnits} screening{totalUnits === 1 ? "" : "s"}</div>

          <AnimatePresence>
            {bonusEligible && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-300/30 text-emerald-100 text-[11px] font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" /> +5% bonus: {inr(bonusAmount)} of free screening added
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-5 rounded-xl bg-white/10 border border-white/15 divide-y divide-white/10 text-[12px]">
            {activeItems.length === 0 ? (
              <div className="px-3.5 py-3 text-blue-100/70 text-center">Add quantities to see a breakdown</div>
            ) : (
              activeItems.map((i) => (
                <div key={i.key} className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                  <span className="truncate">{i.qty} × {i.label}</span>
                  <span className="font-mono font-bold shrink-0">{inr(i.qty * i.price)}</span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/15 font-bold text-[13px]">
            <span>Total · {totalUnits} screenings</span>
            <span className="font-mono">{inr(subtotal)}</span>
          </div>

          <Link
            href="/rag"
            className="mt-6 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white text-blue-700 font-bold text-sm hover:bg-blue-50 transition-colors shadow-sm"
          >
            Get Started <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function StepperRow({
  label, detail, value, onChange, isLast,
}: { label: string; detail: string; value: number; onChange: (v: number) => void; isLast?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3 ${isLast ? "" : "border-b border-zinc-100"}`}>
      <div className="min-w-0">
        <div className="text-[13px] font-bold text-zinc-900 truncate">{label}</div>
        <div className="text-[11px] text-zinc-500">{detail}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-9 h-9 sm:w-7 sm:h-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-9 text-center text-[13px] font-bold text-zinc-900 font-mono">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-9 h-9 sm:w-7 sm:h-7 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300 active:bg-zinc-100 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
