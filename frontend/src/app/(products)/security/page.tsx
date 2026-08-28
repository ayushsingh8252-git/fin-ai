"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, KeyRound, ScrollText, Activity, DatabaseBackup, UploadCloud,
  Folder, FolderOpen, File, ChevronDown, Clock, Users, Cpu, Check,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

/* ═══════════════════════════════════════════════════════════
   TEAM DIRECTORY
   One shared roster — RBAC membership, audit entries, and activity
   alerts below all reference these same people by id, so role changes
   made in the RBAC panel immediately propagate everywhere they appear.
   ═══════════════════════════════════════════════════════════ */

interface TeamMember { id: string; name: string; email: string; role: string; color: string }

const INITIAL_TEAM: TeamMember[] = [
  { id: "u1", name: "Ayush Singh", email: "ayush@company.com", role: "Super Admin", color: "bg-blue-50 border-blue-200 text-blue-600" },
  { id: "u2", name: "Priya Gupta", email: "priya@company.com", role: "HR Admin", color: "bg-purple-50 border-purple-200 text-purple-600" },
  { id: "u3", name: "Rahul Sharma", email: "rahul@company.com", role: "Payroll Manager", color: "bg-amber-50 border-amber-200 text-amber-700" },
  { id: "u4", name: "Krrish", email: "krrish@company.com", role: "Employee", color: "bg-emerald-50 border-emerald-200 text-emerald-600" },
  { id: "u5", name: "Ketan", email: "ketan@company.com", role: "Team Lead", color: "bg-indigo-50 border-indigo-200 text-indigo-600" },
  { id: "u6", name: "Shreaya Singh", email: "shreaya@company.com", role: "Recruiter", color: "bg-pink-50 border-pink-200 text-pink-600" },
  { id: "u7", name: "Neha Kapoor", email: "neha@company.com", role: "Auditor", color: "bg-zinc-100 border-zinc-300 text-zinc-600" },
];

const findUser = (team: TeamMember[], id?: string) => (id ? team.find((u) => u.id === id) : undefined);

/* ═══════════════════════════════════════════════════════════
   RBAC ROLE DEFINITIONS — membership is derived live from the team
   roster (filter by role) rather than hardcoded per role, so the
   roster and the RBAC panel can never drift out of sync.
   ═══════════════════════════════════════════════════════════ */

const RBAC_ROLES: { name: string; desc: string }[] = [
  { name: "Super Admin", desc: "Unrestricted access across every module, tenant, and billing setting. Can create or revoke any other role." },
  { name: "Organization Admin", desc: "Manages org-wide settings, SSO / integrations, and user provisioning." },
  { name: "HR Admin", desc: "Full access to employee records, payroll configuration, and compliance reporting." },
  { name: "HR Executive", desc: "Manages the employee lifecycle — onboarding, leave, and document workflows." },
  { name: "Recruiter", desc: "Access to job postings, candidate pipelines, and interview scheduling." },
  { name: "Payroll Manager", desc: "Processes payroll runs and approves salary or compensation changes." },
  { name: "Team Lead", desc: "Approves leave and timesheets, and views performance for direct reports only." },
  { name: "Employee", desc: "Self-service access: own profile, payslips, leave requests, and policies." },
  { name: "Auditor", desc: "Read-only access to audit logs, compliance reports, and access history." },
  { name: "Read-only Roles", desc: "View-only dashboards for stakeholders, with no edit permissions." },
];

type Status = "success" | "flagged" | "blocked";

interface LogEntry { userId?: string; time: string; meta: string; status: Status }

const AUDIT_ENTRIES: Record<string, LogEntry[]> = {
  "Login": [
    { userId: "u1", time: "2 min ago", meta: "IP 103.21.244.10 · Chrome on Windows", status: "success" },
    { userId: "u4", time: "18 min ago", meta: "IP 49.207.12.88 · Safari on macOS", status: "success" },
  ],
  "Logout": [
    { userId: "u3", time: "34 min ago", meta: "Session duration 2h 14m", status: "success" },
  ],
  "Failed Login": [
    { userId: "u5", time: "1 hr ago", meta: "3 consecutive attempts · IP 182.65.0.44", status: "flagged" },
  ],
  "Password Change": [
    { userId: "u2", time: "Yesterday, 4:12 PM", meta: "Self-service reset via email link", status: "success" },
  ],
  "Salary Edited": [
    { userId: "u3", time: "Yesterday, 11:05 AM", meta: "Adjusted base salary for 1 employee", status: "flagged" },
  ],
  "Employee Created": [
    { userId: "u2", time: "2 days ago", meta: "Onboarded ‘Shreaya Singh’ as Recruiter", status: "success" },
  ],
  "Leave Approved": [
    { userId: "u5", time: "2 days ago", meta: "Approved 3-day leave for Krrish", status: "success" },
  ],
  "Document Downloaded": [
    { userId: "u7", time: "3 days ago", meta: "Downloaded Q3 compliance report", status: "success" },
  ],
  "Report Exported": [
    { userId: "u1", time: "4 days ago", meta: "Exported payroll summary (CSV)", status: "success" },
  ],
  "Permission Changed": [
    { userId: "u1", time: "5 days ago", meta: "Granted ‘Auditor’ role to Neha Kapoor", status: "flagged" },
  ],
};

