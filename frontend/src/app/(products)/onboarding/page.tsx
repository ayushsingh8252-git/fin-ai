"use client";

import { useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, UserPlus, Users, FileText, Shield, GitBranch,
  Share2, CheckCircle2, XCircle, Clock, Plus, Search, X,
  Mail, Building, ChevronRight, Eye, Briefcase, FolderOpen,
  AlertCircle, User, Zap, Upload, Link2, Newspaper, Loader2, Paperclip, Sparkles
} from "lucide-react";
import {
  getSyncedHiresSnapshot, getSyncedHiresServerSnapshot, subscribeSyncedHires, type SyncedHire,
} from "@/lib/hiringSync";
import { getAuthHeaders } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

type Role = "hr" | "manager" | "employee" | null;
type RepoStatus = "not_granted" | "pending" | "granted";

interface Employee {
  id: string;
  name: string;
  email: string;
  designation: string;
  managerId: string | null;
  sharedDocs: string[];
  repoAccess: Record<string, RepoStatus>;
  source?: string;
}

type DocType = "pdf" | "article" | "blog";

interface Document {
  id: string;
  name: string;
  sharedWith: string[];
  type?: DocType;
  url?: string;
}

/* ═══════════════════════════════════════════════════════════
   INITIAL DATA
   ═══════════════════════════════════════════════════════════ */

const REPOS = ["GenQue", "RAG Dynamic", "CLAS"];

const INITIAL_EMPLOYEES: Employee[] = [
  { id: "e1", name: "Ayush", email: "ayush@company.com", designation: "AI Developer", managerId: "m1", sharedDocs: ["design.pdf"], repoAccess: { GenQue: "granted", "RAG Dynamic": "not_granted", CLAS: "not_granted" } },
  { id: "e2", name: "Krrish", email: "krrish@company.com", designation: "UI Designer", managerId: "m1", sharedDocs: [], repoAccess: { GenQue: "not_granted", "RAG Dynamic": "not_granted", CLAS: "not_granted" } },
  { id: "e3", name: "Ketan", email: "ketan@company.com", designation: "MERN Stack Developer", managerId: "m1", sharedDocs: ["software.pdf"], repoAccess: { GenQue: "not_granted", "RAG Dynamic": "pending", CLAS: "not_granted" } },
  { id: "e4", name: "Shreaya Singh", email: "shreaya@company.com", designation: "Software Developer", managerId: null, sharedDocs: [], repoAccess: { GenQue: "not_granted", "RAG Dynamic": "not_granted", CLAS: "not_granted" } },
];

const INITIAL_DOCS: Document[] = [
  { id: "d1", name: "design.pdf", sharedWith: ["e1"], type: "pdf" },
  { id: "d2", name: "software.pdf", sharedWith: ["e3"], type: "pdf" },
  { id: "d3", name: "ai.pdf", sharedWith: [], type: "pdf" },
];

