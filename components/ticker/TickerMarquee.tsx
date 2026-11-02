"use client";

import { useId, useState } from "react";

/**
 * Scrolling strip with a pause/play control (WCAG 2.2.2). The caller renders
 * the rate items twice: `primary` is real content, `duplicate` only fills the
 * loop and is hidden from assistive tech. With reduced motion the animation is
 * off, the duplicate is dropped and the strip becomes a keyboard-scrollable row.
 */
export function TickerMarquee({ primary, duplicate, label }: { primary: React.ReactNode; duplicate: React.ReactNode; label: string }) {
  const [paused, setPaused] = useState(false);
  const trackId = useId();
  return (
    <div className="ticker flex min-w-0 flex-1 items-center" data-paused={paused}>
      <div
        className="ticker-scroller relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_4%,#000_96%,transparent)] focus-visible:outline-offset-[-2px]"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <div id={trackId} className="ticker-track flex w-max animate-marquee">
          <ul className="flex">{primary}</ul>
          <ul className="ticker-dup flex" aria-hidden>
            {duplicate}
          </ul>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-controls={trackId}
        aria-label={paused ? "Play rates ticker" : "Pause rates ticker"}
        className="mr-1 grid size-9 shrink-0 place-items-center rounded-full text-ink/70 transition hover:bg-black/5 hover:text-ink motion-reduce:hidden"
      >
        {paused ? (
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M4 2.5v11l9-5.5-9-5.5Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden>
            <path d="M4 2h3v12H4zM9 2h3v12H9z" />
          </svg>
        )}
      </button>
    </div>
  );
}
