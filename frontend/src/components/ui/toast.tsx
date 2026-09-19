"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error";
interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

const ToastContext = React.createContext<{ toast: (variant: ToastVariant, message: string) => void } | null>(null);

const DISMISS_AFTER_MS = 5000;

/** App-level toast stack. A toast reports the outcome of an action that has
 * already completed, so callers must only raise a "success" after the API call
 * resolved. Errors stay visible a little longer than they take to read. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const toast = React.useCallback((variant: ToastVariant, message: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-3), { id, variant, message }]);
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), DISMISS_AFTER_MS);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg",
              t.variant === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            )}
          >
            {t.variant === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
