import { cn } from "@/lib/utils";

/** Shared panel design system (candidate page, HR Command Center, ...). One accent (blue) for actions
 * and selection; green / amber / red appear only as small status dots or
 * icons that carry meaning — never as tinted card backgrounds. Every tab
 * builds from these so spacing, type and color stay consistent. */

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const DOT: Record<Tone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-blue-500",
  neutral: "bg-zinc-400",
};

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-zinc-200 bg-white", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatusDot({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-zinc-700", className)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700", className)}>
      {children}
    </span>
  );
}

/** Label/value row for definition lists. */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-zinc-900">{children}</dd>
    </div>
  );
}

export function EmptyNote({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-zinc-200 px-4 py-3">
      <p className="text-[13px] text-zinc-500">{children}</p>
      {action}
    </div>
  );
}

export const btnPrimary = "h-9 rounded-md bg-blue-600 px-3.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer";
export const btnSecondary = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer";
export const inputCls = "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-zinc-50";
export const labelCls = "mb-1.5 block text-xs font-medium text-zinc-600";
