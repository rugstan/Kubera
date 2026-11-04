import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { MemoryConversationStore, SupabaseConversationStore, redactForStorage } = await import("./store");

const meta = { ipHash: "h", userAgent: "ua", page: "/" };
const user = (content: string) => ({ role: "user" as const, content, mode: "chat" as const, at: "2026-11-01T00:00:00.000Z" });
const bot = (content: string) => ({ role: "assistant" as const, content, stopReason: "end_turn", at: "2026-11-01T00:00:01.000Z" });

describe("MemoryConversationStore", () => {
  it("claims, blocks concurrent turns, and appends completed turns", async () => {
    let now = 1_000;
    const store = new MemoryConversationStore(() => now);
    const conv = await store.create(meta);
    const first = await store.claim(conv.id, 60_000);
    expect(first.status).toBe("ok");
    expect(await store.claim(conv.id, 60_000)).toEqual({ status: "busy" });

    await store.complete(conv.id, 0, [user("hi"), bot("hello")]);
    const second = await store.claim(conv.id, 60_000);
    expect(second.status === "ok" && second.conversation.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    expect(second.status === "ok" && second.conversation.turnCount).toBe(1);

    // An expired lock can be taken over.
    now += 61_000;
    expect((await store.claim(conv.id, 60_000)).status).toBe("ok");
  });

  it("rejects a stale append (turn count moved)", async () => {
    const store = new MemoryConversationStore();
    const conv = await store.create(meta);
    await store.claim(conv.id, 60_000);
    await store.complete(conv.id, 0, [user("a"), bot("b")]);
    await expect(store.complete(conv.id, 0, [user("c"), bot("d")])).rejects.toThrow(/changed/);
  });

  it("returns not_found for unknown ids and release unlocks", async () => {
    const store = new MemoryConversationStore();
    expect(await store.claim("00000000-0000-4000-8000-000000000000", 1000)).toEqual({ status: "not_found" });
    const conv = await store.create(meta);
    await store.claim(conv.id, 60_000);
    await store.release(conv.id);
    expect((await store.claim(conv.id, 60_000)).status).toBe("ok");
  });

  it("returns copies, so callers cannot mutate stored history", async () => {
    const store = new MemoryConversationStore();
    const conv = await store.create(meta);
    await store.claim(conv.id, 60_000);
    await store.complete(conv.id, 0, [user("a"), bot("b")]);
    const claimed = await store.claim(conv.id, 60_000);
    if (claimed.status !== "ok") throw new Error("expected ok");
    claimed.conversation.messages[1]!.content = "forged";
    await store.release(conv.id);
    const again = await store.claim(conv.id, 60_000);
    expect(again.status === "ok" && again.conversation.messages[1]!.content).toBe("b");
  });
});

const SSN = "123-45-6789";
const sensitive = `My SSN is ${SSN}, DOB: 04/12/1961 and account # 004417250093. Email pat@example.com`;

/** Minimal Supabase stand-in for complete(): one ai_conversations row, records every update payload. */
function fakeDb(row: { messages: unknown[]; turn_count: number }) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: structuredClone(row), error: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        const chain = { eq: () => chain, then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res) };
        return chain;
      },
    }),
  };
  return { db, updates };
}

describe("transcript redaction (Global rule 8)", () => {
  it("never stores an SSN, DOB or account number in plaintext (memory store)", async () => {
    const store = new MemoryConversationStore();
    const conv = await store.create(meta);
    await store.claim(conv.id, 60_000);
    await store.complete(conv.id, 0, [{ ...user(sensitive), dealContext: { inputs: { ssn: SSN, noi: 1_200_000 } } }, bot(`Noted ${SSN}`)]);
    const messages = store.rows.get(conv.id)!.messages;
    const raw = JSON.stringify(messages);
    expect(raw).not.toContain(SSN);
    expect(raw).not.toContain("04/12/1961");
    expect(raw).not.toContain("004417250093");
    expect(messages[0]).toMatchObject({ role: "user", redacted: true });
    expect(messages[0]!.content).toContain("[REDACTED:ssn]");
    // Confidential contact details stay (the column is confidential), and deal numbers survive.
    expect(messages[0]!.content).toContain("pat@example.com");
    expect(messages[0]!.role === "user" && messages[0]!.dealContext).toEqual({ inputs: { ssn: "[REDACTED:restricted]", noi: 1_200_000 } });
  });

  it("never sends an SSN to ai_conversations.messages and scrubs legacy rows (Supabase store)", async () => {
    const { db, updates } = fakeDb({ messages: [user(`legacy ${SSN}`), bot("ok")], turn_count: 1 });
    const store = new SupabaseConversationStore(db as never);
    await store.complete("00000000-0000-4000-8000-000000000000", 1, [user(sensitive), bot("thanks")]);
    expect(updates).toHaveLength(1);
    const written = JSON.stringify(updates[0]!.messages);
    expect(written).not.toContain(SSN);
    expect(written).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
    expect((updates[0]!.messages as { content: string }[]).map((m) => m.content)).toEqual([
      "legacy [REDACTED:ssn]",
      "ok",
      expect.stringContaining("My SSN is [REDACTED:ssn]"),
      "thanks",
    ]);
  });

  it("leaves clean messages untouched (no redacted flag)", () => {
    const m = user("What DSCR does HUD 232 need?");
    expect(redactForStorage(m)).toEqual(m);
  });
});
