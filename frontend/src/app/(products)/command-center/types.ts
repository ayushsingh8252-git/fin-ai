/* ═══════════════════════════════════════════════════════════════════════
   Agent Command Center – Types (Clean Monochrome / Agentic Architecture)
   ═══════════════════════════════════════════════════════════════════════ */

export type MissionPhase =
  | "idle"
  | "planning"
  | "planned"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "failed";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";

export type WorkspaceViewMode = "graph" | "desktop" | "terminal" | "artifacts";

/** A single step as returned by POST /api/v1/agent/plan */
export interface PlanStep {
  connector: string;
  tool: string;
  params: Record<string, unknown>;
  invalid?: boolean;
}

/** Runtime execution state for a step */
export interface ExecutionStep {
  index: number; // 1-indexed
  connector: string;
  tool: string;
  params: Record<string, unknown>;
  resolvedParams?: Record<string, unknown>;
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  thought?: string;
}

/** Uploaded document / resume metadata */
export interface AttachedDocument {
  name: string;
  size: number;
  type: string;
  file?: File;
  previewUrl?: string;
  rawText?: string;
  isSample?: boolean;
}

/** Human-in-the-loop approval request */
export interface ApprovalDialogState {
  stepIndex: number;
  type: "whatsapp" | "call" | "email" | "qualification";
  title: string;
  description: string;
  recipient: string;
  messageContent?: string;
  additionalParams?: Record<string, unknown>;
}

/** Full plan returned by the backend */
export interface Plan {
  steps: PlanStep[];
  error?: string;
}

/** Full execution state */
export interface MissionState {
  phase: MissionPhase;
  prompt: string;
  jobDescription: string;
  attachedDoc: AttachedDocument | null;
  plan: Plan | null;
  executionSteps: ExecutionStep[];
  selectedNodeId: string | null;
  activeStepIndex: number | null; // 1-indexed
  completedAt?: number;
  startedAt?: number;
  totalDurationMs?: number;
  approvalDialog: ApprovalDialogState | null;
  leftActiveTab: "trace" | "inspector" | "artifacts";
  viewMode: WorkspaceViewMode;
}

/** Tool from the unified catalog */
export interface CatalogTool {
  connector: string;
  connector_display_name: string;
  tool: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown> | null;
  permissions: string[];
  timeout: number;
  retry_policy?: Record<string, unknown> | null;
  failure_response?: Record<string, unknown> | null;
  status: string;
}

/** Node data for React Flow */
export interface AgentNodeData {
  [key: string]: unknown;
  stepIndex: number;
  connector: string;
  connectorDisplayName: string;
  tool: string;
  toolDescription: string;
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  isSelected: boolean;
  catalogTool?: CatalogTool;
}

/** Edge data for React Flow */
export interface FlowEdgeData {
  [key: string]: unknown;
  label?: string;
  isActive?: boolean;
  isCompleted?: boolean;
}

/** Demo plan based on real candidate evaluation */
export const DEMO_PLAN: Plan = {
  steps: [
    {
      connector: "hiring",
      tool: "get_candidate_profile",
      params: { file_path: "uploads/hiring/ayush_singh_resume.pdf", filename: "ayush-singh-resume.pdf" },
    },
    {
      connector: "hiring",
      tool: "match_candidate_requirement",
      params: {
        candidate: "$step1.candidate",
        requirement: "Staff / Senior Full Stack AI Engineer with Next.js, Python, FastAPI, and Agentic AI Architecture experience.",
        role_title: "Senior AI Systems Engineer",
      },
    },
    {
      connector: "fraud",
      tool: "run_fraud_check",
      params: { scan_id: "$step1.scan_id" },
    },
    {
      connector: "hiring",
      tool: "generate_candidate_scorecard",
      params: {
        candidate_name: "$step1.candidate.name",
        candidate_email: "$step1.candidate.email",
        role_title: "Senior AI Systems Engineer",
      },
    },
    {
      connector: "whatsapp",
      tool: "send_whatsapp_message",
      params: {
        recipient: "$step1.candidate.phone",
        message: "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role (Score: 89/100). We would like to coordinate a technical discussion. Please let us know your availability.",
      },
    },
  ],
};

/** Demo execution results */
export const DEMO_RESULTS: Record<number, Record<string, unknown>> = {
  1: {
    candidate: {
      name: "Ayush Singh",
      email: "ayush.singh@agenticflow.ai",
      phone: "+91 98765 43210",
      experience: "5+ years",
      skills: [
        "Python",
        "FastAPI",
        "React",
        "Next.js",
        "TypeScript",
        "LLM Orchestration",
        "PyTorch",
        "Docker",
        "PostgreSQL",
        "Vector Databases",
      ],
      summary:
        "Full-stack AI systems engineer specializing in multi-agent orchestration, high-throughput retrieval engines, and real-time streaming architectures. Strong background in scalable backend engineering and intuitive frontend interfaces.",
      ats_score: 92,
    },
    scan_id: "scan_candidate_09a4f",
    status: "parsed",
  },
  2: {
    match_score: 89,
    match_grade: "Strong Match",
    strengths: [
      "Extensive experience in multi-agent orchestration and FastAPI backends",
      "Production Next.js 16 and TypeScript expertise",
      "Direct experience building rule engines, RAG pipelines, and voice agents",
      "Solid understanding of vector embeddings and cloud architecture",
    ],
    gaps: [
      "Prioritize verifying production distributed tracing depth",
    ],
    recommendation: "PROCEED",
    summary:
      "Candidate profile shows 89% alignment with the Senior AI Systems Engineer JD. Demonstrates deep domain expertise in agentic workflows, API design, and modern UI engineering.",
  },
  3: {
    risk_score: 8,
    verdict: "likely_genuine",
    explanation:
      "Document metadata, text alignment, and PDF font metrics are consistent with standard compilation. Identity consistency check passed with 0 anomaly flags.",
    key_concerns: [],
    steps: [
      { name: "Document Structure Analysis", status: "passed", score: 98 },
      { name: "Font & Alignment Forensics", status: "passed", score: 94 },
      { name: "Metadata Timestamp Triangulation", status: "passed", score: 96 },
      { name: "Chronology & Employment Verification", status: "passed", score: 92 },
    ],
  },
  4: {
    scorecard_id: "sc_901928_eval",
    candidate_name: "Ayush Singh",
    overall_score: 89,
    skills_score: 94,
    experience_score: 90,
    education_score: 84,
    cultural_fit_score: 88,
    recommendation: "PROCEED",
    strengths: [
      "Technical alignment exceeds benchmark criteria",
      "Demonstrated ability to deploy complete agent products",
      "Strong architectural decision-making",
    ],
    weaknesses: [
      "Schedule follow-up on specific enterprise auth frameworks",
    ],
  },
  5: {
    message_id: "wamid.HBgLMTkwMzg2ODk1FQIAEhgg...",
    status: "delivered",
    recipient: "+91 98765 43210",
    delivery_timestamp: new Date().toISOString(),
    channel: "WhatsApp Business Cloud API",
  },
};
