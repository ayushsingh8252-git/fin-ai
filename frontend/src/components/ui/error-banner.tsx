import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared inline error banner — matches the red box + AlertTriangle pattern
 * already used on the telephonic-agent page. Meant for "this specific action
 * failed" messages, not raw API/stack traces — pass user-readable text. */
function ErrorBanner({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      data-slot="error-banner"
      className={cn(
        "flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export { ErrorBanner };