const ACTIVITY_ENTRIES: Record<string, LogEntry[]> = {
  "Multiple Failed Logins": [{ userId: "u5", time: "1 hr ago", meta: "5 attempts in 3 minutes", status: "flagged" }],
  "Impossible Travel": [{ userId: "u2", time: "Yesterday", meta: "Login from Mumbai then Berlin within 20 minutes", status: "blocked" }],
  "New Device Login": [{ userId: "u4", time: "3 hrs ago", meta: "First login from an unrecognized iPhone", status: "flagged" }],
  "Suspicious IP": [{ userId: "u5", time: "1 hr ago", meta: "IP flagged on threat-intel blocklist", status: "blocked" }],
  "Mass Downloads": [{ userId: "u7", time: "6 hrs ago", meta: "42 documents downloaded in 5 minutes", status: "flagged" }],
  "Bulk Employee Export": [{ userId: "u1", time: "Yesterday", meta: "Exported full employee directory (312 records)", status: "flagged" }],
  "Payroll Modification": [{ userId: "u3", time: "2 days ago", meta: "Bulk salary adjustment for 8 employees", status: "flagged" }],
  "Permission Escalation": [{ userId: "u2", time: "3 days ago", meta: "Self-granted ‘Organization Admin’ scope", status: "blocked" }],
};

const BACKUP_ENTRIES: Record<string, LogEntry[]> = {
  "Automatic Daily Backups": [{ time: "Today, 2:00 AM", meta: "4.8 GB snapshot · us-east-1", status: "success" }],
  "Point-in-Time Recovery": [{ time: "Always available", meta: "Restore to any point within the last 35 days", status: "success" }],
  "Multi-Region Replication": [{ time: "Continuous", meta: "Synced to eu-west-1 and ap-south-1", status: "success" }],
  "Disaster Recovery Plan": [{ time: "Reviewed 12 days ago", meta: "RTO 4h · RPO 15min", status: "success" }],
  "Backup Encryption": [{ time: "Always on", meta: "AES-256 at rest, TLS 1.3 in transit", status: "success" }],
  "Restore Testing": [{ userId: "u1", time: "7 days ago", meta: "Quarterly restore drill completed successfully", status: "success" }],
};

const UPLOAD_ENTRIES: Record<string, LogEntry[]> = {
  "Malware Scanning": [{ userId: "u4", time: "10 min ago", meta: "resume.pdf · scanned clean", status: "success" }],
  "Allowed File Types": [{ time: "Policy", meta: ".pdf, .docx, .png, .jpg, .csv only", status: "success" }],
  "File Size Limits": [{ time: "Policy", meta: "25 MB max per file, 200 MB per upload batch", status: "success" }],
  "Duplicate Detection": [{ userId: "u6", time: "1 hr ago", meta: "Duplicate of ‘offer_letter_v2.pdf’ auto-merged", status: "flagged" }],
  "OCR Validation (optional)": [{ time: "Enabled", meta: "Text extraction verified on 128 documents this week", status: "success" }],
  "Content Validation": [{ userId: "u5", time: "2 hrs ago", meta: "Blocked ‘payroll.exe’ — disallowed executable", status: "blocked" }],
};

