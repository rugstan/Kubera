"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";
import type { SizerQuote } from "@/lib/sizing/programs/types";
import { bestSummary } from "./carousel";

/**
 * Sticky best-fit summary for phones. It appears while the sizer is on screen
 * but its results are scrolled out of view (the inputs come first on a narrow
 * screen), and "See all structures" jumps to the results. Hidden from 769px up,
 * where inputs and results sit side by side.
 */
const RESERVE_BAR_SPACE = `@media (max-width: 768px) { html { scroll-padding-bottom: calc(6.5rem + env(safe-area-inset-bottom, 0px)); } }`;

export function MobileResultsBar({ best, resultsId, tab }: { best: SizerQuote | undefined; resultsId: string; tab?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const results = document.getElementById(resultsId);
    if (!results || typeof IntersectionObserver === "undefined") return;
    // The sizer panel that wraps the inputs and the results.
    const scope = results.closest<HTMLElement>('[role="tabpanel"]') ?? results.parentElement;
    let inScope = false;
    let resultsOnScreen = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.target === results) resultsOnScreen = e.isIntersecting;
          else inScope = e.isIntersecting;
        }
        setVisible(inScope && !resultsOnScreen);
      },
      // "On screen" means touching the middle band of the viewport, not a sliver at an edge.
      { rootMargin: "-20% 0px -20% 0px" },
    );
    io.observe(results);
    if (scope) io.observe(scope);
    return () => io.disconnect();
  }, [resultsId]);

  // Reserve the bar's height (about 83px plus the safe area) as bottom scroll
  // padding on phones, so a field that takes keyboard focus is scrolled clear
  // of the bar rather than under it (WCAG 2.2 SC 2.4.11). It stays on while
  // the sizer is mounted, not only while the bar shows: the bar can appear in
  // the same scroll that brings the focused field into view.
  const reserve = <style>{RESERVE_BAR_SPACE}</style>;
  if (!visible) return reserve;
  const summary = bestSummary(best);

  function seeAll() {
    const el = document.getElementById(resultsId);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
    track("sizer_see_all_clicked", { tab });
  }

  return (
    <>
      {reserve}
      {/* Lift the floating Ask button above the bar while it is showing. */}
      <style>{`body:has([data-mobile-results-bar]) [data-ask-floating] { bottom: 6rem; }`}</style>
      <div
        data-mobile-results-bar
        role="region"
        aria-label="Best-fit summary"
        className="glass fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-black/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[769px]:hidden"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium text-titanium">Best fit</p>
          <p className="truncate text-[15px] font-semibold text-ink">{summary.label}</p>
          <p className="truncate text-[13px] text-ink/80">{summary.detail}</p>
        </div>
        <button type="button" onClick={seeAll} className="pill pill-primary min-h-11 shrink-0 !px-4 !py-2.5 !text-[15px]">
          See all structures
        </button>
      </div>
    </>
  );
}
