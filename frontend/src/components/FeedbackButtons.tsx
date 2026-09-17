"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { getLlmopsHeaders } from "@/lib/llmopsIdentity";
import { getAuthHeaders } from "@/lib/auth";

type Rating = "up" | "down";

interface FeedbackButtonsProps {
  /** "rag" | "fraud" | "interview" | "screening" | "telephonic" */
  workflowType: string;
  /** The result's own id (request_id / scan_id / report_id / session_id /
   * call id) — the backend derives the Langfuse trace id from this the same
   * way the trace was tagged when it was created. Nothing renders without it. */
  subjectId?: string | null;
  className?: string;
}

export default function FeedbackButtons({ workflowType, subjectId, className = "" }: FeedbackButtonsProps) {
  const [voted, setVoted] = useState<Rating | null>(null);

  if (!subjectId) return null;

  async function vote(rating: Rating) {
    if (voted) return;
    setVoted(rating); // optimistic — a failed POST below shouldn't undo the click
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      await fetch(`${apiUrl}/api/v1/feedback/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getLlmopsHeaders(), ...getAuthHeaders() },
        body: JSON.stringify({ workflow_type: workflowType, subject_id: subjectId, rating }),
      });
    } catch {
      // Best-effort telemetry — never surface an error for a thumbs vote.
    }
  }

  return (
    <div className={`mt-2 flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => vote("up")}
        disabled={!!voted}
        aria-pressed={voted === "up"}
        title="Helpful"
        className={`p-1.5 rounded-lg border transition-colors ${
          voted === "up"
            ? "bg-emerald-50 border-emerald-200 text-emerald-600"
            : "bg-white border-zinc-200 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50"
        } ${voted && voted !== "up" ? "opacity-40" : ""}`}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => vote("down")}
        disabled={!!voted}
        aria-pressed={voted === "down"}
        title="Not helpful"
        className={`p-1.5 rounded-lg border transition-colors ${
          voted === "down"
            ? "bg-red-50 border-red-200 text-red-600"
            : "bg-white border-zinc-200 text-zinc-400 hover:text-red-600 hover:bg-red-50"
        } ${voted && voted !== "down" ? "opacity-40" : ""}`}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      {voted && <span className="text-[11px] text-zinc-400 font-mono">Thanks for the feedback</span>}
    </div>
  );
}
