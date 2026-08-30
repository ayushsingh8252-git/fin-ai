/* ═══════════════════════════════════════════════════════════════════════
   Icon & Category Resolver (Clean Monochrome / SVG Architecture)
   Maps connector/tool names to pure Lucide SVG icons and subtle monochrome tokens.
   ═══════════════════════════════════════════════════════════════════════ */
import {
  MessageSquare,
  Mail,
  Calendar,
  ShieldCheck,
  PhoneCall,
  Search,
  FileText,
  UserCheck,
  CheckCircle2,
  Terminal,
  Cpu,
  Layers,
  Database,
  Globe,
  GitBranch,
  Cloud,
  Send,
  type LucideIcon,
} from "lucide-react";

export interface ConnectorMeta {
  icon: LucideIcon;
  color: string; // Tailwind text color class
  bgColor: string; // Tailwind bg class
  glowColor: string; // CSS color for active highlight
  borderColor: string; // CSS border color
  label: string; // Friendly display label
  category: string; // Category label
}

/** Keyword -> metadata mapping */
const KEYWORD_MAP: Array<{ keywords: string[]; meta: Omit<ConnectorMeta, "label" | "category"> }> = [
  {
    keywords: ["whatsapp"],
    meta: {
      icon: MessageSquare,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      glowColor: "rgba(16, 185, 129, 0.25)",
      borderColor: "rgba(16, 185, 129, 0.2)",
    },
  },
  {
    keywords: ["gmail", "email", "mail"],
    meta: {
      icon: Mail,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["calendar", "meet", "schedule"],
    meta: {
      icon: Calendar,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["fraud", "integrity", "forensic"],
    meta: {
      icon: ShieldCheck,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      glowColor: "rgba(245, 158, 11, 0.25)",
      borderColor: "rgba(245, 158, 11, 0.2)",
    },
  },
  {
    keywords: ["telephonic", "phone", "call", "voice"],
    meta: {
      icon: PhoneCall,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["screening", "screen", "interview"],
    meta: {
      icon: UserCheck,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["hiring", "candidate", "ats", "recruit", "scorecard", "assignment", "profile"],
    meta: {
      icon: FileText,
      color: "text-zinc-100",
      bgColor: "bg-zinc-800/80",
      glowColor: "rgba(255, 255, 255, 0.2)",
      borderColor: "rgba(255, 255, 255, 0.15)",
    },
  },
  {
    keywords: ["rag", "document", "knowledge", "query"],
    meta: {
      icon: Database,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["github", "repo", "git"],
    meta: {
      icon: GitBranch,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
  {
    keywords: ["web", "search", "browse", "google"],
    meta: {
      icon: Globe,
      color: "text-zinc-200",
      bgColor: "bg-zinc-800",
      glowColor: "rgba(255, 255, 255, 0.15)",
      borderColor: "rgba(255, 255, 255, 0.12)",
    },
  },
];

const DEFAULT_META: Omit<ConnectorMeta, "label" | "category"> = {
  icon: Cpu,
  color: "text-zinc-300",
  bgColor: "bg-zinc-800/60",
  glowColor: "rgba(255, 255, 255, 0.12)",
  borderColor: "rgba(255, 255, 255, 0.1)",
};

/**
 * Resolve connector metadata cleanly.
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

function formatConnectorName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function categorizeConnector(name: string): string {
  const n = name.toLowerCase();
  if (["hiring", "screening", "telephonic", "fraud", "verification"].some((k) => n.includes(k)))
    return "Agent";
  if (["rag", "knowledge"].some((k) => n.includes(k))) return "Engine";
  if (["gmail", "calendar", "sheets", "docs", "drive", "google"].some((k) => n.includes(k))) return "Integration";
  if (["whatsapp"].includes(n)) return "Outreach";
  return "Tool";
}

export function deriveEdgeLabel(
  sourceStep: { connector: string; tool: string },
  targetStep: { connector: string; tool: string; params: Record<string, unknown> }
): string | undefined {
  const refs: string[] = [];
  const walk = (val: unknown) => {
    if (typeof val === "string" && val.startsWith("$step")) {
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

export function formatToolName(tool: string): string {
  return tool
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
