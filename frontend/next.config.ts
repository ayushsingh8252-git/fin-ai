import type { NextConfig } from "next";
import path from "path";

const backendTarget = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
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
