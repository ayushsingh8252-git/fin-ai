import * as React from "react";
import { cn } from "@/lib/utils";

/** Placeholder block for content that is still loading. Purely visual; pair it
 * with an aria-busy region so screen readers are told something is loading. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-zinc-200/70", className)}
      {...props}
    />
  );
}

export { Skeleton };
