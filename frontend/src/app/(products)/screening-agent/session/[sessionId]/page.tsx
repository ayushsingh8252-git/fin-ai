"use client";

import { use, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Video } from "lucide-react";
import InterviewRoom from "../../_components/InterviewRoom";
import { getApiBaseUrl } from "@/lib/apiConfig";

const API_URL = getApiBaseUrl();

interface SessionData {
  session_id: string;
  email: string;
  role_title: string;
  jd_text: string | null;
  status: string;
}

export default function ScreeningSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [session, setSession] = useState<SessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/screening/session/${sessionId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail || "This interview link is invalid or has expired.");
        }
        const data = (await res.json()) as SessionData;
        if (cancelled) return;
        // A completed link shows a confirmation only — the scored report
        // is for the hiring team and needs a signed-in recruiter.
        setSession(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this interview link.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 bg-white-grid relative selection:bg-blue-500/20">
      <div className="border-b border-zinc-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center">
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-bold text-zinc-900">Your Interview Invite</span>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-zinc-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading your interview…</p>
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <h1 className="text-lg font-bold text-red-700 mb-1">Interview link unavailable</h1>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {!loading && !error && session && session.status === "completed" && (
          <div className="mx-auto max-w-xl rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
            <h1 className="text-xl font-semibold text-zinc-900">This interview is complete</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Your interview for {session.role_title} was submitted to the hiring team. There&rsquo;s nothing more to do
              on this link — they will contact you about next steps.
            </p>
          </div>
        )}

        {!loading && !error && session && session.status !== "completed" && (
          <>
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 mb-2">
                You&rsquo;re invited to interview for {session.role_title}
              </h1>
              <p className="text-zinc-500 text-sm">
                Upload your resume (PDF) below, then click Start Interview when you&rsquo;re ready. Make sure your camera
                and microphone are working and you&rsquo;re in a quiet space.
              </p>
            </div>
            <InterviewRoom
              initialRoleTitle={session.role_title}
              initialJdText={session.jd_text || ""}
              sessionId={session.session_id}
              email={session.email}
              roleFieldsLocked
              candidateView
            />
          </>
        )}
      </main>
    </div>
  );
}
