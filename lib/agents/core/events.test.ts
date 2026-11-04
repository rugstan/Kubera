import { describe, expect, it } from "vitest";
import { AgentEventValidationError, eventHash, MemoryAgentEventStore, normalizeEvent, verifyChain, type AgentEvent } from "./events";

const now = () => new Date("2026-11-04T17:00:00Z");

describe("agent event validation", () => {
  it("rejects malformed rows before they reach the database", () => {
    const ok = { eventType: "tool.executed", agent: "outreach.chaser" };
    expect(() => normalizeEvent({ ...ok, eventType: "Executed" }, now())).toThrow(AgentEventValidationError);
    expect(() => normalizeEvent({ ...ok, agent: "Bad Agent" }, now())).toThrow(/agent/);
    expect(() => normalizeEvent({ ...ok, reasonCodes: ["Not A Code"] }, now())).toThrow(/reason code/);
    expect(() => normalizeEvent({ ...ok, approverDre: "123" }, now())).toThrow(/approver_dre/);
    expect(() => normalizeEvent({ ...ok, promptVersion: "v2" }, now())).toThrow(/prompt_version/);
    expect(() => normalizeEvent({ ...ok, detail: { blob: "x".repeat(20_000) } }, now())).toThrow(/too large/);
    expect(() => normalizeEvent({ ...ok, dealId: "nope" }, now())).toThrow(/deal_id/);
  });

  it("defaults the chain to the agent and de-duplicates codes and ids", () => {
    const e = normalizeEvent({ eventType: "tool.executed", agent: "crm.agent", reasonCodes: ["a.b", "a.b"], externalMessageIds: ["m1", "m1", ""] }, now());
    expect(e.chain).toBe("agent:crm.agent");
    expect(e.reasonCodes).toEqual(["a.b"]);
    expect(e.externalMessageIds).toEqual(["m1"]);
    expect(normalizeEvent({ eventType: "tool.executed", agent: "crm.agent", chain: null }, now()).chain).toBeNull();
  });
});

describe("hash chain", () => {
  async function chain(n: number) {
    const store = new MemoryAgentEventStore(now);
    for (let i = 0; i < n; i++) await store.append({ eventType: "tool.executed", agent: "crm.agent", reasonCodes: [`step.n${i}`], detail: { i } });
    return store;
  }

  it("numbers and links rows and verifies", async () => {
    const store = await chain(5);
    const rows = store.all();
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(verifyChain(rows)).toEqual({ ok: true, length: 5 });
  });

  it("detects an edited, removed or re-linked row", async () => {
    const rows = (await chain(4)).all();
    const edited: AgentEvent[] = rows.map((r) => (r.seq === 2 ? { ...r, detail: { i: 99 } } : r));
    expect(verifyChain(edited)).toMatchObject({ ok: false, brokenAt: 2, reason: "hash_mismatch" });
    expect(verifyChain(rows.filter((r) => r.seq !== 3))).toMatchObject({ ok: false, reason: "seq_gap" });
    const forged = rows.map((r) => (r.seq === 3 ? { ...r, prevHash: "f".repeat(64) } : r));
    expect(verifyChain(forged)).toMatchObject({ ok: false, brokenAt: 3, reason: "prev_hash_mismatch" });
    // Re-hashing a forged row is not enough: the next row still points at the original.
    const rehashed = edited.map((r) => {
      if (r.seq !== 2) return r;
      const { id: _id, hash: _h, ...content } = r;
      void _id;
      void _h;
      return { ...r, hash: eventHash(content) };
    });
    expect(verifyChain(rehashed)).toMatchObject({ ok: false, brokenAt: 3, reason: "prev_hash_mismatch" });
  });

  it("keeps concurrent appends on one chain contiguous", async () => {
    const store = new MemoryAgentEventStore(now);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ eventType: "tool.executed", agent: "crm.agent", detail: { i } })));
    expect(verifyChain(store.all())).toEqual({ ok: true, length: 20 });
  });

  it("filters by deal, approval and type", async () => {
    const store = new MemoryAgentEventStore(now);
    const deal = "33333333-3333-4333-8333-333333333333";
    await store.append({ eventType: "tool.executed", agent: "a.agent", dealId: deal });
    await store.append({ eventType: "tool.blocked", agent: "a.agent" });
    expect(await store.list({ dealId: deal })).toHaveLength(1);
    expect(await store.list({ eventType: "tool.blocked" })).toHaveLength(1);
  });
});