const SECURITY_FOLDERS = [
  { id: "rbac", label: "Role Based Access Control (RBAC)", icon: <KeyRound className="w-4 h-4" />, description: "10 roles govern exactly what each person can see and do.", items: RBAC_ROLES.map((r) => r.name) },
  { id: "audit", label: "Audit Logs", icon: <ScrollText className="w-4 h-4" />, description: "Every sensitive action is logged with who, when, and from where.", items: Object.keys(AUDIT_ENTRIES) },
  { id: "activity", label: "Activity Monitoring", icon: <Activity className="w-4 h-4" />, description: "Real-time detection surfaces risky behavior as it happens.", items: Object.keys(ACTIVITY_ENTRIES) },
  { id: "backup", label: "Backup & Disaster Recovery", icon: <DatabaseBackup className="w-4 h-4" />, description: "Automated, encrypted, and regularly tested backups.", items: Object.keys(BACKUP_ENTRIES) },
  { id: "uploads", label: "Secure File Uploads", icon: <UploadCloud className="w-4 h-4" />, description: "Every upload is scanned, validated, and constrained by policy.", items: Object.keys(UPLOAD_ENTRIES) },
];

/* ═══════════════════════════════════════════════════════════
   SHARED BITS
   ═══════════════════════════════════════════════════════════ */

const STATUS_TONE: Record<Status, StatusTone> = {
  success: "success",
  flagged: "warning",
  blocked: "danger",
};
const STATUS_ICON: Record<Status, React.ReactNode> = {
  success: <CheckCircle2 className="w-3 h-3" />,
  flagged: <AlertTriangle className="w-3 h-3" />,
  blocked: <XCircle className="w-3 h-3" />,
};

function SecurityStatusPill({ status }: { status: Status }) {
  return (
    <StatusPill tone={STATUS_TONE[status]} className="font-mono shrink-0">
      {STATUS_ICON[status]}
      {status.toUpperCase()}
    </StatusPill>
  );
}

function UserChip({ user }: { user?: TeamMember }) {
  if (!user) return null;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border shrink-0 ${user.color}`}>{user.name[0]}</span>
      <span className="font-semibold text-zinc-800 truncate">{user.name}</span>
    </span>
  );
}

function RolePicker({ role, team, onToggleRole }: { role: string; team: TeamMember[]; onToggleRole: (userId: string, role: string) => void }) {
  return (
    <div className="space-y-1.5">
      {team.map((u) => {
        const checked = u.role === role;
        return (
          <button
            key={u.id}
            onClick={() => onToggleRole(u.id, role)}
            className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all ${
              checked ? "bg-blue-50 border-blue-300" : "bg-white border-zinc-200 hover:border-blue-200 hover:bg-zinc-50"
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 ${u.color}`}>{u.name[0]}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-zinc-800 truncate">{u.name}</span>
                <span className="block text-[11px] text-zinc-400 truncate">{u.email}</span>
              </span>
            </span>
            <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${checked ? "bg-blue-600 border-blue-600" : "bg-white border-zinc-300"}`}>
              {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EntryDetail({
  folderId, item, team, onToggleRole,
}: {
  folderId: string;
  item: string;
  team: TeamMember[];
  onToggleRole: (userId: string, role: string) => void;
}) {
  if (folderId === "rbac") {
    const role = RBAC_ROLES.find((r) => r.name === item);
    const memberCount = team.filter((u) => u.role === item).length;
    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-600 leading-relaxed">{role?.desc}</p>
        <div>
          <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
            Assigned team members ({memberCount}) — tap to grant or move this role
          </p>
          <RolePicker role={item} team={team} onToggleRole={onToggleRole} />
        </div>
      </div>
    );
  }

  const entryMap = folderId === "audit" ? AUDIT_ENTRIES : folderId === "activity" ? ACTIVITY_ENTRIES : folderId === "backup" ? BACKUP_ENTRIES : UPLOAD_ENTRIES;
  const entries = entryMap[item] ?? [];

  return (
    <div className="space-y-2.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white border border-zinc-200 shadow-xs">
          <div className="min-w-0">
            {e.userId ? (
              <div className="text-xs">
                <UserChip user={findUser(team, e.userId)} />
              </div>
            ) : (
              <div className="text-xs flex items-center gap-1.5 text-zinc-500 font-semibold">
                <Cpu className="w-3.5 h-3.5 shrink-0" /> System policy
              </div>
            )}
            <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{e.meta}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1"><Clock className="w-3 h-3" />{e.time}</span>
            <SecurityStatusPill status={e.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FolderItemList({
  folder, team, onToggleRole,
}: {
  folder: (typeof SECURITY_FOLDERS)[number];
  team: TeamMember[];
  onToggleRole: (userId: string, role: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(folder.items[0] ?? null);

  return (
    <div className="space-y-3">
      {folder.items.map((item) => {
        const isOpen = expanded === item;
        return (
          <div key={item} className={`rounded-2xl border bg-white overflow-hidden transition-shadow ${isOpen ? "border-blue-200 shadow-sm" : "border-zinc-200 shadow-xs"}`}>
            <button
              onClick={() => setExpanded(isOpen ? null : item)}
              className="w-full flex items-center justify-between gap-2 px-5 py-4 text-left hover:bg-zinc-50/80 transition-colors"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-zinc-800 min-w-0">
                <File className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="truncate">{item}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform ${isOpen ? "rotate-180 text-blue-600" : ""}`} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-t border-zinc-100"
                >
                  <div className="p-5 bg-zinc-50/60">
                    <EntryDetail folderId={folder.id} item={item} team={team} onToggleRole={onToggleRole} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════ */

