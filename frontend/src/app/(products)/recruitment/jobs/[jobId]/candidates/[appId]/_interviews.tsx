"use client";

import { useState } from "react";
import {
  Bot, CalendarDays, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, Phone, Plus, Users, Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, getInterviewReport, scheduleInterview,
  type Application360, type InterviewInfo, type InterviewMode, type InterviewReport, type ScheduleInterviewResponse,
  type ScheduleStep,
} from "@/lib/recruitmentApi";
import { cn } from "@/lib/utils";
import { EmptyNote, InfoRow, Panel, StatusDot, Tag, btnPrimary, btnSecondary, inputCls, labelCls, type Tone } from "./_ui";

const MODES: { id: InterviewMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  {
    id: "ai_screening",
    label: "AI avatar interview",
    icon: Bot,
    hint: "The candidate opens a private link and is interviewed by the AI interviewer by voice, with camera proctoring. No account needed.",
  },
  {
    id: "telephonic",
    label: "Telephonic interview",
    icon: Phone,
    hint: "The AI interviewer calls the candidate's phone at the scheduled time. The transcript and evaluation arrive when the call ends.",
  },
  {
    id: "human",
    label: "Panel interview",
    icon: Users,
    hint: "A live interview with your team. A Google Meet link is created with the calendar event.",
  },
];

export const MODE_LABEL: Record<string, string> = {
  ai_screening: "AI avatar interview",
  telephonic: "Telephonic interview",
  human: "Panel interview",
};

