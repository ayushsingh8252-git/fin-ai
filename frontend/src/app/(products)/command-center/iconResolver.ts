/* ═══════════════════════════════════════════════════════════════════════
   Icon & Category Resolver
   Maps connector/tool names → Lucide icon names + accent colors.
   Keyword-based — no need to manually register 1000+ tools.
   ═══════════════════════════════════════════════════════════════════════ */
import {
  MessageSquare, Mail, Calendar, Search, Shield, Phone, Brain, Globe,
  Database, Briefcase, UserCheck, FileText, Video, GitBranch, Bug,
  Cloud, Send, ClipboardCheck, ShieldCheck, Fingerprint, Mic, BarChart3,
  Zap, Settings, type LucideIcon,
} from "lucide-react";

export interface ConnectorMeta {
  icon: LucideIcon;
  color: string;         // Tailwind text color class
  bgColor: string;       // Tailwind bg color class  
  glowColor: string;     // CSS color for node glow
  borderColor: string;   // CSS border color
  label: string;         // Friendly display name
  category: string;      // Category label
}

/** Priority-ordered keyword → meta mapping. First match wins. */
const KEYWORD_MAP: Array<{ keywords: string[]; meta: Omit<ConnectorMeta, "label" | "category"> }> = [
  {
    keywords: ["whatsapp"],
    meta: { icon: MessageSquare, color: "text-emerald-400", bgColor: "bg-emerald-500/10", glowColor: "rgba(52,211,153,0.35)", borderColor: "rgba(52,211,153,0.25)" },
  },
  {
    keywords: ["gmail", "email", "mail"],
    meta: { icon: Mail, color: "text-red-400", bgColor: "bg-red-500/10", glowColor: "rgba(248,113,113,0.35)", borderColor: "rgba(248,113,113,0.25)" },
  },
  {
    keywords: ["calendar", "meet", "schedule"],
    meta: { icon: Calendar, color: "text-blue-400", bgColor: "bg-blue-500/10", glowColor: "rgba(96,165,250,0.35)", borderColor: "rgba(96,165,250,0.25)" },
  },
  {
    keywords: ["fraud", "integrity", "forensic"],
    meta: { icon: Shield, color: "text-amber-400", bgColor: "bg-amber-500/10", glowColor: "rgba(251,191,36,0.35)", borderColor: "rgba(251,191,36,0.25)" },
  },
  {
    keywords: ["telephonic", "phone", "call", "voice"],
    meta: { icon: Phone, color: "text-violet-400", bgColor: "bg-violet-500/10", glowColor: "rgba(167,139,250,0.35)", borderColor: "rgba(167,139,250,0.25)" },
  },
  {
    keywords: ["screening", "screen", "interview"],
    meta: { icon: ClipboardCheck, color: "text-cyan-400", bgColor: "bg-cyan-500/10", glowColor: "rgba(34,211,238,0.35)", borderColor: "rgba(34,211,238,0.25)" },
  },
  {
    keywords: ["hiring", "candidate", "ats", "recruit", "scorecard", "assignment"],
    meta: { icon: Briefcase, color: "text-blue-400", bgColor: "bg-blue-500/10", glowColor: "rgba(96,165,250,0.35)", borderColor: "rgba(96,165,250,0.25)" },
  },
  {
    keywords: ["verification", "verify", "identity"],
    meta: { icon: ShieldCheck, color: "text-teal-400", bgColor: "bg-teal-500/10", glowColor: "rgba(45,212,191,0.35)", borderColor: "rgba(45,212,191,0.25)" },
  },
  {
    keywords: ["voice_id", "speaker", "fingerprint"],
    meta: { icon: Fingerprint, color: "text-pink-400", bgColor: "bg-pink-500/10", glowColor: "rgba(244,114,182,0.35)", borderColor: "rgba(244,114,182,0.25)" },
  },
  {
    keywords: ["rag", "document", "knowledge", "query"],
    meta: { icon: Database, color: "text-indigo-400", bgColor: "bg-indigo-500/10", glowColor: "rgba(129,140,248,0.35)", borderColor: "rgba(129,140,248,0.25)" },
  },
  {
    keywords: ["slack"],
    meta: { icon: MessageSquare, color: "text-purple-400", bgColor: "bg-purple-500/10", glowColor: "rgba(192,132,252,0.35)", borderColor: "rgba(192,132,252,0.25)" },
  },
  {
    keywords: ["teams", "microsoft"],
    meta: { icon: Video, color: "text-blue-400", bgColor: "bg-blue-500/10", glowColor: "rgba(96,165,250,0.35)", borderColor: "rgba(96,165,250,0.25)" },
  },
  {
    keywords: ["jira", "issue"],
    meta: { icon: Bug, color: "text-blue-400", bgColor: "bg-blue-500/10", glowColor: "rgba(96,165,250,0.35)", borderColor: "rgba(96,165,250,0.25)" },
  },
  {
    keywords: ["github", "repo"],
    meta: { icon: GitBranch, color: "text-gray-300", bgColor: "bg-gray-500/10", glowColor: "rgba(209,213,219,0.35)", borderColor: "rgba(209,213,219,0.25)" },
  },
  {
    keywords: ["salesforce", "crm"],
    meta: { icon: Cloud, color: "text-sky-400", bgColor: "bg-sky-500/10", glowColor: "rgba(56,189,248,0.35)", borderColor: "rgba(56,189,248,0.25)" },
  },
  {
    keywords: ["sap", "erp"],
    meta: { icon: BarChart3, color: "text-yellow-400", bgColor: "bg-yellow-500/10", glowColor: "rgba(250,204,21,0.35)", borderColor: "rgba(250,204,21,0.25)" },
  },
  {
    keywords: ["sharepoint", "drive", "file", "upload"],
    meta: { icon: FileText, color: "text-teal-400", bgColor: "bg-teal-500/10", glowColor: "rgba(45,212,191,0.35)", borderColor: "rgba(45,212,191,0.25)" },
  },
  {
    keywords: ["sheets", "spreadsheet"],
    meta: { icon: FileText, color: "text-green-400", bgColor: "bg-green-500/10", glowColor: "rgba(74,222,128,0.35)", borderColor: "rgba(74,222,128,0.25)" },
  },
  {
    keywords: ["docs", "document", "write"],
    meta: { icon: FileText, color: "text-blue-300", bgColor: "bg-blue-500/10", glowColor: "rgba(147,197,253,0.35)", borderColor: "rgba(147,197,253,0.25)" },
  },
  {
    keywords: ["google"],
    meta: { icon: Globe, color: "text-blue-400", bgColor: "bg-blue-500/10", glowColor: "rgba(96,165,250,0.35)", borderColor: "rgba(96,165,250,0.25)" },
  },
  {
    keywords: ["web", "search", "browse"],
    meta: { icon: Globe, color: "text-emerald-400", bgColor: "bg-emerald-500/10", glowColor: "rgba(52,211,153,0.35)", borderColor: "rgba(52,211,153,0.25)" },
  },
];

