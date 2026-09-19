"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCcw, UploadCloud, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { errorMessage, uploadResumes, type Job } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";
import { PipelineProgressionSvg } from "./indicators";
import type { BatchProgress } from "./useBatchProgress";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // the server's per-file limit
// A request body is capped at 25MB by the reverse proxy, multipart overhead
// included, so a big batch is sent as several requests that share one batch.
const CHUNK_MAX_FILES = 20;
const CHUNK_MAX_BYTES = 18 * 1024 * 1024;

type EntryState = "selected" | "uploading" | "sent" | "rejected";
interface Entry {
  key: string;
  file: File;
  state: EntryState;
  error?: string;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function chunkEntries(entries: Entry[]): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  let bytes = 0;
  for (const e of entries) {
    if (current.length && (current.length >= CHUNK_MAX_FILES || bytes + e.file.size > CHUNK_MAX_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(e);
    bytes += e.file.size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[#F2F4F7]"
    >
      <div
        className="h-full rounded-full bg-[#171717] transition-all duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: "danger" | "info" | "success" }) {
  return (
    <div className="rounded-md border border-[#E4E7EC] bg-white px-3 py-2">
      <div
        className={cn(
          "text-lg font-semibold tabular-nums leading-none",
          tone === "danger" && value > 0 ? "text-[#F04438]" : tone === "info" && value > 0 ? "text-[#2E90FA]" : "text-[#171717]"
        )}
      >
        {value}
      </div>
      <div className="text-[10px] font-medium text-[#667085] mt-1">{label}</div>
    </div>
  );
}

export function UploadPanel({
  open, onOpenChange, job, batchId, progress, onBatchStarted, onUploaded, onRetry, onViewCandidates, onStartNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  batchId: string | null;
  progress: BatchProgress | null;
  onBatchStarted: (batchId: string) => void;
  /** Called after every chunk lands, so polling restarts if it had already finished. */
  onUploaded: () => void;
  onRetry: (uploadId: string) => Promise<void>;
  onViewCandidates: () => void;
  /** Forget the finished batch so a new one can be started. */
  onStartNew: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sentBytes, setSentBytes] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pending = entries.filter((e) => e.state === "selected");
  const pendingBytes = pending.reduce((n, e) => n + e.file.size, 0);
  const totalBytes = entries.reduce((n, e) => n + e.file.size, 0);
  const settled = entries.filter((e) => e.state === "sent" || e.state === "rejected").length;

  function add(list: FileList | File[]) {
    const seen = new Set(entries.map((e) => e.key));
    const accepted: Entry[] = [];
    const notes: string[] = [];
    for (const file of Array.from(list)) {
      if (!/\.pdf$/i.test(file.name)) notes.push(`${file.name}: only PDF resumes are supported.`);
      else if (file.size === 0) notes.push(`${file.name}: the file is empty.`);
      else if (file.size > MAX_FILE_BYTES) notes.push(`${file.name}: larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
      else {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          accepted.push({ key, file, state: "selected" });
        }
      }
    }
    setEntries((prev) => [...prev, ...accepted]);
    if (notes.length) setSkipped((prev) => [...prev, ...notes]);
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  function reset() {
    setEntries([]);
    setSkipped([]);
    setSentBytes(0);
    setUploadError(null);
  }

  async function start() {
    const toSend = entries.filter((e) => e.state === "selected");
    if (!toSend.length || uploading) return;
    setUploading(true);
    setUploadError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    const total = toSend.reduce((n, e) => n + e.file.size, 0);
    let doneBytes = 0;
    let batch = batchId;
    setSentBytes(0);

    try {
      for (const chunk of chunkEntries(toSend)) {
        const keys = new Set(chunk.map((e) => e.key));
        const chunkBytes = chunk.reduce((n, e) => n + e.file.size, 0);
        setEntries((prev) => prev.map((e) => (keys.has(e.key) ? { ...e, state: "uploading" } : e)));

        const res = await uploadResumes(
          job.id,
          chunk.map((e) => e.file),
          batch,
          (sent, all) => setSentBytes(doneBytes + chunkBytes * (all ? sent / all : 0)),
          controller.signal,
        );
        if (!batch) onBatchStarted(res.batch_id);
        batch = res.batch_id;

        // The server answers in the order the files were sent.
        const outcome = new Map(chunk.map((e, i) => [e.key, res.uploads[i]]));
        setEntries((prev) =>
          prev.map((e) => {
            const row = outcome.get(e.key);
            if (!row) return e;
            return row.status === "failed" ? { ...e, state: "rejected", error: row.error ?? "Rejected" } : { ...e, state: "sent" };
          }),
        );
        doneBytes += chunkBytes;
        setSentBytes(Math.min(doneBytes, total));
        onUploaded();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setEntries((prev) => prev.map((e) => (e.state === "uploading" ? { ...e, state: "selected" } : e)));
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function retry(uploadId: string) {
    setRetrying((prev) => new Set(prev).add(uploadId));
    try {
      await onRetry(uploadId);
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(uploadId);
        return next;
      });
    }
  }

  const status = progress?.status;
  const counts = status?.counts;
  const total = status?.total ?? 0;
  const finished = counts ? counts.parsed + counts.duplicate + counts.failed : 0;
  const pct = total ? Math.round((100 * finished) / total) : 0;
  const problems = (status?.uploads ?? []).filter((u) => u.status === "failed" || u.status === "duplicate");
  const inTrackMode = Boolean(batchId);
  const uploadPct = totalBytes ? Math.min(100, Math.round((100 * sentBytes) / Math.max(1, pendingBytes || totalBytes))) : 0;

  // Active step in the execution pipeline: 1 = Ingestion, 2 = Screening, 3 = Evaluating, 4 = Routing
  const activeStep = !status
    ? 1
    : status.done
    ? 4
    : (counts?.processing ?? 0) > 0
    ? 3
    : (counts?.queued ?? 0) > 0
    ? 2
    : 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl rounded-lg border-[#E4E7EC] bg-white p-5 sm:p-6 shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-[#171717]">Upload Resumes</DialogTitle>
          <DialogDescription className="text-xs text-[#667085]">
            Upload PDF resumes for <span className="font-medium text-[#171717]">{job.title}</span>.
          </DialogDescription>
        </DialogHeader>

        {/* ── Choose files ── */}
        {(!inTrackMode || pending.length > 0 || uploading) && (
          <div className="space-y-3">
            {!uploading && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  add(e.dataTransfer.files);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-7 text-center transition-all duration-150",
                  dragging
                    ? "border-[#171717] bg-[#F2F4F7] scale-[1.005] shadow-xs"
                    : "border-[#E4E7EC] bg-[#F7F8FA] hover:bg-white hover:border-[#D0D5DD]"
                )}
              >
                <UploadCloud className="h-6 w-6 text-[#98A2B3]" aria-hidden="true" />
                <p className="text-xs font-semibold text-[#171717]">Drag and drop resume PDFs here</p>
                <p className="text-[11px] text-[#98A2B3]">or</p>
                <Button variant="outline" size="sm" className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#171717] hover:bg-[#F2F4F7]" onClick={() => inputRef.current?.click()}>
                  Browse files
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Choose resume PDFs"
                  onChange={(e) => {
                    if (e.target.files) add(e.target.files);
                    e.target.value = "";
                  }}
                />
                <p className="text-xs text-[#98A2B3]">PDF only, up to 25 MB each.</p>
              </div>
            )}

            {skipped.length > 0 && (
              <div className="rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                <p className="mb-1 font-semibold">{skipped.length} file{skipped.length === 1 ? " was" : "s were"} not added:</p>
                <ul className="max-h-20 space-y-0.5 overflow-y-auto">
                  {skipped.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {entries.length > 0 && (
              <div className="rounded-lg border border-[#E4E7EC] bg-white">
                <div className="flex items-center justify-between border-b border-[#E4E7EC] px-3 py-2">
                  <p className="text-xs font-medium text-[#171717]">
                    {entries.length} file{entries.length === 1 ? "" : "s"} selected
                    <span className="ml-2 text-xs font-normal text-[#667085]">{formatBytes(totalBytes)}</span>
                  </p>
                  {!uploading && (
                    <Button variant="ghost" size="sm" onClick={reset} className="h-6 text-xs text-[#667085] hover:text-[#171717]">
                      Clear
                    </Button>
                  )}
                </div>
                <ul className="max-h-56 divide-y divide-[#E4E7EC] overflow-y-auto">
                  {entries.map((e) => (
                    <li key={e.key} className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors duration-150">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-[#98A2B3]" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[#171717]" title={e.file.name}>{e.file.name}</span>
                      <span className="shrink-0 text-xs text-[#98A2B3]">{formatBytes(e.file.size)}</span>
                      {e.state === "selected" && !uploading && (
                        <button
                          type="button"
                          onClick={() => removeEntry(e.key)}
                          className="rounded p-0.5 text-[#98A2B3] hover:bg-[#F2F4F7] hover:text-[#171717]"
                          aria-label={`Remove ${e.file.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {e.state === "uploading" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#2E90FA]" aria-label="Uploading" />}
                      {e.state === "sent" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#12B76A]" aria-label="Uploaded" />}
                      {e.state === "rejected" && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[#F04438]" title={e.error}>
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Rejected
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {uploading && (
              <div className="space-y-1.5" aria-live="polite">
                <p className="text-xs text-[#667085]">
                  Uploading… {settled} of {entries.length} files sent
                </p>
                <Bar pct={uploadPct} label="Upload progress" />
              </div>
            )}

            {uploadError && (
              <ErrorBanner
                message={`${uploadError} ${pending.length} file${pending.length === 1 ? " was" : "s were"} not sent.`}
              />
            )}
          </div>
        )}

        {/* ── Real processing progress with Agentic SVG Pipeline Indicator ── */}
        {inTrackMode && (
          <div className="space-y-3.5" aria-live="polite">
            {/* Live Agentic SVG Progression Flow */}
            <div className="rounded-lg border border-[#E4E7EC] bg-[#F7F8FA] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  Automated Evaluation Flow
                </span>
                <span className="text-[11px] text-[#12B76A] font-medium">
                  {status?.done ? "Evaluation Complete" : "Pipeline Active"}
                </span>
              </div>
              <PipelineProgressionSvg
                currentStep={activeStep}
                totalSteps={4}
                isRunning={Boolean(status && !status.done)}
              />
            </div>

            {!status ? (
              <p className="flex items-center gap-2 text-xs text-[#667085]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Checking progress…
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[#171717]">
                    {finished} of {total} resume{total === 1 ? "" : "s"} processed
                    {uploading && <span className="font-normal text-[#667085]"> · more uploading</span>}
                  </p>
                  <Bar pct={pct} label="Processing progress" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Count label="Completed" value={counts!.parsed} />
                  <Count label="Evaluating" value={counts!.processing} tone="info" />
                  <Count label="Waiting" value={counts!.queued} />
                  <Count label="Duplicates" value={counts!.duplicate} />
                  <Count label="Failed" value={counts!.failed} tone="danger" />
                </div>

                {progress?.stalled && (
                  <div className="flex items-start gap-2 rounded-md border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-xs text-[#B54708]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Resumes are saved and will be evaluated once the processing worker completes current items.
                    </span>
                  </div>
                )}

                {problems.length > 0 && (
                  <ul className="max-h-52 divide-y divide-[#E4E7EC] overflow-y-auto rounded-md border border-[#E4E7EC]">
                    {problems.map((u) => (
                      <li key={u.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                        {u.status === "failed" ? (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F04438]" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F79009]" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[#171717]" title={u.filename}>{u.filename}</p>
                          <p className="text-[11px] text-[#667085]">
                            {u.status === "duplicate"
                              ? "Already in this role. Existing profile updated."
                              : u.error || "Could not process file."}
                          </p>
                        </div>
                        {u.status === "failed" && u.retryable && (
                          <Button variant="outline" size="sm" disabled={retrying.has(u.id)} onClick={() => retry(u.id)} className="h-6 text-xs">
                            {retrying.has(u.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                            Retry
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter className="pt-2 border-t border-[#E4E7EC] flex items-center justify-end gap-2">
          {inTrackMode && status?.done && !uploading && pending.length === 0 ? (
            <>
              <Button
                variant="outline"
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
                onClick={() => {
                  reset();
                  onStartNew();
                }}
              >
                Upload more
              </Button>
              <Button
                className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
                onClick={onViewCandidates}
              >
                View candidates
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-8 rounded-md border-[#E4E7EC] text-xs font-medium text-[#667085] hover:bg-[#F2F4F7]"
                disabled={uploading}
                onClick={() => onOpenChange(false)}
              >
                {inTrackMode ? "Close" : "Cancel"}
              </Button>
              {pending.length > 0 && (
                <Button
                  className="h-8 rounded-md bg-[#171717] text-xs font-medium text-white hover:bg-[#262626]"
                  disabled={uploading}
                  onClick={start}
                >
                  {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" aria-hidden="true" />}
                  {uploadError ? "Resume upload" : `Start upload (${pending.length})`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
