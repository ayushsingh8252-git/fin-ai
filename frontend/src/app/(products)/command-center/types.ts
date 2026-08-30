/* ═══════════════════════════════════════════════════════════════════════
   Agent Command Center – Types
   ═══════════════════════════════════════════════════════════════════════ */

export type MissionPhase =
  | "idle"
  | "planning"
  | "planned"
  | "executing"
  | "completed"
  | "failed";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/** A single step as returned by POST /api/v1/agent/plan */
export interface PlanStep {
  connector: string;
  tool: string;
  params: Record<string, unknown>;
  invalid?: boolean;
}

/** Runtime execution state for a step */
export interface ExecutionStep {
  index: number;            // 1-indexed
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
  plan: Plan | null;
  executionSteps: ExecutionStep[];
  selectedNodeId: string | null;
  activeStepIndex: number | null;  // 1-indexed
  completedAt?: number;
  startedAt?: number;
  totalDurationMs?: number;
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
  label?: string;
  isActive?: boolean;
  isCompleted?: boolean;
}

/** Demo plan for fallback */
export const DEMO_PLAN: Plan = {
  steps: [
    {
      connector: "hiring",
      tool: "get_candidate_profile",
      params: { file_path: "uploads/resume.pdf", filename: "resume.pdf" },
    },
    {
      connector: "hiring",
      tool: "match_candidate_requirement",
      params: {
        candidate: "$step1.candidate",
        requirement: "Senior Full Stack Engineer with 5+ years React/Node.js experience",
        role_title: "Senior Full Stack Engineer",
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
        role_title: "Senior Full Stack Engineer",
      },
    },
    {
      connector: "whatsapp",
      tool: "send_whatsapp_message",
      params: {
        recipient: "$step1.candidate.phone",
        message: "Hi! Congratulations — you've been shortlisted for the Senior Full Stack Engineer role. We'd love to schedule a follow-up interview. Please reply with your availability.",
      },
    },
  ],
};

/** Demo execution results for fallback */
export const DEMO_RESULTS: Record<number, Record<string, unknown>> = {
  1: {
    candidate: {
      name: "Ayush Singh",
      email: "ayush@example.com",
      phone: "+919876543210",
      experience: "5+ years",
      skills: ["React", "Node.js", "TypeScript", "Python", "AWS", "Docker", "PostgreSQL"],
      summary: "Senior software engineer with extensive experience in full-stack development, specializing in React and Node.js ecosystems. Strong background in cloud architecture and DevOps practices.",
      ats_score: 92,
    },
    scan_id: "demo-scan-001",
  },
  2: {
    match_score: 87,
    match_grade: "Strong Match",
    strengths: [
      "Extensive React/Node.js experience (5+ years)",
      "Strong TypeScript skills",
      "Cloud architecture expertise (AWS)",
      "Full-stack capability with modern frameworks",
    ],
    gaps: [
      "No explicit mention of GraphQL experience",
      "Limited mobile development background",
    ],
    recommendation: "PROCEED",
    summary: "Candidate demonstrates strong alignment with the Senior Full Stack Engineer role requirements. Technical depth in React and Node.js exceeds expectations, with additional strengths in cloud architecture.",
  },
  3: {
    risk_score: 12,
    verdict: "likely_genuine",
    explanation: "Document analysis shows consistent formatting, valid metadata timestamps, and no signs of tampering. Text alignment and font usage are consistent throughout. No red flags detected in identity verification checks.",
    key_concerns: [],
    steps: [
      { name: "Metadata Analysis", status: "passed", score: 95 },
      { name: "OCR Verification", status: "passed", score: 88 },
      { name: "Font Analysis", status: "passed", score: 91 },
      { name: "ELA Detection", status: "passed", score: 97 },
      { name: "Identity Check", status: "passed", score: 90 },
    ],
  },
  4: {
    scorecard_id: "sc-demo-001",
    candidate_name: "Ayush Singh",
    overall_score: 87,
    skills_score: 92,
    experience_score: 88,
    education_score: 81,
    cultural_fit_score: 85,
    recommendation: "PROCEED",
    strengths: [
      "Exceptional technical skills alignment",
      "Strong problem-solving demonstrated in past projects",
      "Active open-source contributor",
    ],
    weaknesses: [
      "Could benefit from more leadership experience",
      "Limited exposure to GraphQL",
    ],
  },
  5: {
    message_id: "wamid.demo001",
    status: "sent",
    recipient: "+919876543210",
    timestamp: new Date().toISOString(),
  },
};
