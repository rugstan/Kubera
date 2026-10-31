"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { AiUseNotice } from "@/components/privacy/AiUseNotice";
import { SparkIcon } from "@/components/site/GlassHeader";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { disclosures } from "@/lib/site";
import { markAskAvailable, markAskUnavailable, probeAskAvailability, useAskAvailable } from "./availability";
import { ASK_ERROR_COPY, AskError, normalizeAskError, streamAsk, type AskMode, type Msg } from "./client";
import { OPEN_EVENT, type OpenCommandBarDetail } from "./events";
import { Markdown } from "./Markdown";
import { isAskButtonRouteHidden, isPastDesktopThreshold } from "./visibility";

const SUGGESTIONS = [
  "HUD 232 vs. SBA 504 for a $2.8M, 48-bed RCFE refinance?",
  "How does the 2026 SBA 7(a) + 504 stack work for a $18M hotel?",
  "What DSCR and debt yield do hotel CMBS lenders need?",
  "Can I bridge a hotel-to-assisted-living conversion, then take out with HUD?",
];

type Attempt = { history: Msg[]; mode: AskMode; context?: string };

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
// False during SSR and hydration, true afterwards. The floating button renders
// only after mount: on kubera.loans the proxy rewrites `/` to `/express`, so the
// server sees `/express` while usePathname() on the client reports `/`. Gating
// on mount keeps the server and first client render identical.
const noopSubscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

// Elements made inert while the dialog is open (module scope: it is DOM state,
// not render state).
let inerted: HTMLElement[] = [];

