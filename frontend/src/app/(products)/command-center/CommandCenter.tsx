"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Check, CircleSlash, FileText, Loader2, Paperclip, Play, RotateCcw, Send, ShieldCheck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyNote, InfoRow, Panel, StatusDot, Tag, btnPrimary, btnSecondary, inputCls, labelCls, type Tone,
} from "@/components/ui/panel";
import { getAuthHeaders } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiConfig";
import { errorMessage, getMe, type Me } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";
import { TryFreeBanner } from "@/components/TryFreeBanner";

/** HR Command Center.
 *
 * Describe an HR task → the backend LLM planner (agent_tools/planner.py)
 * picks real tools from the HR tool allowlist (api/agent.py::HR_TOOLS) →
 * the recruiter reviews the plan → steps run one at a time against the real
 * tool endpoints. Anything that contacts a person or writes to a calendar
 * pauses for explicit approval. Nothing here is simulated: a step is shown as
 * done only when its API call returned success, and results are rendered
 * from the actual response body.
 *
 * Deliberately no automatic retries: retrying a timed-out "send WhatsApp" or
 * "place call" can deliver it twice. A failed step offers a manual retry.
 */

const API = getApiBaseUrl();
const PLAN_TIMEOUT_MS = 90_000;
const TOOL_TIMEOUT_MS = 120_000;

type ToolInfo = {
  connector: string;
  connector_display_name?: string;
  tool: string;
  description: string;
  status: string;
  input_schema?: { required?: string[]; properties?: Record<string, { type?: string; description?: string }> };
};
type PlanStep = { connector: string; tool: string; params: Record<string, unknown>; invalid?: boolean };
type StepStatus = "pending" | "running" | "done" | "failed" | "awaiting_approval";
type StepState = {
  status: StepStatus;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
};
type Attachment = { file_path: string; filename: string; size: number };

const OUTREACH = new Set([
  "whatsapp.send_whatsapp_message",
  "gmail.send_email",
  "telephonic.place_screening_call",
  "google_calendar.create_meet",
  "google_calendar.create_event",
]);
const key = (s: { connector: string; tool: string }) => `${s.connector}.${s.tool}`;

const EXAMPLES = [
  "Summarise the attached resume and list the candidate's employers",
  "Parse the attached resume and match it against: Backend engineer, 3+ years Python, FastAPI and AWS",
  "Check whether the company Logicmotive looks like a legitimate employer",
  "Draft a take-home assignment for a junior data analyst role",
];

async function call(path: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...getAuthHeaders() },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: body as Record<string, unknown> };
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      body: { detail: timedOut ? `No response after ${Math.round(timeoutMs / 1000)}s. The request may still be running on the server.` : "Couldn't reach the server." },
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function detailText(body: Record<string, unknown>, status: number): string {
  const d = body?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return "Your role doesn't have access to this.";
  if (status === 429) return "Too many requests — wait a minute and try again.";
  return status ? `Request failed (HTTP ${status}).` : "Request failed.";
}

const STEP_REF = /^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$/;

function resolveParams(value: unknown, results: Record<number, Record<string, unknown> | undefined>): unknown {
  if (typeof value === "string") {
    const m = value.trim().match(STEP_REF);
    if (!m) return value;
    let cur: unknown = results[Number(m[1])];
    for (const part of m[2].split(".").filter(Boolean)) {
      if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
      else return value;
    }
    return cur === undefined ? value : cur;
  }
  if (Array.isArray(value)) return value.map((v) => resolveParams(v, results));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveParams(v, results)]));
  }
  return value;
}

const isUnresolved = (v: unknown) => v === undefined || v === null || (typeof v === "string" && (v.trim() === "" || STEP_REF.test(v.trim())));

