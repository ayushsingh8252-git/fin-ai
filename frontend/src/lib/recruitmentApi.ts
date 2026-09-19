/* Typed client for the HR recruitment API (backend: api/recruitment.py).
 *
 * The rest of this app hand-rolls fetch() at every call site. Recruitment has
 * a dozen endpoints and the same error handling everywhere, so it gets one
 * module. Nothing here invents data: every value comes from the backend, and
 * errors are turned into sentences an HR user can act on rather than status
 * codes. */

import { getAuthHeaders } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE = `${API_URL}/api/v1/recruitment`;

// ── Types ───────────────────────────────────────────────────────────────

export type Stage =
  | "PROCESSING" | "APPLIED" | "SCREENING" | "SHORTLISTED" | "INTERVIEW"
  | "SELECTED" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";

export type UserRole = "hr_admin" | "recruiter" | "hiring_manager" | "interviewer";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  permissions: string[];
}

export interface Job {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  jd_text: string | null;
  min_experience_years: number | null;
  must_have_skills: string[];
  preferred_skills: string[];
  status: "open" | "draft" | "closed";
  created_by: string | null;
  created_at: string | null;
  pipeline: Partial<Record<Stage, number>>;
  total_candidates: number;
}

export interface JobInput {
  title: string;
  department?: string;
  location?: string;
  description?: string;
  jd_text?: string;
  min_experience_years?: number | null;
  must_have_skills?: string[];
  preferred_skills?: string[];
  status?: "open" | "draft" | "closed";
}

/** An AI-derived value together with how trustworthy it is. The UI must never
 * show `value` as an AI result unless `status` is "computed". */
export interface Score {
  value: number | null;
  status: "computed" | "degraded" | "not_computed";
  source: "llm" | "deterministic" | "derived" | null;
  reason: string | null;
}

export type AnalysisStatus = "pending" | "running" | "completed" | "partial" | "failed";

export interface CandidateBrief {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  current_role: string | null;
  experience_text: string | null;
  experience_years: number | null;
  skills: string[];
  has_resume: boolean;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  stage: Stage;
  candidate: CandidateBrief;
  scores: { ats_score: Score; match_score: Score; skill_match_score: Score };
  recommendation: string | null;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  created_at: string | null;
}

export interface CandidatePage {
  total: number;
  page: number;
  page_size: number;
  items: ApplicationRow[];
}

export interface CandidateQuery {
  q?: string;
  stage?: Stage[];
  minMatch?: number;
  minExperience?: number;
  skills?: string[];
  sort?: "match_score" | "ats_score" | "skill_match_score" | "created_at" | "stage" | "name";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export type UploadStatus = "queued" | "processing" | "parsed" | "duplicate" | "failed";

export interface UploadRow {
  id: string;
  filename: string;
  status: UploadStatus;
  error: string | null;
  candidate_id: string | null;
  application_id: string | null;
  attempts: number;
  retryable: boolean;
}

export interface UploadResponse {
  batch_id: string;
  accepted: number;
  rejected: { filename: string; reason: string }[];
  uploads: UploadRow[];
}

export interface BatchStatus {
  batch_id: string;
  job_id: string;
  total: number;
  counts: Record<UploadStatus, number>;
  done: boolean;
  oldest_queued_at: string | null;
  uploads: UploadRow[];
}

// ── Errors ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** FastAPI returns `detail` as a string for our own errors and as a list of
 * {loc,msg} objects for request-validation failures. */
function detailToText(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
      .filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }
  return null;
}

function friendlyStatus(status: number, detail: string | null): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return detail || "Your role does not have access to this.";
  if (status === 404) return detail || "We couldn't find that. It may have been removed, or you may not have access.";
  if (status === 413) return detail || "That upload is too large.";
  if (status === 429) return "You're doing that too quickly. Wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Your data is safe. Please try again.";
  return detail || "That didn't work. Please try again.";
}

/** Message safe to show an HR user for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof DOMException && err.name === "AbortError") return "The request took too long. Please try again.";
  return "We couldn't reach the server. Check your connection and try again. Nothing was lost.";
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: string | null = null;
  try {
    detail = detailToText((await res.json())?.detail);
  } catch {
    /* body was not JSON */
  }
  return new ApiError(friendlyStatus(res.status, detail), res.status);
}

// ── Transport ───────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...getAuthHeaders(),
        ...init.headers,
      },
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ── Endpoints ───────────────────────────────────────────────────────────

export const getMe = () => request<Me>("/me");

export const listJobs = () => request<{ jobs: Job[] }>("/jobs").then((r) => r.jobs);
export const getJob = (jobId: string) => request<Job>(`/jobs/${jobId}`);
export const createJob = (body: JobInput) =>
  request<Job>("/jobs", { method: "POST", body: JSON.stringify(body) });
export const updateJob = (jobId: string, body: Partial<JobInput>) =>
  request<Job>(`/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) });

export function listCandidates(jobId: string, q: CandidateQuery = {}, signal?: AbortSignal) {
  return request<CandidatePage>(
    `/jobs/${jobId}/candidates${qs({
      q: q.q,
      stage: q.stage?.join(","),
      min_match: q.minMatch,
      min_experience: q.minExperience,
      skills: q.skills?.join(","),
      sort: q.sort,
      order: q.order,
      page: q.page,
      page_size: q.pageSize,
    })}`,
    { signal },
  );
}

export const setStage = (applicationId: string, stage: Stage, reason?: string) =>
  request<ApplicationRow>(`/applications/${applicationId}/stage`, {
    method: "POST",
    body: JSON.stringify({ stage, reason: reason || null }),
  });

export const getBatch = (batchId: string) => request<BatchStatus>(`/batches/${batchId}`);
export const retryUpload = (uploadId: string) => request<UploadRow>(`/uploads/${uploadId}/retry`, { method: "POST" });

/** Uploads one chunk of resumes. Uses XHR rather than fetch because fetch
 * cannot report upload progress, and the progress bar must reflect bytes
 * that were actually sent. Pass the previous response's batch_id to add to
 * the same batch. */
export function uploadResumes(
  jobId: string,
  files: File[],
  batchId: string | null,
  onProgress: (sentBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    if (batchId) form.append("batch_id", batchId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/jobs/${jobId}/resumes`);
    for (const [k, v] of Object.entries(getAuthHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page from a proxy */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as UploadResponse);
      const detail = detailToText((body as { detail?: unknown } | null)?.detail);
      reject(new ApiError(friendlyStatus(xhr.status, detail), xhr.status));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("network"));
    xhr.timeout = 5 * 60_000;
    signal?.addEventListener("abort", () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    });
    xhr.send(form);
  });
}

/** Opens a candidate's resume. The file endpoint is authorized per candidate,
 * so it needs the Authorization header, which a plain <a href> cannot send:
 * fetch it as a blob and open that. */
export async function openResume(candidateId: string): Promise<void> {
  const res = await fetch(`${BASE}/candidates/${candidateId}/resume`, { headers: getAuthHeaders() });
  if (!res.ok) throw await parseError(res);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
