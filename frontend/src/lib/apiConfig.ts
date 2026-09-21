/**
 * Application API Configuration
 * 
 * Dynamically resolves the backend base URL across client and server runtimes:
 * - When NEXT_PUBLIC_API_URL is configured (e.g., in Vercel environment settings), uses it directly.
 * - In local browser dev (localhost / 127.0.0.1), defaults to http://localhost:8000.
 * - In deployed browser environments (e.g. *.vercel.app), defaults to relative path "" so requests
 *   route through Next.js server-side rewrites. This avoids browser mixed-content (HTTPS -> HTTP)
 *   blocking and eliminates localhost connection refused errors.
 */

export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "");
  }

  // Browser environment
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8000";
    }
    // Deployed domain: relative URL routes through Next.js rewrites proxy
    return "";
  }

  // Server-side / SSR environment
  return (
    process.env.BACKEND_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://44.201.3.194:8000"
      : "http://localhost:8000")
  );
}