const pretty = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ── Page ────────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [planPrompt, setPlanPrompt] = useState("");
  const [steps, setSteps] = useState<StepState[]>([]);
  const [running, setRunning] = useState(false);
  const resultsRef = useRef<Record<number, Record<string, unknown> | undefined>>({});

  useEffect(() => {
    getMe().then(setMe).catch((err) => setMeError(errorMessage(err)));
  }, []);

  const allowed = me?.permissions.includes("analyze") ?? false;

  useEffect(() => {
    if (!allowed) return;
    call("/api/v1/agent/tools", { method: "GET" }, 20_000).then(({ ok, status, body }) => {
      if (ok) setTools((body.tools as ToolInfo[]) || []);
      else setToolsError(detailText(body, status));
    });
  }, [allowed]);

  const toolIndex = useMemo(() => new Map((tools || []).map((t) => [key(t), t])), [tools]);

  const uploadResume = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    const { ok, status, body } = await call("/api/v1/agent/attachments", { method: "POST", body: form }, 60_000);
    if (ok) setAttachment(body as unknown as Attachment);
    else setUploadError(detailText(body, status));
    setUploading(false);
  };

  const makePlan = async () => {
    if (!prompt.trim()) return;
    setPlanning(true);
    setPlanError(null);
    setPlan(null);
    setSteps([]);
    resultsRef.current = {};
    const { ok, status, body } = await call(
      "/api/v1/agent/plan",
      { method: "POST", body: JSON.stringify({ prompt, ...(attachment ? { attachment: { file_path: attachment.file_path, filename: attachment.filename } } : {}) }) },
      PLAN_TIMEOUT_MS,
    );
    setPlanning(false);
    if (!ok) return setPlanError(detailText(body, status));
    if (body.error) return setPlanError(String(body.error));
    const planSteps = (body.steps as PlanStep[]) || [];
    if (planSteps.length === 0) {
      return setPlanError("The planner couldn't map this request to any of the available HR tools. Try rephrasing, or check the tool list on the right.");
    }
    setPlan(planSteps);
    setPlanPrompt(prompt);
    setSteps(planSteps.map((s) => ({ status: "pending", params: s.params || {} })));
  };

  const patchStep = (i: number, patch: Partial<StepState>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  /** Runs steps from `start` until one needs approval, fails, or all finish. */
  const runFrom = async (start: number, approvedParams?: Record<string, unknown>) => {
    if (!plan) return;
    setRunning(true);
    for (let i = start; i < plan.length; i++) {
      const step = plan[i];
      const params = i === start && approvedParams
        ? approvedParams
        : (resolveParams(step.params || {}, resultsRef.current) as Record<string, unknown>);

      if (OUTREACH.has(key(step)) && !(i === start && approvedParams)) {
        patchStep(i, { status: "awaiting_approval", params });
        setRunning(false);
        return;
      }

      patchStep(i, { status: "running", params, error: undefined });
      const t0 = performance.now();
      const { ok, status, body } = await call(
        `/api/v1/agent/tools/${step.connector}/${step.tool}/call`,
        { method: "POST", body: JSON.stringify(params) },
        TOOL_TIMEOUT_MS,
      );
      const durationMs = Math.round(performance.now() - t0);
      if (!ok) {
        patchStep(i, { status: "failed", error: detailText(body, status), durationMs });
        setRunning(false);
        return;
      }
      resultsRef.current[i + 1] = body;
      patchStep(i, { status: "done", result: body, durationMs });
    }
    setRunning(false);
  };

  const reset = () => {
    setPlan(null);
    setSteps([]);
    setPlanError(null);
    resultsRef.current = {};
  };

  const blocked = plan?.some((s) => s.invalid || toolIndex.get(key(s))?.status === "not_configured") ?? false;
  const started = steps.some((s) => s.status !== "pending");
  const finished = plan !== null && steps.length > 0 && steps.every((s) => s.status === "done");

  // ── Access states ──
  if (meError) {
    return (
      <Shell>
        <ErrorBanner message={meError} />
      </Shell>
    );
  }
  if (!me) {
    return (
      <Shell>
        <Skeleton className="h-40 w-full rounded-lg bg-zinc-200/70" />
      </Shell>
    );
  }
  if (!allowed) {
    return (
      <Shell>
        <EmptyNote>
          The HR Command Center is available to HR Admins, Recruiters and Hiring Managers. Your role ({me.role.replace(/_/g, " ")}) doesn&apos;t have access — ask an HR Admin.
        </EmptyNote>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ── Compose ── */}
          <Panel title="What do you need done?" description="The AI planner turns this into steps using real HR tools. You review the plan before anything runs.">
            <div className="space-y-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) makePlan();
                }}
                rows={4}
                maxLength={4000}
                disabled={planning || running}
                placeholder="e.g. Parse the attached resume and match it against a backend engineer role that needs Python and AWS"
                aria-label="Describe the task"
                className={cn(inputCls, "h-auto py-2.5 leading-relaxed")}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadResume(f);
                      e.target.value = "";
                    }}
                  />
                  {attachment ? (
                    <Tag className="max-w-[260px]">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <span className="truncate">{attachment.filename}</span>
                      <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment" className="ml-0.5 text-zinc-400 hover:text-zinc-700 cursor-pointer">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Tag>
                  ) : (
                    <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading || planning || running} className={btnSecondary}>
                      {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4 text-zinc-400" />}
                      {uploading ? "Uploading…" : "Attach resume (PDF)"}
                    </Button>
                  )}
                </div>
                <Button onClick={makePlan} disabled={!prompt.trim() || planning || running} className={btnPrimary}>
                  {planning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                  {planning ? "Planning…" : "Create plan"}
                </Button>
              </div>

              {uploadError && <ErrorBanner message={uploadError} />}

              {!plan && !planning && (
                <div>
                  <p className={labelCls}>Examples</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setPrompt(ex)}
                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-left text-xs text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {planning && (
            <Panel>
              <p className="flex items-center gap-2 text-[13px] text-zinc-600">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> The planner is choosing tools for this request. This usually takes 5–20 seconds.
              </p>
            </Panel>
          )}

          {planError && <ErrorBanner message={planError} />}

          {/* ── Plan + execution ── */}
          {plan && (
            <Panel
              title="Plan"
              description={`For: "${planPrompt.length > 120 ? planPrompt.slice(0, 120) + "…" : planPrompt}"`}
              action={
                <>
                  <Button variant="outline" onClick={reset} disabled={running} className={btnSecondary}>
                    <RotateCcw className="mr-1.5 h-4 w-4 text-zinc-400" /> New task
                  </Button>
                  {!started && (
                    <Button onClick={() => runFrom(0)} disabled={blocked || running} className={btnPrimary}>
                      <Play className="mr-1.5 h-4 w-4" /> Run plan
                    </Button>
                  )}
                </>
              }
            >
              {blocked && (
                <p className="mb-3 flex items-start gap-2 text-[13px] text-zinc-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  This plan uses a tool that isn&apos;t available or configured, so it can&apos;t run. Rephrase the request.
                </p>
              )}
              <ol className="space-y-3">
                {plan.map((step, i) => (
                  <StepCard
                    key={i}
                    index={i}
                    step={step}
                    state={steps[i]}
                    tool={toolIndex.get(key(step))}
                    running={running}
                    onApprove={(params) => runFrom(i, params)}
                    onRetry={() => runFrom(i)}
                  />
                ))}
              </ol>
              {finished && (
                <p className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 text-[13px] text-zinc-700">
                  <Check className="h-4 w-4 text-emerald-600" /> All {plan.length} step{plan.length === 1 ? "" : "s"} completed.
                </p>
              )}
            </Panel>
          )}
        </div>

        {/* ── Tools ── */}
        <div className="space-y-5">
          <Panel title="Available tools" description="What the planner can use, with live configuration status.">
            {toolsError ? (
              <ErrorBanner message={toolsError} />
            ) : !tools ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-full rounded bg-zinc-100" />)}
              </div>
            ) : (
              <ToolList tools={tools} />
            )}
          </Panel>
          <Panel title="Safety">
            <ul className="space-y-2 text-[13px] text-zinc-600">
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" /> Messages, calls and calendar invites never run without your approval.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" /> Failed steps are never retried automatically, so nothing is sent twice.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" /> Attached resumes are only readable by this tool.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">HR Command Center</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Describe an HR task in plain language. AI plans it with real tools; you approve anything that contacts a candidate.
            </p>
          </div>
          <Link href="/recruitment" className={cn(btnSecondary, "inline-flex items-center")}>
            Open Recruitment
          </Link>
        </div>
        <TryFreeBanner />
        {children}
      </div>
    </div>
  );
}

