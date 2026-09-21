"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Upload, FileText, Image as ImageIcon, ShieldAlert, ScanSearch,
  Calculator, Layers, Type, Brain, CheckCircle2, XCircle, AlertTriangle,
  MinusCircle, Loader2, RotateCcw, X, Sparkles, ShieldCheck, Zap, Radio, FileScan,
  Fingerprint, FileSearch, Camera, ScanFace, CreditCard, IdCard, Landmark,
} from "lucide-react";
import { getLlmopsHeaders, getLlmopsSessionId, getLlmopsUserId } from "@/lib/llmopsIdentity";
import { getAuthHeaders, loadStoredSession } from "@/lib/auth";
import FeedbackButtons from "@/components/FeedbackButtons";
import { getApiBaseUrl } from "@/lib/apiConfig";

const API_URL = getApiBaseUrl();
const ACCEPTED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

type UploadMode = "document" | "photo";

/* ═══════════════════════════════════════════════════════════
   TYPES & STEP METADATA — mirrors the backend pipeline order:
   Metadata → OCR Quality → Arithmetic → ELA → Fonts → AI Reasoning
   ═══════════════════════════════════════════════════════════ */

type StepStatus = "pass" | "warn" | "fail" | "na" | "error";

interface StepResult {
  key: string;
  title: string;
  status: StepStatus;
  score: number | null;
  summary: string;
  details?: Record<string, unknown>;
}

interface Overall {
  risk_score: number | null;
  verdict: "likely_genuine" | "needs_review" | "likely_fraudulent" | string;
  explanation: string;
  key_concerns: string[];
  steps: StepResult[];
}

const STEP_META = [
  {
    key: "metadata",
    title: "Metadata Fingerprint Check",
    icon: ShieldAlert,
    blurb: "Reads PDF/EXIF metadata for editing-software fingerprints (Photoshop, Canva, GIMP…) and creation-vs-modification date mismatches.",
  },
  {
    key: "ocr",
    title: "OCR Extraction Quality",
    icon: ScanSearch,
    blurb: "Confirms the document's text was reliably extracted — native PDF text layer first, real Tesseract OCR confidence as a fallback signal.",
  },
  {
    key: "arithmetic",
    title: "Field Arithmetic & Logic",
    icon: Calculator,
    blurb: "Cross-checks gross − deductions = net, and that joining / relieving dates are in the right order relative to today.",
  },
  {
    key: "ela",
    title: "Error Level Analysis",
    icon: Layers,
    blurb: "Recompresses the document and diffs it against the original — pasted or re-edited regions recompress differently and light up.",
  },
  {
    key: "fonts",
    title: "Font & Layout Consistency",
    icon: Type,
    blurb: "Flags an unusually high number of distinct fonts/sizes in the body text — a common side-effect of manual edits.",
  },
  {
    key: "photo_forensics",
    title: "Photo Splice / Face Region Consistency",
    icon: ScanFace,
    blurb: "Recompresses the image and looks for a spatially contiguous region with elevated recompression error — the signature of a pasted/composited region (a swapped face, a copy-pasted photo). A regional-consistency heuristic, not a neural deepfake classifier.",
  },
  {
    key: "identity",
    title: "Duplicate Identity Scan",
    icon: Fingerprint,
    blurb: "Blocks by phone/email/name key against every prior submission, then an ensemble of a Random Forest and a small neural net scores name variants, DOB, device signal, IP, and bank account — matches cluster into an identity graph.",
  },
  {
    key: "pan",
    title: "PAN Card Validation",
    icon: CreditCard,
    blurb: "Validates the PAN format (5 letters + 4 digits + 1 letter) and its 4th-character holder-type code, and flags multiple conflicting PAN numbers in the same document.",
  },
  {
    key: "aadhaar",
    title: "Aadhaar Card Validation",
    icon: IdCard,
    blurb: "Verifies any Aadhaar-shaped 12-digit number against UIDAI's own Verhoeff checksum algorithm — a random or mistyped number fails this with near-certainty.",
  },
  {
    key: "bank_document",
    title: "Bank Details Validation",
    icon: Landmark,
    blurb: "Checks IFSC code format, MICR code length, and flags account numbers that look typed-to-look-real (repeated or sequential digits) rather than issued.",
  },
  {
    key: "resume_authenticity",
    title: "Resume Authenticity Check",
    icon: FileSearch,
    blurb: "Weighs employer/domain cross-referencing, file-metadata forensics, embedding similarity against every resume on file, and an AI-text classifier into one ensemble verdict — no single signal decides alone.",
  },
  {
    key: "reasoning",
    title: "AI Reasoning Synthesis",
    icon: Brain,
    blurb: "An LLM reads the document text plus every signal above and renders a final risk verdict.",
  },
] as const;

