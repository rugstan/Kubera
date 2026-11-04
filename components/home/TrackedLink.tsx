"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics/client";
import type { AnalyticsEvents } from "@/lib/analytics/events";

type HomeCta = AnalyticsEvents["home_cta_clicked"];

/**
 * A next/link that reports which homepage call to action was used. The event
 * carries only the CTA and its section, never the destination's query string.
 * Server components render it with plain string props and text children, and
 * put the pill class last, so the sentence-case CTA guard can read the label.
 */
export function TrackedLink({ cta, section, onClick, ...props }: ComponentProps<typeof Link> & HomeCta) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        track("home_cta_clicked", { cta, section });
        onClick?.(event);
      }}
    />
  );
}
