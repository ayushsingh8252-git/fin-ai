/** Fin AI logomark — two agent nodes flowing into one orchestrated
 * core, standing in for the generic bolt icon everywhere the brand mark
 * appears (main nav, footer, RAG workspace nav). `variant` picks the two
 * color pairings those spots already used ("dark" tile for light
 * backgrounds, "light" tile for the dark footer). */
export function BrandMark({
  variant = "dark",
  className = "",
}: {
  variant?: "dark" | "light";
  className?: string;
}) {
  const tile =
    variant === "dark"
      ? "bg-gradient-to-br from-zinc-900 to-zinc-800"
      : "bg-white";
  const nodeColor = variant === "dark" ? "#60a5fa" : "#2563eb";
  const coreColor = variant === "dark" ? "#ffffff" : "#18181b";

  return (
    <div
      className={`w-8 h-8 rounded-lg ${tile} flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform ${className}`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path d="M7 7L12 16" stroke={nodeColor} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M17 7L12 16" stroke={nodeColor} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.3" fill={nodeColor} />
        <circle cx="17" cy="7" r="2.3" fill={nodeColor} />
        <circle cx="12" cy="16.5" r="3.1" fill={coreColor} className="animate-pulse" />
        <circle cx="12" cy="16.5" r="3.1" fill="none" stroke={nodeColor} strokeWidth="1.1" />
      </svg>
    </div>
  );
}
