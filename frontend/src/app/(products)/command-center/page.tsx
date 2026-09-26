import type { Metadata } from "next";
import CommandCenter from "./CommandCenter";

export const metadata: Metadata = {
  title: "HR Command Center — AgenticFlow AI",
  description:
    "Describe an HR task in plain language. AI plans it with real HR tools, and you approve anything that contacts a candidate.",
};

export default function CommandCenterPage() {
  return <CommandCenter />;
}
