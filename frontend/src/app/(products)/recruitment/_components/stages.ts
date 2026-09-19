import type { Stage } from "@/lib/recruitmentApi";
import type { StatusTone } from "@/components/ui/status-pill";

export const STAGE_LABEL: Record<Stage, string> = {
  PROCESSING: "Processing",
  APPLIED: "Applied",
  SCREENING: "Screening",
  SHORTLISTED: "Shortlisted",
  INTERVIEW: "Interview",
  SELECTED: "Selected",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

// Colour is reserved for meaning: blue = in progress, green = positive
// outcome, red = negative outcome, grey = everything else.
export const STAGE_TONE: Record<Stage, StatusTone> = {
  PROCESSING: "info",
  APPLIED: "neutral",
  SCREENING: "neutral",
  SHORTLISTED: "success",
  INTERVIEW: "neutral",
  SELECTED: "success",
  OFFER: "success",
  HIRED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

/** The stages shown as the pipeline strip, in lifecycle order. */
export const PIPELINE_ORDER: Stage[] = [
  "APPLIED", "SCREENING", "SHORTLISTED", "INTERVIEW", "SELECTED", "OFFER", "HIRED",
];

/** Which stages a person may move a candidate to from each stage.
 *
 * This mirrors STAGE_TRANSITIONS in the backend's recruitment_service.py and
 * exists ONLY to decide which buttons to offer. The server is the authority:
 * it re-validates every move and answers an illegal one with a readable
 * error, so a drift between the two can never let a bad transition through.
 * PROCESSING has no entry on purpose: that move is automatic, never a person's. */
export const NEXT_STAGES: Record<Stage, Stage[]> = {
  PROCESSING: [],
  APPLIED: ["SCREENING", "SHORTLISTED", "REJECTED", "WITHDRAWN"],
  SCREENING: ["APPLIED", "SHORTLISTED", "REJECTED", "WITHDRAWN"],
  SHORTLISTED: ["SCREENING", "INTERVIEW", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["SHORTLISTED", "SELECTED", "REJECTED", "WITHDRAWN"],
  SELECTED: ["INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["SELECTED", "HIRED", "REJECTED", "WITHDRAWN"],
  HIRED: [],
  REJECTED: ["APPLIED"],
  WITHDRAWN: ["APPLIED"],
};

export function initials(name: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