// ── Step card ───────────────────────────────────────────────────────────

const STATUS: Record<StepStatus, { label: string; tone: Tone }> = {
  pending: { label: "Not run", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  awaiting_approval: { label: "Needs your approval", tone: "warning" },
};

function StepCard({
  index, step, state, tool, running, onApprove, onRetry,
}: {
  index: number;
  step: PlanStep;
  state?: StepState;
  tool?: ToolInfo;
  running: boolean;
  onApprove: (params: Record<string, unknown>) => void;
  onRetry: () => void;
}) {
  const st = state?.status ?? "pending";
  const outreach = OUTREACH.has(key(step));
  const params = state?.params ?? step.params ?? {};
  return (
    <li className="rounded-md border border-zinc-200">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-zinc-900">
            <span className="mr-2 text-zinc-400 tabular-nums">{index + 1}.</span>
            {tool?.description?.split(/[.—]/)[0] || pretty(step.tool)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
            {step.connector}.{step.tool}
            {outreach && <span className="ml-2 font-sans text-zinc-500">· contacts a person — asks for approval</span>}
          </p>
          {step.invalid && <p className="mt-1 text-xs text-rose-600">Not a tool this workspace provides.</p>}
          {tool?.status === "not_configured" && <p className="mt-1 text-xs text-amber-700">This tool isn&apos;t configured on the server.</p>}
        </div>
        <div className="flex items-center gap-3">
          {typeof state?.durationMs === "number" && <span className="text-xs tabular-nums text-zinc-400">{(state.durationMs / 1000).toFixed(1)}s</span>}
          {st === "running" ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700"><Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> Running</span>
          ) : (
            <StatusDot tone={STATUS[st].tone}>{STATUS[st].label}</StatusDot>
          )}
        </div>
      </div>

      {st === "awaiting_approval" ? (
        <ApprovalForm tool={tool} params={params} disabled={running} onApprove={onApprove} />
      ) : (
        Object.keys(params).length > 0 && st !== "done" && (
          <dl className="border-t border-zinc-100 px-4 py-2">
            {Object.entries(params).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
              <InfoRow key={k} label={pretty(k)}>
                <ParamValue value={v} />
              </InfoRow>
            ))}
          </dl>
        )
      )}

      {st === "failed" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
          <p className="text-[13px] text-rose-700">{state?.error}</p>
          <Button variant="outline" onClick={onRetry} disabled={running} className={btnSecondary}>
            <RotateCcw className="mr-1.5 h-4 w-4 text-zinc-400" /> Retry this step
          </Button>
        </div>
      )}

      {st === "done" && state?.result && (
        <div className="border-t border-zinc-100 px-4 py-3">
          <ResultView result={state.result} />
        </div>
      )}
    </li>
  );
}

