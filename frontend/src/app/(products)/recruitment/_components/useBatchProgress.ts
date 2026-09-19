"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage, getBatch, type BatchStatus } from "@/lib/recruitmentApi";

const POLL_MS = 2000;
const RETRY_MS = 5000;
/** How long files may sit unclaimed before we tell the user the processing
 * service may not be running. Long enough that a normal queue never trips it. */
const STALLED_AFTER_MS = 90_000;

export interface BatchProgress {
  batchId: string;
  status: BatchStatus;
  /** Files are waiting and nothing is being processed: the worker is probably down. */
  stalled: boolean;
  /** The last refresh failed; `status` is the most recent successful one. */
  refreshError: string | null;
}

/** Polls a batch until every file has reached a final state.
 *
 * The numbers come straight from the database rows the worker updates, so a
 * dead worker shows as files stuck in "queued", never as invented progress.
 * `onSettled` fires once when the batch finishes, so the caller can reload the
 * candidate list. */
export function useBatchProgress(
  batchId: string | null,
  onSettled?: () => void,
  /** Bump to resume polling of an already-finished batch, e.g. after a retry re-queues a file. */
  restartKey = 0,
): BatchProgress | null {
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const settledRef = useRef(onSettled);

  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const status = await getBatch(batchId);
        if (cancelled) return;
        const oldest = status.oldest_queued_at ? Date.parse(status.oldest_queued_at) : NaN;
        const stalled =
          !status.done &&
          status.counts.processing === 0 &&
          status.counts.queued > 0 &&
          !Number.isNaN(oldest) &&
          Date.now() - oldest > STALLED_AFTER_MS;
        setProgress({ batchId, status, stalled, refreshError: null });
        if (status.done) {
          settledRef.current?.();
        } else {
          timer = window.setTimeout(tick, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setProgress((prev) => (prev && prev.batchId === batchId ? { ...prev, refreshError: errorMessage(err) } : prev));
        timer = window.setTimeout(tick, RETRY_MS);
      }
    };
    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [batchId, restartKey]);

  // Never surface a previous batch's numbers under a new id.
  return batchId && progress?.batchId === batchId ? progress : null;
}
