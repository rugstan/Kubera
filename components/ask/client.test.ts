import { describe, expect, it, vi } from "vitest";
import { AskError, ASK_ERROR_COPY, kindForStatus, normalizeAskError, streamAsk } from "./client";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const base = { message: "hi", mode: "chat" as const, onChunk: () => {}, isOnline: () => true };

describe("kindForStatus", () => {
  it("maps statuses to failure kinds", () => {
    expect(kindForStatus(503)).toBe("unavailable");
    expect(kindForStatus(429)).toBe("rate_limited");
    expect(kindForStatus(500)).toBe("error");
    expect(kindForStatus(400)).toBe("error");
  });
});

describe("streamAsk", () => {
  it("streams chunks and resolves with the full text", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async () => new Response(streamOf(["Hello", ", ", "world"]), { status: 200 }));
    const { text } = await streamAsk({ ...base, onChunk: (t) => seen.push(t), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(text).toBe("Hello, world");
    expect(seen.at(-1)).toBe("Hello, world");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ask");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ mode: "chat", message: "hi" });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("conversationId");
  });

  it("sends only the conversation id and new message, and reads the id back", async () => {
    const id = "6f1c1d2e-8d3b-4b5e-9a51-1f2e3d4c5b6a";
    const fetchImpl = vi.fn(async () => new Response(streamOf(["ok"]), { status: 200, headers: { "x-conversation-id": id } }));
    const seenIds: (string | null)[] = [];
    const result = await streamAsk({
      ...base,
      conversationId: id,
      dealContext: '{"program":"hud232"}',
      onConversationId: (v) => seenIds.push(v),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ conversationId: id, message: "hi", mode: "chat", dealContext: { program: "hud232" } });
    expect(result.conversationId).toBe(id);
    expect(seenIds).toEqual([id]);
  });

  it("asks for a Turnstile token only when starting a conversation", async () => {
    const getTurnstileToken = vi.fn(async () => "tok");
    const turnstileHeaders = (t: string | null): Record<string, string> => (t ? { "cf-turnstile-response": t } : {});
    const fetchImpl = vi.fn(async () => new Response(streamOf(["ok"]), { status: 200 }));
    await streamAsk({ ...base, getTurnstileToken, turnstileHeaders, fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["cf-turnstile-response"]).toBe("tok");
    await streamAsk({ ...base, conversationId: "abc", getTurnstileToken, turnstileHeaders, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(getTurnstileToken).toHaveBeenCalledTimes(1);
  });

  it("drops malformed deal context instead of sending a string", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf(["ok"]), { status: 200 }));
    await streamAsk({ ...base, dealContext: "not json", fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.dealContext).toBeUndefined();
  });

  it.each(["conversation_not_found", "conversation_full"])("retries once as a new conversation on %s", async (code) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x", code }), { status: code === "conversation_full" ? 409 : 404 }))
      .mockResolvedValueOnce(new Response(streamOf(["fresh"]), { status: 200, headers: { "x-conversation-id": "new-id" } }));
    const result = await streamAsk({ ...base, conversationId: "old-id", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(second).not.toHaveProperty("conversationId");
    expect(result).toEqual({ text: "fresh", conversationId: "new-id" });
  });

  it("shows a busy conversation as an error with the server hint, without retrying", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: "Kubera AI is still answering your last question.", code: "conversation_busy" }), { status: 409 }),
    );
    const err = await streamAsk({ ...base, conversationId: "abc", fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(err).toBeInstanceOf(AskError);
    expect(err.kind).toBe("error");
    expect(err.status).toBe(409);
    expect(err.message).toBe("Kubera AI is still answering your last question.");
  });

  it("reports 503 as unavailable with our own copy", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "Kubera AI is not configured." }), { status: 503 });
    const err = await streamAsk({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(AskError);
    expect(err.kind).toBe("unavailable");
    expect(err.status).toBe(503);
    expect(err.message).toBe(ASK_ERROR_COPY.unavailable.body);
  });

  it("keeps the server hint for 429 rate limits", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "Try again in a few minutes." }), { status: 429 });
    const err = await streamAsk({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(err.message).toBe("Try again in a few minutes.");
  });

  it("never leaks raw server error strings for generic failures", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: "TypeError: boom at db.ts:12" }), { status: 500 });
    const err = await streamAsk({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err.kind).toBe("error");
    expect(err.message).toBe(ASK_ERROR_COPY.error.body);
  });

  it("fails fast as offline without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const err = await streamAsk({ ...base, isOnline: () => false, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err.kind).toBe("offline");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies a network failure as offline when the browser is offline, else error", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const offline = await streamAsk({ ...base, isOnline: () => true, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(offline.kind).toBe("error");
    let online = true;
    const flaky = async () => {
      online = false;
      throw new TypeError("Failed to fetch");
    };
    const dropped = await streamAsk({ ...base, isOnline: () => online, fetchImpl: flaky as unknown as typeof fetch }).catch((e) => e);
    expect(dropped.kind).toBe("offline");
  });

  it("rethrows aborts untouched so the UI can ignore them", async () => {
    const fetchImpl = async () => {
      throw new DOMException("aborted", "AbortError");
    };
    const err = await streamAsk({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err.name).toBe("AbortError");
  });

  it("turns a mid-stream failure into an AskError", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("partial"));
        c.error(new TypeError("network error"));
      },
    });
    const fetchImpl = async () => new Response(body, { status: 200 });
    const err = await streamAsk({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(AskError);
  });
});

describe("normalizeAskError", () => {
  it("passes AskError through", () => {
    const e = new AskError("rate_limited", "x", 429);
    expect(normalizeAskError(e, true)).toBe(e);
  });
});
