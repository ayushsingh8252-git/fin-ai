import { Badge } from "@/components/ui/badge";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

const TONE_TO_VARIANT: Record<StatusTone, "success" | "warning" | "danger" | "secondary" | "outline"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "secondary",
  info: "outline",
};

/** Thin semantic wrapper around Badge — the single place status color maps
 * to visual treatment, replacing the 4+ near-duplicate STATUS_STYLES /
 * VERDICT_STYLES lookup objects previously hand-rolled per page. */
function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant={TONE_TO_VARIANT[tone]} className={className}>
      {children}
    </Badge>
  );
}

export { StatusPill };
