"use client";

import { useState } from "react";
import { FileSearch, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, extractEmploymentHistory, openResume,
  type Application360, type WorkHistoryEntry,
} from "@/lib/recruitmentApi";
import { EmptyNote, InfoRow, Panel, StatusDot, btnSecondary, type Tone } from "./_ui";

/** Every value on these panels comes from the parsed resume or a real
 * pipeline result. Missing data is stated as missing — never filled in. */

export function formatTenure(w: Pick<WorkHistoryEntry, "start" | "end" | "is_current">): string | null {
  if (!w.start && !w.end && !w.is_current) return null;
  return `${w.start || "?"} – ${w.is_current ? "Present" : w.end || "?"}`;
}

export function ExtractFromResumeButton({
  applicationId,
  onDone,
  label = "Extract from resume",
}: {
  applicationId: string;
  onDone: () => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await extractEmploymentHistory(applicationId);
          toast("success", `Extracted ${res.work_history.length} employer(s) from the resume.`);
          onDone();
        } catch (err) {
          toast("error", errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      className={btnSecondary}
    >
      {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileSearch className="mr-1.5 h-4 w-4 text-zinc-400" />}
      {label}
    </Button>
  );
}

// ── Employment history ─────────────────────────────────────────────────

export function EmploymentHistoryCard({
  data,
  canAnalyze,
  onReload,
}: {
  data: Application360;
  canAnalyze: boolean;
  onReload: () => void;
}) {
  const { candidate, application } = data;
  const history = candidate.work_history || [];

  return (
    <Panel title="Employment history" description={history.length ? "Parsed from the resume" : undefined}>
      {history.length === 0 ? (
        <EmptyNote
          action={canAnalyze && candidate.has_resume ? <ExtractFromResumeButton applicationId={application.id} onDone={onReload} /> : undefined}
        >
          {candidate.has_resume ? "No employers have been extracted from this resume yet." : "No resume on file."}
        </EmptyNote>
      ) : (
        <ol className="divide-y divide-zinc-100">
          {history.map((w, i) => (
            <li key={`${w.company}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-zinc-900">
                  {w.title || "Role not stated"}
                  <span className="font-normal text-zinc-500"> · {w.company}</span>
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                {w.is_current && <StatusDot tone="success" className="text-xs text-zinc-600">Current</StatusDot>}
                {formatTenure(w) && <span className="tabular-nums">{formatTenure(w)}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ── Education ───────────────────────────────────────────────────────────

export function EducationCard({ data }: { data: Application360 }) {
  const education = (data.candidate.education || []).filter((e) => e && e.institution);
  if (education.length === 0) return null;
  return (
    <Panel title="Education">
      <ul className="divide-y divide-zinc-100">
        {education.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 py-3 first:pt-0 last:pb-0">
            <p className="text-[13px] font-medium text-zinc-900">
              {e.degree || "Degree not stated"}
              <span className="font-normal text-zinc-500"> · {e.institution}</span>
            </p>
            {e.years && <span className="text-xs tabular-nums text-zinc-500">{e.years}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Contact ─────────────────────────────────────────────────────────────

export function ContactCard({ data }: { data: Application360 }) {
  const { candidate } = data;
  const { toast } = useToast();
  return (
    <Panel title="Contact">
      <dl className="-my-2 divide-y divide-zinc-100">
        <InfoRow label="Email">
          {candidate.email ? (
            <a href={`mailto:${candidate.email}`} className="break-all text-blue-600 hover:underline">{candidate.email}</a>
          ) : (
            <span className="text-zinc-400">Not provided</span>
          )}
        </InfoRow>
        <InfoRow label="Phone">
          {candidate.phone ? <span className="tabular-nums">{candidate.phone}</span> : <span className="text-zinc-400">Not provided</span>}
        </InfoRow>
        <InfoRow label="Location">
          {candidate.location || <span className="text-zinc-400">Not stated</span>}
        </InfoRow>
        <InfoRow label="Resume">
          {candidate.has_resume ? (
            <button
              type="button"
              onClick={() => openResume(candidate.id).catch((err) => toast("error", errorMessage(err)))}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" /> {candidate.resume_filename || "View PDF"}
            </button>
          ) : (
            <span className="text-zinc-400">None on file</span>
          )}
        </InfoRow>
      </dl>
    </Panel>
  );
}

// ── Verification status (real signals only) ────────────────────────────

export function fraudStatus(data: Application360): { label: string; tone: Tone } {
  const fraud = data.fraud;
  if (!fraud) return { label: "Not scanned", tone: "neutral" };
  if (fraud.status === "scanning" || fraud.status === "uploaded") return { label: "Scan in progress", tone: "info" };
  if (fraud.status === "error") return { label: "Scan failed", tone: "danger" };
  const verdict = (fraud.result as { verdict?: string })?.verdict;
  const score = (fraud.result as { risk_score?: number })?.risk_score;
  const suffix = typeof score === "number" ? ` (risk ${score})` : "";
  if (verdict === "likely_genuine") return { label: `Likely genuine${suffix}`, tone: "success" };
  if (verdict === "likely_fraudulent") return { label: `Likely fraudulent${suffix}`, tone: "danger" };
  if (verdict === "needs_review") return { label: `Needs review${suffix}`, tone: "warning" };
  return { label: "Complete, no verdict", tone: "neutral" };
}

export function VerificationStatusCard({ data }: { data: Application360 }) {
  const fraud = fraudStatus(data);

  const lastBgv = (data.activity || []).find((a) => a.event_type === "candidate.bgv_verified");
  const bgvPayload = (lastBgv?.payload || {}) as { company?: string; verdict?: string };
  const bgv: { label: string; tone: Tone } = lastBgv
    ? {
        label: `${bgvPayload.company || "Employer"} — ${(bgvPayload.verdict || "checked").replace(/_/g, " ")}`,
        tone: bgvPayload.verdict === "likely_legitimate" ? "success" : bgvPayload.verdict === "likely_not_legitimate" ? "danger" : "warning",
      }
    : { label: "Not run", tone: "neutral" };

  const messages = data.whatsapp_messages || [];
  const delivered = messages.filter((m) => ["delivered", "read"].includes(m.status)).length;
  const whatsapp: { label: string; tone: Tone } = messages.length
    ? { label: `${messages.length} sent, ${delivered} delivered`, tone: delivered ? "success" : "warning" }
    : { label: "No messages", tone: "neutral" };

  return (
    <Panel title="Verification">
      <dl className="-my-2 divide-y divide-zinc-100">
        <InfoRow label="Resume fraud scan"><StatusDot tone={fraud.tone}>{fraud.label}</StatusDot></InfoRow>
        <InfoRow label="Employer check"><StatusDot tone={bgv.tone}>{bgv.label}</StatusDot></InfoRow>
        <InfoRow label="WhatsApp"><StatusDot tone={whatsapp.tone}>{whatsapp.label}</StatusDot></InfoRow>
      </dl>
    </Panel>
  );
}
