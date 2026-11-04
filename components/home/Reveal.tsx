import type { CSSProperties } from "react";

/**
 * Scroll reveal, CSS only. The wrapper renders at full opacity in the server
 * HTML (no-JS, crawlers, screenshots and assistive tech all see the content);
 * `.reveal` in globals.css adds a scroll-driven fade where the browser supports
 * `animation-timeline` and the user has not asked for reduced motion.
 * `delay` (seconds, as before) staggers siblings by shifting the animation range.
 */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const step = Math.round(delay * 25);
  const style = step > 0 ? ({ "--reveal-step": step } as CSSProperties) : undefined;
  return (
    <div className={`reveal ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
