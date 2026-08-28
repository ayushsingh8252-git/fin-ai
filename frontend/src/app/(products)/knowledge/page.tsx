"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  ArrowLeft, Brain, GitBranch, GitPullRequest, FileText,
  CheckCircle2, Clock, Search, X, ChevronRight, ChevronDown,
  Users, Star, Activity, FolderOpen, Code, Terminal, Eye,
  Zap, ArrowUpRight, Filter, MessageSquare, Book, User,
  BarChart3, Globe, Layers, Shield, Database, Bot, Sparkles,
  Video, ScrollText, CalendarClock, ClipboardCheck, Mail, Award,
} from "lucide-react";
import {
  getSyncedHiresSnapshot, getSyncedHiresServerSnapshot, subscribeSyncedHires, type SyncedHire,
} from "@/lib/hiringSync";
import { EmptyState } from "@/components/ui/empty-state";

/* ═══════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════ */

function useAnimatedCounter(end: number, duration = 1200) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const started = useRef(false);
  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * end));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, end, duration]);
  return { count, ref };
}

/* ═══════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════ */

const EMPLOYEE = {
  name: "Ayush Singh",
  designation: "AI Engineer",
  department: "Engineering",
  joined: "Jan 2024",
  manager: "Rahul Sharma",
  avatar: "AS",
};

const PROJECTS = [
  {
    id: "genque",
    name: "GenQue",
    desc: "AI Question Generation Platform",
    tech: ["Python", "FastAPI", "React", "LangChain"],
    prs: 87,
    issues: 32,
    commits: 312,
    contribution: 78,
    lastActive: "2 days ago",
    status: "active",
    team: ["Ayush", "Rahul", "Krrish"],
  },
  {
    id: "rag-dynamic",
    name: "RAG Dynamic",
    desc: "Enterprise Retrieval Engine",
    tech: ["Python", "Pinecone", "Next.js", "Docker"],
    prs: 42,
    issues: 18,
    commits: 198,
    contribution: 62,
    lastActive: "5 days ago",
    status: "active",
    team: ["Ayush", "Ketan", "Shreaya"],
  },
  {
    id: "clas",
    name: "CLAS",
    desc: "Compliance AI System",
    tech: ["Python", "PostgreSQL", "React", "AWS"],
    prs: 26,
    issues: 12,
    commits: 94,
    contribution: 45,
    lastActive: "1 week ago",
    status: "maintenance",
    team: ["Ayush", "Priya"],
  },
];

const PULL_REQUESTS = [
  { id: 324, title: "Implement vector search pipeline", author: "Ayush", reviewer: "Rahul", branch: "feat/vector-search", status: "merged", files: 12, added: 847, removed: 123, labels: ["feature", "ai"], date: "2 days ago", project: "genque" },
  { id: 318, title: "Fix authentication token refresh", author: "Ayush", reviewer: "Krrish", branch: "fix/auth-refresh", status: "merged", files: 4, added: 89, removed: 45, labels: ["bugfix"], date: "5 days ago", project: "genque" },
  { id: 312, title: "Add RAG reranking module", author: "Ayush", reviewer: "Ketan", branch: "feat/rerank", status: "merged", files: 8, added: 432, removed: 67, labels: ["feature", "rag"], date: "1 week ago", project: "rag-dynamic" },
  { id: 308, title: "Update Docker compose config", author: "Ayush", reviewer: "Shreaya", branch: "chore/docker", status: "merged", files: 3, added: 45, removed: 12, labels: ["infra"], date: "1 week ago", project: "rag-dynamic" },
  { id: 301, title: "Implement compliance rule engine", author: "Ayush", reviewer: "Priya", branch: "feat/rules", status: "open", files: 15, added: 1200, removed: 89, labels: ["feature", "compliance"], date: "3 days ago", project: "clas" },
  { id: 295, title: "Add evaluation metrics dashboard", author: "Ayush", reviewer: "Rahul", branch: "feat/eval-dashboard", status: "pending", files: 7, added: 340, removed: 23, labels: ["feature", "analytics"], date: "4 days ago", project: "genque" },
];

