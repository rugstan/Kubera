"use client";

import Form from "next/form";
import Link from "next/link";
import { useEffect, useRef } from "react";

// Keyboard focus across a filter change. Applying the filter form or following
// a filter link (remove a filter, an empty-state suggestion, a page link)
// navigates to a new URL, which re-renders the panel and unmounts the focused
// control, so focus would drop to <body>. Each of those marks the navigation
// here, and the results summary takes focus once the new results render.
// Loading the page or arriving from elsewhere never moves focus.

const FRESH_MS = 10_000;
let markedAt = 0;

const mark = () => {
  markedAt = Date.now();
};

/** The GET filter form (next/form: client-side navigation, the URL is the whole state). */
export function FilterForm(props: React.ComponentProps<typeof Form>) {
  return (
    <Form
      {...props}
      onSubmit={(e) => {
        props.onSubmit?.(e);
        if (!e.defaultPrevented) mark();
      }}
    />
  );
}

/** A link that changes the filters or the page. */
export function FilterLink(props: React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (!e.defaultPrevented) mark();
      }}
    />
  );
}

/** "Showing 1–3 of 3 lenders": announced, and focused after a filter change made on this page. */
export function ResultsSummary({ id, query, className, children }: { id: string; query: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!markedAt || Date.now() - markedAt > FRESH_MS) return;
    markedAt = 0;
    ref.current?.focus();
  }, [query]);
  return (
    <p aria-live="polite" className={className} id={id} ref={ref} tabIndex={-1}>
      {children}
    </p>
  );
}
