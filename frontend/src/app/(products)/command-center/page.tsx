import type { Metadata } from "next";
import CommandCenter from "./CommandCenter";
import "./command-center.css";

export const metadata: Metadata = {
  title: "Agent Command Center — AgenticFlow AI",
  description:
    "Mission control for AI agents. Submit natural-language goals and watch autonomous agents plan, execute, and deliver results in real time.",
};

export default function CommandCenterPage() {
  return <CommandCenter />;
}
