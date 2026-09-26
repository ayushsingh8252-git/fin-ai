"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Eye, Loader2, Mail, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, triggerBackgroundVerification,
  type Application360, type BackgroundVerificationResponse, type WorkHistoryEntry,
} from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";
import { ExtractFromResumeButton, formatTenure } from "./_profile";
import { EmptyNote, InfoRow, Panel, StatusDot, btnPrimary, btnSecondary, inputCls, labelCls, type Tone } from "./_ui";

const MANUAL = "__manual__";

/** Same default as the backend (_default_employer): the most recent PAST
 * employer, because contacting a current employer can expose a candidate
 * who hasn't resigned yet. */
function defaultEmployerKey(history: WorkHistoryEntry[]): string {
  const past = history.find((w) => !w.is_current);
  const pick = past || history[0];
  return pick ? pick.company : MANUAL;
}

const VERDICT: Record<string, { label: string; tone: Tone }> = {
  likely_legitimate: { label: "Likely legitimate", tone: "success" },
  likely_not_legitimate: { label: "Likely not legitimate", tone: "danger" },
  uncertain: { label: "Uncertain", tone: "warning" },
  unknown: { label: "No web data found", tone: "neutral" },
};

/** A finished run, held by the page so it survives tab switches and the
 * background data refresh that follows a run. `at` keys the email editor so a
 * new run replaces any edits made to the previous draft. */
export interface SavedBgvResult {
  result: BackgroundVerificationResponse;
  at: number;
}

