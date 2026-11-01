"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { postJson } from "@/components/forms";

// The page behind a confirm or unsubscribe link. Opening the link only shows a
// button; pressing it posts the token. That keeps mail scanners and link
// previews, which open links on their own, from changing anyone's subscription.
// The page heading lives in the server page, outside the Suspense boundary.

type Mode = "confirm" | "unsubscribe";

const COPY: Record<Mode, { lead: string; button: string; done: Record<string, string> }> = {
  confirm: {
    lead: "Press the button to finish subscribing to the Kubera Commercial newsletter.",
    button: "Confirm subscription",
    done: {
      confirmed: "You are subscribed. Look for the next issue in your inbox. Every email has an unsubscribe link.",
      already_confirmed: "You are already subscribed. Nothing more to do.",
    },
  },
  unsubscribe: {
    lead: "Press the button to stop receiving the Kubera Commercial newsletter at this address.",
    button: "Unsubscribe",
    done: {
      unsubscribed: "You are unsubscribed. We will not send you the newsletter again unless you sign up again.",
      already_unsubscribed: "You were already unsubscribed. Nothing more to do.",
    },
  },
};

export function TokenAction({ mode }: { mode: Mode }) {
  const token = useSearchParams().get("token")?.trim() ?? "";
  const copy = COPY[mode];
  const [state, setState] = useState<{ kind: "idle" } | { kind: "working" } | { kind: "done"; message: string } | { kind: "error"; message: string; signUpAgain: boolean }>({ kind: "idle" });
  const resultRef = useRef<HTMLParagraphElement>(null);

  async function run() {
    setState({ kind: "working" });
    const result = await postJson<{ status: string }>(`/api/newsletter/${mode}`, { token });
    if (result.ok) {
      setState({ kind: "done", message: copy.done[result.data.status] ?? "Done." });
    } else {
      const { failure } = result;
      // A 400 here means the link itself is bad (expired, tampered, already
      // used up). The generic form copy talks about answers this page does not
      // have, so show the server's own explanation instead.
      const linkProblem = failure.status === 400;
      setState({
        kind: "error",
        message: linkProblem ? (failure.serverMessage ?? "This link is not valid.") : failure.message,
        // Offer a fresh signup only on the confirm page; someone unsubscribing
        // does not want to be pointed back at the signup form.
        signUpAgain: mode === "confirm" && linkProblem && (failure.reason === "expired" || failure.reason === "invalid"),
      });
    }
    // Move focus to the outcome so a screen-reader user hears it.
    queueMicrotask(() => resultRef.current?.focus());
  }

  if (!token) {
    return (
      <p role="alert" className="notice-danger mt-4 rounded-xl px-4 py-3 text-[15px]">
        This link is incomplete. Open the link from your email again, or <Link href="/newsletter" className="font-medium underline">sign up for the newsletter</Link>.
      </p>
    );
  }

  return (
    <div>
      {state.kind === "done" ? null : <p className="mt-4 text-[17px] leading-relaxed text-ink/85">{copy.lead}</p>}
      {state.kind !== "done" && (
        <button type="button" onClick={() => void run()} disabled={state.kind === "working"} className="pill pill-primary mt-6 disabled:opacity-60">
          {state.kind === "working" ? "Working" : copy.button}
        </button>
      )}
      <p
        ref={resultRef}
        tabIndex={-1}
        role={state.kind === "error" ? "alert" : "status"}
        className={`mt-6 text-[16px] leading-relaxed outline-none ${state.kind === "error" ? "notice-danger rounded-xl px-4 py-3" : state.kind === "done" ? "notice-success rounded-xl px-4 py-3" : "sr-only"}`}
      >
        {state.kind === "done" || state.kind === "error" ? state.message : ""}
      </p>
      {state.kind === "error" && state.signUpAgain && (
        <p className="mt-4 text-[15px]">
          <Link href="/newsletter" className="font-medium text-accent underline underline-offset-2">
            Sign up for the newsletter again
          </Link>
        </p>
      )}
      {state.kind === "done" && (
        <p className="mt-6 text-[15px]">
          <Link href="/insights" className="font-medium text-accent underline underline-offset-2">
            Read our latest insights
          </Link>
        </p>
      )}
    </div>
  );
}
