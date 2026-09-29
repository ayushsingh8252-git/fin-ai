"use client";

import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiConfig";

const API_URL = getApiBaseUrl();

interface AudioEvent {
  event_type: string;
  speaker_id: string | null;
  turn_index: number | null;
  start_seconds: number | null;
  duration_ms: number | null;
  confidence: number | null;
  details: { speakers_detected?: number; additional_speakers?: number; reason?: string } | null;
  occurred_at: string | null;
}

interface AudioEventsResponse {
  status: "not_enabled" | "active" | "degraded";
  baseline_status: "enrolling" | "ready" | "insufficient_baseline" | null;
  reference_source: "voiceprint" | "interview_enrollment" | null;
  stats: {
    stream_seconds: number;
    candidate_seconds: number;
    unknown_seconds: number;
    unresolved_seconds: number;
    candidate_coverage_pct: number | null;
    distinct_extra_speakers: number;
  } | null;
  events: AudioEvent[];
}

const fmtSec = (s: number | null | undefined) => (s == null ? "—" : `${s.toFixed(1)} s`);
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : "—");

/** HR-only "Audio Integrity Events" section: what the speaker monitor
 * measured, stated neutrally. Renders nothing when the candidate didn't
 * consent to the voice check. */
export default function AudioIntegrity({ sessionId }: { sessionId?: string }) {
  const [data, setData] = useState<AudioEventsResponse | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API_URL}/api/v1/interview/${sessionId}/audio-events`, { headers: { ...getAuthHeaders() } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, [sessionId]);

  if (!data || data.status === "not_enabled") return null;
  const s = data.stats;
  const detections = data.events.filter((e) => e.event_type === "MULTIPLE_SPEAKERS_DETECTED");
  const clears = data.events.filter((e) => e.event_type === "MULTIPLE_SPEAKERS_CLEARED");
  const degraded = data.events.filter((e) => e.event_type === "AUDIO_ANALYSIS_DEGRADED").length;
  const unresolved = data.events.filter((e) => e.event_type === "SPEAKER_UNRESOLVED").length;

  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <Mic className="w-4 h-4 text-zinc-500" />
        <h4 className="text-xs font-bold text-zinc-900">Audio Integrity Events</h4>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        Voices on the candidate&rsquo;s microphone that did not match the candidate&rsquo;s voice reference.
        These are observed audio events, not a conclusion about the candidate — a TV, a family member or an echo
        can produce them.
      </p>

      {data.baseline_status === "insufficient_baseline" && (
        <p className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          No candidate voice reference could be established, so no speaker checks were made.
        </p>
      )}
      {(data.status === "degraded" || degraded > 0) && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Audio analysis was temporarily unavailable during this interview; results may be incomplete.
        </p>
      )}

      {s && data.baseline_status === "ready" && (
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
          <Stat label="Additional speaker events" value={String(detections.length)} />
          <Stat label="Candidate voice coverage" value={s.candidate_coverage_pct == null ? "—" : `${s.candidate_coverage_pct}%`} />
          <Stat label="Unknown speaker time" value={fmtSec(s.unknown_seconds)} />
          <Stat label="Unresolved audio" value={`${fmtSec(s.unresolved_seconds)}${unresolved ? ` (${unresolved})` : ""}`} />
        </dl>
      )}
      {data.reference_source && (
        <p className="mb-3 text-[10px] text-zinc-400">
          Voice reference: {data.reference_source === "voiceprint" ? "existing enrolled voiceprint" : "candidate's first answers"}
        </p>
      )}

      {detections.length > 0 && (
        <ol className="space-y-2">
          {detections.map((d, i) => {
            const cleared = clears.find((c) => (c.occurred_at ?? "") >= (d.occurred_at ?? ""));
            return (
              <li key={`${d.occurred_at}-${i}`} className="rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-800">
                    Event {i + 1} · {(d.details?.additional_speakers ?? 1) > 1
                      ? `Additional speakers detected (${d.details?.additional_speakers})`
                      : "Additional speaker detected"}
                  </span>
                  <span className="text-zinc-500">
                    {fmtTime(d.occurred_at)} – {cleared ? fmtTime(cleared.occurred_at) : "end of interview"}
                    {cleared?.duration_ms != null ? ` · ${(cleared.duration_ms / 1000).toFixed(1)} s` : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-zinc-500">
                  {d.turn_index != null ? `During answer ${d.turn_index + 1} · ` : ""}
                  {d.speaker_id ?? "unlabelled voice"}
                  {d.confidence != null ? ` · confidence ${Math.round(d.confidence * 100)}%` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 p-2">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-zinc-700">{value}</dd>
    </div>
  );
}