const DEFAULT_META: Omit<ConnectorMeta, "label" | "category"> = {
  icon: Zap,
  color: "text-zinc-400",
  bgColor: "bg-zinc-500/10",
  glowColor: "rgba(161,161,170,0.35)",
  borderColor: "rgba(161,161,170,0.25)",
};

/**
 * Resolve connector metadata from connector name, tool name, or display name.
 */
export function resolveConnectorMeta(
  connectorName: string,
  toolName?: string,
  displayName?: string
): ConnectorMeta {
  const searchText = `${connectorName} ${toolName || ""} ${displayName || ""}`.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => searchText.includes(kw))) {
      return {
        ...entry.meta,
        label: displayName || formatConnectorName(connectorName),
        category: categorizeConnector(connectorName),
      };
    }
  }

  return {
    ...DEFAULT_META,
    label: displayName || formatConnectorName(connectorName),
    category: categorizeConnector(connectorName),
  };
}

/** Turn connector_name → "Connector Name" */
function formatConnectorName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Categorize a connector into a higher-level group */
function categorizeConnector(name: string): string {
  const n = name.toLowerCase();
  if (["hiring", "screening", "telephonic", "fraud", "verification", "voice_id"].some((k) => n.includes(k)))
    return "Agent";
  if (["rag", "knowledge"].some((k) => n.includes(k))) return "Intelligence";
  if (["gmail", "calendar", "sheets", "docs", "drive", "google"].some((k) => n.includes(k))) return "Google";
  if (["slack", "teams", "jira", "github", "salesforce", "sap", "sharepoint"].some((k) => n.includes(k)))
    return "Enterprise";
  if (["whatsapp"].includes(n)) return "Communication";
  return "Tool";
}

/** Derive a short data-flow label from step params (for edge labels) */
export function deriveEdgeLabel(
  sourceStep: { connector: string; tool: string },
  targetStep: { connector: string; tool: string; params: Record<string, unknown> }
): string | undefined {
  // Check if any param in the target references the source
  const refs: string[] = [];
  const walk = (val: unknown) => {
    if (typeof val === "string" && val.startsWith("$step")) {
      // Extract the field name from $stepN.field.subfield
      const parts = val.split(".");
      if (parts.length > 1) {
        refs.push(parts.slice(1).join("."));
      }
    } else if (typeof val === "object" && val !== null) {
      Object.values(val).forEach(walk);
    }
  };
  walk(targetStep.params);

  if (refs.length === 0) return undefined;
  if (refs.length === 1) return refs[0];
  return refs.slice(0, 2).join(", ");
}

/** Format a tool name for display */
export function formatToolName(tool: string): string {
  return tool
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
