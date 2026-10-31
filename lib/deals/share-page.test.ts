import { describe, expect, it } from "vitest";
import { sendPackageToLender } from "./packages";
import { handleShareRequest } from "./share-page";
import { docs, lenderInput, newDeal, setup } from "./test-fixtures";

async function world() {
  const ctx = setup();
  const deal = await newDeal(ctx.store, ctx.now, { title: "Sunrise <Assisted> Living" });
  const lender = await ctx.store.insertLender(lenderInput(), "a", ctx.now());
  const r = await sendPackageToLender({ store: ctx.store, gate: ctx.gate, now: ctx.now, baseUrl: "https://k.test" }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "a" });
  const token = r.shareUrl!.split("/").pop()!;
  const signed: string[] = [];
  const deps = { store: ctx.store, now: ctx.now, allow: async () => true, signUrl: async (p: string) => (signed.push(p), `https://storage.test/${p}?sig=1`) };
  return { ...ctx, token, deps, signed, r };
}

describe("lender share page", () => {
  it("lists the locked version's documents with signed links, escaped and unindexed", async () => {
    const { token, deps, signed } = await world();
    const res = await handleShareRequest(token, "ip1", deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const html = await res.text();
    expect(html).toContain("Sunrise &lt;Assisted&gt; Living");
    expect(html).toContain("Package version 1");
    expect(html).toContain("broker, not the lender");
    expect(html).toContain("Real estate broker, California Department of Real Estate");
    expect(signed).toEqual(["leads/x/doc-1.pdf", "leads/x/doc-2.pdf"]);
  });

  it("answers unknown, expired and revoked links the same way and rate-limits", async () => {
    const { token, deps, store, now, r, clock } = await world();
    expect((await handleShareRequest("x".repeat(43), "ip", deps)).status).toBe(404);
    await store.revokeShareLink(r.outreach.shareLinkId!, "a", "test", now());
    const revoked = await handleShareRequest(token, "ip", deps);
    expect(revoked.status).toBe(404);
    expect(await revoked.text()).toContain("not available");
    clock.advance(1);
    expect((await handleShareRequest(token, "ip", { ...deps, allow: async () => false })).status).toBe(429);
  });
});
