import { cn } from "@/lib/utils";

/** Same visual language as the recruitment overview page's MetricCard
 * (../page.tsx) — reused rather than reinvented so Analytics reads as part
 * of the same product. The one addition: an explicit "no data yet" state,
 * since several of these metrics are honestly empty until the underlying
 * pipeline produces real rows (see recruitment_analytics.py's docstrings). */
export function KpiTile({
  label,
  value,
  subtext,
  icon: IconSvg,
  badge,
  badgeTone = "blue",
  unavailable,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeTone?: "blue" | "emerald" | "amber" | "zinc" | "red";
  /** When set, renders in place of `value` — e.g. "No data available",
   * "Baseline not configured". Keeps the tile's shape so the grid doesn't
   * jump around as different metrics light up over time. */
  unavailable?: string;
}) {
  return (
    <div className="group rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-2xs hover:border-zinc-300 hover:shadow-xs transition-all">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <div className="w-8 h-8 rounded-xl bg-zinc-50 border border-zinc-200/70 flex items-center justify-center text-zinc-700 group-hover:text-blue-600 group-hover:border-blue-200 group-hover:bg-blue-50/50 transition-colors">
          <IconSvg className="w-4 h-4" />
        </div>
      </div>
      {unavailable ? (
        <div className="mt-3">
          <span className="text-sm font-semibold text-zinc-400">{unavailable}</span>
        </div>
      ) : (
        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="text-3xl font-extrabold tracking-tight font-mono text-zinc-900">
            {value}
          </span>
          {badge && (
            <span
              className={cn(
                "text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border",
                badgeTone === "emerald"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                  : badgeTone === "amber"
                  ? "bg-amber-50 text-amber-700 border-amber-200/80"
                  : badgeTone === "red"
                  ? "bg-red-50 text-red-700 border-red-200/80"
                  : badgeTone === "zinc"
                  ? "bg-zinc-100 text-zinc-700 border-zinc-200"
                  : "bg-blue-50 text-blue-700 border-blue-200/80"
              )}
            >
              {badge}
            </span>
          )}
        </div>
      )}
      {subtext && (
        <p className="mt-3 text-xs text-zinc-500 font-medium pt-2.5 border-t border-zinc-100">
          {subtext}
        </p>
      )}
    </div>
  );
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}%`;
}

export function formatSignedPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export function formatSeconds(v: number): string {
  if (v < 60) return `${v.toFixed(1)}s`;
  const mins = Math.floor(v / 60);
  const secs = Math.round(v % 60);
  return `${mins}m ${secs}s`;
}

export function formatUsd(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function formatCount(v: number): string {
  return v.toLocaleString();
}
