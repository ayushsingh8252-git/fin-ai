import {
  Brain, BriefcaseBusiness, Phone, Radar, Search, Shield, ShieldAlert, ShieldCheck, Upload, UserPlus, Video, Zap,
  type LucideIcon,
} from "lucide-react";

/** Single source of truth for product navigation (ProductNav, the
 * Recruitment shell and the RAG header all render from this), so a route is
 * added, renamed or removed in one place. Every href is a real page. */
export type ProductLink = { href: string; label: string; icon: LucideIcon; description: string };

export const PRODUCT_GROUPS: { title: string; items: ProductLink[] }[] = [
  {
    title: "Hiring",
    items: [
      { href: "/recruitment", label: "Recruitment", icon: BriefcaseBusiness, description: "Jobs, candidates, interviews and analytics" },
      { href: "/command-center", label: "HR Command Center", icon: Radar, description: "Plan and run HR tasks with AI" },
      { href: "/screening-agent", label: "Screening Agent", icon: Video, description: "AI video interviews" },
      { href: "/telephonic-agent", label: "Telephonic Agent", icon: Phone, description: "AI phone screening calls" },
      { href: "/fraud-detection", label: "Fraud Detection", icon: ShieldAlert, description: "Document authenticity checks" },
      { href: "/hiring-automation", label: "Hiring Pipeline", icon: Zap, description: "Bulk resume parsing and assignments" },
    ],
  },
  {
    title: "Policy & knowledge",
    items: [
      { href: "/rag", label: "RAG Workspace", icon: Search, description: "Ask questions over your documents" },
      { href: "/rules", label: "Rule Explorer", icon: ShieldCheck, description: "Rules extracted from policies" },
      { href: "/upload", label: "Ingest Documents", icon: Upload, description: "Add policy documents" },
      { href: "/knowledge", label: "Knowledge Transfer", icon: Brain, description: "Hand-over knowledge capture" },
    ],
  },
  {
    title: "People & compliance",
    items: [
      { href: "/onboarding", label: "Onboarding", icon: UserPlus, description: "New-hire onboarding" },
      { href: "/security", label: "Security & Compliance", icon: Shield, description: "Security posture overview" },
    ],
  },
];

export const ALL_PRODUCTS: ProductLink[] = PRODUCT_GROUPS.flatMap((g) => g.items);

export const isActivePath = (pathname: string | null, href: string) =>
  !!pathname && (pathname === href || pathname.startsWith(`${href}/`));
