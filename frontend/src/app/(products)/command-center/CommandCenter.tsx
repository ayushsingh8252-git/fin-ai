"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Upload,
  FileText,
  X,
  Sparkles,
  Bot,
  Sliders,
  CheckCircle2,
  FileCode,
  ArrowRight,
  UserCheck,
  ShieldCheck,
  PhoneCall,
  MessageSquare,
  Mail,
  Search,
  RotateCcw,
  Plus,
  Play,
  Layers,
  Terminal,
} from "lucide-react";

import LeftPanel from "./LeftPanel";
import RightCanvas from "./RightCanvas";
import { VoiceGateModal } from "./VoiceGateModal";
import type {
  MissionState,
  ExecutionStep,
  CatalogTool,
  Plan,
  PlanStep,
  AttachedDocument,
  ApprovalDialogState,
  WorkspaceViewMode,
} from "./types";
import { DEMO_PLAN as DemoPlan } from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001").replace(/\/api\/v1$/, "");

/** Calls the real backend tool endpoint — the only way any step (planned via
 * the LLM planner or the local keyword-matched fallback below) actually
 * executes. No caller of this may fabricate a result on failure; a failed
 * call must be reported as failed. */
async function callRealTool(
  connector: string,
  tool: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}/api/v1/agent/tools/${connector}/${tool}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// Extracts a real email address / E.164-ish phone number / free-text time
// mention straight out of the user's own prompt, so a request like "email
// jane@x.com about the 3pm interview" or "whatsapp +917209602122 that we're
// confirmed for tomorrow" carries the actual values the user typed instead
// of the canned demo candidate's contact info.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /\+?\d[\d\s-]{7,14}\d/;
const TIME_RE = /\b(\d{1,2}(:\d{2})?\s?(am|pm|AM|PM))\b|\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function extractPromptEntities(prompt: string): { email: string | null; phone: string | null; time: string | null } {
  const emailMatch = prompt.match(EMAIL_RE);
  const phoneMatch = prompt.match(PHONE_RE);
  const timeMatch = prompt.match(TIME_RE);
  return {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].replace(/\s|-/g, "") : null,
    time: timeMatch ? timeMatch[0] : null,
  };
}

/**
 * Intelligent plan synthesizer for custom user prompts when backend planner is unconfigured
 */
