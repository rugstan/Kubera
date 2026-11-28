"use client";

import { useState } from "react";

// Copies one string (the approved email's subject or body) to the clipboard.
// The text is already on the page; nothing is stored or logged.

export function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="pill pill-glass min-h-11"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
        type="button"
      >
        {label}
      </button>
      <span aria-live="polite" className="text-xs text-titanium">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
