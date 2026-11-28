"use client";

import { useEffect } from "react";

// A fix link from the deal page or the preview lands on
// /deals/[id]/submission#field-<key>. The editor streams in behind Suspense,
// so the browser's own jump can run before the field exists; once the editor
// has rendered, this scrolls to the field (the staff shell's scroll padding
// keeps it clear of the sticky header) and puts the cursor in it.

export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
  }, []);
  return null;
}
