"use client";

import { useState } from "react";

/**
 * Cal.com scheduling embed. The calendar loads only after the visitor asks for
 * it, so opening /contact sends nothing to a third party. The page link below
 * works without JavaScript and in browsers that block frames.
 */
export function SchedulerEmbed({ embedUrl, pageUrl }: { embedUrl: string; pageUrl: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      {shown ? (
        <iframe
          title="Schedule a call with Kubera Commercial"
          src={embedUrl}
          loading="lazy"
          className="h-[640px] w-full rounded-2xl border border-black/[0.08] bg-white"
        />
      ) : (
        <button type="button" onClick={() => setShown(true)} className="pill pill-primary">
          Show available times
        </button>
      )}
      <p className="mt-3 text-[13px] text-titanium">
        Scheduling is provided by Cal.com.{" "}
        <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2">
          Open the booking page<span className="sr-only"> (opens in a new tab)</span>
        </a>
        .
      </p>
    </div>
  );
}
