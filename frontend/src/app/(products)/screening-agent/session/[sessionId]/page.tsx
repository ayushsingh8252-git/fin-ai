"use client";

import { use, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Video } from "lucide-react";
import InterviewRoom from "../../_components/InterviewRoom";
import InterviewReport from "../../_components/InterviewReport";
import type { EvaluationResult } from "../../_components/types";
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
  // Once an interview finishes, GET /interview/report/{id} persists — reused
  // here so reloading (or revisiting) this link shows the real completed
  // report instead of dropping the candidate back into a fresh setup screen.
  const [completedReport, setCompletedReport] = useState<EvaluationResult | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

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
        setSession(data);

        if (data.status === "completed") {
          try {
            const reportRes = await fetch(`${API_URL}/api/v1/interview/report/${sessionId}`);
            if (reportRes.ok) {
              const report = (await reportRes.json()) as EvaluationResult;
              if (!cancelled) setCompletedReport(report);
            } else if (!cancelled) {
              setReportError("This interview is complete, but the detailed report couldn't be loaded.");
            }
          } catch {
            if (!cancelled) setReportError("This interview is complete, but the detailed report couldn't be loaded.");
          }
        }
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
          <>
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 mb-2">
                Your interview for {session.role_title} is complete
              </h1>
              <p className="text-zinc-500 text-sm">
                Thanks for taking the time to interview — here&rsquo;s your report from that session.
              </p>
            </div>
            <div className="max-w-3xl mx-auto">
              {completedReport ? (
                <InterviewReport evaluation={completedReport} />
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-700">
                  {reportError || "Loading your report…"}
                </div>
              )}
            </div>
          </>
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
            />
          </>
        )}
      </main>
    </div>
  );
}
