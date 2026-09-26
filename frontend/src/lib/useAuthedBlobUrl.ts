"use client";

import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/lib/auth";

/** Loads a login-protected backend file (e.g. /uploads/...) as a blob: URL.
 * <img>, <iframe> and the browser PDF viewer can't send the Authorization
 * header, so pointing them straight at the backend returns 401 whenever real
 * auth is on. `loading` is true until the file arrives or fails. */
export function useAuthedBlobUrl(url: string | null): { src: string | null; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ url: string | null; src: string | null; error: boolean }>({
    url: null,
    src: null,
    error: false,
  });

  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(url, { headers: getAuthHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url, src: objectUrl, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url, src: null, error: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return { src: null, loading: false, error: false };
  if (state.url !== url) return { src: null, loading: true, error: false };
  return { src: state.src, loading: false, error: state.error };
}
