import type { NextConfig } from "next";
import path from "path";

// NEXT_PUBLIC_API_URL may be "/" (same-origin: the browser calls /api on
// whatever host served the page, e.g. behind Caddy on several domains) —
// that is not a usable rewrite target, so only absolute URLs are taken here.
const absolute = (v?: string) => (v && /^https?:\/\//.test(v) ? v : undefined);
const backendTarget = (
  absolute(process.env.BACKEND_URL) ||
  absolute(process.env.NEXT_PUBLIC_API_URL) ||
  (process.env.NODE_ENV === "production"
    ? "http://44.201.3.194:8000"
    : "http://localhost:8000")
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendTarget}/api/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${backendTarget}/health`,
      },
    ];
  },
};

export default nextConfig;
