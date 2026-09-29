"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { getAuthHeaders } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiConfig";

const API_URL = getApiBaseUrl();

const TRAIT_LABELS: Record<string, string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  // OCEAN-AI's own output terminology — deliberately NOT relabeled to
  // "Neuroticism" or flipped, see docs/behavioral-analysis.md. A higher
  // value means fewer neurotic/negative-emotion signals were detected, same
  // direction as the other four traits (higher = more of that quality).
  non_neuroticism: "Non-Neuroticism",
};
const TRAIT_ORDER = ["openness", "conscientiousness", "extraversion", "agreeableness", "non_neuroticism"];

type Traits = Partial<Record<string, number>>;

interface BehavioralAnalysisData {
  status: "not_requested" | "pending" | "processing" | "completed" | "failed";
  source: { audio: boolean; video: boolean; fusion: boolean } | null;
  model: { name: string | null; version: string | null } | null;
  results: { audio: Traits | null; video: Traits | null; audio_video: Traits | null } | null;
  error: string | null;
  processed_at: string | null;
}

interface LoadResult {
  data: BehavioralAnalysisData | null;
  error: string | null;
}

async function loadAnalysis(sessionId: string): Promise<LoadResult> {
  try {
    const res = await fetch(`${API_URL}/api/v1/interview/${sessionId}/behavioral-analysis`, {
      headers: { ...getAuthHeaders() },
    });
    if (!res.ok) {
      return {
        data: null,
        error: res.status === 403 ? "You don't have access to behavioral analysis." : "Could not load behavioral analysis.",
      };
    }
    return { data: (await res.json()) as BehavioralAnalysisData, error: null };
  } catch {
    return { data: null, error: "Could not reach the server." };
  }
}

function TraitBar({ trait, value }: { trait: string; value: number }) {
  // OCEAN-AI's scores are on a 0-1 scale — render as a percentage bar.
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-zinc-500">{TRAIT_LABELS[trait] || trait}</span>
        <span className="font-semibold text-zinc-700">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ModalityBlock({ title, traits }: { title: string; traits: Traits | null | undefined }) {
  if (!traits) return null;
  return (
    <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-3.5">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      <div className="space-y-2.5">
        {TRAIT_ORDER.filter((t) => traits[t] !== undefined && traits[t] !== null).map((t) => (
          <TraitBar key={t} trait={t} value={traits[t] as number} />
        ))}
      </div>
    </div>
  );
}

/** HR-only Behavioral Analysis section — fetches its own data (the report's
 * evaluation prop only ever carries the LLM interview score, never this)
 * from GET /interview/{session_id}/behavioral-analysis. Renders nothing at
 * all for "not_requested" (the common case: candidate didn't opt in) so an
 * ordinary report stays uncluttered. */
export default function BehavioralAnalysis({ sessionId }: { sessionId?: string }) {
  const [data, setData] = useState<BehavioralAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyResult = useCallback((r: LoadResult) => {
    if (r.data) setData(r.data);
    setActionError(r.error);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    applyResult(await loadAnalysis(sessionId));
    setLoading(false);
  }, [sessionId, applyResult]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    loadAnalysis(sessionId).then((r) => {
      if (!cancelled) applyResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, applyResult]);

  const retry = useCallback(async () => {
    if (!sessionId) return;
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/interview/${sessionId}/behavioral-analysis/retry`, {
        method: "POST",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) {
        setActionError("Could not queue a retry.");
        return;
      }
      await fetchStatus();
    } catch {
      setActionError("Could not reach the server.");
    }
  }, [sessionId, fetchStatus]);

  if (!sessionId || !data || data.status === "not_requested") return null;

  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-500" />
          <h4 className="text-xs font-bold text-zinc-900">Behavioral Analysis</h4>
        </div>
        <button
          onClick={() => void fetchStatus()}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        Model-inferred behavioral/personality signals, generated from the candidate&rsquo;s interview
        audio and video. These are supplementary signals for context, not objective truth or a hire/
        reject recommendation — they are never included in the interview score above.
      </p>

      {actionError && (
        <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {actionError}
        </div>
      )}

      {(data.status === "pending" || data.status === "processing") && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {data.status === "pending" ? "Queued for analysis…" : "Analyzing recording…"}
        </div>
      )}

      {data.status === "failed" && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <span>Analysis failed{data.error ? `: ${data.error}` : "."} The interview result above is unaffected.</span>
          <button
            onClick={() => void retry()}
            className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
          >
            Retry
          </button>
        </div>
      )}

      {data.status === "completed" && data.results && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <ModalityBlock title="Audio Analysis" traits={data.results.audio} />
            <ModalityBlock title="Video Analysis" traits={data.results.video} />
            <ModalityBlock title="Audio + Video (Fusion)" traits={data.results.audio_video} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-400">
            {data.model?.name && (
              <span>
                Model: {data.model.name}
                {data.model.version ? ` v${data.model.version}` : ""}
              </span>
            )}
            {data.processed_at && <span>Processed: {new Date(data.processed_at).toLocaleString()}</span>}
          </div>
        </>
      )}
    </div>
  );
}
