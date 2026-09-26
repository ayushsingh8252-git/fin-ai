"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Check, ChevronDown, ChevronRight, FileText, Loader2, Plus, RefreshCw, Send, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  errorMessage, getApplication360, setStage, openResume,
  createOffer, updateOffer,
  sendWhatsAppMessage, triggerTelephonicCall,
  type Application360, type OfferInfo, type Stage,
} from "@/lib/recruitmentApi";
import { NEXT_STAGES, STAGE_LABEL, STAGE_TONE } from "@/app/(products)/recruitment/_components/stages";
import { useRecruitment } from "@/app/(products)/recruitment/_components/RecruitmentShell";
import { cn } from "@/lib/utils";
import {
  ContactCard, EducationCard, EmploymentHistoryCard, ExtractFromResumeButton, VerificationStatusCard,
} from "./_profile";
import { BackgroundVerificationTab, type SavedBgvResult } from "./_bgv";
import { InterviewsTab } from "./_interviews";
import {
  EmptyNote, InfoRow, Panel, StatusDot, Tag, btnPrimary, btnSecondary, inputCls, labelCls, type Tone,
} from "./_ui";

// Tagged with the application id it was loaded for, so a background refresh
// keeps the current page on screen (and any in-progress tab state mounted)
// instead of blanking to a skeleton; the skeleton shows only on first load or
// when navigating to a different candidate.
type LoadState = ({ data: Application360 } | { error: string }) & { appId: string } | null;

const WHATSAPP_TEMPLATES = [
  {
    label: "Voice screen invite",
    text: (name: string, role: string) =>
      `Hi ${name}, thank you for applying for the ${role} role. We'd like to invite you to a short voice screening call. Are you available today?`,
  },
  {
    label: "Interview confirmation",
    text: (name: string, role: string) =>
      `Hi ${name}, your interview for the ${role} role is confirmed. Let us know if you have any questions before the meeting.`,
  },
  {
    label: "Offer extended",
    text: (name: string, role: string) =>
      `Hi ${name}, we're pleased to share that we've extended an offer for the ${role} role. Please review the details we've sent over.`,
  },
  {
    label: "Follow-up",
    text: (name: string, role: string) =>
      `Hi ${name}, following up on your application for the ${role} role. When would be a good time to connect this week?`,
  },
];

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900">{value}</p>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

// ── Evaluation ──────────────────────────────────────────────────────────

function EvaluationTab({ data, canAnalyze, onReload }: { data: Application360; canAnalyze: boolean; onReload: () => void }) {
  const { application, candidate } = data;
  const matched = application.analysis.matched_skills || [];
  const missing = application.analysis.missing_skills || [];
  const other = (candidate.skills || []).filter((s) => !matched.includes(s) && !missing.includes(s));
  const total = matched.length + missing.length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel
          title="Skills"
          description={total ? `${matched.length} of ${total} job requirements met` : "Not yet matched against the job description"}
        >
          <div className="space-y-4">
            <SkillGroup title="Meets requirement" empty="None of the required skills were found.">
              {matched.map((s) => (
                <Tag key={s}>
                  <Check className="h-3 w-3 text-emerald-600" /> {s}
                </Tag>
              ))}
            </SkillGroup>
            {missing.length > 0 && (
              <SkillGroup title="Missing">
                {missing.map((s) => (
                  <Tag key={s} className="border-dashed bg-white text-zinc-500">
                    <X className="h-3 w-3 text-zinc-400" /> {s}
                  </Tag>
                ))}
              </SkillGroup>
            )}
            {other.length > 0 && (
              <SkillGroup title="Other skills">
                {other.map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
              </SkillGroup>
            )}
          </div>
        </Panel>
        <EmploymentHistoryCard data={data} canAnalyze={canAnalyze} onReload={onReload} />
        <EducationCard data={data} />
      </div>
      <div className="space-y-4">
        <ContactCard data={data} />
        <VerificationStatusCard data={data} />
      </div>
    </div>
  );
}

function SkillGroup({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode[] | React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-zinc-500">{title}</p>
      {items.length ? <div className="flex flex-wrap gap-1.5">{children}</div> : <p className="text-[13px] text-zinc-400">{empty}</p>}
    </div>
  );
}

// ── WhatsApp ────────────────────────────────────────────────────────────

function WhatsAppTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate, job } = data;
  const messages = data.whatsapp_messages || [];
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const firstName = (candidate.name || "there").split(" ")[0];
  const role = job?.title || "the role";

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendWhatsAppMessage(application.id, text.trim());
      setText("");
      toast("success", "Message sent.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Panel title="WhatsApp" description={candidate.phone ? `Messages to ${candidate.phone}` : "No phone number on file"} bodyClassName="p-0">
      <div className="max-h-[380px] min-h-[220px] space-y-3 overflow-y-auto bg-zinc-50/60 px-5 py-4">
        {messages.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-zinc-500">No messages yet. Pick a template below or write one.</p>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div key={m.id} className={cn("flex max-w-[80%] flex-col", outbound ? "ml-auto items-end" : "items-start")}>
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                    outbound ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-900"
                  )}
                >
                  {m.body}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {m.created_at && new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {outbound && ` · ${m.status}`}
                </p>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={send} className="space-y-3 border-t border-zinc-100 px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {WHATSAPP_TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              disabled={!candidate.phone}
              onClick={() => setText(t.text(firstName, role))}
              className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer"
            >
              {t.label}
            </button>
          ))}
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!candidate.phone || sending}
            placeholder={candidate.phone ? `Message ${firstName}` : "No phone number on file"}
            aria-label="Message"
            className={inputCls}
          />
          <Button type="submit" disabled={!candidate.phone || !text.trim() || sending} className={btnPrimary}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {!sending && "Send"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// ── Voice screen ────────────────────────────────────────────────────────

function callTone(status: string): Tone {
  if (status === "completed") return "success";
  if (["failed", "no-answer", "busy", "canceled"].includes(status)) return "danger";
  return "info";
}

function VoiceScreeningTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, candidate } = data;
  const call = (data.telephonic_calls || [])[0] || null;
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const start = async () => {
    setCalling(true);
    setError(null);
    try {
      await triggerTelephonicCall(application.id);
      toast("success", "Screening call started.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCalling(false);
    }
  };

  const score = (v: number | null | undefined) => (typeof v === "number" ? `${v}%` : <span className="text-zinc-400">Not scored</span>);

  return (
    <div className="space-y-4">
      <Panel
        title="AI voice screen"
        description={candidate.phone ? `Automated screening call to ${candidate.phone}` : "No phone number on file"}
        action={
          <Button onClick={start} disabled={calling || !candidate.phone} className={btnPrimary}>
            {calling && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {calling ? "Connecting…" : call ? "Call again" : "Start call"}
          </Button>
        }
      >
        {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
        {call ? (
          <dl className="-my-2 divide-y divide-zinc-100">
            <InfoRow label="Status"><StatusDot tone={callTone(call.status)}>{call.status}</StatusDot></InfoRow>
            {typeof call.duration_sec === "number" && <InfoRow label="Duration">{Math.round(call.duration_sec)}s</InfoRow>}
            <InfoRow label="Communication">{score(call.communication_score)}</InfoRow>
            <InfoRow label="Relevance">{score(call.relevance_score)}</InfoRow>
            <InfoRow label="Confidence">{score(call.confidence_score)}</InfoRow>
            {call.created_at && <InfoRow label="Placed">{new Date(call.created_at).toLocaleString()}</InfoRow>}
          </dl>
        ) : (
          <p className="text-[13px] text-zinc-500">No calls yet.</p>
        )}
      </Panel>

      {call?.evaluation_summary && (
        <Panel title="Evaluation">
          <p className="text-[13px] leading-relaxed text-zinc-700">{call.evaluation_summary}</p>
        </Panel>
      )}

      {call && (call.transcript || []).length > 0 && (
        <Panel title="Transcript" description={`${call.transcript.length} turns`}>
          <ol className="-my-2 max-h-[360px] divide-y divide-zinc-100 overflow-y-auto">
            {call.transcript.map((t, i) => (
              <li key={i} className="grid grid-cols-[110px_1fr] gap-3 py-2.5 text-[13px]">
                <span className="font-medium text-zinc-500">{t.role === "agent" ? "AI recruiter" : candidate.name || "Candidate"}</span>
                <span className="leading-relaxed text-zinc-800">{t.text}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

// ── Offers ──────────────────────────────────────────────────────────────

const OFFER_TONE: Record<OfferInfo["status"], Tone> = {
  draft: "neutral", sent: "info", accepted: "success", rejected: "danger", rescinded: "danger",
};

function formatSalary(offer: OfferInfo): string | null {
  if (offer.salary === null || offer.salary === undefined) return null;
  try {
    return new Intl.NumberFormat(offer.currency === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency: offer.currency || "USD", maximumFractionDigits: 0,
    }).format(offer.salary);
  } catch {
    return `${offer.currency} ${offer.salary.toLocaleString()}`;
  }
}

function OffersTab({ data, onReload }: { data: Application360; onReload: () => void }) {
  const { application, job } = data;
  const offers = data.offers || [];
  const [showForm, setShowForm] = useState(false);
  const [salary, setSalary] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [equity, setEquity] = useState("");
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = salary.trim() ? Number(salary.replace(/[,\s]/g, "")) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      setError("Enter the base salary as a number, e.g. 1800000.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createOffer(application.id, {
        role_title: job?.title || undefined,
        salary: amount,
        currency,
        equity: equity.trim() || undefined,
        start_date: startDate || undefined,
      });
      setShowForm(false);
      toast("success", "Offer created.");
      onReload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const accept = async (offerId: string) => {
    try {
      await updateOffer(offerId, { status: "accepted" });
      toast("success", "Offer accepted — candidate moved to Hired.");
      onReload();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  return (
    <Panel
      title="Offers"
      description={`${offers.length} offer${offers.length === 1 ? "" : "s"}`}
      action={
        <Button variant="outline" onClick={() => setShowForm((v) => !v)} className={btnSecondary}>
          <Plus className="mr-1.5 h-4 w-4 text-zinc-400" /> New offer
        </Button>
      }
    >
      {showForm && (
        <form onSubmit={create} className="mb-4 space-y-3 rounded-md border border-zinc-200 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="of-salary" className={labelCls}>Base salary (per year)</label>
              <div className="flex gap-2">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency" className={cn(inputCls, "w-24")}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
                <input id="of-salary" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor="of-equity" className={labelCls}>Equity (optional)</label>
              <input id="of-equity" value={equity} onChange={(e) => setEquity(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="of-start" className={labelCls}>Start date</label>
              <input id="of-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)} className={btnSecondary}>Cancel</Button>
            <Button type="submit" disabled={saving} className={btnPrimary}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create offer
            </Button>
          </div>
        </form>
      )}

      {offers.length === 0 ? (
        <p className="text-[13px] text-zinc-500">No offers yet.</p>
      ) : (
        <ul className="-my-2 divide-y divide-zinc-100">
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-[13px] font-medium text-zinc-900">{o.role_title || "Offer"}</p>
                <p className="text-xs text-zinc-500">
                  {[
                    formatSalary(o) ? `${formatSalary(o)} / year` : "Salary not specified",
                    o.equity,
                    o.start_date && `Starts ${o.start_date}`,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusDot tone={OFFER_TONE[o.status] || "neutral"} className="text-xs capitalize">{o.status}</StatusDot>
                {o.status !== "accepted" && o.status !== "rescinded" && (
                  <Button variant="outline" onClick={() => accept(o.id)} className={btnSecondary} title="Moves the candidate to Hired">
                    Mark accepted
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Activity ────────────────────────────────────────────────────────────

const ACTOR_LABEL: Record<string, string> = { hr: "HR", ai: "AI", system: "System" };

function ActivityTab({ data }: { data: Application360 }) {
  const events = data.activity || [];
  return (
    <Panel title="Activity" description="Every AI result and HR decision on this application, newest first.">
      {events.length === 0 ? (
        <p className="text-[13px] text-zinc-500">No activity yet.</p>
      ) : (
        <ol className="-my-2 divide-y divide-zinc-100">
          {events.map((ev) => (
            <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
              <p className="min-w-0 text-[13px] text-zinc-800">
                <span className="mr-2 inline-block w-12 text-xs font-medium text-zinc-400">{ACTOR_LABEL[ev.actor_type] || ev.actor_type}</span>
                {ev.summary}
              </p>
              {ev.created_at && (
                <time className="text-xs tabular-nums text-zinc-400">
                  {new Date(ev.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </time>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ── Stage actions ───────────────────────────────────────────────────────

function StageActions({
  current,
  onMove,
  busy,
}: {
  current: Stage;
  onMove: (s: Stage) => void;
  busy: Stage | null;
}) {
  const options = NEXT_STAGES[current] || [];
  const primary = options.find((s) => s !== "REJECTED" && s !== "WITHDRAWN");
  const rest = options.filter((s) => s !== primary);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (options.length === 0) return null;
  return (
    <div ref={ref} className="relative flex">
      {primary && (
        <Button
          onClick={() => onMove(primary)}
          disabled={busy !== null}
          className={cn(btnPrimary, rest.length && "rounded-r-none")}
        >
          {busy === primary && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Move to {STAGE_LABEL[primary]}
        </Button>
      )}
      {rest.length > 0 && (
        <Button
          onClick={() => setOpen((v) => !v)}
          disabled={busy !== null}
          aria-label="More stage options"
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            primary ? cn(btnPrimary, "rounded-l-none border-l border-blue-500 px-2") : btnSecondary
          )}
        >
          {!primary && "Change stage"}
          <ChevronDown className={cn("h-4 w-4", !primary && "ml-1.5 text-zinc-400")} />
        </Button>
      )}
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          {rest.map((s) => (
            <button
              key={s}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onMove(s);
              }}
              className={cn(
                "flex w-full items-center rounded-md px-3 py-2 text-left text-[13px] cursor-pointer",
                s === "REJECTED" ? "text-rose-600 hover:bg-rose-50" : "text-zinc-700 hover:bg-zinc-50"
              )}
            >
              {s === "REJECTED" ? "Reject" : `Move to ${STAGE_LABEL[s]}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "evaluation", label: "Overview" },
  { id: "bgv", label: "Background check" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "voice", label: "Voice screen" },
  { id: "interviews", label: "Interviews" },
  { id: "offers", label: "Offers" },
  { id: "activity", label: "Activity" },
] as const;

export default function CandidateDetailPage() {
  const { jobId, appId } = useParams<{ jobId: string; appId: string }>();
  const [loaded, setLoaded] = useState<LoadState>(null);
  const [refresh, setRefresh] = useState(0);
  const [stageBusy, setStageBusy] = useState<Stage | null>(null);
  const [activeTab, setActiveTab] = useState<string>("evaluation");
  // Last BGV run, kept here so the drafted email survives switching tabs.
  const [bgv, setBgv] = useState<(SavedBgvResult & { appId: string }) | null>(null);
  const { can } = useRecruitment();
  const { toast } = useToast();

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    getApplication360(appId)
      .then((data) => !cancelled && setLoaded({ appId, data }))
      .catch((err) => !cancelled && setLoaded({ appId, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [appId, refresh]);

  const moveStage = async (target: Stage) => {
    setStageBusy(target);
    try {
      await setStage(appId, target);
      toast("success", target === "REJECTED" ? "Candidate rejected." : `Moved to ${STAGE_LABEL[target]}.`);
      reload();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setStageBusy(null);
    }
  };

  if (loaded === null || loaded.appId !== appId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-64 rounded bg-zinc-200/70" />
        <Skeleton className="h-44 w-full rounded-lg bg-zinc-200/70" />
        <Skeleton className="h-72 w-full rounded-lg bg-zinc-200/70" />
      </div>
    );
  }

  if ("error" in loaded) {
    return (
      <div className="max-w-md space-y-3 py-6">
        <ErrorBanner message={loaded.error} />
        <Button variant="outline" onClick={reload} className={btnSecondary}>Try again</Button>
      </div>
    );
  }

  const { data } = loaded;
  const { candidate, application, job } = data;
  const name = candidate.name || "Candidate";
  const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "C";
  const currentEmployer = (candidate.work_history || []).find((w) => w.is_current) || null;
  const summary = candidate.summary || application.analysis.ai_summary;
  const matched = application.analysis.matched_skills || [];
  const reqTotal = matched.length + (application.analysis.missing_skills || []).length;
  const matchVal = application.scores.match_score.value;
  const atsVal = application.scores.ats_score.value;

  const subline = [
    candidate.current_role && (currentEmployer ? `${candidate.current_role} at ${currentEmployer.company}` : candidate.current_role),
    candidate.location,
    typeof candidate.experience_years === "number" && `${candidate.experience_years} years experience`,
  ].filter(Boolean) as string[];

  const counts: Record<string, number | undefined> = {
    whatsapp: data.whatsapp_messages?.length,
    voice: data.telephonic_calls?.length,
    interviews: data.interviews?.length,
    offers: data.offers?.length,
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-zinc-500">
        <Link href="/recruitment" className="hover:text-zinc-900">Positions</Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
        <Link href={`/recruitment/jobs/${jobId}`} className="truncate hover:text-zinc-900">{job?.title || "Position"}</Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
        <span className="truncate text-zinc-900">{name}</span>
      </nav>

      {/* Header */}
      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{name}</h1>
                <StatusDot tone={STAGE_TONE[application.stage] as Tone}>{STAGE_LABEL[application.stage]}</StatusDot>
                {candidate.is_demo && (
                  <Tag className="text-zinc-500" >Demo data</Tag>
                )}
              </div>
              {subline.length > 0 && <p className="mt-1 text-[13px] text-zinc-500">{subline.join(" · ")}</p>}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={reload} aria-label="Refresh" title="Refresh" className={cn(btnSecondary, "px-2.5")}>
              <RefreshCw className="h-4 w-4 text-zinc-400" />
            </Button>
            {candidate.has_resume && (
              <Button
                variant="outline"
                onClick={() => openResume(candidate.id).catch((err) => toast("error", errorMessage(err)))}
                className={btnSecondary}
              >
                <FileText className="mr-1.5 h-4 w-4 text-zinc-400" /> Resume
              </Button>
            )}
            {can("decide") && <StageActions current={application.stage} onMove={moveStage} busy={stageBusy} />}
          </div>
        </div>

        <div className="border-t border-zinc-100 px-5 py-4">
          <p className="mb-1 text-xs font-medium text-zinc-500">Summary</p>
          {summary ? (
            <p className="max-w-4xl text-[14px] leading-relaxed text-zinc-700">{summary}</p>
          ) : (
            <EmptyNote
              action={can("analyze") && candidate.has_resume ? <ExtractFromResumeButton applicationId={application.id} onDone={reload} /> : undefined}
            >
              {candidate.has_resume ? "No summary has been extracted from this resume yet." : "No resume on file."}
            </EmptyNote>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-zinc-200 bg-zinc-200 lg:grid-cols-4">
          <Metric label="Role fit" value={matchVal !== null ? `${matchVal}%` : "—"} hint="Match to the job description" />
          <Metric label="ATS score" value={atsVal !== null ? `${atsVal}%` : "—"} hint="Resume quality" />
          <Metric label="Requirements met" value={reqTotal ? `${matched.length} / ${reqTotal}` : "—"} hint="Required skills found" />
          <Metric label="AI recommendation" value={application.analysis.recommendation || "—"} hint="HR makes the decision" />
        </div>
      </section>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Candidate sections"
        className="flex items-center gap-6 overflow-x-auto border-b border-zinc-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => {
          const active = activeTab === t.id;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "relative -mb-px flex h-10 items-center gap-1.5 whitespace-nowrap text-[13px] font-medium transition-colors cursor-pointer",
                "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full",
                active ? "text-zinc-900 after:bg-blue-600" : "text-zinc-500 hover:text-zinc-900"
              )}
            >
              {t.label}
              {typeof count === "number" && count > 0 && (
                <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] tabular-nums text-zinc-600">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div role="tabpanel">
        {activeTab === "evaluation" && <EvaluationTab data={data} canAnalyze={can("analyze")} onReload={reload} />}
        {activeTab === "bgv" && (
          <BackgroundVerificationTab
            data={data}
            canAnalyze={can("analyze")}
            onReload={reload}
            saved={bgv?.appId === appId ? bgv : null}
            onResult={(saved) => setBgv({ ...saved, appId })}
          />
        )}
        {activeTab === "whatsapp" && <WhatsAppTab data={data} onReload={reload} />}
        {activeTab === "voice" && <VoiceScreeningTab data={data} onReload={reload} />}
        {activeTab === "interviews" && <InterviewsTab data={data} onReload={reload} />}
        {activeTab === "offers" && <OffersTab data={data} onReload={reload} />}
        {activeTab === "activity" && <ActivityTab data={data} />}
      </div>
    </div>
  );
}