const TIMELINE_EVENTS = [
  { date: "Jan 2024", title: "Joined GenQue Project", type: "join" },
  { date: "Feb 2024", title: "First commit to GenQue", type: "commit" },
  { date: "Mar 2024", title: "First PR merged (#42)", type: "pr" },
  { date: "May 2024", title: "Released Question Generator v2", type: "release" },
  { date: "Jul 2024", title: "Joined RAG Dynamic Project", type: "join" },
  { date: "Sep 2024", title: "Fixed critical auth vulnerability", type: "bugfix" },
  { date: "Nov 2024", title: "Implemented vector search pipeline", type: "feature" },
  { date: "Jan 2025", title: "Onboarded to CLAS project", type: "join" },
  { date: "Mar 2025", title: "Major RAG reranking refactor", type: "refactor" },
  { date: "Jun 2025", title: "Documentation overhaul across repos", type: "docs" },
];

const KNOWLEDGE_NODES = [
  { id: "genque", label: "GenQue", group: "project" },
  { id: "rag", label: "RAG Dynamic", group: "project" },
  { id: "clas", label: "CLAS", group: "project" },
  { id: "fastapi", label: "FastAPI", group: "tech" },
  { id: "react", label: "React", group: "tech" },
  { id: "docker", label: "Docker", group: "tech" },
  { id: "postgresql", label: "PostgreSQL", group: "tech" },
  { id: "langchain", label: "LangChain", group: "tech" },
  { id: "aws", label: "AWS", group: "tech" },
  { id: "pinecone", label: "Pinecone", group: "tech" },
  { id: "auth", label: "Authentication", group: "domain" },
  { id: "rag-pipeline", label: "RAG Pipeline", group: "domain" },
  { id: "ci-cd", label: "CI/CD", group: "domain" },
  { id: "agents", label: "AI Agents", group: "domain" },
];

const FILE_TREE = [
  { name: "backend/", children: ["app/", "tests/", "requirements.txt"] },
  { name: "frontend/", children: ["src/", "public/", "package.json"] },
  { name: "agents/", children: ["reasoning.py", "tools.py", "prompts/"] },
  { name: "docs/", children: ["architecture.md", "api.md", "setup.md"] },
  { name: "docker/", children: ["Dockerfile", "docker-compose.yml"] },
  { name: ".github/", children: ["workflows/", "CODEOWNERS"] },
];