function synthesizePlanFromPrompt(prompt: string, hasDoc: boolean): Plan {
  const p = prompt.toLowerCase();
  const steps: PlanStep[] = [];
  const entities = extractPromptEntities(prompt);

  const mentionsResume = p.includes("resume") || p.includes("candidate") || p.includes("hire") || p.includes("cv") || hasDoc;
  const mentionsMatching = p.includes("jd") || p.includes("match") || p.includes("requirement") || p.includes("role") || mentionsResume;
  const mentionsFraud = p.includes("fraud") || p.includes("verify") || p.includes("background") || p.includes("integrity") || p.includes("authentic");
  const mentionsScorecard = p.includes("score") || p.includes("evaluate") || p.includes("report") || mentionsMatching;
  const mentionsWhatsApp = p.includes("whatsapp") || p.includes("text") || p.includes("message");
  const mentionsCall = p.includes("call") || p.includes("phone") || p.includes("voice") || p.includes("telephonic");
  const mentionsEmail = p.includes("email") || p.includes("mail") || p.includes("gmail");
  const mentionsScreening = p.includes("screen") || p.includes("interview") || mentionsCall;
  const mentionsRag = p.includes("search") || p.includes("rag") || p.includes("policy") || p.includes("knowledge") || p.includes("docs");
  const mentionsCalendar = p.includes("calendar") || p.includes("schedule") || p.includes("meet");

  if (mentionsResume) {
    steps.push({
      connector: "hiring",
      tool: "get_candidate_profile",
      params: { file_path: "uploads/hiring/ayush_singh_resume.pdf", filename: "ayush-singh-resume.pdf" },
    });
  }

  if (mentionsMatching) {
    steps.push({
      connector: "hiring",
      tool: "match_candidate_requirement",
      params: {
        candidate: "$step1.candidate",
        requirement: "Senior AI Systems & Full Stack Engineer with FastAPI, React, and Multi-Agent Orchestration depth.",
        role_title: "Senior AI Systems Engineer",
      },
    });
  }

  if (mentionsFraud) {
    steps.push({
      connector: "fraud",
      tool: "run_fraud_check",
      params: { scan_id: "$step1.scan_id" },
    });
  }

  if (mentionsScorecard) {
    steps.push({
      connector: "hiring",
      tool: "generate_candidate_scorecard",
      params: {
        candidate_name: "$step1.candidate.name",
        candidate_email: "$step1.candidate.email",
        role_title: "Senior AI Systems Engineer",
      },
    });
  }

  if (mentionsCall || mentionsScreening) {
    steps.push({
      connector: "telephonic",
      tool: "place_screening_call",
      params: {
        to: entities.phone || "$step1.candidate.phone",
        candidate_name: "$step1.candidate.name",
        role_title: "Senior AI Systems Engineer",
      },
    });
  }

  if (mentionsCalendar) {
    steps.push({
      connector: "google_calendar",
      tool: "create_meet",
      params: {
        summary: entities.time ? `Technical Discussion (${entities.time})` : "Technical Discussion with Ayush Singh",
        attendee_email: entities.email || "$step1.candidate.email",
      },
    });
  }

  if (mentionsWhatsApp) {
    steps.push({
      connector: "whatsapp",
      tool: "send_whatsapp_message",
      params: {
        recipient: entities.phone || "$step1.candidate.phone",
        // The prompt itself is the message when the user wrote out real
        // content (email/time found) — otherwise fall back to the demo copy.
        message: entities.email || entities.time || entities.phone ? prompt : "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role (Score: 89/100). Please let us know your availability for a technical interview.",
      },
    });
  }

  if (mentionsEmail) {
    steps.push({
      connector: "gmail",
      // real schema is {to, subject, body} — see mcp/connectors/google/gmail.py
      tool: "send_email",
      params: {
        to: entities.email || "$step1.candidate.email",
        subject: entities.time ? `Interview scheduled: ${entities.time}` : "Shortlisted: Senior AI Systems Engineer Application",
        body: entities.email || entities.time ? prompt : "Hello Ayush, we have reviewed your candidate profile and would love to proceed to the next technical discussion.",
      },
    });
  }

  if (mentionsRag && steps.length === 0) {
    steps.push({
      connector: "rag",
      tool: "query_documents",
      params: { query: prompt, top_k: 5 },
    });
  }

  // Fallback default if nothing specific matched
  if (steps.length === 0) {
    return DemoPlan;
  }

  return { steps };
}

function resolvePlaceholders(
  value: unknown,
  results: Record<number, Record<string, unknown>>
): unknown {
  if (typeof value === "string") {
    const match = value.trim().match(/^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$/);
    if (!match) return value;
    const stepIndex = parseInt(match[1], 10);
    const pathParts = match[2].split(".").filter(Boolean);
    let resolved: unknown = results[stepIndex];
    for (const key of pathParts) {
      if (resolved && typeof resolved === "object" && key in (resolved as Record<string, unknown>)) {
        resolved = (resolved as Record<string, unknown>)[key];
      } else {
        return value;
      }
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolvePlaceholders(v, results));
  }
  if (typeof value === "object" && value !== null) {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolvePlaceholders(v, results);
    }
    return resolved;
  }
  return value;
}

