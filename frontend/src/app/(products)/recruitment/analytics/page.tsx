"use client";

import { useEffect, useState } from "react";
import {
  Users, Zap, CheckCircle2, Clock, RefreshCw as ReturningIcon, Video,
  FileText, Gauge, DollarSign, AlertTriangle, Loader2, ShieldOff,
} from "lucide-react";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  getAnalyticsOverview, getAnalyticsTrends, getAnalyticsBreakdown, getRecentActivity,
  errorMessage,
  type AnalyticsOverview, type AnalyticsTrends, type AnalyticsBreakdown, type RecentActivityItem,
  type AnalyticsDays,
} from "@/lib/recruitmentApi";
import { useRecruitment } from "../_components/RecruitmentShell";
import { KpiTile, formatPct, formatSignedPct, formatSeconds, formatUsd, formatCount } from "./_kpi";
import { TrendLineChart, ExecutionsBarChart, AgentBreakdownList } from "./_charts";

type Loaded =
  | { days: AnalyticsDays; overview: AnalyticsOverview; trends: AnalyticsTrends; breakdown: AnalyticsBreakdown; activity: RecentActivityItem[] }
  | { days: AnalyticsDays; error: string }
  | null;

export default function RecruitmentAnalyticsPage() {
  const { can } = useRecruitment();
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [loaded, setLoaded] = useState<Loaded>(null);

  const allowed = can("view_analytics");
  // Previous range's data stays on screen while the new range loads.
  const refreshing = loaded !== null && loaded.days !== days;

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    Promise.all([
      getAnalyticsOverview(days),
      getAnalyticsTrends(days),
      getAnalyticsBreakdown(days),
      getRecentActivity(50),
    ])
      .then(([overview, trends, breakdown, activityRes]) => {
        if (!cancelled) setLoaded({ days, overview, trends, breakdown, activity: activityRes.items });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ days, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [days, allowed]);

  if (!allowed) {
    return (
      <div className="space-y-6 pb-14">
        <EmptyState
          icon={ShieldOff}
          title="Analytics isn't available for your role"
          description="Recruitment Analytics is visible to HR Admins, Recruiters and Hiring Managers. Ask an HR Admin if you need access."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-14">
      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Recruitment Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Usage, AI performance and recruitment workflow impact
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {refreshing && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value) as AnalyticsDays)}
            className="w-40"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </div>
      </div>

      {loaded === null && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {loaded && "error" in loaded && <ErrorBanner message={loaded.error} />}

      {loaded && "overview" in loaded && (
        <AnalyticsBody data={loaded} />
      )}
    </div>
  );
}

function AnalyticsBody({
  data,
}: {
  data: { overview: AnalyticsOverview; trends: AnalyticsTrends; breakdown: AnalyticsBreakdown; activity: RecentActivityItem[] };
}) {
  const { overview, trends, activity } = data;
  const mau = overview.monthly_active_users;
  const returning = overview.returning_users;
  const executions = overview.ai_executions;
  const documents = overview.documents_processed;
  const latency = overview.latency;
  const interviews = overview.interviews_completed;
  const cost = overview.ai_cost;
  const timeSaved = overview.time_saved;

  return (
    <div className="space-y-8">
      {/* ─── Row 1: primary KPIs ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Monthly Active Users"
          icon={Users}
          value={formatCount(mau.current)}
          badge={mau.has_prior_period_data ? formatSignedPct(mau.pct_change) : undefined}
          badgeTone={(mau.pct_change ?? 0) >= 0 ? "emerald" : "red"}
          subtext={mau.has_prior_period_data ? `${formatCount(mau.previous)} in the prior period` : "Not enough history yet for a trend"}
        />
        <KpiTile
          label="AI Executions"
          icon={Zap}
          value={executions.has_data ? formatCount(executions.total_executions) : ""}
          unavailable={executions.has_data ? undefined : "No data available"}
          subtext={executions.has_data ? `${formatCount(executions.successful)} successful · ${formatCount(executions.failed)} failed` : undefined}
        />
        <KpiTile
          label="AI Success Rate"
          icon={CheckCircle2}
          value={executions.has_data ? formatPct(executions.success_rate_pct) : ""}
          unavailable={executions.has_data ? undefined : "No data available"}
          badgeTone="emerald"
          subtext={executions.has_data ? "Successful executions ÷ total executions" : undefined}
        />
        <KpiTile
          label="Time Saved"
          icon={Clock}
          value={timeSaved.baseline_configured ? formatSeconds(timeSaved.time_saved_minutes_total * 60) : ""}
          unavailable={timeSaved.baseline_configured ? undefined : "Baseline not configured"}
          subtext={timeSaved.baseline_configured ? `${formatPct(timeSaved.pct_reduction)} reduction vs. manual baseline` : "No validated manual baseline recorded yet"}
        />
      </div>

      {/* ─── Row 2 ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Returning User Rate"
          icon={ReturningIcon}
          value={returning.current_active > 0 ? formatPct(returning.rate_pct) : ""}
          unavailable={returning.current_active > 0 ? undefined : "No data available"}
          subtext={returning.current_active > 0 ? `${returning.returning} returning · ${returning.new} new this period` : undefined}
        />
        <KpiTile
          label="AI Interviews Completed"
          icon={Video}
          value={interviews.has_data ? formatCount(interviews.completed) : ""}
          unavailable={interviews.has_data ? undefined : "No data available"}
          subtext={interviews.has_data ? undefined : "No interview has reached a completed AI session yet"}
        />
        <KpiTile
          label="Documents / Resumes Processed"
          icon={FileText}
          value={documents.has_data ? formatCount(documents.processed) : ""}
          unavailable={documents.has_data ? undefined : "No data available"}
          subtext={documents.has_data ? `${formatCount(documents.uploaded)} uploaded · ${formatCount(documents.failed)} failed` : undefined}
        />
        <KpiTile
          label="Average AI Latency"
          icon={Gauge}
          value={latency.has_data ? formatSeconds(latency.avg_seconds) : ""}
          unavailable={latency.has_data ? undefined : "No data available"}
          subtext={latency.has_data ? `P50 ${formatSeconds(latency.p50_seconds)} · P95 ${formatSeconds(latency.p95_seconds)}` : undefined}
        />
      </div>

      {/* ─── Row 3 ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiTile
          label="AI Cost / Execution"
          icon={DollarSign}
          value={cost.has_data ? formatUsd(cost.cost_per_execution_usd) : ""}
          unavailable={cost.has_data ? undefined : "Cost data unavailable"}
          subtext={
            cost.has_data
              ? `${formatUsd(cost.total_cost_usd)} total across ${formatCount(cost.executions_with_cost)} executions`
              : cost.reason === "unpriced"
              ? "No LLM rate card configured (LLM_COST_RATES_JSON)"
              : cost.reason === "no_executions"
              ? "No resumes processed in this period"
              : "Cost instrumentation is live going forward — no attributed cost yet"
          }
        />
        <KpiTile
          label="Failure Rate"
          icon={AlertTriangle}
          value={executions.has_data ? formatPct(executions.failure_rate_pct) : ""}
          unavailable={executions.has_data ? undefined : "No data available"}
          badgeTone="red"
          subtext={executions.has_data ? "Failed executions ÷ total executions" : undefined}
        />
      </div>

      {/* ─── Charts ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Active Users Over Time">
          {trends.active_users.length > 0 ? (
            <TrendLineChart data={trends.active_users} valueKey="active_users" label="active users" />
          ) : (
            <NoChartData />
          )}
        </ChartCard>
        <ChartCard title="AI Executions Over Time">
          {trends.executions.length > 0 ? (
            <ExecutionsBarChart data={trends.executions} />
          ) : (
            <NoChartData />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Executions by Agent / Workflow">
        {executions.by_agent.length > 0 ? (
          <AgentBreakdownList rows={executions.by_agent} />
        ) : (
          <NoChartData />
        )}
      </ChartCard>

      {/* ─── Recent activity ─── */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-zinc-900">Recent Activity</h2>
        {activity.length === 0 ? (
          <EmptyState title="No recent activity" description="Real recruitment activity will show up here as it happens." />
        ) : (
          <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-2xs overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-xs text-zinc-500">
                      {item.time ? new Date(item.time).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-zinc-700">{item.user}</TableCell>
                    <TableCell className="text-xs text-zinc-600">{item.activity}</TableCell>
                    <TableCell className="text-xs font-mono text-zinc-500">{item.workflow}</TableCell>
                    <TableCell>
                      {item.status ? (
                        <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-2xs">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </div>
  );
}

function NoChartData() {
  return (
    <div className="flex h-[180px] items-center justify-center text-xs text-zinc-400">
      No data available for this period
    </div>
  );
}

function statusTone(status: string): "success" | "danger" | "neutral" | "info" {
  const s = status.toLowerCase();
  if (["complete", "completed", "parsed", "success", "duplicate"].includes(s)) return "success";
  if (["error", "failed", "failure"].includes(s)) return "danger";
  if (["scanning", "processing", "queued", "running"].includes(s)) return "info";
  return "neutral";
}