const MANAGERS = [
  { id: "m1", name: "Rahul Sharma" },
  { id: "m2", name: "Priya Gupta" },
];

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function OnboardingPage() {
  const [role, setRole] = useState<Role>(null);
  const [employees, setEmployees] = useState<Employee[]>(INITIAL_EMPLOYEES);
  const [documents, setDocuments] = useState<Document[]>(INITIAL_DOCS);
  const [currentManagerId, setCurrentManagerId] = useState("m1");
  const [currentEmployeeId, setCurrentEmployeeId] = useState("e1");

  // Picks up candidates handed off by the Agentic Hiring Pipeline demo (/hiring-automation)
  // so they show up here as real new employees instead of staying siloed in that page.
  // sessionStorage doesn't exist during SSR, so this reads via useSyncExternalStore (server
  // snapshot = []) rather than an effect, avoiding a hydration mismatch on first paint.
  const syncedHires = useSyncExternalStore(subscribeSyncedHires, getSyncedHiresSnapshot, getSyncedHiresServerSnapshot);
  const [appliedSynced, setAppliedSynced] = useState<SyncedHire[] | null>(null);

  // Merges newly-synced hires into `employees` the moment the store snapshot changes.
  // This runs during render (React's documented "adjusting state" pattern), guarded by
  // reference equality so it only fires once per distinct sync payload — not in an effect,
  // so there's no extra post-mount render flash.
  if (syncedHires !== appliedSynced) {
    setAppliedSynced(syncedHires);
    if (syncedHires.length > 0) {
      const existingIds = new Set(employees.map((e) => e.id));
      const additions: Employee[] = syncedHires
        .filter((h) => !existingIds.has(h.id))
        .map((h) => ({
          id: h.id,
          name: h.name,
          email: h.email,
          designation: h.designation,
          managerId: "m1",
          sharedDocs: [],
          repoAccess: Object.fromEntries(REPOS.map((r) => [r, "not_granted" as RepoStatus])),
          source: "Agentic Hiring Pipeline",
        }));
      if (additions.length > 0) setEmployees((prev) => [...prev, ...additions]);
    }
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      {/* PAGE HEADER */}
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Employee Onboarding</span>
          </div>
          {role && (
            <button
              onClick={() => setRole(null)}
              className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors"
            >
              Switch Role
            </button>
          )}
        </div>
      </div>

      {/* ROLE SELECTOR */}
      <AnimatePresence>
        {!role && (
          <RoleSelector
            onSelect={(r, opts) => {
              setRole(r);
              if (r === "manager" && opts?.managerId) setCurrentManagerId(opts.managerId);
              if (r === "employee" && opts?.employeeId) setCurrentEmployeeId(opts.employeeId);
            }}
            employees={employees}
          />
        )}
      </AnimatePresence>

      {/* PORTALS */}
      {role === "hr" && (
        <HRPortal
          employees={employees}
          setEmployees={setEmployees}
          documents={documents}
          setDocuments={setDocuments}
        />
      )}
      {role === "manager" && (
        <ManagerPortal
          employees={employees}
          setEmployees={setEmployees}
          managerId={currentManagerId}
        />
      )}
      {role === "employee" && (
        <EmployeePortal
          employee={employees.find(e => e.id === currentEmployeeId) || employees[0]}
          documents={documents}
          setEmployees={setEmployees}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROLE SELECTOR
   ═══════════════════════════════════════════════════════════ */

function RoleSelector({ onSelect, employees }: {
  onSelect: (role: Role, opts?: { managerId?: string; employeeId?: string }) => void;
  employees: Employee[];
}) {
  const roles = [
    { key: "hr" as Role, label: "Login as HR", desc: "Manage employees, documents, and assignments", icon: <Shield className="w-6 h-6" />, color: "blue" },
    { key: "manager" as Role, label: "Login as Manager", desc: "Approve access, manage team and repos", icon: <Briefcase className="w-6 h-6" />, color: "indigo" },
    { key: "employee" as Role, label: "Login as Employee", desc: "View shared docs, repo access, onboarding", icon: <User className="w-6 h-6" />, color: "emerald" },
  ];

  const [subSelect, setSubSelect] = useState<"manager" | "employee" | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="max-w-3xl mx-auto px-4 sm:px-6 py-16"
    >
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-200 bg-zinc-50 mb-4">
          <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span className="text-[11px] font-mono font-bold text-zinc-600">ONBOARDING AGENT READY</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 mb-2">Choose Your Portal</h1>
        <p className="text-sm text-zinc-500">Select a role to access the onboarding dashboard</p>
      </div>

      {!subSelect ? (
        <div className="grid sm:grid-cols-3 gap-4">
          {roles.map((r, i) => (
            <motion.button
              key={r.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              onClick={() => {
                if (r.key === "hr") onSelect("hr");
                else if (r.key === "manager") setSubSelect("manager");
                else setSubSelect("employee");
              }}
              className="p-6 rounded-2xl bg-white border border-zinc-200 hover:border-blue-400 hover:shadow-md transition-all text-left group"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 mb-4 group-hover:scale-105 transition-transform">
                {r.icon}
              </div>
              <h3 className="text-sm font-bold text-zinc-900 mb-1">{r.label}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">{r.desc}</p>
            </motion.button>
          ))}
        </div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <button onClick={() => setSubSelect(null)} className="text-xs text-blue-600 font-bold mb-4 flex items-center gap-1 hover:underline">
            <ArrowLeft className="w-3 h-3" /> Back to roles
          </button>
          <h3 className="text-sm font-bold text-zinc-900 mb-3">
            {subSelect === "manager" ? "Select a Manager" : "Select an Employee"}
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {subSelect === "manager" ? (
              MANAGERS.map(m => (
                <button
                  key={m.id}
                  onClick={() => onSelect("manager", { managerId: m.id })}
                  className="p-4 rounded-xl bg-white border border-zinc-200 hover:border-blue-400 hover:shadow-sm transition-all text-left flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 text-xs font-bold">
                    {m.name.split(" ").map(w => w[0]).join("")}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-900">{m.name}</div>
                    <div className="text-[11px] text-zinc-500">Engineering Manager</div>
                  </div>
                </button>
              ))
            ) : (
              employees.map(e => (
                <button
                  key={e.id}
                  onClick={() => onSelect("employee", { employeeId: e.id })}
                  className="p-4 rounded-xl bg-white border border-zinc-200 hover:border-blue-400 hover:shadow-sm transition-all text-left flex items-center gap-3"
                >
                  <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 text-xs font-bold">
                    {e.name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-900">{e.name}</div>
                    <div className="text-[11px] text-zinc-500">{e.designation}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HR PORTAL
   ═══════════════════════════════════════════════════════════ */

function HRPortal({ employees, setEmployees, documents, setDocuments }: {
  employees: Employee[];
  setEmployees: (fn: (prev: Employee[]) => Employee[]) => void;
  documents: Document[];
  setDocuments: (fn: (prev: Document[]) => Document[]) => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", email: "", designation: "", managerId: "" });
  const [formError, setFormError] = useState("");
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const [notification, setNotification] = useState("");

  // Onboarding knowledge attachments — PDFs, article links, previous blog links
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [articleInput, setArticleInput] = useState("");
  const [articleLinks, setArticleLinks] = useState<string[]>([]);
  const [blogInput, setBlogInput] = useState("");
  const [blogLinks, setBlogLinks] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showNotif = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(""), 2500); };

  const resetForm = () => {
    setFormData({ name: "", email: "", designation: "", managerId: "" });
    setPdfFiles([]);
    setArticleInput(""); setArticleLinks([]);
    setBlogInput(""); setBlogLinks([]);
    setFormError("");
  };

  const addPdfFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    setPdfFiles(prev => [...prev, ...incoming]);
  };

  const addLink = (kind: "article" | "blog") => {
    const value = (kind === "article" ? articleInput : blogInput).trim();
    if (!value) return;
    if (kind === "article") { setArticleLinks(prev => [...prev, value]); setArticleInput(""); }
    else { setBlogLinks(prev => [...prev, value]); setBlogInput(""); }
  };

  // Pushes uploaded PDFs / article / blog links into the shared Document Library, tied to the new hire
  const attachKnowledgeToEmployee = async (empId: string, empName: string) => {
    const uploadedDocs: Document[] = [];

    if (pdfFiles.length > 0) {
      try {
        const fd = new FormData();
        pdfFiles.forEach(f => fd.append("files", f));
        const res = await fetch(`${API_URL}/api/v1/upload`, { method: "POST", headers: getAuthHeaders(), body: fd });
        if (res.ok) {
          const data = await res.json();
          for (const r of data.results || []) {
            if (r.document_id) uploadedDocs.push({ id: r.document_id, name: r.filename, sharedWith: [empId], type: "pdf" });
          }
        }
      } catch {
        // Backend unreachable — attachments are recorded locally so onboarding can still proceed.
        pdfFiles.forEach(f => uploadedDocs.push({ id: `d${Date.now()}-${f.name}`, name: f.name, sharedWith: [empId], type: "pdf" }));
      }
    }

    const addLinksOfType = async (links: string[], kind: "article" | "blog") => {
      for (const url of links) {
        try {
          const res = await fetch(`${API_URL}/api/v1/upload-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ url }),
          });
          if (res.ok) {
            const data = await res.json();
            uploadedDocs.push({ id: data.document_id || `d${Date.now()}-${url}`, name: url, sharedWith: [empId], type: kind, url });
          } else {
            uploadedDocs.push({ id: `d${Date.now()}-${url}`, name: url, sharedWith: [empId], type: kind, url });
          }
        } catch {
          uploadedDocs.push({ id: `d${Date.now()}-${url}`, name: url, sharedWith: [empId], type: kind, url });
        }
      }
    };

    await addLinksOfType(articleLinks, "article");
    await addLinksOfType(blogLinks, "blog");

    if (uploadedDocs.length > 0) {
      setDocuments(prev => [...prev, ...uploadedDocs]);
      setEmployees(prev => prev.map(e => e.id === empId ? { ...e, sharedDocs: [...e.sharedDocs, ...uploadedDocs.map(d => d.name)] } : e));
      showNotif(`${uploadedDocs.length} resource(s) shared with ${empName}.`);
    }
  };

  const addEmployee = async () => {
    setFormError("");
    if (!formData.name.trim() || !formData.email.trim() || !formData.designation || !formData.managerId) {
      setFormError("All fields are required."); return;
    }
    if (employees.some(e => e.email.toLowerCase() === formData.email.toLowerCase())) {
      setFormError("Employee with this email already exists."); return;
    }
    const newEmp: Employee = {
      id: `e${Date.now()}`,
      name: formData.name.trim(),
      email: formData.email.trim(),
      designation: formData.designation,
      managerId: formData.managerId,
      sharedDocs: [],
      repoAccess: Object.fromEntries(REPOS.map(r => [r, "not_granted" as RepoStatus])),
    };
    setEmployees(prev => [...prev, newEmp]);
    showNotif(`${newEmp.name} added successfully.`);
    setShowAddForm(false);

    const hasAttachments = pdfFiles.length > 0 || articleLinks.length > 0 || blogLinks.length > 0;
    if (hasAttachments) {
      setIsSubmitting(true);
      await attachKnowledgeToEmployee(newEmp.id, newEmp.name);
      setIsSubmitting(false);
    }
    resetForm();
  };

  const shareDoc = (docId: string, empId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (doc?.sharedWith.includes(empId)) { showNotif("Already shared with this employee."); return; }
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, sharedWith: [...d.sharedWith, empId] } : d));
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, sharedDocs: [...e.sharedDocs, doc!.name] } : e));
    showNotif("Document shared.");
    setShareTarget(null);
  };

  const assignManager = (empId: string, managerId: string) => {
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, managerId } : e));
    showNotif("Manager assigned.");
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 right-4 sm:right-8 z-40 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shadow-lg"
          >
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5" />{notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-extrabold text-zinc-900">HR Dashboard</h2>
          </div>
          <p className="text-xs text-zinc-500">Manage employees, documents, and access permissions</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm self-start"
        >
          <Plus className="w-4 h-4" /> Add Employee
        </button>
      </div>

      {/* Add Employee Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-6"
          >
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-900">New Employee</h3>
                <button onClick={() => { setShowAddForm(false); setFormError(""); }} className="text-zinc-400 hover:text-zinc-700"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 mb-3">
                <input placeholder="Full Name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  className="px-3 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10" />
                <input placeholder="Email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                  className="px-3 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10" />
                <select value={formData.designation} onChange={e => setFormData(p => ({ ...p, designation: e.target.value }))}
                  className="px-3 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-sm focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">Designation</option>
                  <option>AI Developer</option>
                  <option>UI Designer</option>
                  <option>MERN Stack Developer</option>
                  <option>Software Developer</option>
                </select>
                <select value={formData.managerId} onChange={e => setFormData(p => ({ ...p, managerId: e.target.value }))}
                  className="px-3 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-sm focus:outline-none focus:border-blue-400 appearance-none">
                  <option value="">Reporting Manager</option>
                  {MANAGERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              {/* Onboarding Knowledge Attachments */}
              <div className="pt-3 mt-1 border-t border-zinc-100 space-y-3">
                <h4 className="text-xs font-bold text-zinc-700 flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5 text-blue-600" />Onboarding Resources (optional)</h4>

                <div className="grid sm:grid-cols-3 gap-3">
                  {/* PDFs */}
                  <div>
                    <label className="flex flex-col items-center justify-center gap-1 px-3 py-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-colors text-center">
                      <Upload className="w-4 h-4" />
                      <span className="text-[11px] font-bold">PDF / Multiple PDFs</span>
                      <input type="file" accept=".pdf" multiple className="hidden" onChange={e => addPdfFiles(e.target.files)} />
                    </label>
                    {pdfFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {pdfFiles.map((f, i) => (
                          <span key={`${f.name}-${i}`} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 flex items-center gap-1">
                            <FileText className="w-2.5 h-2.5" />{f.name}
                            <button type="button" onClick={() => setPdfFiles(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-600"><X className="w-2.5 h-2.5" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Article Links */}
                  <div>
                    <div className="flex items-center gap-1">
                      <input
                        placeholder="Article link"
                        value={articleInput}
                        onChange={e => setArticleInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink("article"); } }}
                        className="flex-1 min-w-0 px-2.5 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-xs focus:outline-none focus:border-blue-400"
                      />
                      <button type="button" onClick={() => addLink("article")} className="p-2.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-600 hover:bg-blue-50 hover:text-blue-600 shrink-0">
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {articleLinks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {articleLinks.map((link, i) => (
                          <span key={`${link}-${i}`} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center gap-1 max-w-full">
                            <Link2 className="w-2.5 h-2.5 shrink-0" /><span className="truncate max-w-[110px]">{link}</span>
                            <button type="button" onClick={() => setArticleLinks(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-600"><X className="w-2.5 h-2.5" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Previous Blogs */}
                  <div>
                    <div className="flex items-center gap-1">
                      <input
                        placeholder="Previous blog link"
                        value={blogInput}
                        onChange={e => setBlogInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink("blog"); } }}
                        className="flex-1 min-w-0 px-2.5 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-xs focus:outline-none focus:border-blue-400"
                      />
                      <button type="button" onClick={() => addLink("blog")} className="p-2.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-600 hover:bg-blue-50 hover:text-blue-600 shrink-0">
                        <Newspaper className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {blogLinks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {blogLinks.map((link, i) => (
                          <span key={`${link}-${i}`} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-1 max-w-full">
                            <Newspaper className="w-2.5 h-2.5 shrink-0" /><span className="truncate max-w-[110px]">{link}</span>
                            <button type="button" onClick={() => setBlogLinks(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-600"><X className="w-2.5 h-2.5" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {formError && <p className="text-xs text-red-600 font-bold mt-3 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{formError}</p>}
              <button
                onClick={addEmployee}
                disabled={isSubmitting}
                className="mt-4 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isSubmitting ? "Sharing resources…" : "Create Employee"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Employee List */}
        <div className="lg:col-span-3 space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" />Employees ({employees.length})</h3>
          <div className="space-y-2">
            {employees.map(emp => (
              <div key={emp.id} className="p-4 rounded-xl bg-white border border-zinc-200 hover:border-blue-300 transition-all">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                      {emp.name[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-bold text-zinc-900 truncate">{emp.name}</span>
                        {emp.source && (
                          <span title={emp.source} className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
                            <Sparkles className="w-2.5 h-2.5" /> New Hire
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500">{emp.designation}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">
                      {emp.managerId ? MANAGERS.find(m => m.id === emp.managerId)?.name || "—" : "Unassigned"}
                    </span>
                    {!emp.managerId && (
                      <select
                        onChange={e => { if (e.target.value) assignManager(emp.id, e.target.value); }}
                        className="text-[10px] px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-bold appearance-none cursor-pointer"
                        defaultValue=""
                      >
                        <option value="" disabled>Assign</option>
                        {MANAGERS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                {emp.sharedDocs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {emp.sharedDocs.map(d => (
                      <span key={d} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Document Library */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2"><FolderOpen className="w-4 h-4 text-blue-600" />Document Library</h3>
          <div className="space-y-2">
            {documents.map(doc => {
              const docIcon = doc.type === "article" ? <Link2 className="w-4 h-4 text-indigo-600 shrink-0" />
                : doc.type === "blog" ? <Newspaper className="w-4 h-4 text-emerald-600 shrink-0" />
                : <FileText className="w-4 h-4 text-blue-600 shrink-0" />;
              return (
              <div key={doc.id} className="p-4 rounded-xl bg-white border border-zinc-200">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {docIcon}
                    {doc.url ? (
                      <a href={doc.url} target="_blank" rel="noreferrer" className="text-sm font-bold text-zinc-900 hover:text-blue-600 truncate">{doc.name}</a>
                    ) : (
                      <span className="text-sm font-bold text-zinc-900 truncate">{doc.name}</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShareTarget(shareTarget === doc.id ? null : doc.id)}
                    className="p-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {doc.sharedWith.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {doc.sharedWith.map(eid => {
                      const emp = employees.find(e => e.id === eid);
                      return emp ? (
                        <span key={eid} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600 flex items-center gap-1">
                          <Eye className="w-2.5 h-2.5" /> {emp.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                <AnimatePresence>
                  {shareTarget === doc.id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="pt-2 border-t border-zinc-100 space-y-1">
                        {employees.map(emp => {
                          const already = doc.sharedWith.includes(emp.id);
                          return (
                            <button
                              key={emp.id}
                              onClick={() => !already && shareDoc(doc.id, emp.id)}
                              disabled={already}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between transition-all ${
                                already ? "bg-emerald-50 text-emerald-700 cursor-default" : "bg-zinc-50 text-zinc-700 hover:bg-blue-50 hover:text-blue-700"
                              }`}
                            >
                              <span>{emp.name}</span>
                              {already ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3 h-3 text-zinc-400" />}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MANAGER PORTAL
   ═══════════════════════════════════════════════════════════ */

function ManagerPortal({ employees, setEmployees, managerId }: {
  employees: Employee[];
  setEmployees: (fn: (prev: Employee[]) => Employee[]) => void;
  managerId: string;
}) {
  const manager = MANAGERS.find(m => m.id === managerId)!;
  const teamEmployees = employees.filter(e => e.managerId === managerId);
  const [notification, setNotification] = useState("");
  const showNotif = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(""), 2500); };

  // Managers only ever approve a pending request — the request itself is raised by the employee,
  // keeping both portals reading/writing the same `employees` state in sync.
  const approveAccess = (empId: string, repo: string) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp || emp.repoAccess[repo] !== "pending") return;
    setEmployees(prev => prev.map(e => e.id === empId
      ? { ...e, repoAccess: { ...e.repoAccess, [repo]: "granted" } }
      : e
    ));
    showNotif(`${repo} access granted to ${emp.name}.`);
  };

  const statusPill = (status: RepoStatus) => {
    const map = {
      not_granted: { bg: "bg-zinc-100 border-zinc-200 text-zinc-600", label: "Not Granted" },
      pending: { bg: "bg-amber-50 border-amber-200 text-amber-700", label: "Pending" },
      granted: { bg: "bg-emerald-50 border-emerald-200 text-emerald-700", label: "Granted" },
    };
    const s = map[status];
    return <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${s.bg}`}>{s.label}</span>;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 right-4 sm:right-8 z-40 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shadow-lg"
          >
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5" />{notification}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Briefcase className="w-5 h-5 text-indigo-600" />
          <h2 className="text-xl font-extrabold text-zinc-900">Manager Portal — {manager.name}</h2>
        </div>
        <p className="text-xs text-zinc-500">Manage team access, review repo permissions, and approve onboarding</p>
      </div>

      {/* Team */}
      <div className="mb-8">
        <h3 className="text-sm font-bold text-zinc-900 mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-blue-600" />Team Members ({teamEmployees.length})</h3>
        {teamEmployees.length === 0 ? (
          <p className="text-xs text-zinc-500 p-4 bg-zinc-50 rounded-xl border border-zinc-200">No employees assigned to you yet.</p>
        ) : (
          <div className="space-y-3">
            {teamEmployees.map(emp => (
              <div key={emp.id} className="p-4 rounded-xl bg-white border border-zinc-200">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 text-xs font-bold shrink-0">
                    {emp.name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-zinc-900">{emp.name}</div>
                    <div className="text-[11px] text-zinc-500">{emp.designation}</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {REPOS.map(repo => (
                    <div key={repo} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200/80">
                      <div className="flex items-center gap-2">
                        <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                        <span className="text-xs font-bold text-zinc-800">{repo}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {statusPill(emp.repoAccess[repo])}
                        {emp.repoAccess[repo] === "pending" && (
                          <button
                            onClick={() => approveAccess(emp.id, repo)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   EMPLOYEE PORTAL
   ═══════════════════════════════════════════════════════════ */

function EmployeePortal({ employee, documents, setEmployees }: {
  employee: Employee;
  documents: Document[];
  setEmployees: (fn: (prev: Employee[]) => Employee[]) => void;
}) {
  const sharedDocs = documents.filter(d => d.sharedWith.includes(employee.id));
  const [notification, setNotification] = useState("");
  const showNotif = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(""), 2500); };

  // Employee raises the request; the manager portal (reading the same `employees` state) approves it.
  const requestAccess = (repo: string) => {
    if (employee.repoAccess[repo] !== "not_granted") return;
    setEmployees(prev => prev.map(e => e.id === employee.id
      ? { ...e, repoAccess: { ...e.repoAccess, [repo]: "pending" } }
      : e
    ));
    showNotif(`Access request for ${repo} sent to your manager.`);
  };

  const totalSteps = 4;
  const completedSteps = [
    sharedDocs.length > 0,
    Object.values(employee.repoAccess).some(s => s === "granted"),
    !!employee.managerId,
    employee.designation !== "",
  ].filter(Boolean).length;
  const progress = Math.round((completedSteps / totalSteps) * 100);

  const statusPill = (status: RepoStatus) => {
    const map = {
      not_granted: { bg: "bg-zinc-100 border-zinc-200 text-zinc-600", icon: <XCircle className="w-3 h-3" />, label: "Not Granted" },
      pending: { bg: "bg-amber-50 border-amber-200 text-amber-700", icon: <Clock className="w-3 h-3" />, label: "Pending" },
      granted: { bg: "bg-emerald-50 border-emerald-200 text-emerald-700", icon: <CheckCircle2 className="w-3 h-3" />, label: "Granted" },
    };
    const s = map[status];
    return <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${s.bg}`}>{s.icon}{s.label}</span>;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <AnimatePresence>
        {notification && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="fixed top-16 right-4 sm:right-8 z-40 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shadow-lg"
          >
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5" />{notification}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile */}
      <div className="p-6 rounded-2xl bg-white border border-zinc-200 mb-6">
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 text-xl font-bold shrink-0">
            {employee.name[0]}
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-zinc-900">{employee.name}</h2>
            <p className="text-xs text-zinc-500">{employee.designation} · {employee.email}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Manager: {employee.managerId ? MANAGERS.find(m => m.id === employee.managerId)?.name || "—" : "Unassigned"}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-700">Onboarding Progress</span>
          <span className="text-xs font-mono font-bold text-blue-600">{progress}%</span>
        </div>
        <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full bg-blue-600 rounded-full" />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Shared Documents */}
        <div>
          <h3 className="text-sm font-bold text-zinc-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-blue-600" />Shared Documents</h3>
          {sharedDocs.length === 0 ? (
            <p className="text-xs text-zinc-500 p-4 bg-zinc-50 rounded-xl border border-zinc-200">No documents shared with you yet.</p>
          ) : (
            <div className="space-y-2">
              {sharedDocs.map(doc => (
                <div key={doc.id} className="p-3 rounded-xl bg-white border border-zinc-200 flex items-center gap-3">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-medium text-zinc-900">{doc.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Repo Access */}
        <div>
          <h3 className="text-sm font-bold text-zinc-900 mb-3 flex items-center gap-2"><GitBranch className="w-4 h-4 text-blue-600" />Repository Access</h3>
          <div className="space-y-2">
            {REPOS.map(repo => (
              <div key={repo} className="p-3 rounded-xl bg-white border border-zinc-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-900">{repo}</span>
                </div>
                <div className="flex items-center gap-2">
                  {statusPill(employee.repoAccess[repo])}
                  {employee.repoAccess[repo] === "not_granted" && (
                    <button
                      onClick={() => requestAccess(repo)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Request Access
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
