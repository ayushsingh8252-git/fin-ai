import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared "nothing here yet" block — explains what's missing and, where
 * relevant, what to do next, instead of a bare "No data" string. Visual
 * language matches the soft bg-zinc-50 boxes already used in a few places
 * (e.g. the onboarding manager portal's team/document lists). */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-10 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-zinc-200 text-zinc-400">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-bold text-zinc-900">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-zinc-500 leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