const ACTIVITIES = [
  { action: "Merged PR #324", detail: "Implement vector search pipeline", time: "2 days ago", reviewer: "Rahul", project: "GenQue" },
  { action: "Reviewed PR #319", detail: "Fix token caching layer", time: "3 days ago", reviewer: "Krrish", project: "GenQue" },
  { action: "Updated Docker config", detail: "Optimized multi-stage build", time: "5 days ago", reviewer: "Shreaya", project: "RAG Dynamic" },
  { action: "Resolved auth bug", detail: "Fixed refresh token race condition", time: "1 week ago", reviewer: "Ketan", project: "RAG Dynamic" },
  { action: "Added compliance rules", detail: "Implemented SOC2 rule engine", time: "1 week ago", reviewer: "Priya", project: "CLAS" },
];

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function KnowledgePage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [prFilter, setPrFilter] = useState("all");
  const [expandedTimeline, setExpandedTimeline] = useState<number | null>(null);
  const [knowledgeHover, setKnowledgeHover] = useState<string | null>(null);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const [viewingHireId, setViewingHireId] = useState<string | null>(null);

  // Picks up candidates handed off by the Agentic Hiring Pipeline demo (/hiring-automation)
  // so they show up here as real new employees receiving knowledge transfer. sessionStorage
  // doesn't exist during SSR, so this is read via useSyncExternalStore (server snapshot = [])
  // rather than an effect, to avoid a hydration mismatch on first paint.
  const syncedHires = useSyncExternalStore(subscribeSyncedHires, getSyncedHiresSnapshot, getSyncedHiresServerSnapshot);

  const viewingHire = syncedHires.find((h) => h.id === viewingHireId) || null;

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "projects", label: "Projects" },
    { id: "prs", label: "Pull Requests" },
    { id: "timeline", label: "Timeline" },
    { id: "graph", label: "Knowledge Graph" },
    { id: "files", label: "Files" },
    { id: "activity", label: "Activity" },
  ];

  const filteredPRs = PULL_REQUESTS.filter(pr => {
    if (prFilter !== "all" && pr.status !== prFilter) return false;
    if (searchQuery && !pr.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      {/* PAGE HEADER */}
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Knowledge Transfer Engine</span>
          </div>
        </div>
      </div>

      {/* SECTION TABS / NEW-HIRE SWITCHER */}
      <div className="sticky top-12 z-20 bg-white/90 backdrop-blur-sm border-b border-zinc-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {viewingHire ? (
            <div className="flex items-center gap-2 py-2.5 overflow-x-auto scrollbar-hide">
              <button
                onClick={() => setViewingHireId(null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600 hover:text-blue-600 transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Workspace
              </button>
              <span className="text-zinc-300">/</span>
              <span className="text-xs font-bold text-zinc-900 whitespace-nowrap flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {viewingHire.name} · New Hire
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-2">
              {sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                    activeSection === s.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {s.label}
                </button>
              ))}
              {syncedHires.length > 0 && (
                <div className="flex items-center gap-1 ml-1 pl-2 border-l border-zinc-200 shrink-0">
                  {syncedHires.map(h => (
                    <button
                      key={h.id}
                      onClick={() => setViewingHireId(h.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors whitespace-nowrap"
                    >
                      <Sparkles className="w-3 h-3" /> {h.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {viewingHire ? (
          <NewHireKnowledgeView hire={viewingHire} />
        ) : (
          <>
            {/* OVERVIEW */}
            {activeSection === "overview" && <OverviewSection />}
            {activeSection === "projects" && (
              <ProjectsSection expandedProject={expandedProject} setExpandedProject={setExpandedProject} />
            )}
            {activeSection === "prs" && (
              <PRSection
                prs={filteredPRs}
                filter={prFilter}
                setFilter={setPrFilter}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
              />
            )}
            {activeSection === "timeline" && (
              <TimelineSection expandedIdx={expandedTimeline} setExpandedIdx={setExpandedTimeline} />
            )}
            {activeSection === "graph" && (
              <KnowledgeGraphSection hover={knowledgeHover} setHover={setKnowledgeHover} aiOpen={aiSummaryOpen} setAiOpen={setAiSummaryOpen} />
            )}
            {activeSection === "files" && (
              <FilesSection expandedFolder={expandedFolder} setExpandedFolder={setExpandedFolder} />
            )}
            {activeSection === "activity" && (
              <ActivitySection filter={activityFilter} setFilter={setActivityFilter} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NEW HIRE — KNOWLEDGE TRANSFER IN PROGRESS
   (Candidates handed off from the Agentic Hiring Pipeline demo — a fresh
   employee has no PR history yet, so this is a lighter view than the
   veteran workspace above: profile + transfer checklist, not a full graph.)
   ═══════════════════════════════════════════════════════════ */

const NEW_HIRE_KT_STEPS = [
  { label: "Assign Documents", icon: FileText, detail: "Architecture.md, API Reference, Team Handbook" },
  { label: "Assign Videos", icon: Video, detail: "Codebase walkthrough & deployment training" },
  { label: "Assign Policies", icon: ScrollText, detail: "Security, compliance & code review policy" },
  { label: "Schedule Sessions", icon: CalendarClock, detail: "1:1 pairing sessions with the team lead" },
  { label: "Track Completion", icon: ClipboardCheck, detail: "Monitoring reading & training progress" },
];

function NewHireKnowledgeView({ hire }: { hire: SyncedHire }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="p-6 rounded-2xl bg-white border border-zinc-200 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 text-2xl font-bold shrink-0">
            {hire.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-extrabold text-zinc-900">{hire.name}</h2>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                <Sparkles className="w-2.5 h-2.5" /> New Hire
              </span>
            </div>
            <p className="text-xs text-zinc-500">{hire.designation} · Joined via Agentic Hiring Pipeline</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] text-zinc-400">
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{hire.email}</span>
              <span className="flex items-center gap-1"><Award className="w-3 h-3" />ATS {hire.ats}%</span>
              <span>{hire.experience} experience</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-4">
          {hire.skills.map(s => (
            <span key={s} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">{s}</span>
          ))}
        </div>
      </div>

      <h3 className="text-sm font-bold text-zinc-900 mb-3 flex items-center gap-2"><Brain className="w-4 h-4 text-blue-600" />Knowledge Transfer Checklist</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {NEW_HIRE_KT_STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-white border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">{s.label} <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /></div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{s.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW
   ═══════════════════════════════════════════════════════════ */

function OverviewSection() {
  const projects = useAnimatedCounter(5);
  const prs = useAnimatedCounter(127);
  const score = useAnimatedCounter(94);
  const repos = useAnimatedCounter(3);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      {/* Profile Card */}
      <div className="p-6 rounded-2xl bg-white border border-zinc-200 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 text-2xl font-bold shrink-0">
            {EMPLOYEE.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold text-zinc-900">{EMPLOYEE.name}</h2>
            <p className="text-xs text-zinc-500">{EMPLOYEE.designation} · {EMPLOYEE.department}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[11px] text-zinc-400">
              <span>Joined {EMPLOYEE.joined}</span>
              <span>Manager: {EMPLOYEE.manager}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Projects", value: projects, suffix: "", icon: <FolderOpen className="w-4 h-4" /> },
          { label: "Merged PRs", value: prs, suffix: "", icon: <GitPullRequest className="w-4 h-4" /> },
          { label: "Knowledge Score", value: score, suffix: "%", icon: <Star className="w-4 h-4" /> },
          { label: "Repositories", value: repos, suffix: "", icon: <GitBranch className="w-4 h-4" /> },
        ].map(stat => (
          <div key={stat.label} className="p-4 rounded-2xl bg-white border border-zinc-200 hover:border-blue-300 transition-all">
            <div className="flex items-center gap-2 mb-2 text-blue-600">
              {stat.icon}
              <span className="text-[11px] font-bold text-zinc-500 uppercase">{stat.label}</span>
            </div>
            <div className="text-2xl font-extrabold text-zinc-900 font-mono">
              <span ref={stat.value.ref}>{stat.value.count}</span>{stat.suffix}
            </div>
          </div>
        ))}
      </div>

      {/* Analytics Cards */}
      <h3 className="text-sm font-bold text-zinc-900 mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-600" />Contribution Analytics</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Commits", value: 604 },
          { label: "Pull Requests", value: 155 },
          { label: "Code Reviews", value: 89 },
          { label: "Docs Updates", value: 34 },
          { label: "Issues Closed", value: 62 },
          { label: "Features", value: 28 },
        ].map(m => (
          <div key={m.label} className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-center">
            <div className="text-lg font-extrabold text-zinc-900 font-mono">{m.value}</div>
            <div className="text-[10px] font-bold text-zinc-500 uppercase">{m.label}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PROJECTS
   ═══════════════════════════════════════════════════════════ */

function ProjectsSection({ expandedProject, setExpandedProject }: {
  expandedProject: string | null;
  setExpandedProject: (id: string | null) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <h3 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-blue-600" />Project Workspace</h3>
      <div className="space-y-4">
        {PROJECTS.map(proj => {
          const expanded = expandedProject === proj.id;
          const projectPRs = PULL_REQUESTS.filter(pr => pr.project === proj.id);
          return (
            <div key={proj.id} className="rounded-2xl bg-white border border-zinc-200 overflow-hidden hover:border-blue-300 transition-all">
              <button
                onClick={() => setExpandedProject(expanded ? null : proj.id)}
                className="w-full p-5 text-left flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitBranch className="w-4 h-4 text-blue-600 shrink-0" />
                    <h4 className="text-base font-bold text-zinc-900">{proj.name}</h4>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      proj.status === "active" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-zinc-100 border-zinc-200 text-zinc-600"
                    }`}>
                      {proj.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">{proj.desc}</p>
                  <div className="flex flex-wrap gap-1">
                    {proj.tech.map(t => (
                      <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-zinc-500 shrink-0">
                  <div className="text-center">
                    <div className="font-extrabold text-zinc-900 text-lg font-mono">{proj.prs}</div>
                    <div className="text-[10px]">PRs</div>
                  </div>
                  <div className="text-center">
                    <div className="font-extrabold text-zinc-900 text-lg font-mono">{proj.issues}</div>
                    <div className="text-[10px]">Issues</div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </div>
              </button>

              <AnimatePresence>
                {expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-5 pb-5 border-t border-zinc-100">
                      <div className="grid sm:grid-cols-3 gap-3 pt-4 mb-4">
                        <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                          <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Commits</div>
                          <div className="text-lg font-extrabold text-zinc-900 font-mono">{proj.commits}</div>
                        </div>
                        <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                          <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Contribution</div>
                          <div className="text-lg font-extrabold text-blue-600 font-mono">{proj.contribution}%</div>
                          <div className="h-1.5 bg-zinc-200 rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${proj.contribution}%` }} />
                          </div>
                        </div>
                        <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                          <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Team</div>
                          <div className="flex -space-x-2">
                            {proj.team.map(name => (
                              <div key={name} className="w-7 h-7 rounded-full bg-blue-50 border-2 border-white flex items-center justify-center text-[10px] font-bold text-blue-600">
                                {name[0]}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Recent PRs for this project */}
                      <h5 className="text-xs font-bold text-zinc-700 mb-2">Recent Pull Requests</h5>
                      <div className="space-y-1.5">
                        {projectPRs.slice(0, 3).map(pr => (
                          <PRCard key={pr.id} pr={pr} compact />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PR SECTION
   ═══════════════════════════════════════════════════════════ */

function PRCard({ pr, compact = false }: { pr: typeof PULL_REQUESTS[0]; compact?: boolean }) {
  const statusStyles: Record<string, string> = {
    merged: "bg-indigo-50 border-indigo-200 text-indigo-700",
    open: "bg-emerald-50 border-emerald-200 text-emerald-700",
    pending: "bg-amber-50 border-amber-200 text-amber-700",
    closed: "bg-zinc-100 border-zinc-200 text-zinc-600",
  };

  return (
    <div className={`rounded-xl bg-white border border-zinc-200 hover:border-blue-300 transition-all ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <GitPullRequest className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} text-blue-600 shrink-0`} />
            <span className={`font-bold text-zinc-900 truncate ${compact ? "text-xs" : "text-sm"}`}>{pr.title}</span>
            <span className="text-[10px] font-mono text-zinc-400">#{pr.id}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-zinc-500">
            <span>{pr.branch}</span>
            <span>·</span>
            <span>{pr.date}</span>
            {!compact && (
              <>
                <span>·</span>
                <span className="text-emerald-600 font-bold">+{pr.added}</span>
                <span className="text-red-500 font-bold">-{pr.removed}</span>
                <span>·</span>
                <span>{pr.files} files</span>
              </>
            )}
          </div>
        </div>
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border shrink-0 ${statusStyles[pr.status] || statusStyles.closed}`}>
          {pr.status}
        </span>
      </div>
      {!compact && pr.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {pr.labels.map(l => (
            <span key={l} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function PRSection({ prs, filter, setFilter, searchQuery, setSearchQuery }: {
  prs: typeof PULL_REQUESTS;
  filter: string;
  setFilter: (f: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  const tabs = ["all", "merged", "open", "pending"];

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><GitPullRequest className="w-4 h-4 text-blue-600" />Pull Requests</h3>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search PRs..."
            className="pl-8 pr-3 py-2 rounded-xl bg-zinc-50 border border-zinc-200 text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 w-full sm:w-56"
          />
        </div>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize whitespace-nowrap transition-all ${
              filter === t ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {t === "all" ? `All (${PULL_REQUESTS.length})` : `${t} (${PULL_REQUESTS.filter(p => p.status === t).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {prs.length === 0 ? (
          <EmptyState
            icon={GitPullRequest}
            title="No pull requests match your filter"
            description="Try a different status filter, or clear it to see every pull request again."
          />
        ) : (
          prs.map(pr => <PRCard key={pr.id} pr={pr} />)
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TIMELINE
   ═══════════════════════════════════════════════════════════ */

function TimelineSection({ expandedIdx, setExpandedIdx }: {
  expandedIdx: number | null;
  setExpandedIdx: (idx: number | null) => void;
}) {
  const typeColors: Record<string, string> = {
    join: "bg-blue-600",
    commit: "bg-zinc-600",
    pr: "bg-indigo-600",
    release: "bg-emerald-600",
    bugfix: "bg-red-500",
    feature: "bg-blue-500",
    refactor: "bg-amber-600",
    docs: "bg-zinc-500",
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <h3 className="text-sm font-bold text-zinc-900 mb-6 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" />Contribution Timeline</h3>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 sm:left-5 top-0 bottom-0 w-px bg-zinc-200" />

        <div className="space-y-4">
          {TIMELINE_EVENTS.map((event, i) => {
            const expanded = expandedIdx === i;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="relative pl-10 sm:pl-12"
              >
                {/* Dot */}
                <div className={`absolute left-2.5 sm:left-3.5 top-1.5 w-3 h-3 rounded-full border-2 border-white ${typeColors[event.type] || "bg-zinc-400"}`} />

                <button
                  onClick={() => setExpandedIdx(expanded ? null : i)}
                  className="w-full text-left p-3 rounded-xl bg-white border border-zinc-200 hover:border-blue-300 transition-all"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-bold text-zinc-900">{event.title}</span>
                      <span className="text-[10px] text-zinc-400 ml-2">{event.date}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border capitalize ${
                      event.type === "release" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                      event.type === "bugfix" ? "bg-red-50 border-red-200 text-red-600" :
                      "bg-zinc-100 border-zinc-200 text-zinc-600"
                    }`}>
                      {event.type}
                    </span>
                  </div>
                </button>

                <AnimatePresence>
                  {expanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-1 p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-600 leading-relaxed">
                        Detailed contribution record for this milestone. This event marks a significant contribution in the employee&apos;s knowledge transfer journey within the organization.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   KNOWLEDGE GRAPH
   ═══════════════════════════════════════════════════════════ */

function KnowledgeGraphSection({ hover, setHover, aiOpen, setAiOpen }: {
  hover: string | null;
  setHover: (id: string | null) => void;
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
}) {
  const groupColors: Record<string, { fill: string; border: string; text: string }> = {
    project: { fill: "#eff6ff", border: "#bfdbfe", text: "#2563eb" },
    tech: { fill: "#f0fdf4", border: "#bbf7d0", text: "#16a34a" },
    domain: { fill: "#fef3c7", border: "#fde68a", text: "#d97706" },
  };

  // Arrange nodes in a circle around center
  const cx = 300, cy = 220, radius = 160;
  const nodePositions = KNOWLEDGE_NODES.map((node, i) => {
    const angle = (i / KNOWLEDGE_NODES.length) * 2 * Math.PI - Math.PI / 2;
    return { ...node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Globe className="w-4 h-4 text-blue-600" />Interactive Knowledge Graph</h3>
        <button
          onClick={() => setAiOpen(!aiOpen)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors self-start"
        >
          <Bot className="w-3.5 h-3.5" /> AI Summary
        </button>
      </div>

      {/* AI Summary Panel */}
      <AnimatePresence>
        {aiOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
            <div className="p-5 rounded-2xl bg-blue-50/50 border border-blue-200">
              <h4 className="text-xs font-bold text-blue-900 mb-2">AI-Generated Knowledge Summary</h4>
              <p className="text-xs text-blue-800 leading-relaxed mb-3">
                Ayush has primarily contributed to the GenQue platform with deep expertise in AI question generation, FastAPI backend architecture, and vector search pipelines. Key areas include prompt engineering, Docker deployment, and GitHub CI/CD workflows.
              </p>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <h5 className="font-bold text-blue-900 w-full">Most Experienced Modules:</h5>
                {["Authentication", "Evaluation Pipeline", "Question Generator", "Knowledge Retrieval"].map(m => (
                  <span key={m} className="px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 font-bold">{m}</span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {["Ask AI", "View Docs", "View PRs", "Find Expert"].map(a => (
                  <button key={a} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 transition-colors">{a}</button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Graph */}
      <div className="rounded-2xl bg-white border border-zinc-200 p-4 overflow-x-auto">
        <svg viewBox="0 0 600 440" className="w-full max-w-[600px] mx-auto" style={{ minWidth: 320 }}>
          {/* Connections */}
          {nodePositions.map(node => (
            <line
              key={`line-${node.id}`}
              x1={cx} y1={cy}
              x2={node.x} y2={node.y}
              stroke={hover === node.id || !hover ? "#e2e8f0" : "#f4f4f5"}
              strokeWidth={hover === node.id ? 2 : 1}
              strokeDasharray={hover === node.id ? "none" : "4 2"}
              className="transition-all duration-300"
            />
          ))}

          {/* Center Node */}
          <circle cx={cx} cy={cy} r={32} fill="#eff6ff" stroke="#bfdbfe" strokeWidth={2} />
          <text x={cx} y={cy - 6} textAnchor="middle" className="text-[10px] font-bold fill-blue-600">Ayush</text>
          <text x={cx} y={cy + 8} textAnchor="middle" className="text-[8px] fill-zinc-500">Singh</text>

          {/* Outer Nodes */}
          {nodePositions.map(node => {
            const colors = groupColors[node.group];
            const isHovered = hover === node.id;
            return (
              <g
                key={node.id}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={node.x} cy={node.y}
                  r={isHovered ? 28 : 24}
                  fill={colors.fill}
                  stroke={isHovered ? colors.text : colors.border}
                  strokeWidth={isHovered ? 2 : 1}
                  className="transition-all duration-200"
                />
                <text
                  x={node.x} y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={colors.text}
                  className="text-[8px] font-bold pointer-events-none"
                >
                  {node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-4 mt-4 text-[10px]">
          {[
            { label: "Projects", color: "bg-blue-100 border-blue-200 text-blue-700" },
            { label: "Technologies", color: "bg-emerald-100 border-emerald-200 text-emerald-700" },
            { label: "Domains", color: "bg-amber-100 border-amber-200 text-amber-700" },
          ].map(l => (
            <span key={l.label} className={`px-2 py-0.5 rounded-full border font-bold ${l.color}`}>{l.label}</span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FILES
   ═══════════════════════════════════════════════════════════ */

function FilesSection({ expandedFolder, setExpandedFolder }: {
  expandedFolder: string | null;
  setExpandedFolder: (f: string | null) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <h3 className="text-sm font-bold text-zinc-900 mb-4 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-blue-600" />Repository File Explorer</h3>
      <div className="rounded-2xl bg-white border border-zinc-200 divide-y divide-zinc-100">
        {FILE_TREE.map(folder => {
          const expanded = expandedFolder === folder.name;
          return (
            <div key={folder.name}>
              <button
                onClick={() => setExpandedFolder(expanded ? null : folder.name)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-zinc-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className={`w-4 h-4 ${expanded ? "text-blue-600" : "text-zinc-400"}`} />
                  <span className="text-sm font-mono font-bold text-zinc-900">{folder.name}</span>
                </div>
                <ChevronRight className={`w-4 h-4 text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pl-10 pr-4 pb-3 space-y-1">
                      {folder.children.map(child => (
                        <div key={child} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer">
                          {child.endsWith("/") ? (
                            <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-zinc-400" />
                          )}
                          <span className="text-xs font-mono text-zinc-700">{child}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ACTIVITY
   ═══════════════════════════════════════════════════════════ */

function ActivitySection({ filter, setFilter }: {
  filter: string;
  setFilter: (f: string) => void;
}) {
  const projects = ["all", ...new Set(ACTIVITIES.map(a => a.project))];
  const filtered = filter === "all" ? ACTIVITIES : ACTIVITIES.filter(a => a.project === filter);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" />Recent Activity</h3>
        <div className="flex gap-1 overflow-x-auto">
          {projects.map(p => (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize whitespace-nowrap transition-all ${
                filter === p ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((act, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="p-4 rounded-xl bg-white border border-zinc-200 hover:border-blue-300 transition-all"
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-bold text-zinc-900">{act.action}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{act.detail}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-zinc-400">{act.time}</div>
                <div className="text-[10px] font-mono font-bold text-blue-600 mt-0.5">{act.project}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
