import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AIAssistantWidget from "@/components/ai-assistant/AIAssistantWidget";
import CookieConsent from "@/components/CookieConsent";
import { AUTH_GATE_ENABLED, AuthProvider } from "@/contexts/AuthContext";
import AuthHeaderBar from "@/components/auth/AuthHeaderBar";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "fin.ai — Enterprise AI Agent Orchestration Platform",
  description:
    "fin.ai automates enterprise policy extraction, orchestrates autonomous multi-agent reasoning, indexes document vectors with hybrid RAG, and executes deterministic actions across your organization.",
  openGraph: {
    title: "fin.ai — Enterprise AI Agent Orchestration Platform",
    description:
      "Automate complex enterprise workflows with autonomous AI agents. Hybrid RAG, voice biometrics, fraud detection, and multi-agent orchestration — all in one platform.",
    siteName: "fin.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "fin.ai — Enterprise AI Agent Orchestration Platform",
    description: "Autonomous multi-agent reasoning and enterprise orchestration by fin.ai.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`} data-scroll-behavior="smooth">
      <body className="min-h-screen bg-white text-zinc-900 selection:bg-blue-500/20 font-[var(--font-inter)]">
        <AuthProvider>
          {AUTH_GATE_ENABLED && <AuthHeaderBar />}
          {children}
          <AIAssistantWidget />
          <CookieConsent />
        </AuthProvider>
      </body>
    </html>
  );
}
