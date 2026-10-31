"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { disclosures } from "@/lib/site";
import { SparkIcon } from "@/components/site/GlassHeader";
import { TurnstileSlot, turnstileHeaders, useTurnstile } from "@/components/security/Turnstile";
import { OPEN_EVENT, type OpenCommandBarDetail } from "./events";
import { Markdown } from "./Markdown";

type Msg = { role: "user" | "assistant"; content: string };

/** Sizer context arrives as a JSON string; the server validates the object shape. */
function parseDealContext(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// Server owns the transcript: we send only the conversation id and the new
// message, and read the id back from this header.
const CONVERSATION_HEADER = "x-conversation-id";
const RESTART_CODES = new Set(["conversation_not_found", "conversation_full"]);

const SUGGESTIONS = [
  "HUD 232 vs. SBA 504 for a $2.8M, 48-bed RCFE refinance?",
  "How does the 2026 SBA 7(a) + 504 stack work for a $18M hotel?",
  "What DSCR and debt yield do hotel CMBS lenders need?",
  "Can I bridge a hotel-to-assisted-living conversion, then take out with HUD?",
];

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [dealContext, setDealContext] = useState<string | undefined>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<string | null>(null);
  const turnstile = useTurnstile("ask");

  const send = useCallback(
    async (text: string, mode: "chat" | "term_sheet" = "chat", context = dealContext) => {
      const content = text.trim();
      if (!content || busy) return;
      const history: Msg[] = [...messages, { role: "user", content }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const post = async () => {
          const conversationId = conversationRef.current;
          const token = conversationId ? null : await turnstile.getToken();
          return fetch("/api/ask", {
            method: "POST",
            headers: { "content-type": "application/json", ...turnstileHeaders(token) },
            body: JSON.stringify({ ...(conversationId ? { conversationId } : {}), message: content, mode, dealContext: parseDealContext(context) }),
            signal: ctrl.signal,
          });
        };
        let res = await post();
        if (!res.ok && conversationRef.current) {
          const err = (await res.clone().json().catch(() => null)) as { code?: string } | null;
          if (err?.code && RESTART_CODES.has(err.code)) {
            conversationRef.current = null;
            res = await post();
          }
        }
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? "Kubera AI is unavailable right now.");
        }
        conversationRef.current = res.headers.get(CONVERSATION_HEADER) ?? conversationRef.current;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages([...history, { role: "assistant", content: acc }]);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setMessages([...history, { role: "assistant", content: (e as Error).message }]);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, dealContext, turnstile],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<OpenCommandBarDetail>).detail ?? {};
      setOpen(true);
      if (d.dealContext) setDealContext(d.dealContext);
      if (d.prompt && d.autoSubmit) void send(d.prompt, d.mode ?? "chat", d.dealContext ?? dealContext);
      else if (d.prompt) setInput(d.prompt);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [send, dealContext]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    document.documentElement.style.overflow = open ? "hidden" : "";
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <>
      <TurnstileSlot turnstile={turnstile} className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2" />
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-black/[0.08] px-4 py-2.5 text-sm font-medium text-ink shadow-[var(--shadow-float)] transition hover:scale-[1.02] md:bottom-8 md:right-8"
        aria-label="Ask Kubera AI"
      >
        <SparkIcon className="size-4 text-accent" />
        Ask Kubera AI
        <kbd className="hidden rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[11px] text-titanium sm:inline">⌘K</kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-3 pt-[8vh] backdrop-blur-sm md:pt-[12vh]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Ask Kubera AI"
              className="glass flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-black/[0.08] shadow-[var(--shadow-float)]"
              initial={{ y: 16, scale: 0.98, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 8, scale: 0.98, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <form
                className="flex items-start gap-3 border-b border-black/[0.06] px-5 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <SparkIcon className="mt-1 size-5 shrink-0 text-accent" />
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder="Ask about HUD 232, SBA 504 hotel stacks, CMBS, bridge…"
                  className="max-h-40 flex-1 resize-none bg-transparent text-[17px] text-ink placeholder:text-titanium focus:outline-none"
                  aria-label="Your question"
                  maxLength={4000}
                />
                {busy ? (
                  <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-full bg-black/[0.06] px-3 py-1 text-xs font-medium">
                    Stop
                  </button>
                ) : (
                  <kbd className="mt-1 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-titanium">esc</kbd>
                )}
              </form>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
                {messages.length === 0 ? (
                  <div>
                    <p className="eyebrow mb-3">Try asking</p>
                    <ul className="space-y-1">
                      {SUGGESTIONS.map((s) => (
                        <li key={s}>
                          <button type="button" onClick={() => void send(s)} className="w-full rounded-xl px-3 py-2.5 text-left text-[15px] text-ink/80 transition hover:bg-black/[0.04]">
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {dealContext && (
                      <button
                        type="button"
                        onClick={() => void send("Draft an indicative term sheet for my sized structure.", "term_sheet")}
                        className="pill pill-primary mt-4 !py-2 !text-sm"
                      >
                        Generate term sheet from my sizer results
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((m, i) =>
                      m.role === "user" ? (
                        <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-[15px] text-white">{m.content}</p>
                      ) : (
                        <div key={i}>
                          {m.content ? <Markdown text={m.content} /> : <Thinking />}
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] px-5 py-3">
                <p className="max-w-md text-[11px] leading-snug text-titanium">{disclosures.ai}</p>
                <div className="flex gap-2">
                  {dealContext && messages.length > 0 && !busy && (
                    <button type="button" onClick={() => void send("Draft an indicative term sheet for this structure.", "term_sheet")} className="rounded-full bg-black/[0.05] px-3 py-1.5 text-xs font-medium hover:bg-black/[0.08]">
                      Term sheet
                    </button>
                  )}
                  <Link href="/express" onClick={() => setOpen(false)} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">
                    Talk to an advisor
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 py-2" aria-label="Kubera AI is thinking">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-titanium"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}
