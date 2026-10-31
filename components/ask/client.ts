// Browser-side transport for /api/ask: one streaming request and a typed
// failure model, so the UI can show a distinct state for offline, unavailable
// (503), rate-limited (429) and generic errors instead of pasting raw error
// text into the conversation.

export type Msg = { role: "user" | "assistant"; content: string };
export type AskMode = "chat" | "term_sheet";

export type AskErrorKind = "offline" | "unavailable" | "rate_limited" | "error";

export class AskError extends Error {
  readonly kind: AskErrorKind;
  readonly status?: number;
  constructor(kind: AskErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AskError";
    this.kind = kind;
    this.status = status;
  }
}

export const ASK_ERROR_COPY: Record<AskErrorKind, { title: string; body: string; retryable: boolean }> = {
  offline: {
    title: "You're offline",
    body: "Kubera AI needs a connection. Check your network and try again, or talk to an advisor.",
    retryable: true,
  },
  unavailable: {
    title: "Kubera AI is unavailable",
    body: "The assistant isn't available right now. An advisor can help with your question directly.",
    retryable: false,
  },
  rate_limited: {
    title: "Too many questions at once",
    body: "Please wait a few minutes before asking again, or talk to an advisor now.",
    retryable: true,
  },
  error: {
    title: "That didn't go through",
    body: "Something went wrong while answering. Try again, or talk to an advisor.",
    retryable: true,
  },
};

/** Map an HTTP status to a failure kind. */
export function kindForStatus(status: number): AskErrorKind {
  if (status === 503) return "unavailable";
  if (status === 429) return "rate_limited";
  return "error";
}

export function normalizeAskError(e: unknown, online: boolean): AskError {
  if (e instanceof AskError) return e;
  // fetch() rejects with a TypeError on network failure; a dropped stream does too.
  return new AskError(online ? "error" : "offline", (e as Error)?.message ?? "Request failed");
}

export type StreamAskOptions = {
  messages: Msg[];
  mode: AskMode;
  dealContext?: string;
  signal?: AbortSignal;
  onChunk: (textSoFar: string) => void;
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
};

/**
 * POSTs the conversation and streams the plain-text answer. Resolves with the
 * full text; throws AskError on failure. Aborts surface as the native AbortError.
 */
export async function streamAsk(opts: StreamAskOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const isOnline = opts.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  if (!isOnline()) throw new AskError("offline", "offline");

  let res: Response;
  try {
    res = await fetchImpl("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: opts.messages.slice(-20), mode: opts.mode, dealContext: opts.dealContext }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw normalizeAskError(e, isOnline());
  }

  if (!res.ok || !res.body) {
    const kind = kindForStatus(res.status);
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    // Server copy is shown for rate limits (it carries a useful hint); other
    // kinds use our own wording so internal error strings never leak to the UI.
    const message = kind === "rate_limited" && payload?.error ? payload.error : ASK_ERROR_COPY[kind].body;
    throw new AskError(kind, message, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      opts.onChunk(acc);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const err = normalizeAskError(e, isOnline());
    throw err;
  }
  return acc;
}
