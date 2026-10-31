/**
 * `compact` hides the " Commercial" half of the wordmark visually below 380px
 * so the primary header row fits at 320px (WCAG 1.4.10 Reflow). It stays in the
 * accessible name.
 */
export function Logo({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${dark ? "text-white" : "text-ink"}`}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <defs>
          <linearGradient id="kubera-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9cd6f" />
            <stop offset="1" stopColor="#b8912a" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="7" fill={dark ? "#fff" : "#1d1d1f"} />
        <path d="M8 6v12M8 12l7-6M10.5 10l5 8" stroke="url(#kubera-mark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">
        Kubera<span className={`font-normal text-titanium${compact ? " max-[379px]:sr-only" : ""}`}> Commercial</span>
      </span>
    </span>
  );
}
