"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCcw, UploadCloud, X, XCircle, ExternalLink, ArrowRight, Folder, Database, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { errorMessage, uploadResumes, type Job } from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";
import { GoogleDriveSvg, CatsAtsSvg, PipelineProgressionSvg } from "./indicators";
import type { BatchProgress } from "./useBatchProgress";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
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

export function UploadPanel({
  open, onOpenChange, job, batchId, progress, onBatchStarted, onUploaded, onRetry, onViewCandidates, onStartNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  batchId: string | null;
  progress: BatchProgress | null;
  onBatchStarted: (batchId: string) => void;
  onUploaded: () => void;
  onRetry: (uploadId: string) => Promise<void>;
  onViewCandidates: () => void;
  onStartNew: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"files" | "drive" | "cats">("files");

  // Local File Upload State
  const [entries, setEntries] = useState<Entry[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sentBytes, setSentBytes] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Google Drive State
  const [driveUrl, setDriveUrl] = useState("");
  const [driveValidating, setDriveValidating] = useState(false);
  const [driveResult, setDriveResult] = useState<{
    type: "file" | "folder";
    name: string;
    itemCount?: number;
    sampleFiles?: string[];
  } | null>(null);
  const [driveSuccess, setDriveSuccess] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  // CATS Internal Tool State
  const [catsId, setCatsId] = useState("");
  const [catsFetching, setCatsFetching] = useState(false);
  const [catsCandidate, setCatsCandidate] = useState<{
    id: string;
    name: string;
    role: string;
    experience: string;
    skills: string[];
    matchScore: number;
    email: string;
  } | null>(null);
  const [catsImportSuccess, setCatsImportSuccess] = useState(false);
  const [catsError, setCatsError] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const pending = entries.filter((e) => e.state === "selected");
  const pendingBytes = pending.reduce((n, e) => n + e.file.size, 0);
  const totalBytes = entries.reduce((n, e) => n + e.file.size, 0);

  function addFiles(list: FileList | File[]) {
    const seen = new Set(entries.map((e) => e.key));
    const accepted: Entry[] = [];
    const notes: string[] = [];
    for (const file of Array.from(list)) {
      if (!/\.(pdf|docx)$/i.test(file.name)) notes.push(`${file.name}: Only PDF/DOCX resumes supported.`);
      else if (file.size === 0) notes.push(`${file.name}: Empty file.`);
      else if (file.size > MAX_FILE_BYTES) notes.push(`${file.name}: Exceeds ${MAX_FILE_BYTES / (1024 * 1024)} MB limit.`);
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

  async function startFileUpload() {
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

  // Handle Google Drive link verification (Simulated)
  const handleVerifyDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!driveUrl.trim()) return;
    setDriveValidating(true);
    setDriveError(null);
    setDriveResult(null);
    setDriveSuccess(false);

    setTimeout(() => {
      setDriveValidating(false);
      const isFolder = driveUrl.includes("folders") || driveUrl.includes("drive/folders");
      if (isFolder) {
        setDriveResult({
          type: "folder",
          name: "Q3_Candidate_Submissions_Engineering",
          itemCount: 6,
          sampleFiles: [
            "Resume_Priya_Patel_SeniorAI.pdf",
            "Resume_David_Kim_MLOps.pdf",
            "Resume_Sarah_Jenkins_Backend.pdf",
            "Resume_Alex_Rivera_Distributed.pdf",
            "Resume_Elena_Chen_Systems.pdf",
            "Resume_Rohan_Mehta_Platform.pdf",
          ],
        });
      } else {
        setDriveResult({
          type: "file",
          name: "Candidate_Resume_Verified.pdf",
          itemCount: 1,
          sampleFiles: ["Candidate_Resume_Verified.pdf"],
        });
      }
    }, 600);
  };

  const handleImportDrive = async () => {
    if (!driveResult) return;
    setDriveValidating(true);
    setTimeout(() => {
      setDriveValidating(false);
      setDriveSuccess(true);
      onUploaded();
    }, 900);
  };

  // Handle CATS Internal Tool ID lookup (Simulated)
  const handleFetchCats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catsId.trim()) return;
    setCatsFetching(true);
    setCatsError(null);
    setCatsCandidate(null);
    setCatsImportSuccess(false);

    setTimeout(() => {
      setCatsFetching(false);
      setCatsCandidate({
        id: catsId.trim().toUpperCase(),
        name: "Aarav Sharma",
        role: "Senior AI / Backend Engineer",
        experience: "5.5 years",
        skills: ["Python", "FastAPI", "PyTorch", "PostgreSQL", "Docker"],
        matchScore: 92,
        email: "aarav.sharma@domain.io",
      });
    }, 700);
  };

  const handleImportCats = async () => {
    if (!catsCandidate) return;
    setCatsFetching(true);
    setTimeout(() => {
      setCatsFetching(false);
      setCatsImportSuccess(true);
      onUploaded();
    }, 800);
  };

  const status = progress?.status;
  const counts = status?.counts;
  const inTrackMode = Boolean(batchId);

  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl rounded-2xl border-zinc-200 bg-white p-6 shadow-xl">
        <DialogHeader className="pb-3 border-b border-zinc-100">
          <DialogTitle className="text-base font-bold text-zinc-900">Add Candidates</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Intake resumes for <span className="font-semibold text-zinc-800">{job.title}</span>
          </DialogDescription>
        </DialogHeader>

        {/* 3 Intake Tabs */}
        <div className="flex rounded-xl bg-zinc-100 p-1 gap-1 my-2">
          <button
            type="button"
            onClick={() => setActiveTab("files")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              activeTab === "files" ? "bg-zinc-900 text-white shadow-2xs" : "text-zinc-600 hover:text-zinc-900"
            )}
          >
            <UploadCloud className="h-4 w-4" />
            <span>Upload Files</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("drive")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              activeTab === "drive" ? "bg-zinc-900 text-white shadow-2xs" : "text-zinc-600 hover:text-zinc-900"
            )}
          >
            <GoogleDriveSvg className="h-4 w-4" />
            <span>Google Drive</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cats")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer",
              activeTab === "cats" ? "bg-zinc-900 text-white shadow-2xs" : "text-zinc-600 hover:text-zinc-900"
            )}
          >
            <CatsAtsSvg className="h-4 w-4" />
            <span>CATS Tool</span>
          </button>
        </div>

        {/* ── TAB 1: FILE UPLOAD ── */}
        {activeTab === "files" && (
          <div className="space-y-4 pt-1">
            {!uploading && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all",
                  dragging
                    ? "border-zinc-900 bg-zinc-100"
                    : "border-zinc-200 bg-zinc-50/50 hover:bg-zinc-50 hover:border-zinc-400"
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-800 mb-3 shadow-2xs">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold text-zinc-900">
                  Click or drag resumes here
                </p>
                <p className="text-[11px] text-zinc-400 mt-1">PDF or DOCX up to 25MB each</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx"
                  onChange={(e) => e.target.files?.length && addFiles(e.target.files)}
                  className="hidden"
                />
              </div>
            )}

            {/* Selected Files List */}
            {entries.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {entries.map((e) => (
                  <div key={e.key} className="flex items-center justify-between p-2.5 rounded-xl border border-zinc-200/80 bg-white text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 text-zinc-600 shrink-0" />
                      <span className="font-medium text-zinc-800 truncate">{e.file.name}</span>
                      <span className="text-[10px] text-zinc-400 font-mono">({formatBytes(e.file.size)})</span>
                    </div>
                    {!uploading && (
                      <button onClick={() => removeEntry(e.key)} className="text-zinc-400 hover:text-rose-500 p-1 cursor-pointer">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {uploadError && <ErrorBanner message={uploadError} />}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-9 rounded-xl border-zinc-200 text-xs font-semibold cursor-pointer">
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pending.length === 0 || uploading}
                onClick={startFileUpload}
                className="h-9 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-4 shadow-2xs cursor-pointer"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Process {pending.length > 0 ? `${pending.length} Resumes` : "Upload"}
              </Button>
            </div>
          </div>
        )}

        {/* ── TAB 2: GOOGLE DRIVE LINK ── */}
        {activeTab === "drive" && (
          <div className="space-y-4 pt-1">
            <form onSubmit={handleVerifyDrive} className="space-y-3">
              <label className="block text-xs font-semibold text-zinc-700">
                Google Drive URL (Single Resume or Shared Folder)
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://drive.google.com/drive/folders/... or /file/d/..."
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  className="flex-1 h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:outline-none focus:border-blue-500"
                  required
                />
                <Button
                  type="submit"
                  disabled={driveValidating || !driveUrl.trim()}
                  className="h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-4 shadow-2xs cursor-pointer"
                >
                  {driveValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify Link"}
                </Button>
              </div>
            </form>

            {driveResult && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GoogleDriveSvg className="h-4 w-4" />
                    <span className="font-bold text-zinc-900">{driveResult.name}</span>
                  </div>
                  <span className="rounded-full bg-zinc-100 text-zinc-800 border border-zinc-200 px-2 py-0.5 text-[10px] font-bold">
                    {driveResult.itemCount} document(s) detected
                  </span>
                </div>

                {driveResult.sampleFiles && (
                  <div className="space-y-1.5 pl-1 max-h-32 overflow-y-auto">
                    {driveResult.sampleFiles.map((fname, i) => (
                      <div key={i} className="flex items-center gap-2 text-zinc-600 text-[11px]">
                        <FileText className="h-3 w-3 text-zinc-500 shrink-0" />
                        <span className="truncate font-mono">{fname}</span>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  onClick={handleImportDrive}
                  disabled={driveValidating}
                  className="w-full h-9 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold mt-2 cursor-pointer shadow-2xs"
                >
                  {driveValidating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Import & Parse {driveResult.itemCount} Resumes from Drive
                </Button>
              </div>
            )}

            {driveSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Resumes successfully synced from Google Drive and queued for analysis!</span>
              </div>
            )}

            {driveError && <ErrorBanner message={driveError} />}
          </div>
        )}

        {/* ── TAB 3: CATS INTERNAL ATS TOOL ── */}
        {activeTab === "cats" && (
          <div className="space-y-4 pt-1">
            <form onSubmit={handleFetchCats} className="space-y-3">
              <label className="block text-xs font-semibold text-zinc-700">
                CATS Candidate ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. CATS-90421"
                  value={catsId}
                  onChange={(e) => setCatsId(e.target.value)}
                  className="flex-1 h-10 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:outline-none focus:border-zinc-900 font-mono uppercase"
                  required
                />
                <Button
                  type="submit"
                  disabled={catsFetching || !catsId.trim()}
                  className="h-10 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold px-4 shadow-2xs cursor-pointer"
                >
                  {catsFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch Record"}
                </Button>
              </div>
              <p className="text-[11px] text-zinc-400">
                Pulls candidate record, verified skill stack, and resume from internal CATS system.
              </p>
            </form>

            {catsCandidate && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
                  <div>
                    <p className="font-bold text-zinc-900 text-sm">{catsCandidate.name}</p>
                    <p className="text-[11px] text-zinc-500">{catsCandidate.role} · {catsCandidate.experience}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold">
                    {catsCandidate.matchScore}% Verified Fit
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {catsCandidate.skills.map((s) => (
                    <span key={s} className="rounded-md bg-white border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-700">
                      {s}
                    </span>
                  ))}
                </div>

                <Button
                  onClick={handleImportCats}
                  disabled={catsFetching}
                  className="w-full h-9 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold mt-1 cursor-pointer shadow-2xs"
                >
                  {catsFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Import Candidate to {job.title}
                </Button>
              </div>
            )}

            {catsImportSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Candidate record imported from CATS tool and added to pipeline!</span>
              </div>
            )}

            {catsError && <ErrorBanner message={catsError} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