const STATUS_STYLES: Record<StepStatus, { icon: typeof CheckCircle2; text: string; bg: string; border: string; bar: string; label: string }> = {
  pass: { icon: CheckCircle2, text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", bar: "bg-emerald-500", label: "Pass" },
  warn: { icon: AlertTriangle, text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-500", label: "Warn" },
  fail: { icon: XCircle, text: "text-red-700", bg: "bg-red-50", border: "border-red-200", bar: "bg-red-500", label: "Fail" },
  na: { icon: MinusCircle, text: "text-zinc-500", bg: "bg-zinc-50", border: "border-zinc-200", bar: "bg-zinc-300", label: "N/A" },
  error: { icon: XCircle, text: "text-red-700", bg: "bg-red-50", border: "border-red-200", bar: "bg-red-500", label: "Error" },
};

const VERDICT_STYLES: Record<string, { text: string; chip: string; gradient: string; glow: string; label: string }> = {
  likely_genuine: {
    text: "text-emerald-700", chip: "bg-emerald-50 border-emerald-200",
    gradient: "from-emerald-600 via-emerald-600 to-teal-500", glow: "shadow-emerald-600/20", label: "Likely Genuine",
  },
  needs_review: {
    text: "text-amber-700", chip: "bg-amber-50 border-amber-200",
    gradient: "from-amber-500 via-amber-500 to-orange-500", glow: "shadow-amber-600/20", label: "Needs Review",
  },
  likely_fraudulent: {
    text: "text-red-700", chip: "bg-red-50 border-red-200",
    gradient: "from-red-600 via-red-600 to-rose-500", glow: "shadow-red-600/20", label: "Likely Fraudulent",
  },
};

const HERO_STATS = [
  { value: String(STEP_META.length), label: "forensic checks per scan" },
  { value: "Real", label: "backend — nothing simulated" },
  { value: "Live", label: "step-by-step SSE streaming" },
  { value: "PDF/JPG/PNG", label: "documents & photos" },
];

type Stage = "landing" | "uploaded" | "scanning" | "done" | "error";

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */

export default function FraudDetectionPage() {
  const [stage, setStage] = useState<Stage>("landing");
  const [uploadMode, setUploadMode] = useState<UploadMode>("document");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [scanId, setScanId] = useState("");
  const [filename, setFilename] = useState("");
  const [contentType, setContentType] = useState<"pdf" | "image">("pdf");
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [stepsByKey, setStepsByKey] = useState<Record<string, StepResult>>({});
  const [overall, setOverall] = useState<Overall | null>(null);
  const [scanError, setScanError] = useState("");

  const runId = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  // Invalidates the in-flight SSE connection on unmount/reset so late-arriving
  // events from a closed-out scan never call setState after the fact.
  useEffect(() => () => { runId.current += 1; esRef.current?.close(); }, []);

  const reset = () => {
    runId.current += 1;
    esRef.current?.close();
    esRef.current = null;
    setStage("landing");
    setUploadMode("document");
    setUploadError("");
    setScanError("");
    setStepsByKey({});
    setOverall(null);
    setScanId("");
    setFilename("");
    setPreviewImageUrl(null);
  };

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const allowedForMode = uploadMode === "photo" ? IMAGE_EXTENSIONS : ACCEPTED_EXTENSIONS;
    if (!allowedForMode.includes(ext)) {
      setUploadError(`Unsupported file type for ${uploadMode === "photo" ? "Photo / Image" : "Document"} mode. Allowed: ${allowedForMode.join(", ")}`);
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/api/v1/fraud/upload`, { method: "POST", headers: { ...getLlmopsHeaders(), ...getAuthHeaders() }, body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      setScanId(data.scan_id);
      setFilename(data.filename);
      setContentType(data.content_type);
      setPreviewImageUrl(data.preview_image_url ?? null);
      setStage("uploaded");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed. Is the backend running?");
    } finally {
      setUploading(false);
    }
  };

  const startScan = () => {
    if (!scanId) return;
    const myRun = ++runId.current;
    setStepsByKey({});
    setOverall(null);
    setScanError("");
    setStage("scanning");

    // EventSource can't set custom request headers, so identity (and now the
    // auth token — see api/deps.py::get_current_user_query) are passed as
    // query params here instead (backend accepts both — see
    // services/llmops_identity.py).
    const identityParams = new URLSearchParams();
    const sessionId = getLlmopsSessionId();
    const userId = getLlmopsUserId();
    if (sessionId) identityParams.set("session_id", sessionId);
    if (userId) identityParams.set("user_id", userId);
    identityParams.set("token", loadStoredSession()?.accessToken || "");
    const es = new EventSource(`${API_URL}/api/v1/fraud/scan/${scanId}/stream?${identityParams.toString()}`);
    esRef.current = es;

    es.onmessage = (ev) => {
      if (myRun !== runId.current) return;
      let payload: { type: string; step?: StepResult; overall?: Overall; message?: string };
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (payload.type === "step" && payload.step) {
        setStepsByKey((prev) => ({ ...prev, [payload.step!.key]: payload.step! }));
      } else if (payload.type === "complete" && payload.overall) {
        setOverall(payload.overall);
        es.close();
        setStage("done");
      } else if (payload.type === "error") {
        setScanError(payload.message || "The scan failed.");
        es.close();
        setStage("error");
      }
    };

    es.onerror = () => {
      if (myRun !== runId.current) return;
      es.close();
      setStage((current) => {
        if (current === "scanning") {
          setScanError("Lost connection to the scan stream.");
          return "error";
        }
        return current;
      });
    };
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Fraud Detection Live Agent</span>
          </div>
          <button
            onClick={reset}
            className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:bg-zinc-200 transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Restart</span>
          </button>
        </div>
      </div>

      <HeroSection />

      <section id="scanner" className="relative -mt-6 sm:-mt-10 pb-4 scroll-mt-20">
        <div className="max-w-3xl mx-auto px-6">
          <ScannerCard
            stage={stage}
            uploadMode={uploadMode}
            onUploadModeChange={setUploadMode}
            dragOver={dragOver}
            uploading={uploading}
            uploadError={uploadError}
            onDragOver={setDragOver}
            onFile={handleFile}
            filename={filename}
            contentType={contentType}
            previewImageUrl={previewImageUrl}
            onStartScan={startScan}
            stepsByKey={stepsByKey}
            scanError={scanError}
            onReset={reset}
          />
        </div>
      </section>

      {stage === "done" && overall && (
        <section className="pb-6">
          <div className="max-w-4xl mx-auto px-6">
            <ResultSummary overall={overall} onReset={reset} scanId={scanId} />
          </div>
        </section>
      )}

      <MethodologySection />
      <ClosingCtaBanner />

      <footer className="border-t border-zinc-200 bg-white py-10">
        <div className="max-w-6xl mx-auto px-6 text-center text-[12px] text-zinc-500 font-mono">
          Fin AI · Fraud Detection Live Agent — every score above is computed live from your uploaded document. Nothing here is simulated.
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════════════════════ */

function HeroSection() {
  return (
    <section className="relative pt-24 pb-16 md:pt-32 overflow-hidden">
      <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
        <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 mb-6">
          <Radio className="w-3.5 h-3.5" /> Live Agent · Real Forensic Pipeline
        </span>

        <h1 className="text-[clamp(2rem,4.5vw,3.2rem)] font-extrabold tracking-tight leading-[1.1] mb-5">
          Catch a <span className="text-blue-600">fabricated document</span> — or a fabricated identity.
        </h1>

        <p className="text-[16px] text-zinc-600 leading-relaxed max-w-xl mx-auto mb-8">
          Upload a resume, salary slip, offer letter, relieving letter, Aadhaar card, PAN card, or bank document — as a PDF or a photo. {STEP_META.length} real forensic checks run against your file live: document metadata, OCR confidence, field arithmetic, error level analysis, font consistency, photo splice/face-region consistency, a duplicate-identity scan, PAN and Aadhaar (UIDAI Verhoeff checksum) validation, bank detail validation, a resume authenticity ensemble, and a final AI-reasoned verdict. No canned demo numbers.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-5">
          <a
            href="#scanner"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20 transition-all"
          >
            Scan a Document <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="#methodology"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold border border-zinc-200 text-zinc-700 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-all"
          >
            How it works
          </a>
        </div>

        <p className="text-[12px] text-zinc-500 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" /> Real backend. <span className="font-semibold text-zinc-700">Your file never leaves this scan.</span>
        </p>
      </div>

      <div className="max-w-4xl mx-auto px-6 mt-16 pt-10 border-t border-zinc-200 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {HERO_STATS.map((s) => (
            <div key={s.label}>
              <div className="text-xl sm:text-2xl font-extrabold text-blue-600 font-mono">{s.value}</div>
              <div className="text-[12px] text-zinc-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SCANNER CARD — the real, working product (not a mock-up)
   ═══════════════════════════════════════════════════════════ */

function ScannerCard({
  stage, uploadMode, onUploadModeChange, dragOver, uploading, uploadError, onDragOver, onFile,
  filename, contentType, previewImageUrl, onStartScan, stepsByKey, scanError, onReset,
}: {
  stage: Stage; uploadMode: UploadMode; onUploadModeChange: (m: UploadMode) => void;
  dragOver: boolean; uploading: boolean; uploadError: string;
  onDragOver: (v: boolean) => void; onFile: (f: File | undefined | null) => void;
  filename: string; contentType: "pdf" | "image"; previewImageUrl: string | null;
  onStartScan: () => void; stepsByKey: Record<string, StepResult>; scanError: string; onReset: () => void;
}) {
  const doneCount = Object.keys(stepsByKey).length;
  const statusCopy =
    stage === "landing" ? "Idle · awaiting a document"
    : stage === "uploaded" ? "Ready · document loaded"
    : stage === "scanning" ? `Scanning · ${doneCount}/${STEP_META.length} steps complete`
    : stage === "done" ? "Scan complete"
    : "Scan failed";

  return (
    <div className="rounded-3xl border border-zinc-200 bg-white shadow-xl overflow-hidden">
      <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${stage === "scanning" ? "bg-blue-500 animate-pulse" : stage === "error" ? "bg-red-500" : "bg-emerald-500"}`} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-zinc-900 truncate">Fraud Detection Agent</div>
            <div className="text-[11px] text-zinc-500 font-mono flex items-center gap-1.5 truncate">
              {stage === "scanning" && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />}
              {statusCopy}
            </div>
          </div>
        </div>
        {filename && (
          <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 flex items-center gap-1 shrink-0 max-w-[160px]">
            {contentType === "image" ? <ImageIcon className="w-3 h-3 shrink-0" /> : <FileText className="w-3 h-3 shrink-0" />}
            <span className="truncate">{filename}</span>
          </span>
        )}
      </div>

      <div className="p-5 sm:p-6">
        <AnimatePresence mode="wait">
          {stage === "landing" && (
            <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <UploadDropzone
                mode={uploadMode}
                onModeChange={onUploadModeChange}
                dragOver={dragOver}
                uploading={uploading}
                error={uploadError}
                onDragOver={onDragOver}
                onFile={onFile}
              />
            </motion.div>
          )}

          {stage === "uploaded" && (
            <motion.div key="uploaded" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid sm:grid-cols-[200px_1fr] gap-5">
              <DocPreview filename={filename} contentType={contentType} previewImageUrl={previewImageUrl} scanning={false} />
              <div className="flex flex-col items-center justify-center text-center py-6 gap-4">
                <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                  <FileScan className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold text-zinc-900 mb-1">Document loaded — ready to scan</div>
                  <div className="text-xs text-zinc-500">The agent will run all {STEP_META.length} checks live, streamed step by step.</div>
                </div>
                <button
                  onClick={onStartScan}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-colors shadow-md shadow-blue-600/20"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Start Scan
                </button>
              </div>
            </motion.div>
          )}

          {(stage === "scanning" || stage === "done") && (
            <motion.div key="scan" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="grid sm:grid-cols-[200px_1fr] gap-5">
              <DocPreview
                filename={filename}
                contentType={contentType}
                previewImageUrl={previewImageUrl}
                scanning={stage === "scanning"}
                activeStepTitle={STEP_META[STEP_META.findIndex((m) => !stepsByKey[m.key])]?.title}
              />
              <StepChecklist stepsByKey={stepsByKey} scanning={stage === "scanning"} />
            </motion.div>
          )}

          {stage === "error" && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center text-center py-10 gap-3">
              <XCircle className="w-8 h-8 text-red-500" />
              <div className="text-sm font-bold text-zinc-900">Scan failed</div>
              <div className="text-xs text-zinc-500 max-w-sm">{scanError}</div>
              <button
                onClick={onReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 text-xs font-bold hover:bg-zinc-200 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Try another document
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   UPLOAD DROPZONE
   ═══════════════════════════════════════════════════════════ */

const UPLOAD_MODE_META: Record<UploadMode, { label: string; icon: typeof FileText; hint: string; dropHint: string; accept: string[] }> = {
  document: {
    label: "Document",
    icon: FileText,
    hint: "PDF, JPG, or PNG — payslip, offer letter, relieving letter, resume, Aadhaar, PAN, or bank document",
    dropHint: "Drag & drop a document here",
    accept: ACCEPTED_EXTENSIONS,
  },
  photo: {
    label: "Photo / Image",
    icon: Camera,
    hint: "JPG or PNG — a photographed/scanned resume, payslip, ID document, or a portrait photo",
    dropHint: "Drag & drop a photo here",
    accept: IMAGE_EXTENSIONS,
  },
};

function UploadDropzone({
  mode, onModeChange, dragOver, uploading, error, onDragOver, onFile,
}: {
  mode: UploadMode; onModeChange: (m: UploadMode) => void;
  dragOver: boolean; uploading: boolean; error: string;
  onDragOver: (v: boolean) => void; onFile: (f: File | undefined | null) => void;
}) {
  const meta = UPLOAD_MODE_META[mode];
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {(Object.keys(UPLOAD_MODE_META) as UploadMode[]).map((m) => {
          const opt = UPLOAD_MODE_META[m];
          const Icon = opt.icon;
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              disabled={uploading}
              onClick={() => onModeChange(m)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-[12.5px] font-bold transition-colors disabled:opacity-60 ${
                active
                  ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                  : "bg-white border-zinc-200 text-zinc-600 hover:border-blue-200 hover:bg-blue-50/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {opt.label}
            </button>
          );
        })}
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); if (!uploading) onDragOver(true); }}
        onDragLeave={() => onDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragOver(false);
          if (!uploading) onFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center gap-2 px-6 py-14 rounded-2xl border-2 border-dashed text-center transition-colors ${
          uploading
            ? "border-zinc-200 bg-zinc-50 text-zinc-400 cursor-wait"
            : dragOver
            ? "border-blue-400 bg-blue-50/60 text-blue-700 cursor-pointer"
            : "border-zinc-300 bg-zinc-50/60 text-zinc-500 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer"
        }`}
      >
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${uploading ? "bg-zinc-100" : "bg-blue-50 border border-blue-200"}`}>
          {uploading ? <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" /> : <Upload className="w-5 h-5 text-blue-600" />}
        </div>
        <div className="text-sm font-bold text-zinc-800 mt-1">{uploading ? "Uploading…" : meta.dropHint}</div>
        <div className="text-xs text-zinc-500 max-w-xs">{uploading ? "" : `or click to browse · ${meta.hint}`}</div>
        <input
          key={mode}
          type="file"
          // Photo mode uses the image/* MIME pattern (not file extensions) —
          // that's what reliably makes `capture` open the device camera
          // directly on mobile browsers instead of the file browser, the
          // concrete mechanism behind the "Photo / Image" option.
          accept={mode === "photo" ? "image/*" : meta.accept.join(",")}
          {...(mode === "photo" ? { capture: "environment" as const } : {})}
          disabled={uploading}
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-xs text-red-600 font-medium">
          <XCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DOCUMENT PREVIEW + SCAN-LINE OVERLAY
   ═══════════════════════════════════════════════════════════ */

function DocPreview({
  filename, contentType, previewImageUrl, scanning, activeStepTitle,
}: {
  filename: string; contentType: "pdf" | "image"; previewImageUrl: string | null; scanning: boolean;
  activeStepTitle?: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="relative rounded-xl overflow-hidden border border-zinc-200 bg-zinc-50 flex-1 min-h-[220px] flex items-center justify-center">
        {previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${API_URL}${previewImageUrl}`} alt={filename} className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-400 py-14">
            <FileText className="w-11 h-11 text-blue-300" />
            <span className="text-[10.5px] font-mono">Preview unavailable</span>
          </div>
        )}

        {scanning && (
          <>
            {/* Vision-agent scan sweep, not a generic loading shimmer */}
            <motion.div
              className="absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-blue-400/50 to-transparent pointer-events-none"
              initial={{ top: "-18%" }}
              animate={{ top: "110%" }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-x-0 h-px bg-blue-400/90 shadow-[0_0_8px_2px_rgba(96,165,250,0.7)] pointer-events-none"
              initial={{ top: "-2%" }}
              animate={{ top: "108%" }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            />

            {/* Targeting reticle corners — reads as machine vision, not a spinner */}
            {[
              "top-2 left-2 border-t-2 border-l-2",
              "top-2 right-2 border-t-2 border-r-2",
              "bottom-2 left-2 border-b-2 border-l-2",
              "bottom-2 right-2 border-b-2 border-r-2",
            ].map((pos) => (
              <div key={pos} className={`absolute w-4 h-4 border-blue-500/70 pointer-events-none ${pos}`} />
            ))}

            {activeStepTitle && (
              <div className="absolute left-2 bottom-2 translate-y-[calc(100%+6px)] pointer-events-none">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-1 rounded-md bg-zinc-900/90 text-blue-300 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  {activeStepTitle}
                </span>
              </div>
            )}
          </>
        )}
      </div>
      <div className={`flex items-center gap-1.5 text-[11px] text-zinc-500 ${scanning && activeStepTitle ? "mt-7" : "mt-2.5"}`}>
        {contentType === "image" ? <ImageIcon className="w-3 h-3 text-zinc-400 shrink-0" /> : <FileText className="w-3 h-3 text-zinc-400 shrink-0" />}
        <span className="truncate font-mono">{filename}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   LIVE STEP CHECKLIST
   ═══════════════════════════════════════════════════════════ */

function StepChecklist({ stepsByKey, scanning }: { stepsByKey: Record<string, StepResult>; scanning: boolean }) {
  const nextIdx = STEP_META.findIndex((m) => !stepsByKey[m.key]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold text-zinc-900 uppercase tracking-wide">What the agent is checking</span>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">
          {Object.keys(stepsByKey).length}/{STEP_META.length}
        </span>
      </div>

      {STEP_META.map((m, i) => {
        const result = stepsByKey[m.key];
        const isActive = scanning && i === nextIdx;
        const Icon = m.icon;
        const style = result ? STATUS_STYLES[result.status] : null;
        const StatusIcon = style?.icon;

        return (
          <motion.div
            key={m.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-2.5 flex items-start gap-2.5 transition-colors ${
              isActive ? "border-blue-300 bg-blue-50/60" : result ? `${style!.border} ${style!.bg}` : "border-zinc-200 bg-zinc-50/50"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isActive ? "bg-blue-100 text-blue-600" : result ? "bg-white" : "bg-zinc-100 text-zinc-400"}`}>
              {isActive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-bold text-zinc-900">{m.title}</span>
                {result && StatusIcon && (
                  <span className={`flex items-center gap-1 text-[10px] font-mono font-bold shrink-0 ${style!.text}`}>
                    <StatusIcon className="w-3 h-3" />
                    {style!.label}
                    {result.score !== null && ` · ${result.score}`}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">
                {result ? result.summary : isActive ? "Running…" : "Pending"}
              </p>
              {result && <StepDetailChips stepKey={m.key} details={result.details} />}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Surfaces the real values the agent actually extracted for this step —
 * not just a pass/fail badge — so the scan reads as genuine forensic output
 * instead of a generic progress animation. */
function StepDetailChips({ stepKey, details }: { stepKey: string; details?: Record<string, unknown> }) {
  if (!details) return null;

  const chips: string[] = [];
  if (stepKey === "metadata") {
    const producer = (details.producer ?? details.software) as string | null | undefined;
    if (producer) chips.push(`Producer: ${producer}`);
    if (details.creation_date) chips.push(`Created: ${details.creation_date}`);
    if (details.mod_date) chips.push(`Modified: ${details.mod_date}`);
  } else if (stepKey === "ocr") {
    if (details.method) chips.push(`Method: ${details.method === "ocr" ? "Tesseract OCR" : "native text layer"}`);
    const pages = details.pages ?? details.pages_ocred;
    if (typeof pages === "number") chips.push(`${pages} page${pages === 1 ? "" : "s"}`);
  } else if (stepKey === "arithmetic") {
    const fields = details.extracted_fields as Record<string, unknown> | undefined;
    if (fields) {
      for (const [k, v] of Object.entries(fields).slice(0, 3)) {
        chips.push(`${k}: ${v}`);
      }
    }
  } else if (stepKey === "ela") {
    if (typeof details.max_diff === "number") chips.push(`Max diff: ${details.max_diff}`);
    if (typeof details.threshold === "number") chips.push(`Threshold: ${details.threshold}`);
  } else if (stepKey === "fonts") {
    if (typeof details.distinct_families === "number") chips.push(`${details.distinct_families} font families`);
    const families = details.families as string[] | undefined;
    if (families?.length) chips.push(families.slice(0, 3).join(", "));
  } else if (stepKey === "identity") {
    const matches = details.matches as Array<{ matched_name: string | null; probability: number }> | undefined;
    if (matches?.length) chips.push(`${matches.length} match${matches.length === 1 ? "" : "es"} · top ${Math.round(matches[0].probability * 100)}%`);
    else chips.push("No prior submissions matched");
    const clusterSize = details.identity_cluster_size as number | undefined;
    if (typeof clusterSize === "number" && clusterSize > 1) chips.push(`Identity cluster: ${clusterSize}`);
    const blocked = details.candidates_blocked as number | undefined;
    if (typeof blocked === "number") chips.push(`${blocked} candidate${blocked === 1 ? "" : "s"} blocked for comparison`);
  } else if (stepKey === "resume_authenticity") {
    const subScores = details.sub_scores as Record<string, number> | undefined;
    if (subScores) {
      for (const [k, v] of Object.entries(subScores)) {
        chips.push(`${k.replace(/_/g, " ")}: ${v}`);
      }
    }
  } else if (stepKey === "reasoning") {
    const concerns = details.key_concerns as string[] | undefined;
    if (concerns?.length) chips.push(...concerns.slice(0, 2));
  } else if (stepKey === "photo_forensics") {
    if (details.grid) chips.push(`Grid: ${details.grid}`);
    const cluster = details.largest_contiguous_cluster as number | undefined;
    if (typeof cluster === "number") chips.push(`Largest anomalous cluster: ${cluster} block${cluster === 1 ? "" : "s"}`);
  } else if (stepKey === "pan") {
    const candidates = details.candidates as string[] | undefined;
    if (candidates?.length) chips.push(...candidates.slice(0, 3));
  } else if (stepKey === "aadhaar") {
    const numbers = details.numbers_checked as string[] | undefined;
    if (numbers?.length) chips.push(...numbers.slice(0, 2));
    const masked = details.masked_last4 as string[] | undefined;
    if (masked?.length) chips.push(`Masked, last 4: ${masked.join(", ")}`);
  } else if (stepKey === "bank_document") {
    const ifsc = details.ifsc_codes as string[] | undefined;
    if (ifsc?.length) chips.push(`IFSC: ${ifsc.join(", ")}`);
    const accounts = details.account_numbers as string[] | undefined;
    if (accounts?.length) chips.push(`Account: ${accounts.slice(0, 2).join(", ")}`);
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {chips.map((c, i) => (
        <span key={i} className="text-[9.5px] font-mono text-zinc-500 bg-white border border-zinc-200 rounded px-1.5 py-0.5">
          {c}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RESULTS — verdict banner + per-step marks
   ═══════════════════════════════════════════════════════════ */

function ResultSummary({ overall, onReset, scanId }: { overall: Overall; onReset: () => void; scanId?: string }) {
  const verdictStyle = VERDICT_STYLES[overall.verdict] || VERDICT_STYLES.needs_review;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className={`relative rounded-3xl overflow-hidden p-6 sm:p-8 bg-gradient-to-br ${verdictStyle.gradient} shadow-2xl ${verdictStyle.glow}`}>
        <div className="absolute -top-16 -right-16 w-56 h-56 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 border border-white/25 text-white text-[13px] font-extrabold">
              <ShieldCheck className="w-4 h-4" /> {verdictStyle.label}
            </span>
            {overall.risk_score !== null && (
              <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-full bg-white/95 text-zinc-800">
                Risk Score {overall.risk_score}/100
              </span>
            )}
          </div>
          <p className="text-white/95 text-[14px] leading-relaxed mb-4 max-w-2xl">{overall.explanation}</p>
          {overall.key_concerns.length > 0 && (
            <ul className="space-y-1.5">
              {overall.key_concerns.map((c, i) => (
                <li key={i} className="text-[12.5px] text-white/90 flex items-start gap-1.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-white/70 shrink-0" /> {c}
                </li>
              ))}
            </ul>
          )}
          <FeedbackButtons workflowType="fraud" subjectId={scanId} className="mt-4" />
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-zinc-900 uppercase tracking-wide mb-3">Marks per step</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {overall.steps.map((s) => {
            const style = STATUS_STYLES[s.status];
            const StatusIcon = style.icon;
            return (
              <div key={s.key} className="rounded-2xl bg-white border border-zinc-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-bold text-zinc-900">{s.title}</span>
                  <StatusIcon className={`w-4 h-4 shrink-0 ${style.text}`} />
                </div>
                {s.score !== null ? (
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className={`text-[15px] font-extrabold font-mono shrink-0 ${style.text}`}>{s.score}</span>
                    <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${style.bar}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${s.score}%` }}
                        transition={{ duration: 0.9, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-[13px] font-mono text-zinc-400 mb-3">Not applicable</div>
                )}
                <p className="text-[12px] text-zinc-500 leading-relaxed">{s.summary}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 text-white text-[13px] font-bold hover:bg-zinc-800 transition-colors shadow-sm"
        >
          <X className="w-3.5 h-3.5" /> Scan another document
        </button>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   METHODOLOGY
   ═══════════════════════════════════════════════════════════ */

function MethodologySection() {
  return (
    <section id="methodology" className="py-20 sm:py-24 border-t border-zinc-200/80 bg-zinc-50/50 scroll-mt-14">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center max-w-xl mx-auto mb-14">
          <span className="text-xs font-mono uppercase tracking-widest text-blue-600 font-semibold px-2.5 py-1 rounded bg-blue-50 border border-blue-200">
            How It Works
          </span>
          <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold text-zinc-900 tracking-tight mt-4">
            {STEP_META.length} real checks, <span className="text-blue-600">one honest verdict</span>
          </h2>
          <p className="text-zinc-600 text-[15px] mt-2 leading-relaxed">
            Every check below runs against your actual file — highest-signal, lowest-effort forgeries first, AI reasoning last to synthesize everything.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {STEP_META.map((m, i) => (
            <StepFeatureCard key={m.key} index={i + 1} title={m.title} desc={m.blurb} icon={m.icon} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepFeatureCard({
  index, title, desc, icon: Icon,
}: { index: number; title: string; desc: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-[11px] font-mono font-bold text-zinc-300">0{index}</span>
      </div>
      <h3 className="text-[14px] font-bold text-zinc-900 mb-1">{title}</h3>
      <p className="text-[12.5px] text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CLOSING CTA
   ═══════════════════════════════════════════════════════════ */

function ClosingCtaBanner() {
  return (
    <section className="py-20 border-t border-zinc-200/80 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <div className="relative rounded-[2rem] overflow-hidden p-10 sm:p-14 text-center bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 shadow-2xl shadow-blue-600/25">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-white mx-auto mb-5">
              <Zap className="w-6 h-6" />
            </div>
            <h2 className="text-[clamp(1.5rem,3.5vw,2.1rem)] font-extrabold text-white tracking-tight mb-3">
              Don&apos;t guess whether a document is real
            </h2>
            <p className="text-blue-100 text-[15px] max-w-lg mx-auto mb-8">
              Upload it and let the agent run six real checks in the time it takes to read this sentence.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="#scanner"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-semibold bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm"
              >
                Scan a Document <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
