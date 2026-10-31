import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { MemoryConversationStore } = await import("./store");

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