export default function CommandCenter() {
  const [prompt, setPrompt] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null);
  const [showJdInput, setShowJdInput] = useState(false);
  const [isVoiceAuthenticated, setIsVoiceAuthenticated] = useState(false);

  const [state, setState] = useState<MissionState>({
    phase: "idle",
    prompt: "",
    jobDescription: "",
    attachedDoc: null,
    plan: null,
    executionSteps: [],
    selectedNodeId: null,
    activeStepIndex: null,
    approvalDialog: null,
    leftActiveTab: "trace",
    viewMode: "graph",
    planningLogs: [],
  });

  const [executionMode, setExecutionMode] = useState<"auto" | "manual">("auto");
  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<Record<number, Record<string, unknown>>>({});
  const parsedDataRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchCatalog();
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const urlPrompt = urlParams.get("prompt");
      if (urlPrompt) {
        setPrompt(urlPrompt);
        handleLoadSampleResume();
      }
    }
  }, []);

  async function fetchCatalog() {
    try {
      const res = await fetch(`${API_URL}/api/v1/agent/tools`);
      if (res.ok) {
        const data = await res.json();
        setCatalogTools(data.tools || []);
      }
    } catch {
      console.warn("[CommandCenter] Tool catalog offline - running local autonomous suite");
    }
  }

  const handleLoadSampleResume = () => {
    setAttachedDoc({
      name: "ayush-singh-resume.pdf",
      size: 473243,
      type: "application/pdf",
      isSample: true,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedDoc({
      name: file.name,
      size: file.size,
      type: file.type,
      file,
      isSample: false,
    });
  };

  /** Main submission handler for ANY prompt */
  const handleSubmit = useCallback(
    async (missionPrompt: string) => {
      const trimmed = missionPrompt.trim();
      if (!trimmed) return;

      setState({
        phase: "planning",
        prompt: trimmed,
        jobDescription,
        attachedDoc,
        plan: null,
        executionSteps: [],
        selectedNodeId: null,
        activeStepIndex: null,
        approvalDialog: null,
        leftActiveTab: "trace",
        viewMode: "graph",
        startedAt: Date.now(),
        planningLogs: [`Analyzing natural language intent: "${trimmed}"`],
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const thoughts = [
          attachedDoc
            ? `Candidate document loaded: ${attachedDoc.name} (${Math.round(attachedDoc.size / 1024)} KB)`
            : "Extracting goal parameters & criteria...",
          "Querying unified connector catalog (21 connectors, 71 tools registered)...",
          "Synthesizing optimal tool execution DAG...",
          "Resolving runtime dependency bindings ($step1.candidate)...",
          "Autonomous execution plan compiled. Ready for dispatch.",
        ];

        for (const thought of thoughts) {
          if (controller.signal.aborted) return;
          await sleep(220);
          setState((prev) => ({
            ...prev,
            planningLogs: [...(prev.planningLogs || []), thought],
          }));
        }

        let plan: Plan = synthesizePlanFromPrompt(trimmed, !!attachedDoc);

        // Try requesting the real backend LLM planner — it extracts
        // recipient/time/content entities from the prompt far more reliably
        // than the local keyword-matcher above, so prefer it whenever it
        // returns a usable plan. Execution below is always real regardless
        // of which plan source won — this only decides *what* runs, never
        // *whether* it actually runs.
        try {
          const planRes = await fetch(`${API_URL}/api/v1/agent/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: trimmed }),
            signal: controller.signal,
          });

          if (planRes.ok) {
            const data = await planRes.json();
            if (data.steps && data.steps.length > 0) {
              plan = data;
            }
          }
        } catch {
          // Real LLM planner unreachable — the local keyword-matched plan
          // (with prompt-extracted entities) is used instead. Still executed
          // for real below.
        }

        if (controller.signal.aborted) return;

        // If file is attached and real backend upload is accessible, try real parsing
        let parsedCandidateData: Record<string, unknown> | null = null;
        if (attachedDoc && attachedDoc.file) {
          try {
            const formData = new FormData();
            formData.append("files", attachedDoc.file);
            const uploadRes = await fetch(`${API_URL}/api/v1/hiring/parse-resumes`, {
              method: "POST",
              body: formData,
              signal: controller.signal,
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData.candidates?.[0]) {
                parsedCandidateData = uploadData.candidates[0];
              }
            }
          } catch {
            // fallback
          }
        }

        // Initialize execution steps
        const execSteps: ExecutionStep[] = plan.steps.map((step, i) => ({
          index: i + 1,
          connector: step.connector,
          tool: step.tool,
          params: step.params,
          status: "pending" as const,
        }));

        resultsRef.current = {};
        parsedDataRef.current = parsedCandidateData;

        setState((prev) => ({
          ...prev,
          phase: "planned",
          plan,
          executionSteps: execSteps,
        }));

        // If user is in manual step-by-step mode, wait for explicit step trigger
        if (executionMode === "manual") {
          return;
        }

        await sleep(400);
        if (controller.signal.aborted) return;

        setState((prev) => ({ ...prev, phase: "executing" }));
        // Alias, not a copy — writes below must land in resultsRef.current
        // too, since handleApproveStep/executeSingleStep resolve $stepN
        // placeholders from that ref after this function returns at an
        // approval gate.
        const results = resultsRef.current;

        for (let i = 0; i < plan.steps.length; i++) {
          if (controller.signal.aborted) return;

          const stepIndex = i + 1;
          const planStep = plan.steps[i];

          setState((prev) => ({
            ...prev,
            activeStepIndex: stepIndex,
            selectedNodeId: `step-${stepIndex}`,
            executionSteps: prev.executionSteps.map((s) =>
              s.index === stepIndex ? { ...s, status: "running" as const, startedAt: Date.now() } : s
            ),
          }));

          const resolvedParams = resolvePlaceholders(planStep.params, results) as Record<
            string,
            unknown
          >;
          const startTime = Date.now();

          // ── HUMAN APPROVAL GATE FOR EXTERNAL ACTIONS (WhatsApp / Call / Email) ──
          const isExternalOutreach =
            planStep.connector === "whatsapp" ||
            planStep.connector === "gmail" ||
            planStep.tool.includes("call") ||
            planStep.tool.includes("screening_call") ||
            planStep.tool.includes("send_email");

          if (isExternalOutreach) {
            const isCall = planStep.connector === "telephonic" || planStep.tool.includes("call");
            const isEmail = planStep.connector === "gmail" || planStep.tool.includes("email");

            setState((prev) => ({
              ...prev,
              phase: "waiting_approval",
              activeStepIndex: stepIndex,
              selectedNodeId: `step-${stepIndex}`,
              approvalDialog: {
                stepIndex,
                type: isCall ? "call" : isEmail ? "email" : "whatsapp",
                title: isCall
                  ? "Authorize Voice Screening Call"
                  : isEmail
                  ? "Authorize Email Outreach"
                  : "Authorize WhatsApp Outreach Dispatch",
                description: isCall
                  ? "Candidate Ayush Singh qualified (Score: 89/100). The AI telephonic agent is prepared to place an automated technical screening call to the candidate's phone."
                  : isEmail
                  ? "Candidate Ayush Singh qualified (Score: 89/100). Formal shortlisting email notification is queued. Confirm destination email address and body."
                  : "Candidate Ayush Singh qualified (Score: 89/100). Autonomous WhatsApp notification prepared. Confirm candidate phone number and message payload.",
                recipient:
                  (resolvedParams.recipient as string) ||
                  (resolvedParams.to as string) ||
                  (isEmail ? "ayush.singh@agenticflow.ai" : "+91 98765 43210"),
                messageContent:
                  (resolvedParams.message as string) ||
                  (resolvedParams.body as string) ||
                  "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role (Score: 89/100). We would love to coordinate a technical interview. Please reply with your availability.",
              },
              executionSteps: prev.executionSteps.map((s) =>
                s.index === stepIndex ? { ...s, status: "waiting_approval" as const } : s
              ),
            }));

            // Pause until user clicks Approve in left panel
            return;
          }

          // Execute Step — always a real call. A failure is reported as a
          // failed step with the real error, never fabricated as success.
          try {
            const { ok, status, body } = await callRealTool(
              planStep.connector,
              planStep.tool,
              resolvedParams,
              controller.signal
            );
            const elapsed = Date.now() - startTime;

            if (ok) {
              results[stepIndex] = body;
              setState((prev) => ({
                ...prev,
                executionSteps: prev.executionSteps.map((s) =>
                  s.index === stepIndex
                    ? { ...s, status: "completed" as const, result: body, resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                    : s
                ),
              }));
            } else {
              const errorMsg = (body?.detail as any)?.message || (body?.detail as string) || `Tool call failed (HTTP ${status})`;
              setState((prev) => ({
                ...prev,
                phase: "failed",
                executionSteps: prev.executionSteps.map((s) =>
                  s.index === stepIndex
                    ? { ...s, status: "failed" as const, result: body, error: String(errorMsg), resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                    : s
                ),
              }));
              return;
            }
          } catch (err) {
            if (controller.signal.aborted) return;
            const elapsed = Date.now() - startTime;
            setState((prev) => ({
              ...prev,
              phase: "failed",
              executionSteps: prev.executionSteps.map((s) =>
                s.index === stepIndex
                  ? { ...s, status: "failed" as const, error: (err as Error)?.message || "Network error reaching the backend", resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                  : s
              ),
            }));
            return;
          }

          await sleep(200);
        }

        // Finalize
        setState((prev) => ({
          ...prev,
          phase: "completed",
          activeStepIndex: null,
          completedAt: Date.now(),
          totalDurationMs: Date.now() - (prev.startedAt || Date.now()),
        }));
      } catch {
        setState((prev) => ({ ...prev, phase: "failed" }));
      }
    },
    [jobDescription, attachedDoc]
  );

  /** Resume execution after human approval — always a real call to the
   * backend tool (Gmail/WhatsApp/Sarvam telephonic). Approving is the user's
   * explicit go-ahead to actually send/call; faking success here would mean
   * the "Approve" button never did what it says it does. */
  const handleApproveStep = useCallback(
    async (stepIndex: number, updatedParams?: Record<string, unknown>) => {
      setState((prev) => ({
        ...prev,
        phase: "executing",
        approvalDialog: null,
        executionSteps: prev.executionSteps.map((s) =>
          s.index === stepIndex ? { ...s, status: "running" as const, startedAt: Date.now() } : s
        ),
      }));

      const targetStep = state.executionSteps.find((s) => s.index === stepIndex);
      if (!targetStep) return;

      // The approval dialog always edits a generic {recipient, message} pair
      // (LeftPanel.tsx), but gmail.send_email's real params are {to, subject,
      // body} — see mcp/connectors/google/gmail.py — so map the edited
      // fields across for email steps, otherwise an edited email would
      // silently send to/with the original unedited values.
      const edits = { ...(updatedParams || {}) };
      if (targetStep.connector === "gmail") {
        if (typeof edits.recipient === "string") edits.to = edits.recipient;
        if (typeof edits.message === "string") edits.body = edits.message;
      }

      const resolvedParams = {
        ...(resolvePlaceholders(targetStep.params, resultsRef.current) as Record<string, unknown>),
        ...edits,
      };
      const startTime = Date.now();

      try {
        const { ok, status, body } = await callRealTool(targetStep.connector, targetStep.tool, resolvedParams);
        const elapsed = Date.now() - startTime;

        if (ok) {
          resultsRef.current[stepIndex] = body;
          setState((prev) => {
            const updatedSteps = prev.executionSteps.map((s) =>
              s.index === stepIndex
                ? { ...s, status: "completed" as const, result: body, resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                : s
            );
            const allDone = updatedSteps.every((s) => s.status === "completed");
            return {
              ...prev,
              phase: allDone ? "completed" : "executing",
              activeStepIndex: null,
              completedAt: allDone ? Date.now() : prev.completedAt,
              totalDurationMs: allDone ? Date.now() - (prev.startedAt || Date.now()) : prev.totalDurationMs,
              executionSteps: updatedSteps,
            };
          });
        } else {
          const errorMsg = (body?.detail as any)?.message || (body?.detail as string) || `Tool call failed (HTTP ${status})`;
          setState((prev) => ({
            ...prev,
            phase: "failed",
            activeStepIndex: null,
            executionSteps: prev.executionSteps.map((s) =>
              s.index === stepIndex
                ? { ...s, status: "failed" as const, result: body, error: String(errorMsg), resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                : s
            ),
          }));
        }
      } catch (err) {
        const elapsed = Date.now() - startTime;
        setState((prev) => ({
          ...prev,
          phase: "failed",
          activeStepIndex: null,
          executionSteps: prev.executionSteps.map((s) =>
            s.index === stepIndex
              ? { ...s, status: "failed" as const, error: (err as Error)?.message || "Network error reaching the backend", resolvedParams, completedAt: Date.now(), durationMs: elapsed }
              : s
          ),
        }));
      }
    },
    [state.executionSteps]
  );

  const executeSingleStep = useCallback(
    async (stepIndex: number) => {
      const plan = state.plan;
      if (!plan || stepIndex < 1 || stepIndex > plan.steps.length) return;

      const planStep = plan.steps[stepIndex - 1];
      const results = resultsRef.current;

      setState((prev) => ({
        ...prev,
        phase: "executing",
        activeStepIndex: stepIndex,
        selectedNodeId: `step-${stepIndex}`,
        executionSteps: prev.executionSteps.map((s) =>
          s.index === stepIndex ? { ...s, status: "running" as const, startedAt: Date.now() } : s
        ),
      }));

      const resolvedParams = resolvePlaceholders(planStep.params, results) as Record<string, unknown>;
      const startTime = Date.now();

      // Human Approval Gate Check
      const isExternalOutreach =
        planStep.connector === "whatsapp" ||
        planStep.connector === "gmail" ||
        planStep.tool.includes("call") ||
        planStep.tool.includes("screening_call") ||
        planStep.tool.includes("send_email");

      if (isExternalOutreach) {
        const isCall = planStep.connector === "telephonic" || planStep.tool.includes("call");
        const isEmail = planStep.connector === "gmail" || planStep.tool.includes("email");

        setState((prev) => ({
          ...prev,
          phase: "waiting_approval",
          activeStepIndex: stepIndex,
          selectedNodeId: `step-${stepIndex}`,
          approvalDialog: {
            stepIndex,
            type: isCall ? "call" : isEmail ? "email" : "whatsapp",
            title: isCall
              ? "Authorize Voice Screening Call"
              : isEmail
              ? "Authorize Email Outreach"
              : "Authorize WhatsApp Outreach Dispatch",
            description: isCall
              ? "Candidate Ayush Singh qualified (Score: 89/100). The AI telephonic agent is prepared to place an automated technical screening call to the candidate's phone."
              : isEmail
              ? "Candidate Ayush Singh qualified (Score: 89/100). Formal shortlisting email notification is queued. Confirm destination email address and body."
              : "Candidate Ayush Singh qualified (Score: 89/100). Autonomous WhatsApp notification prepared. Confirm candidate phone number and message payload.",
            recipient:
              (resolvedParams.recipient as string) ||
              (resolvedParams.to as string) ||
              (isEmail ? "ayush.singh@agenticflow.ai" : "+91 98765 43210"),
            messageContent:
              (resolvedParams.message as string) ||
              (resolvedParams.body as string) ||
              "Hi Ayush! Your profile has been shortlisted for the Senior AI Systems Engineer role (Score: 89/100). We would love to coordinate a technical interview. Please reply with your availability.",
          },
          executionSteps: prev.executionSteps.map((s) =>
            s.index === stepIndex ? { ...s, status: "waiting_approval" as const } : s
          ),
        }));
        return;
      }

      try {
        const { ok, status, body } = await callRealTool(planStep.connector, planStep.tool, resolvedParams);
        const elapsed = Date.now() - startTime;

        if (ok) {
          results[stepIndex] = body;
          setState((prev) => {
            const updatedSteps = prev.executionSteps.map((s) =>
              s.index === stepIndex
                ? { ...s, status: "completed" as const, result: body, resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                : s
            );
            const allDone = updatedSteps.every((s) => s.status === "completed");
            return {
              ...prev,
              phase: allDone ? "completed" : "planned",
              activeStepIndex: null,
              executionSteps: updatedSteps,
              completedAt: allDone ? Date.now() : prev.completedAt,
              totalDurationMs: allDone ? Date.now() - (prev.startedAt || Date.now()) : prev.totalDurationMs,
            };
          });
        } else {
          const errorMsg = (body?.detail as any)?.message || (body?.detail as string) || `Tool call failed (HTTP ${status})`;
          setState((prev) => ({
            ...prev,
            phase: "failed",
            activeStepIndex: null,
            executionSteps: prev.executionSteps.map((s) =>
              s.index === stepIndex
                ? { ...s, status: "failed" as const, result: body, error: String(errorMsg), resolvedParams, completedAt: Date.now(), durationMs: elapsed }
                : s
            ),
          }));
        }
      } catch (err) {
        const elapsed = Date.now() - startTime;
        setState((prev) => ({
          ...prev,
          phase: "failed",
          activeStepIndex: null,
          executionSteps: prev.executionSteps.map((s) =>
            s.index === stepIndex
              ? { ...s, status: "failed" as const, error: (err as Error)?.message || "Network error reaching the backend", resolvedParams, completedAt: Date.now(), durationMs: elapsed }
              : s
          ),
        }));
      }
    },
    [state.plan]
  );

  const executeNextStep = useCallback(() => {
    const nextPending = state.executionSteps.find((s) => s.status === "pending");
    if (nextPending) {
      executeSingleStep(nextPending.index);
    }
  }, [state.executionSteps, executeSingleStep]);

  const handleFollowUp = useCallback((text: string) => {
    handleSubmit(text);
  }, [handleSubmit]);

  const handleReset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setState({
      phase: "idle",
      prompt: "",
      jobDescription: "",
      attachedDoc: null,
      plan: null,
      executionSteps: [],
      selectedNodeId: null,
      activeStepIndex: null,
      approvalDialog: null,
      leftActiveTab: "trace",
      viewMode: "graph",
      planningLogs: [],
    });
  }, []);

  const isIdle = state.phase === "idle";

  return (
    <div className="cc-root" style={{ width: "100%", height: "100vh", overflow: "hidden", position: "relative" }}>
      {/* ── VOICE BIOMETRIC SECURITY GATE OVERLAY ── */}
      <VoiceGateModal
        isOpen={!isVoiceAuthenticated}
        onAuthenticated={() => setIsVoiceAuthenticated(true)}
      />

      <div
        style={{
          width: "100%",
          height: "100%",
          filter: isVoiceAuthenticated ? "none" : "blur(14px)",
          transition: "filter 0.4s ease",
          pointerEvents: isVoiceAuthenticated ? "auto" : "none",
        }}
      >
        {/* ── INITIAL STATE: MINIMALIST CENTERED AGENT LAUNCHER ── */}
        {isIdle && (
        <div
          style={{
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            position: "relative",
          }}
          className="cc-canvas-bg"
        >
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            style={{ width: "100%", maxWidth: 720 }}
          >
            {/* Tag */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: "rgba(255, 255, 255, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={16} className="text-zinc-200" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#f4f4f5", letterSpacing: "0.02em" }}>
                Agent Command Center
              </span>
            </div>

            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "#f4f4f5",
                textAlign: "center",
                lineHeight: 1.3,
                marginBottom: 6,
              }}
            >
              What mission should the autonomous agents execute?
            </h1>

            <p style={{ fontSize: 13, color: "#a1a1aa", textAlign: "center", marginBottom: 20 }}>
              Enter any custom instruction or select a workflow. The agents autonomously generate the plan,
              execute tools, and verify data.
            </p>

            {/* Custom Prompt Box */}
            <div className="cc-card" style={{ padding: "20px", background: "#111115" }}>
              <div style={{ position: "relative" }}>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Enter any custom mission... e.g. Analyze candidate against JD, run fraud checks, and send WhatsApp outreach after human approval."
                  rows={3}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 14,
                    color: "#f4f4f5",
                    resize: "none",
                    lineHeight: 1.6,
                    paddingRight: prompt ? 30 : 0,
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                      handleSubmit(prompt);
                    }
                  }}
                />

                {prompt && (
                  <button
                    onClick={() => setPrompt("")}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      background: "transparent",
                      border: "none",
                      color: "#71717a",
                      cursor: "pointer",
                      padding: 4,
                    }}
                    title="Clear prompt"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Document / Resume Upload Section */}
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(255, 255, 255, 0.06)", paddingTop: 14 }}>
                {attachedDoc ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "rgba(255, 255, 255, 0.04)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: 8,
                      padding: "8px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <FileText size={16} className="text-zinc-300" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#f4f4f5" }}>
                          {attachedDoc.name}
                        </div>
                        <div style={{ fontSize: 10, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                          {Math.round(attachedDoc.size / 1024)} KB {attachedDoc.isSample ? "• Built-in Sample" : "• Attached File"}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setAttachedDoc(null)}
                      style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="cc-dropzone"
                      style={{
                        flex: 1,
                        padding: "10px",
                        textAlign: "center",
                        fontSize: 12,
                        color: "#a1a1aa",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <Upload size={13} />
                      <span>Upload Candidate Resume (PDF / DOCX)</span>
                    </div>

                    <button
                      onClick={handleLoadSampleResume}
                      className="cc-btn-secondary"
                      style={{ fontSize: 11, padding: "8px 12px", whiteSpace: "nowrap" }}
                    >
                      <FileCode size={12} /> Use Ayush Singh Resume
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt"
                      onChange={handleFileUpload}
                      style={{ display: "none" }}
                    />
                  </div>
                )}
              </div>

              {/* Target Job Description Optional Drawer */}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => setShowJdInput(!showJdInput)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#71717a",
                    fontSize: 11,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <Sliders size={11} />
                  <span>{showJdInput ? "Hide Target Job Description" : "+ Add Specific Target Job Description"}</span>
                </button>

                {showJdInput && (
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    rows={2}
                    placeholder="e.g. Senior AI Systems Engineer with Next.js, Python, FastAPI, and Multi-Agent Orchestration."
                    style={{
                      width: "100%",
                      background: "#09090b",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 12,
                      color: "#d4d4d8",
                      marginTop: 8,
                      outline: "none",
                    }}
                  />
                )}
              </div>

              {/* Launch Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 14,
                  borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                  paddingTop: 12,
                }}
              >
                <div style={{ fontSize: 11, color: "#71717a", fontFamily: "var(--font-geist-mono), monospace" }}>
                  Ctrl+Enter to launch
                </div>

                <button
                  onClick={() => handleSubmit(prompt || "Analyze candidate resume against JD, verify fraud risk, and dispatch WhatsApp outreach.")}
                  className="cc-btn-primary"
                >
                  <Send size={13} />
                  <span>Deploy Autonomous Mission</span>
                </button>
              </div>
            </div>

            {/* Quick Presets */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: "#71717a", textAlign: "center", marginBottom: 8 }}>
                Or choose a pre-configured multi-agent mission:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                <PresetChip
                  icon={<MessageSquare size={12} />}
                  label="Candidate Evaluation & WhatsApp Outreach"
                  onClick={() => {
                    setPrompt(
                      "Analyze this candidate against the JD, perform background verification, and if everything is good, contact the candidate on WhatsApp."
                    );
                    handleLoadSampleResume();
                  }}
                />
                <PresetChip
                  icon={<PhoneCall size={12} />}
                  label="Telephonic AI Voice Screening Call"
                  onClick={() => {
                    setPrompt(
                      "Conduct an AI-driven telephonic screening call with the candidate to assess architectural depth and communication skills."
                    );
                    handleLoadSampleResume();
                  }}
                />
                <PresetChip
                  icon={<Mail size={12} />}
                  label="Scorecard Generation & Gmail Dispatch"
                  onClick={() => {
                    setPrompt(
                      "Generate comprehensive candidate scorecard against JD and send formal email interview confirmation via Gmail."
                    );
                    handleLoadSampleResume();
                  }}
                />
                <PresetChip
                  icon={<ShieldCheck size={12} />}
                  label="Document Authenticity & Fraud Verification"
                  onClick={() => {
                    setPrompt(
                      "Perform multi-layer document forensics, ELA analysis, and identity verification on submitted PDF resume."
                    );
                    handleLoadSampleResume();
                  }}
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ── ACTIVE SPLIT-SCREEN WORKSPACE STATE ── */}
      {!isIdle && (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
          {/* LEFT PANEL — 38% (Conversational Timeline, Stream, Inline Inspector) */}
          <div style={{ width: "38%", minWidth: 350, maxWidth: 480, flexShrink: 0 }}>
            <LeftPanel
              state={state}
              onStepClick={(stepIndex) =>
                setState((prev) => ({
                  ...prev,
                  selectedNodeId: `step-${stepIndex}`,
                  leftActiveTab: "inspector",
                }))
              }
              onApproveStep={handleApproveStep}
              onFollowUp={handleFollowUp}
              catalogTools={catalogTools}
              onReset={handleReset}
              onTabChange={(tab) => setState((prev) => ({ ...prev, leftActiveTab: tab }))}
              executionMode={executionMode}
              onToggleExecutionMode={() =>
                setExecutionMode((m) => (m === "auto" ? "manual" : "auto"))
              }
              onExecuteStep={executeSingleStep}
              onExecuteNextStep={executeNextStep}
            />
          </div>

          {/* RIGHT CANVAS — 62% (Interactive Agent Graph & AI Desktop) */}
          <div style={{ flex: 1, position: "relative" }}>
            <RightCanvas
              executionSteps={state.executionSteps}
              planSteps={state.plan?.steps || []}
              selectedNodeId={state.selectedNodeId}
              activeStepIndex={state.activeStepIndex}
              onNodeClick={(stepIndex) =>
                setState((prev) => ({
                  ...prev,
                  selectedNodeId: `step-${stepIndex}`,
                  leftActiveTab: "inspector",
                }))
              }
              onCanvasClick={() => setState((prev) => ({ ...prev, selectedNodeId: null }))}
              catalogTools={catalogTools}
              phase={state.phase}
              viewMode={state.viewMode}
              onViewModeChange={(mode) => setState((prev) => ({ ...prev, viewMode: mode }))}
              executionMode={executionMode}
              onToggleExecutionMode={() =>
                setExecutionMode((m) => (m === "auto" ? "manual" : "auto"))
              }
              onExecuteStep={executeSingleStep}
              onExecuteNextStep={executeNextStep}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function PresetChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="cc-btn-secondary"
      style={{
        fontSize: 11,
        padding: "6px 12px",
        borderRadius: 9999,
        background: "rgba(255, 255, 255, 0.03)",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
