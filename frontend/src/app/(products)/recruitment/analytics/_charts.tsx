"use client";

import { useState } from "react";

/** Small, dependency-free SVG charts for the analytics dashboard — this repo
 * has no chart library installed, and these are simple enough (one line
 * series, one grouped-bar series) not to warrant adding one. Palette follows
 * the app's existing status colors (StatusPill/badge.tsx): blue for a plain
 * trend, emerald for success, red for failure — never reused for anything
 * else on this page. */

const BLUE = "#2563eb";
const EMERALD = "#059669";
const RED = "#dc2626";

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Line chart (single series) ──────────────────────────────────────────

export function TrendLineChart({
  data,
  valueKey,
  label,
  color = BLUE,
  height = 180,
}: {
  data: Array<Record<string, unknown>>;
  valueKey: string;
  label: string;
  color?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const width = 640;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = data.map((d) => Number(d[valueKey]) || 0);
  const maxV = Math.max(1, ...values);
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = values.map((v, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + innerH - (v / maxV) * innerH,
    v,
  }));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${points[points.length - 1].x.toFixed(1)} ${(padding.top + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padding.top + innerH).toFixed(1)} Z`;

  // Show at most ~6 x-axis labels so dates never collide.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={label}>
        <line
          x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH}
          stroke="currentColor" className="text-zinc-100" strokeWidth={1}
        />
        <path d={areaPath} fill={color} opacity={0.08} stroke="none" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <rect
              x={p.x - stepX / 2} y={padding.top} width={Math.max(stepX, 1)} height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
            {(hover === i || data.length <= 14) && (
              <circle cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} fill={color} className="pointer-events-none" />
            )}
          </g>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={padding.left + i * stepX}
              y={height - 6}
              textAnchor="middle"
              className="fill-zinc-400 text-[9px] font-mono"
            >
              {formatShortDate(String(d.date))}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((points[hover].x) / width) * 100}%`,
            top: `${(points[hover].y / height) * 100}%`,
          }}
        >
          <div className="font-mono text-[10px] text-zinc-400">{formatShortDate(String(data[hover].date))}</div>
          <div className="font-bold text-zinc-900">{points[hover].v.toLocaleString()} {label}</div>
        </div>
      )}
    </div>
  );
}

// ── Grouped bar chart (successful vs failed) ────────────────────────────

export function ExecutionsBarChart({
  data,
  height = 180,
}: {
  data: Array<{ date: string; successful: number; failed: number }>;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const width = 640;
  const padding = { top: 12, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxV = Math.max(1, ...data.map((d) => d.successful + d.failed));
  const groupW = innerW / data.length;
  const barW = Math.min(14, groupW * 0.55);
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="AI executions per day">
        <line
          x1={padding.left} y1={padding.top + innerH} x2={padding.left + innerW} y2={padding.top + innerH}
          stroke="currentColor" className="text-zinc-100" strokeWidth={1}
        />
        {data.map((d, i) => {
          const cx = padding.left + i * groupW + groupW / 2;
          const successH = (d.successful / maxV) * innerH;
          const failedH = (d.failed / maxV) * innerH;
          const gap = 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
              <rect x={cx - groupW / 2} y={padding.top} width={groupW} height={innerH} fill="transparent" />
              {d.successful > 0 && (
                <rect
                  x={cx - barW - gap / 2} y={padding.top + innerH - successH} width={barW}
                  height={Math.max(successH, 1)} rx={2} fill={EMERALD}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                />
              )}
              {d.failed > 0 && (
                <rect
                  x={cx + gap / 2} y={padding.top + innerH - failedH} width={barW}
                  height={Math.max(failedH, 1)} rx={2} fill={RED}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                />
              )}
            </g>
          );
        })}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text
              key={i}
              x={padding.left + i * groupW + groupW / 2}
              y={height - 6}
              textAnchor="middle"
              className="fill-zinc-400 text-[9px] font-mono"
            >
              {formatShortDate(d.date)}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((padding.left + hover * (innerW / data.length) + (innerW / data.length) / 2) / width) * 100}%`,
            top: "0%",
          }}
        >
          <div className="font-mono text-[10px] text-zinc-400">{formatShortDate(data[hover].date)}</div>
          <div className="flex items-center gap-1.5 font-bold text-emerald-600">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> {data[hover].successful} successful
          </div>
          <div className="flex items-center gap-1.5 font-bold text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-600" /> {data[hover].failed} failed
          </div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Successful</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-600" /> Failed</span>
      </div>
    </div>
  );
}

// ── Horizontal proportional bar list (by agent / workflow) ─────────────

export function AgentBreakdownList({
  rows,
}: {
  rows: Array<{ agent: string; successful: number; failed: number }>;
}) {
  if (!rows.length) return null;
  const maxTotal = Math.max(1, ...rows.map((r) => r.successful + r.failed));

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const total = r.successful + r.failed;
        const successPct = (r.successful / maxTotal) * 100;
        const failedPct = (r.failed / maxTotal) * 100;
        return (
          <div key={r.agent}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-semibold text-zinc-700">{r.agent}</span>
              <span className="font-mono text-zinc-400">{total.toLocaleString()}</span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              {r.successful > 0 && (
                <div className="h-full bg-emerald-500" style={{ width: `${successPct}%` }} title={`${r.successful} successful`} />
              )}
              {r.failed > 0 && (
                <div className="h-full bg-red-500 ml-0.5 rounded-r-full" style={{ width: `${failedPct}%` }} title={`${r.failed} failed`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
