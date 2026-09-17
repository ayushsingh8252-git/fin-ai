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
  planningLogs: string[];
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

// NOTE: a DEMO_RESULTS table used to live here and was silently substituted
// into callRealTool() in CommandCenter.tsx whenever a real backend call
// failed or timed out — a failure would render as an indistinguishable fake
// success (fake match score, fake fraud verdict, fake WhatsApp delivery
// receipt). Removed: callRealTool() now retries real failures with backoff
// and, if retries are exhausted, returns a real, visible failure instead.
