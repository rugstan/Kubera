/**
 * Monochrome mark: a white stroke on an ink tile (a light tile with an ink
 * stroke on dark surfaces). `compact` hides the " Commercial" half of the
 * wordmark visually below 420px so the primary header row fits at 320px
 * (WCAG 1.4.10 Reflow). It stays in the accessible name.
 */
export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${dark ? "text-white" : "text-ink"}`}>
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <rect width="24" height="24" rx="7" fill={dark ? "#f5f5f7" : "#1d1d1f"} />
        <path d="M8 6v12M8 12l7-6M10.5 10l5 8" stroke={dark ? "#1d1d1f" : "#ffffff"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span className="text-[15px] font-semibold">
        Kubera<span className={`font-normal ${dark ? "text-white/80" : "text-graphite"}${compact ? " max-[419px]:sr-only" : ""}`}> Commercial</span>
      </span>
    </span>
  );
}
