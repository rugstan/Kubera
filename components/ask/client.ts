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

/** Sizer context arrives as a JSON string; the server validates the object shape. */
export function parseDealContext(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// The server owns the transcript: the client sends only the conversation id
// (omitted on the first message) and the new user message, and reads the id
// back from this response header.
export const CONVERSATION_HEADER = "x-conversation-id";
/** Error codes that mean "start a fresh conversation and resend once". */
export const RESTART_CODES: ReadonlySet<string> = new Set(["conversation_not_found", "conversation_full"]);

export type StreamAskOptions = {
  /** The new user message. */
  message: string;
  /** Id from the previous turn's response header; omit to start a conversation. */
  conversationId?: string | null;
  mode: AskMode;
  /** Sizer context as a JSON string; parsed into an object before sending. */
  dealContext?: string;
  /** Bot check for starting a conversation; only called when there is no conversation id. */
  getTurnstileToken?: () => Promise<string | null>;
  /** Extra headers for the request that starts a conversation (Turnstile token). */
  turnstileHeaders?: (token: string | null) => Record<string, string>;
  signal?: AbortSignal;
  onChunk: (textSoFar: string) => void;
  /** Called with the conversation id the server assigned or confirmed. */
  onConversationId?: (id: string | null) => void;
  fetchImpl?: typeof fetch;
  isOnline?: () => boolean;
};

export type StreamAskResult = { text: string; conversationId: string | null };

/**
 * POSTs one user message and streams the plain-text answer. Resolves with the
 * full text and the conversation id; throws AskError on failure. When the
 * server reports the conversation as expired or full, it retries once as a new
 * conversation. Aborts surface as the native AbortError.
 */
export async function streamAsk(opts: StreamAskOptions): Promise<StreamAskResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const isOnline = opts.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  if (!isOnline()) throw new AskError("offline", "offline");

  const dealContext = parseDealContext(opts.dealContext);
  const post = async (conversationId: string | null) => {
    const token = conversationId ? null : ((await opts.getTurnstileToken?.()) ?? null);
    const extra = conversationId ? {} : (opts.turnstileHeaders?.(token) ?? {});
    return fetchImpl("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify({ ...(conversationId ? { conversationId } : {}), message: opts.message, mode: opts.mode, dealContext }),
      signal: opts.signal,
    });
  };

  let conversationId = opts.conversationId ?? null;
  let res: Response;
  try {
    res = await post(conversationId);
    if (!res.ok && conversationId) {
      const err = (await res
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (err?.code && RESTART_CODES.has(err.code)) {
        conversationId = null;
        opts.onConversationId?.(null);
        res = await post(null);
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw normalizeAskError(e, isOnline());
  }

  if (!res.ok || !res.body) {
    const kind = kindForStatus(res.status);
    const payload = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    // Server copy is shown for rate limits and a busy conversation (both carry
    // a useful hint); other kinds use our own wording so internal error strings
    // never leak to the UI.
    const useServerCopy = (kind === "rate_limited" || payload?.code === "conversation_busy") && payload?.error;
    const message = useServerCopy ? payload.error! : ASK_ERROR_COPY[kind].body;
    throw new AskError(kind, message, res.status);
  }

  conversationId = res.headers.get(CONVERSATION_HEADER) ?? conversationId;
  opts.onConversationId?.(conversationId);

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
  return { text: acc, conversationId };
}