export function BackgroundVerificationTab({
  data,
  canAnalyze,
  onReload,
  saved,
  onResult,
}: {
  data: Application360;
  canAnalyze: boolean;
  onReload: () => void;
  saved: SavedBgvResult | null;
  onResult: (saved: SavedBgvResult) => void;
}) {
  const { candidate, application } = data;
  const history = useMemo(() => candidate.work_history || [], [candidate.work_history]);
  const { toast } = useToast();
  const emailRef = useRef<HTMLDivElement>(null);
  const result = saved?.result ?? null;

  // null = no explicit pick yet, so it follows the default even when work
  // history arrives after mount (e.g. just extracted from the resume).
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? defaultEmployerKey(history);
  const [manualCompany, setManualCompany] = useState("");
  const [manualRole, setManualRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedEntry = history.find((w) => w.company === selected) || null;
  const isManual = selected === MANUAL;

  const run = async () => {
    const company = isManual ? manualCompany.trim() : selectedEntry?.company;
    if (!company) {
      setError("Choose an employer from the resume, or enter one.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await triggerBackgroundVerification(application.id, {
        company_name: company,
        ...(isManual && manualRole.trim() ? { candidate_role: manualRole.trim() } : {}),
      });
      onResult({ result: res, at: Date.now() });
      toast("success", `Verification email ready for ${res.company_name}.`);
      onReload();
      requestAnimationFrame(() => emailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const verdict = result ? VERDICT[result.legitimacy.verdict] || VERDICT.unknown : null;

  return (
    <div className="space-y-4">
      {/* ── Choose employer ── */}
      <Panel
        title="Background verification"
        description="Checks an employer from the resume on the open web, finds its HR team on LinkedIn, and drafts an HR-to-HR verification email."
        action={
          canAnalyze && (
            <Button onClick={run} disabled={loading} className={btnPrimary}>
              {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {loading ? "Verifying…" : result ? "Run again" : "Run verification"}
            </Button>
          )
        }
      >
        <div className="space-y-4">
          {history.length === 0 && (
            <EmptyNote
              action={
                canAnalyze && candidate.has_resume ? (
                  <ExtractFromResumeButton applicationId={application.id} onDone={onReload} label="Extract employers" />
                ) : undefined
              }
            >
              {candidate.has_resume
                ? "No employers have been extracted from this resume yet."
                : "No resume on file — enter the employer manually."}
            </EmptyNote>
          )}

          <fieldset>
            <legend className={labelCls}>Employer to verify</legend>
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-md border border-zinc-200">
              {history.map((w) => {
                const active = selected === w.company;
                return (
                  <label
                    key={w.company}
                    className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors", active ? "bg-blue-50/50" : "hover:bg-zinc-50")}
                  >
                    <input
                      type="radio"
                      name="bgv-employer"
                      checked={active}
                      onChange={() => setChoice(w.company)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-zinc-900">{w.company}</span>
                      <span className="block text-xs text-zinc-500">
                        {[w.title, formatTenure(w)].filter(Boolean).join(" · ") || "No role or dates stated"}
                      </span>
                    </span>
                    <span className="text-xs text-zinc-500">
                      {w.is_current ? <StatusDot tone="success" className="text-xs">Current</StatusDot> : "Past"}
                    </span>
                  </label>
                );
              })}
              <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors", isManual ? "bg-blue-50/50" : "hover:bg-zinc-50")}>
                <input
                  type="radio"
                  name="bgv-employer"
                  checked={isManual}
                  onChange={() => setChoice(MANUAL)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span>
                  <span className="block text-[13px] font-medium text-zinc-900">Another employer</span>
                  <span className="block text-xs text-zinc-500">Not on the resume — enter it manually</span>
                </span>
              </label>
            </div>
          </fieldset>

          {isManual && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bgv-company" className={labelCls}>Employer name</label>
                <input id="bgv-company" value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="bgv-role" className={labelCls}>Role held (optional)</label>
                <input id="bgv-role" value={manualRole} onChange={(e) => setManualRole(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}

          {selectedEntry?.is_current && (
            <p className="flex items-start gap-2 text-[13px] text-zinc-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                <span className="font-medium">{selectedEntry.company}</span> is the candidate&apos;s current employer. Contact them only after the
                candidate has given explicit written consent.
              </span>
            </p>
          )}

          {error && <ErrorBanner message={error} />}
        </div>
      </Panel>

      {/* ── Running ── */}
      {loading && (
        <Panel>
          <p className="flex items-center gap-2 text-[13px] text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            Checking the company, searching LinkedIn for its HR team, and drafting the email. This usually takes 10–30 seconds.
          </p>
        </Panel>
      )}

      {/* ── Results ── */}
      {result && verdict && !loading && (
        <div className="space-y-4">
          {result.warnings && result.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white px-5 py-3">
              {result.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-[13px] text-zinc-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {w}
                </p>
              ))}
            </div>
          )}

          <div ref={emailRef} className="scroll-mt-20">
            <EmailPreview key={saved!.at} result={result} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Verification details">
              <dl className="-my-2 divide-y divide-zinc-100">
                <InfoRow label="Employer">{result.company_name}</InfoRow>
                <InfoRow label="Declared role">{result.claimed_role || <span className="text-zinc-400">Not stated</span>}</InfoRow>
                <InfoRow label="Declared period">
                  {formatTenure(result.employment) || <span className="text-zinc-400">Not stated</span>}
                </InfoRow>
                <InfoRow label="Source">{result.employment.from_resume ? "Parsed resume" : "Entered manually"}</InfoRow>
                <InfoRow label="Company legitimacy">
                  <StatusDot tone={verdict.tone}>
                    {verdict.label} <span className="text-zinc-400">({result.legitimacy.score}/100)</span>
                  </StatusDot>
                </InfoRow>
                <InfoRow label="Web sources">
                  {result.legitimacy.positive_signals ?? 0} supporting, {result.legitimacy.negative_signals ?? 0} negative
                </InfoRow>
                {result.hr_contact_number?.number && <InfoRow label="Company phone">{result.hr_contact_number.number}</InfoRow>}
              </dl>
            </Panel>

            <Panel
              title="People found on LinkedIn"
              description="From public search — check each title before contacting."
            >
              {result.hr_contacts.length === 0 ? (
                <p className="text-[13px] text-zinc-500">No one found. The email is addressed to the HR team.</p>
              ) : (
                <ul className="-my-2 divide-y divide-zinc-100">
                  {result.hr_contacts.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-zinc-900">{c.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{c.title}</span>
                      </span>
                      {c.linkedin_url && (
                        <a
                          href={c.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          Profile <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {result.legitimacy.evidence && result.legitimacy.evidence.length > 0 && (
            <Panel title="Web sources checked" description={result.legitimacy.note}>
              <ul className="-my-2 divide-y divide-zinc-100">
                {result.legitimacy.evidence.map((ev, i) => (
                  <li key={i} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-w-0 items-center gap-1 text-[13px] font-medium text-blue-600 hover:underline"
                      >
                        <span className="truncate">{ev.title || ev.url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      <StatusDot tone={ev.signal === "positive" ? "success" : "danger"} className="shrink-0 text-xs">
                        {ev.signal === "positive" ? "Supporting" : "Negative"}
                      </StatusDot>
                    </div>
                    {ev.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{ev.snippet}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

// ── Personalised HR-to-HR email ─────────────────────────────────────────

function EmailPreview({ result }: { result: BackgroundVerificationResponse }) {
  const email = result.personalized_email;
  const { toast } = useToast();
  const [body, setBody] = useState(email.body);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<"all" | "body" | null>(null);

  const copy = async (what: "all" | "body") => {
    await navigator.clipboard.writeText(what === "all" ? `Subject: ${email.subject}\n\n${body}` : body);
    setCopied(what);
    toast("success", what === "all" ? "Subject and email copied." : "Email body copied.");
    setTimeout(() => setCopied(null), 2500);
  };

  const mailto = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(body)}`;
  const from = email.sender_email && email.sender_email !== email.sender_name
    ? `${email.sender_name} <${email.sender_email}>`
    : email.sender_name;

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Mail className="h-4 w-4 text-zinc-400" /> Verification email
        </span>
      }
      description={`HR-to-HR request built from the candidate's declared employment at ${result.company_name}.`}
      action={
        <>
          <Button variant="outline" onClick={() => setEditing((v) => !v)} className={btnSecondary}>
            {editing ? <Eye className="mr-1.5 h-4 w-4 text-zinc-400" /> : <PenLine className="mr-1.5 h-4 w-4 text-zinc-400" />}
            {editing ? "Preview" : "Edit"}
          </Button>
          <Button variant="outline" onClick={() => copy("body")} className={btnSecondary}>
            {copied === "body" ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4 text-zinc-400" />}
            Copy body
          </Button>
          <Button variant="outline" onClick={() => copy("all")} className={btnSecondary}>
            {copied === "all" ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4 text-zinc-400" />}
            Copy email
          </Button>
          <a href={mailto} className={cn(btnPrimary, "inline-flex items-center")}>
            <Mail className="mr-1.5 h-4 w-4" /> Open in mail app
          </a>
        </>
      }
      bodyClassName="p-0"
    >
      <dl className="divide-y divide-zinc-100 border-b border-zinc-100">
        {[
          ["From", from],
          [
            "To",
            <span key="to">
              <span className="font-medium">{email.recipient_name}</span>
              <span className="text-zinc-500"> — {email.recipient_title}</span>
              {email.recipient_url && (
                <a
                  href={email.recipient_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                >
                  LinkedIn <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>,
          ],
          ["Subject", <span key="s" className="font-medium">{email.subject}</span>],
        ].map(([label, value]) => (
          <div key={label as string} className="flex gap-4 px-5 py-2.5 text-[13px]">
            <dt className="w-14 shrink-0 text-zinc-500">{label}</dt>
            <dd className="min-w-0 text-zinc-900">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="px-5 py-4">
        {editing ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(28, body.split("\n").length + 2)}
            className="w-full rounded-md border border-zinc-200 p-4 text-[13px] leading-relaxed text-zinc-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
          />
        ) : (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800">{body}</div>
        )}
        <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
          The recipient&apos;s email address isn&apos;t public — get it from their LinkedIn profile or {result.company_name}&apos;s HR page, then add
          it in your mail app.
        </p>
      </div>
    </Panel>
  );
}