function ParamValue({ value }: { value: unknown }) {
  if (typeof value === "string" && STEP_REF.test(value.trim())) {
    const m = value.trim().match(STEP_REF)!;
    return <span className="text-zinc-500">from step {m[1]}{m[2] ? ` (${m[2].slice(1)})` : ""}</span>;
  }
  if (value === "" || value === null || value === undefined) return <span className="text-amber-700">Missing</span>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap break-words">{value.length > 300 ? value.slice(0, 300) + "…" : value}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object")) return <span>{value.join(", ")}</span>;
  return <span className="font-mono text-xs">{JSON.stringify(value).slice(0, 300)}</span>;
}

function ApprovalForm({
  tool, params, disabled, onApprove,
}: {
  tool?: ToolInfo;
  params: Record<string, unknown>;
  disabled: boolean;
  onApprove: (params: Record<string, unknown>) => void;
}) {
  const required = tool?.input_schema?.required ?? [];
  const props = tool?.input_schema?.properties ?? {};
  const editable = Array.from(new Set([...required, ...Object.keys(params)])).filter(
    (k) => !k.startsWith("_") && (props[k]?.type ?? "string") === "string" && (typeof params[k] === "string" || params[k] === undefined),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((k) => [k, isUnresolved(params[k]) ? "" : String(params[k])])),
  );
  const missing = required.filter((k) => editable.includes(k) ? !values[k]?.trim() : isUnresolved(params[k]));

  return (
    <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3">
      <p className="text-[13px] text-zinc-700">Check exactly what will be sent. Nothing happens until you approve.</p>
      {editable.map((k) => {
        const long = k === "message" || k === "body";
        return (
          <div key={k}>
            <label htmlFor={`ap-${k}`} className={labelCls}>
              {pretty(k)}{required.includes(k) && <span className="text-rose-500"> *</span>}
            </label>
            {long ? (
              <textarea
                id={`ap-${k}`}
                rows={4}
                value={values[k]}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                className={cn(inputCls, "h-auto py-2")}
              />
            ) : (
              <input id={`ap-${k}`} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} className={inputCls} />
            )}
          </div>
        );
      })}
      {missing.length > 0 && <p className="text-xs text-amber-700">Fill in: {missing.map(pretty).join(", ")}</p>}
      <div className="flex justify-end">
        <Button
          onClick={() => onApprove({ ...params, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) })}
          disabled={disabled || missing.length > 0}
          className={btnPrimary}
        >
          <Check className="mr-1.5 h-4 w-4" /> Approve and run
        </Button>
      </div>
    </div>
  );
}