/** Radix hides siblings from assistive tech (aria-hidden) and traps focus; mark them inert too so the page behind is unreachable by any route. */
function inertBackground(dialogEl: HTMLElement | null) {
  const portalRoot = dialogEl?.closest("body > *");
  inerted = Array.from(document.body.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== portalRoot && !["SCRIPT", "STYLE", "NEXT-ROUTE-ANNOUNCER"].includes(el.tagName) && !el.inert,
  );
  for (const el of inerted) el.inert = true;
}
function releaseBackground() {
  for (const el of inerted) el.inert = false;
  inerted = [];
}

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AskError | null>(null);
  const online = useOnline();
  const [scrolled, setScrolled] = useState(false);
  const [dealContext, setDealContext] = useState<string | undefined>();
  const askAvailable = useAskAvailable();
  const pathname = usePathname();
  const mounted = useMounted();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastAttemptRef = useRef<Attempt | null>(null);
  // The server owns the transcript; we keep only its id between turns.
  const conversationRef = useRef<string | null>(null);
  const turnstile = useTurnstile("ask");

  const run = useCallback(
    async (history: Msg[], mode: AskMode, context?: string) => {
      lastAttemptRef.current = { history, mode, context };
      setError(null);
      setMessages([...history, { role: "assistant", content: "" }]);
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let received = "";
      try {
        const message = history.at(-1)?.content ?? "";
        await streamAsk({
          message,
          conversationId: conversationRef.current,
          mode,
          dealContext: context,
          getTurnstileToken: () => turnstile.getToken(),
          turnstileHeaders,
          signal: ctrl.signal,
          onConversationId: (id) => {
            conversationRef.current = id;
          },
          onChunk: (text) => {
            received = text;
            setMessages([...history, { role: "assistant", content: text }]);
          },
        });
        markAskAvailable();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const err = normalizeAskError(e, typeof navigator === "undefined" ? true : navigator.onLine);
        if (err.kind === "unavailable") markAskUnavailable();
        // Keep any partial answer; otherwise drop the empty placeholder so the
        // failure is shown as its own state, never as an assistant message.
        setMessages(received ? [...history, { role: "assistant", content: received }] : history);
        setError(err);
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [turnstile],
  );

  const send = useCallback(
    (text: string, mode: AskMode = "chat", context = dealContext) => {
      const content = text.trim();
      if (!content || busy) return;
      setInput("");
      void run([...messages, { role: "user", content }], mode, context);
    },
    [busy, messages, dealContext, run],
  );

  const retry = useCallback(() => {
    const a = lastAttemptRef.current;
    if (a && !busy) void run(a.history, a.mode, a.context);
  }, [busy, run]);

  const openBar = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  // Keyboard shortcut and cross-component open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!askAvailable && !open) return;
        if (open) setOpen(false);
        else openBar();
      }
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenCommandBarDetail>).detail ?? {};
      if (!askAvailable) return;
      openBar();
      if (d.dealContext) setDealContext(d.dealContext);
      if (d.prompt && d.autoSubmit) send(d.prompt, d.mode ?? "chat", d.dealContext ?? dealContext);
      else if (d.prompt) setInput(d.prompt);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [send, dealContext, askAvailable, open, openBar]);

  // Find out early whether the backend is configured so entry points can hide.
  useEffect(() => {
    void probeAskAvailability();
  }, []);

  // Floating button: revealed on desktop only after the first screen scrolls by.
  useEffect(() => {
    const onScroll = () => setScrolled(isPastDesktopThreshold(window.scrollY));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, error]);

  useEffect(() => releaseBackground, []);

  // Route rule for the main site; pages served under a rewritten URL (the
  // express host) also render a [data-ask-floating-hidden] marker that a CSS
  // rule in globals.css honors regardless of the client pathname.
  const hiddenRoute = isAskButtonRouteHidden(pathname);
  const showFloating = mounted && askAvailable && !hiddenRoute;
  const retryable = error ? ASK_ERROR_COPY[error.kind].retryable : false;

  return (
    <>
      <TurnstileSlot turnstile={turnstile} className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2" />
      {showFloating && (
        <button
          type="button"
          onClick={openBar}
          data-ask-entry
          data-ask-floating
          className={`glass fixed bottom-5 right-5 z-40 flex min-h-11 items-center gap-2 rounded-full border border-black/[0.08] px-4 py-2.5 text-sm font-medium text-ink shadow-[var(--shadow-float)] transition hover:scale-[1.02] md:bottom-8 md:right-8 ${scrolled ? "" : "sm:hidden"}`}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <SparkIcon className="size-4 text-accent" />
          Ask Kubera AI
          <kbd className="hidden rounded-md bg-black/[0.06] px-1.5 py-0.5 text-xs sm:inline" aria-hidden>
            ⌘K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          ref={contentRef}
          className="glass dialog-content flex max-h-[80vh] max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/[0.08] shadow-[var(--shadow-float)]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inertBackground(contentRef.current);
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // Radix would focus its Trigger (we have none, since the bar opens
            // from several places); return focus to whatever opened it.
            e.preventDefault();
            releaseBackground();
            const target = returnFocusRef.current;
            if (target && target.isConnected) target.focus();
            returnFocusRef.current = null;
          }}
        >
          <DialogTitle className="sr-only">Ask Kubera AI</DialogTitle>
          <DialogDescription className="sr-only">
            Ask questions about commercial real estate financing. Answers are generated automatically; press Escape to close.
          </DialogDescription>

          <form
            className="flex items-start gap-2 border-b border-black/[0.06] px-4 py-3 md:px-5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <SparkIcon className="mt-3.5 size-5 shrink-0 text-accent" />
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about HUD, SBA, CMBS, bridge…"
              className="max-h-40 min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-[17px] text-ink placeholder:text-titanium focus:outline-none"
              aria-label="Your question"
              maxLength={4000}
            />
            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="min-h-11 shrink-0 rounded-full bg-black/[0.06] px-4 text-sm font-medium hover:bg-black/10"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !online}
                className="min-h-11 shrink-0 rounded-full bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-black/10 disabled:text-titanium"
              >
                Send
              </button>
            )}
            <DialogClose className="shrink-0 text-ink hover:bg-black/[0.06]" aria-label="Close Ask Kubera AI">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </DialogClose>
          </form>

          {!online && (
            <p role="status" className="border-b border-amber-500/30 bg-amber-50 px-5 py-2 text-sm text-ink">
              You&apos;re offline. Questions will send once you reconnect.
            </p>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4" tabIndex={0} aria-label="Conversation history">
            {messages.length === 0 && !error && (
              <div>
                <AiUseNotice context="chat" className="mb-4 rounded-2xl bg-black/[0.03] px-4 py-3" />
                <p className="eyebrow mb-3">Try asking</p>
                <ul className="space-y-1">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => send(s)}
                        className="min-h-11 w-full rounded-xl px-3 py-2.5 text-left text-[15px] text-ink/80 transition hover:bg-black/[0.04]"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
                {dealContext && (
                  <button
                    type="button"
                    onClick={() => send("Draft an indicative term sheet for my sized structure.", "term_sheet")}
                    className="pill pill-primary mt-4 !py-2 !text-sm"
                  >
                    Generate term sheet from my sizer results
                  </button>
                )}
              </div>
            )}

            {/* The live region exists from the start so additions are announced.
                aria-busy holds announcements until a streamed answer is complete. */}
            <div role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy} aria-label="Kubera AI conversation" className="space-y-5">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-[15px] text-white">
                    <span className="sr-only">You: </span>
                    {m.content}
                  </p>
                ) : (
                  <div key={i}>
                    {m.content ? (
                      <>
                        <span className="sr-only">Kubera AI: </span>
                        <Markdown text={m.content} />
                      </>
                    ) : (
                      <Thinking />
                    )}
                  </div>
                ),
              )}
            </div>

            {error && (
              <div
                role="alert"
                data-ask-error={error.kind}
                className={`mt-5 rounded-2xl border p-4 text-ink ${error.kind === "offline" ? "border-amber-500/40 bg-amber-50" : "border-rose-500/40 bg-rose-50"}`}
              >
                <p className="font-semibold">{ASK_ERROR_COPY[error.kind].title}</p>
                <p className="mt-1 text-sm">{error.kind === "rate_limited" || error.status === 409 ? error.message : ASK_ERROR_COPY[error.kind].body}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {retryable && (
                    <button type="button" onClick={retry} className="min-h-11 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-black">
                      Try again
                    </button>
                  )}
                  <Link
                    href="/express"
                    onClick={() => setOpen(false)}
                    className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
                  >
                    Talk to an advisor
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] px-5 py-3">
            <p className="max-w-md text-xs leading-snug text-titanium">{disclosures.ai}</p>
            <div className="flex gap-2">
              {dealContext && messages.length > 0 && !busy && (
                <button
                  type="button"
                  onClick={() => send("Draft an indicative term sheet for this structure.", "term_sheet")}
                  className="min-h-11 rounded-full bg-black/[0.05] px-4 text-sm font-medium hover:bg-black/[0.08]"
                >
                  Term sheet
                </button>
              )}
              <Link
                href="/express"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Talk to an advisor
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Thinking() {
  return (
    <div role="status" className="flex items-center gap-1.5 py-2">
      <span className="sr-only">Kubera AI is thinking</span>
      {[0, 1, 2].map((i) => (
        <span key={i} aria-hidden className="size-1.5 animate-pulse rounded-full bg-titanium" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </div>
  );
}