const STATUS_TONE: Record<string, Tone> = {
  scheduled: "info",
  dialing: "info",
  in_progress: "info",
  completed: "success",
  failed: "danger",
  cancelled: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  dialing: "Dialling",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

/** datetime-local value for "one hour from now", rounded to the next quarter hour. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => undefined,
        );
      }}
      className={btnSecondary}
    >
      {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4 text-zinc-400" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ── Scheduling ──────────────────────────────────────────────────────────

const STEP_TEXT: Record<string, Record<string, string>> = {
  calendar: { created: "Google Calendar event created", failed: "Google Calendar event not created", skipped: "Not added to Google Calendar" },
  email: { sent: "Invite email sent to the candidate", failed: "Invite email not sent", skipped: "Invite email not sent (turned off)" },
  call: {
    placed: "Call placed: the provider accepted it",
    queued: "Call queued for the scheduled time",
    failed: "Call not placed",
    skipped: "Call not placed",
  },
};

function stepTone(status: string): Tone {
  if (status === "failed") return "danger";
  if (status === "skipped") return "neutral";
  return "success";
}

function ScheduleResult({ result }: { result: ScheduleInterviewResponse }) {
  const { interview, steps } = result;
  return (
    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-4">
      <p className="text-[13px] font-medium text-zinc-900">
        {MODE_LABEL[interview.mode] || interview.mode} saved for {fmtDate(interview.scheduled_at)}
      </p>
      <ul className="space-y-1.5">
        {(Object.entries(steps) as [string, ScheduleStep][]).map(([key, step]) => (
          <li key={key} className="text-[13px]">
            <StatusDot tone={stepTone(step.status)}>{STEP_TEXT[key]?.[step.status] || `${key}: ${step.status}`}</StatusDot>
            {(step.error || (step.status === "failed" && step.detail)) && (
              <p className="ml-3 mt-0.5 text-xs text-red-600">{step.error || step.detail}</p>
            )}
          </li>
        ))}
      </ul>
      {interview.candidate_link && (
        <div className="flex flex-wrap gap-2">
          <input readOnly value={interview.candidate_link} aria-label="Candidate interview link" className={cn(inputCls, "min-w-0 flex-1 bg-white font-mono text-xs")} />
          <CopyButton value={interview.candidate_link} label="Copy link" />
        </div>
      )}
    </div>
  );
}

function ScheduleForm({
  data, onDone, onCancel,
}: {
  data: Application360;
  onDone: (res: ScheduleInterviewResponse) => void;
  onCancel: () => void;
}) {
  const { candidate } = data;
  const [mode, setMode] = useState<InterviewMode>("ai_screening");
  const [when, setWhen] = useState(defaultWhen);
  const [duration, setDuration] = useState(30);
  const [interviewer, setInterviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noPhone = mode === "telephonic" && !candidate.phone;
  const noEmail = mode === "ai_screening" && sendEmail && !candidate.email;
  const active = MODES.find((m) => m.id === mode)!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when || noPhone || noEmail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await scheduleInterview(data.application.id, {
        mode,
        scheduled_at: new Date(when).toISOString(),
        duration_minutes: duration,
        interviewer_email: interviewer.trim() || undefined,
        notes: notes.trim() || undefined,
        add_to_calendar: addToCalendar,
        send_invite_email: mode === "ai_screening" ? sendEmail : false,
      });
      onDone(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-4 space-y-4 rounded-md border border-zinc-200 p-4">
      <fieldset>
        <legend className={labelCls}>Interview type</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {MODES.map((m) => {
            const Icon = m.icon;
            const selected = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(m.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2.5 text-left text-[13px] font-medium transition-colors cursor-pointer",
                  selected ? "border-blue-500 bg-blue-50/60 text-zinc-900 ring-2 ring-blue-500/15" : "border-zinc-200 text-zinc-700 hover:bg-zinc-50",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-blue-600" : "text-zinc-400")} />
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{active.hint}</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="iv-when" className={labelCls}>Date and time</label>
          <input id="iv-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required className={inputCls} />
        </div>
        <div>
          <label htmlFor="iv-duration" className={labelCls}>Duration</label>
          <select id="iv-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
            {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="iv-who" className={labelCls}>{mode === "human" ? "Interviewer email" : "Recruiter email"}</label>
          <input
            id="iv-who"
            type="email"
            value={interviewer}
            onChange={(e) => setInterviewer(e.target.value)}
            placeholder="Defaults to you"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="iv-notes" className={labelCls}>Notes for the calendar event (optional)</label>
        <textarea
          id="iv-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={2}
          className={cn(inputCls, "h-auto py-2")}
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-[13px] text-zinc-700">
          <input type="checkbox" checked={addToCalendar} onChange={(e) => setAddToCalendar(e.target.checked)} className="mt-0.5" />
          <span>
            Add to Google Calendar
            <span className="block text-xs text-zinc-500">
              Creates the event on the connected Google account and invites you{candidate.email ? " and the candidate" : ""}.
              {mode === "human" && " The Meet link comes from this event."}
            </span>
          </span>
        </label>
        {mode === "ai_screening" && (
          <label className="flex items-start gap-2 text-[13px] text-zinc-700">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="mt-0.5" />
            <span>
              Email the candidate their interview link
              <span className="block text-xs text-zinc-500">{candidate.email || "No email on file"}</span>
            </span>
          </label>
        )}
        {mode === "telephonic" && (
          <p className="text-xs text-zinc-500">
            Calls {candidate.phone || "—"}. Times within the next two minutes are dialled immediately; later times are queued.
          </p>
        )}
      </div>

      {noPhone && <ErrorBanner message="This candidate has no phone number on file, so a telephonic interview isn't possible." />}
      {noEmail && <ErrorBanner message="This candidate has no email on file. Turn off the invite email and share the link yourself." />}
      {error && <ErrorBanner message={error} />}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} className={btnSecondary}>Cancel</Button>
        <Button type="submit" disabled={saving || noPhone || noEmail} className={btnPrimary}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {saving ? "Scheduling…" : "Schedule interview"}
        </Button>
      </div>
    </form>
  );
}

// ── Report ──────────────────────────────────────────────────────────────

function ScoreCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900">{value === null ? "—" : value}</p>
      {value !== null && (
        <div className="mt-1.5 h-1 rounded-full bg-zinc-100">
          <div className="h-1 rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
      )}
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-zinc-700">
          {items.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      ) : (
        <p className="text-[13px] text-zinc-400">{empty}</p>
      )}
    </div>
  );
}

function ReportView({ report }: { report: InterviewReport }) {
  const { interview, evaluation, session, transcript } = report;
  return (
    <div className="space-y-5 border-t border-zinc-100 pt-4">
      <dl className="grid gap-x-6 sm:grid-cols-2">
        <InfoRow label="Candidate">{report.candidate?.name || report.candidate?.email || "—"}</InfoRow>
        <InfoRow label="Job">{report.job?.title || "—"}</InfoRow>
        <InfoRow label="Scheduled for">{fmtDate(interview.scheduled_at)}</InfoRow>
        <InfoRow label="Type">{MODE_LABEL[interview.mode] || interview.mode}</InfoRow>
        <InfoRow label="Planned duration">{interview.duration_minutes ? `${interview.duration_minutes} min` : "—"}</InfoRow>
        <InfoRow label="Actual duration">{fmtDuration(session?.duration_sec)}</InfoRow>
      </dl>

      {!report.report_available || !evaluation ? (
        <EmptyNote>
          {session?.error
            ? `No report: ${session.error}`
            : interview.status === "failed"
              ? `No report: ${interview.status_detail || "the interview did not take place."}`
              : "No report yet. It appears here once the interview is completed and evaluated."}
        </EmptyNote>
      ) : (
        <>
          <section>
            <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Executive summary</h4>
            <p className="text-[13px] leading-relaxed text-zinc-800">{evaluation.summary || "No summary was generated."}</p>
            {evaluation.recommendation && (
              <p className="mt-2 text-[13px] text-zinc-700">
                Recommendation: <span className="font-semibold text-zinc-900">{evaluation.recommendation}</span>
              </p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Scores (0–100)</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ScoreCell label="Overall" value={evaluation.overall_score} />
              <ScoreCell label="Relevance" value={evaluation.relevance_score} />
              <ScoreCell label="Communication" value={evaluation.communication_score} />
              <ScoreCell label="Confidence" value={evaluation.confidence_score} />
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">A dash means the evaluator didn&rsquo;t return that score.</p>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <ListBlock title="Strengths" items={evaluation.strengths} empty="None recorded." />
            <ListBlock title="Areas for improvement" items={evaluation.areas_for_improvement} empty="None recorded." />
          </div>

          {(evaluation.matched_skills.length > 0 || evaluation.missing_skills.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Skills demonstrated</h4>
                <div className="flex flex-wrap gap-1.5">
                  {evaluation.matched_skills.length ? evaluation.matched_skills.map((s) => <Tag key={s}>{s}</Tag>) : <span className="text-[13px] text-zinc-400">None</span>}
                </div>
              </div>
              <div>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Skills not shown</h4>
                <div className="flex flex-wrap gap-1.5">
                  {evaluation.missing_skills.length ? evaluation.missing_skills.map((s) => <Tag key={s}>{s}</Tag>) : <span className="text-[13px] text-zinc-400">None</span>}
                </div>
              </div>
            </div>
          )}

          {(evaluation.key_takeaway || evaluation.suggested_next_step) && (
            <dl className="divide-y divide-zinc-100">
              {evaluation.key_takeaway && <InfoRow label="Key takeaway">{evaluation.key_takeaway}</InfoRow>}
              {evaluation.suggested_next_step && <InfoRow label="Suggested next step">{evaluation.suggested_next_step}</InfoRow>}
            </dl>
          )}
        </>
      )}

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Questions and responses</h4>
        {transcript.length === 0 ? (
          <p className="text-[13px] text-zinc-400">No transcript recorded.</p>
        ) : (
          <ol className="space-y-2">
            {transcript.map((t, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-md px-3 py-2 text-[13px] leading-relaxed",
                  t.role === "interviewer" ? "bg-zinc-50 text-zinc-800" : "border border-zinc-200 text-zinc-700",
                )}
              >
                <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  {t.role === "interviewer" ? "Interviewer" : "Candidate"}
                </span>
                {t.text}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Session metadata</h4>
        <dl className="grid gap-x-6 divide-zinc-100 sm:grid-cols-2">
          <InfoRow label="Session status">{session?.status || "—"}</InfoRow>
          <InfoRow label="Started">{fmtDate(session?.started_at)}</InfoRow>
          <InfoRow label="Completed">{fmtDate(session?.completed_at)}</InfoRow>
          <InfoRow label="Report generated">{fmtDate(evaluation?.generated_at)}</InfoRow>
          <InfoRow label="Transcript source">
            {report.transcript_verified === null
              ? "—"
              : report.transcript_verified
                ? interview.mode === "telephonic" ? "Telephony provider" : "Server-recorded"
                : "Submitted by the browser (unverified)"}
          </InfoRow>
          {report.client_reported && (
            <InfoRow label="Proctoring (browser-reported)">
              {report.client_reported.integrity_score ?? "—"}/100 · {report.client_reported.proctor_flags_count ?? 0} flags
            </InfoRow>
          )}
          <InfoRow label="Interview ID"><span className="font-mono text-xs">{interview.id.slice(0, 8)}</span></InfoRow>
        </dl>
      </section>
    </div>
  );
}

function InterviewRow({ iv, applicationId }: { iv: InterviewInfo; applicationId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReport = iv.mode !== "human";

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !report) {
      setLoading(true);
      setError(null);
      try {
        setReport(await getInterviewReport(applicationId, iv.id));
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-zinc-900">{MODE_LABEL[iv.mode] || iv.mode}</p>
          <p className="text-xs text-zinc-500">
            {fmtDate(iv.scheduled_at)}
            {iv.duration_minutes ? ` · ${iv.duration_minutes} min` : ""}
            {iv.interviewer_email && ` · ${iv.interviewer_email}`}
          </p>
          {iv.status_detail && (
            <p className={cn("mt-1 text-xs", iv.status === "failed" ? "text-red-600" : "text-zinc-500")}>{iv.status_detail}</p>
          )}
        </div>
        <StatusDot tone={STATUS_TONE[iv.status] || "neutral"} className="text-xs">
          {STATUS_LABEL[iv.status] || iv.status}
        </StatusDot>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {iv.candidate_link && iv.status !== "completed" && (
          <>
            <CopyButton value={iv.candidate_link} label="Copy candidate link" />
            <a href={iv.candidate_link} target="_blank" rel="noopener noreferrer" className={cn(btnSecondary, "inline-flex items-center")}>
              <ExternalLink className="mr-1.5 h-4 w-4 text-zinc-400" /> Open link
            </a>
          </>
        )}
        {iv.meet_link && (
          <a href={iv.meet_link} target="_blank" rel="noopener noreferrer" className={cn(btnSecondary, "inline-flex items-center")}>
            <Video className="mr-1.5 h-4 w-4 text-zinc-400" /> Join Meet
          </a>
        )}
        {iv.calendar_html_link && (
          <a href={iv.calendar_html_link} target="_blank" rel="noopener noreferrer" className={cn(btnSecondary, "inline-flex items-center")}>
            <CalendarDays className="mr-1.5 h-4 w-4 text-zinc-400" /> Calendar event
          </a>
        )}
        {canReport && (
          <Button type="button" variant="outline" onClick={toggle} aria-expanded={open} className={btnSecondary}>
            {open ? <ChevronDown className="mr-1.5 h-4 w-4 text-zinc-400" /> : <ChevronRight className="mr-1.5 h-4 w-4 text-zinc-400" />}
            {iv.has_report ? "View report" : "Details"}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3">
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
            </p>
          )}
          {error && <ErrorBanner message={error} />}
          {report && <ReportView report={report} />}
        </div>
      )}
    </li>
  );
}

export function InterviewsTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const interviews = data.interviews || [];
  const [showForm, setShowForm] = useState(false);
  const [lastResult, setLastResult] = useState<ScheduleInterviewResponse | null>(null);
  const { toast } = useToast();

  const onDone = (res: ScheduleInterviewResponse) => {
    setShowForm(false);
    setLastResult(res);
    const failed = Object.values(res.steps).filter((s) => s?.status === "failed").length;
    if (res.interview.status === "failed") toast("error", "Interview saved, but it couldn't go ahead. See the details below.");
    else if (failed) toast("error", `Interview saved, but ${failed} step${failed > 1 ? "s" : ""} failed. See the details below.`);
    else toast("success", "Interview scheduled.");
    onReload();
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Interviews"
        description="Schedule an AI avatar, telephonic or panel interview. Reports appear here once an interview is complete."
        action={
          !showForm && (
            <Button variant="outline" onClick={() => { setShowForm(true); setLastResult(null); }} className={btnSecondary}>
              <Plus className="mr-1.5 h-4 w-4 text-zinc-400" /> Schedule interview
            </Button>
          )
        }
      >
        {showForm && <ScheduleForm data={data} onDone={onDone} onCancel={() => setShowForm(false)} />}
        {lastResult && !showForm && <div className="mb-4"><ScheduleResult result={lastResult} /></div>}

        {interviews.length === 0 ? (
          !showForm && (
            <EmptyNote
              action={
                <Button onClick={() => setShowForm(true)} className={btnPrimary}>
                  Schedule interview
                </Button>
              }
            >
              No interviews yet.
            </EmptyNote>
          )
        ) : (
          <ul className="-my-3 divide-y divide-zinc-100">
            {interviews.map((iv) => <InterviewRow key={iv.id} iv={iv} applicationId={data.application.id} />)}
          </ul>
        )}
      </Panel>
    </div>
  );
}
