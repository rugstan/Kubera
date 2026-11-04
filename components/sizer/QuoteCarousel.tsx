"use client";

import { useEffect, useRef, useState } from "react";
import { Analytics } from "@/components/analytics/Analytics";
import { track } from "@/lib/analytics/client";
import type { SizerQuote } from "@/lib/sizing/programs/types";
import { clampIndex, nearestIndex } from "./carousel";
import { MobileResultsBar } from "./MobileResultsBar";
import { ProgramCard } from "./programs/ProgramCard";

/**
 * The sizer's quote cards. At 769px and wider they are the usual responsive
 * grid. On phones (768px and narrower) they become a swipeable, scroll-snapped
 * row with previous/next buttons and a position indicator, and the sticky
 * MobileResultsBar summarises the best fit. One set of DOM serves both.
 */
export function QuoteCarousel({ quotes, bestId, tab }: { quotes: SizerQuote[]; bestId: SizerQuote["id"] | null; tab: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [active, setActive] = useState(0);
  // Slide the code scrolled to itself, so that scroll is not reported as a swipe.
  const programmatic = useRef<number | null>(null);
  const count = quotes.length;
  const best = quotes.find((q) => q.id === bestId);
  const bestIndex = Math.max(0, quotes.findIndex((q) => q.id === bestId));

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Phones open on the recommended card, the one the results bar names, and
  // follow it when the tab or the best fit changes. The desktop grid does not
  // scroll, so its order is untouched.
  useEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth + 1) return;
    const left = slideOffsets(list)[bestIndex] ?? 0;
    if (Math.abs(list.scrollLeft - left) > 1) {
      programmatic.current = bestIndex;
      list.scrollTo({ left, behavior: "auto" });
    }
    setActive(bestIndex);
  }, [tab, bestId, bestIndex]);

  function slideOffsets(list: HTMLElement): number[] {
    return Array.from(list.children).map((c) => (c as HTMLElement).offsetLeft - list.offsetLeft);
  }

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const next = nearestIndex(slideOffsets(list), list.scrollLeft);
      const auto = programmatic.current === next;
      programmatic.current = null;
      setActive((prev) => {
        if (prev !== next && !auto) track("sizer_quote_swiped", { index: next, count });
        return next;
      });
    });
  }

  function goTo(i: number) {
    const list = listRef.current;
    if (!list) return;
    const target = clampIndex(i, count);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: slideOffsets(list)[target] ?? 0, behavior: reduce ? "auto" : "smooth" });
  }

  const resultsId = `sizer-results-${tab}`;

  return (
    <div>
      <div
        ref={listRef}
        id={resultsId}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Program quotes. Swipe or scroll sideways to compare."
        onScroll={onScroll}
        className="relative flex w-0 min-w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] min-[769px]:w-auto min-[769px]:grid min-[769px]:snap-none min-[769px]:grid-cols-2 min-[769px]:gap-4 min-[769px]:overflow-visible min-[769px]:pb-0 xl:grid-cols-3 [&::-webkit-scrollbar]:hidden"
      >
        {quotes.map((q, i) => (
          <div
            key={`${tab}-${q.id}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            className="flex w-[86%] shrink-0 snap-start [&>*]:w-full min-[769px]:w-auto min-[769px]:shrink"
          >
            <ProgramCard q={q} best={q.id === bestId} index={i} />
          </div>
        ))}
      </div>

      {count > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 min-[769px]:hidden">
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous structure"
            className="inline-flex size-11 items-center justify-center rounded-full border border-black/20 bg-white text-ink disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex flex-col items-center gap-1">
            <p className="text-[13px] font-medium text-ink" aria-live="polite">
              Structure {active + 1} of {count}
            </p>
            <div className="flex items-center">
              {quotes.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`Show ${q.name}`}
                  aria-current={i === active ? "true" : undefined}
                  className="inline-flex size-6 items-center justify-center rounded-full"
                >
                  <span className={`block rounded-full transition-all ${i === active ? "h-2 w-5 bg-accent" : "size-2 bg-black/30"}`} />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === count - 1}
            aria-label="Next structure"
            className="inline-flex size-11 items-center justify-center rounded-full border border-black/20 bg-white text-ink disabled:opacity-40"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m6 3 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      <Analytics />
      <MobileResultsBar best={best} resultsId={resultsId} tab={tab} />
    </div>
  );
}