export default function SecurityExplorerPage() {
  const [activeFolderId, setActiveFolderId] = useState(SECURITY_FOLDERS[0].id);
  const [team, setTeam] = useState<TeamMember[]>(INITIAL_TEAM);
  const [notification, setNotification] = useState("");
  const folder = SECURITY_FOLDERS.find((f) => f.id === activeFolderId) ?? SECURITY_FOLDERS[0];
  const totalItems = SECURITY_FOLDERS.reduce((n, f) => n + f.items.length, 0);

  const showNotif = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(""), 2500); };

  const toggleRole = (userId: string, role: string) => {
    const user = team.find((u) => u.id === userId);
    if (!user) return;
    const grantingRole = user.role !== role;
    setTeam((prev) => prev.map((u) => (u.id === userId ? { ...u, role: grantingRole ? role : "Unassigned" } : u)));
    showNotif(grantingRole ? `${user.name} is now ${role}.` : `${user.name} was removed from ${role}.`);
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      {/* PAGE HEADER */}
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Security & Compliance Explorer</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline">MONITORING ACTIVE</span>
          </div>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed top-20 right-4 sm:right-8 z-40 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold shadow-lg shadow-blue-600/20 flex items-center gap-2"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {notification}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        {/* Header */}
        <div className="mb-10">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
            Security & Compliance
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 mt-4 mb-3 tracking-tight">Enterprise Security Explorer</h1>
          <p className="text-[15px] text-zinc-500 leading-relaxed max-w-2xl">
            {SECURITY_FOLDERS.length} categories · {totalItems} tracked controls · {team.length} team members. Select a category, then a control, to inspect exactly how it is enforced — access, activity, and audit trails all reference the team directory below.
          </p>
        </div>

        {/* Team roster */}
        <div className="mb-10 p-5 sm:p-6 rounded-3xl bg-white border border-zinc-200/90 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Team & Role Assignments</h3>
              <p className="text-xs text-zinc-500">Open the RBAC category below to reassign anyone&rsquo;s role.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {team.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-zinc-50/70 border border-zinc-200">
                <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border shrink-0 ${u.color}`}>{u.name[0]}</span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-zinc-900 truncate">{u.name}</div>
                  <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${u.role === "Unassigned" ? "bg-zinc-100 border-zinc-200 text-zinc-400 italic" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
                    {u.role}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Explorer */}
        <div className="grid md:grid-cols-[300px_1fr] gap-8">
          {/* Folder nav */}
          <div className="space-y-2 md:sticky md:top-20 self-start">
            {SECURITY_FOLDERS.map((f) => {
              const isActive = f.id === activeFolderId;
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveFolderId(f.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3.5 rounded-2xl text-left text-sm font-semibold transition-all ${
                    isActive ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "bg-white border border-zinc-200 text-zinc-700 hover:border-blue-300 hover:shadow-sm"
                  }`}
                >
                  {isActive ? <FolderOpen className="w-4 h-4 shrink-0" /> : <Folder className="w-4 h-4 shrink-0 text-blue-500" />}
                  <span className="flex-1 min-w-0 truncate">{f.label}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0 ${isActive ? "bg-white/20" : "bg-zinc-100 text-zinc-500"}`}>{f.items.length}</span>
                </button>
              );
            })}
          </div>

          {/* Selected folder's items */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={folder.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
                    {folder.icon}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-zinc-900">{folder.label}</h2>
                    <p className="text-sm text-zinc-500">{folder.description}</p>
                  </div>
                </div>
                <FolderItemList folder={folder} team={team} onToggleRole={toggleRole} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