// ── Results: rendered straight from the response body ─────────────────

function ResultView({ result }: { result: Record<string, unknown> }) {
  const [raw, setRaw] = useState(false);
  const entries = Object.entries(result).filter(([k, v]) => v !== null && v !== undefined && v !== "" && k !== "resume_text");
  const placeholder = entries.filter(([k, v]) => k.endsWith("_is_real") && (v === false || v === "false")).map(([k]) => k.replace(/_is_real$/, ""));

  return (
    <div className="space-y-2">
      {result.degraded === true && (
        <p className="flex items-start gap-2 text-xs text-zinc-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          The AI provider was unavailable, so this used a basic non-AI fallback. Treat the values below as approximate.
        </p>
      )}
      {placeholder.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-zinc-700">
          <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
          Placeholder, not a real score: {placeholder.map(pretty).join(", ")}.
        </p>
      )}
      <dl className="divide-y divide-zinc-100">
        {entries
          .filter(([k]) => k !== "degraded" && !k.endsWith("_is_real") && !(placeholder.some((p) => k.startsWith(p))))
          .slice(0, 16)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-[13px]">
              <dt className="text-zinc-500">{pretty(k)}</dt>
              <dd className="min-w-0 text-zinc-900"><ValueView value={v} /></dd>
            </div>
          ))}
      </dl>
      <button type="button" onClick={() => setRaw((r) => !r)} className="text-xs font-medium text-blue-600 hover:underline cursor-pointer">
        {raw ? "Hide" : "Show"} raw response
      </button>
      {raw && (
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-700">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ValueView({ value }: { value: unknown }) {
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number" || typeof value === "string") {
    const s = String(value);
    if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="break-all text-blue-600 hover:underline">{s}</a>;
    return <span className="whitespace-pre-wrap break-words">{s.length > 600 ? s.slice(0, 600) + "…" : s}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400">None</span>;
    if (value.every((v) => typeof v !== "object")) {
      return <div className="flex flex-wrap gap-1">{value.map((v, i) => <Tag key={i}>{String(v)}</Tag>)}</div>;
    }
    return (
      <ul className="space-y-1">
        {value.slice(0, 8).map((v, i) => (
          <li key={i} className="text-xs text-zinc-700">
            {v && typeof v === "object"
              ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== "" && typeof x !== "object").map(([k, x]) => `${pretty(k)}: ${x}`).join(" · ")
              : String(v)}
          </li>
        ))}
        {value.length > 8 && <li className="text-xs text-zinc-400">+{value.length - 8} more</li>}
      </ul>
    );
  }
  if (value && typeof value === "object") {
    const flat = Object.entries(value as Record<string, unknown>).filter(([, x]) => x !== null && x !== "" && typeof x !== "object");
    return <span className="text-xs text-zinc-700">{flat.map(([k, x]) => `${pretty(k)}: ${x}`).join(" · ") || "—"}</span>;
  }
  return <span>{String(value)}</span>;
}

function ToolList({ tools }: { tools: ToolInfo[] }) {
  const groups = new Map<string, ToolInfo[]>();
  for (const t of tools) {
    const g = t.connector_display_name || t.connector;
    groups.set(g, [...(groups.get(g) || []), t]);
  }
  return (
    <ul className="-my-2 divide-y divide-zinc-100">
      {Array.from(groups.entries()).map(([group, list]) => {
        const configured = list.every((t) => t.status !== "not_configured");
        return (
          <li key={group} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-zinc-900">{group}</p>
              <p className="truncate text-xs text-zinc-500">{list.map((t) => pretty(t.tool)).join(", ")}</p>
            </div>
            <StatusDot tone={configured ? "success" : "warning"} className="shrink-0 text-xs">
              {configured ? "Configured" : "Not configured"}
            </StatusDot>
          </li>
        );
      })}
    </ul>
  );
}
