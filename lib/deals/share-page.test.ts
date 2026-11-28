import { describe, expect, it } from "vitest";
import { dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import { sendPackageToLender } from "./packages";
import { handleShareRequest } from "./share-page";
import type { DealSummaryRecord, DealSummarySpec } from "./submission/types";
import { docs, lenderInput, newDeal, noHolds, setup } from "./test-fixtures";

async function world() {
  const ctx = setup();
  const deal = await newDeal(ctx.store, ctx.now, { title: "Sunrise <Assisted> Living" });
  const lender = await ctx.store.insertLender(lenderInput(), "a", ctx.now());
  const r = await sendPackageToLender({ store: ctx.store, gate: ctx.gate, now: ctx.now, baseUrl: "https://k.test", holds: noHolds }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "a" });
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

describe("lender share page with the locked deal summary", () => {
  const PDF_SHA = "d".repeat(64);
  const spec: DealSummarySpec = {
    templateVersion: "deal-summary-v1",
    title: "Sunrise <Assisted> Living — loan request summary",
    subtitle: "Prepared November 1, 2026 by Corin Commercial, Inc. for lender review",
    asOf: "2026-11-01",
    headline: [
      { label: "Loan request", value: "$12,500,000" },
      { label: "LTV", value: "75%" },
    ],
    sections: [
      { title: "Request", rows: [{ label: "Purpose", value: "Refinance <b>bridge</b> debt", source: "Entered by Corin" }] },
      { title: "Sources & uses", table: { head: ["Sources", "Amount"], rows: [["Senior loan", "$12,500,000"]] } },
      { title: "Plan and exit", paragraphs: ["<script>alert('x')</script> Hold \"long term\""] },
    ],
    metricNotes: [],
    openItems: [],
    footer: "license",
  };

  async function withSummary() {
    const ctx = setup();
    const deal = await newDeal(ctx.store, ctx.now, { title: "Sunrise <Assisted> Living" });
    const lender = await ctx.store.insertLender(lenderInput(), "a", ctx.now());
    const items = [...docs(2), dealSummaryPackageItem(deal.id, PDF_SHA)];
    const r = await sendPackageToLender({ store: ctx.store, gate: ctx.gate, now: ctx.now, baseUrl: "https://k.test", holds: noHolds }, { dealId: deal.id, lenderId: lender.id, items, actor: "a" });
    const token = r.shareUrl!.split("/").pop()!;
    const record: DealSummaryRecord = { id: "s1", dealId: deal.id, asOf: "2026-11-01", playbook: "hud_232", targetStage: "term_sheet", templateVersion: "deal-summary-v1", spec, specSha256: "e".repeat(64), pdfSha256: PDF_SHA, pdfStoragePath: items[2]!.storagePath, profileVersion: 1, sponsorVersion: null, createdBy: "a", createdAt: "2026-11-01T00:00:00.000Z" };
    const lookups: [string, string][] = [];
    const summaries = { getSummaryByPdfSha: async (dealId: string, sha: string) => (lookups.push([dealId, sha]), dealId === record.dealId && sha === record.pdfSha256 ? record : null) };
    const deps = { store: ctx.store, now: ctx.now, allow: async () => true, signUrl: async (p: string) => `https://storage.test/${p}?sig=1`, summaries };
    return { ...ctx, deal, token, deps, record, lookups };
  }

  it("renders the summary above the documents, escaped, and groups the documents by kind", async () => {
    const { deal, token, deps, lookups } = await withSummary();
    const res = await handleShareRequest(token, "ip", deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(lookups).toEqual([[deal.id, PDF_SHA]]);
    const at = (s: string) => html.indexOf(s);
    expect(at("Sunrise &lt;Assisted&gt; Living — loan request summary")).toBeGreaterThan(at("Package version 1"));
    expect(at('<h2>Documents</h2>')).toBeGreaterThan(at("loan request summary"));
    expect(html).toContain("<b>$12,500,000</b>");
    expect(html).toContain("Refinance &lt;b&gt;bridge&lt;/b&gt; debt");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; Hold &quot;long term&quot;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<h3>Sources &amp; uses</h3>");
    expect(html).toContain('<td class="src">Entered by Corin</td>');
    expect(html).toContain("<h3>Deal summary</h3>");
    expect(html).toContain("<h3>Operating statements</h3>");
    expect(html).toContain("<h3>Other documents</h3>");
    expect(html.indexOf("<h3>Deal summary</h3>")).toBeLessThan(html.indexOf("<h3>Operating statements</h3>"));
    expect(html).toContain("broker, not the lender");
  });

  it("renders as before when no summary is found, the lookup fails, or no summary store is wired", async () => {
    const { token, deps } = await withSummary();
    const plain = await (await handleShareRequest(token, "ip", { ...deps, summaries: undefined })).text();
    expect(plain).not.toContain("loan request summary");
    expect(plain).not.toContain("<h2>Documents</h2>");
    expect(plain).not.toContain("section.summary");
    expect(plain).toMatch(/<ul><li><a href="https:\/\/storage\.test\/[^"]+" rel="noopener noreferrer">/);
    const missing = await (await handleShareRequest(token, "ip", { ...deps, summaries: { getSummaryByPdfSha: async () => null } })).text();
    expect(missing).toBe(plain);
    const broken = await (await handleShareRequest(token, "ip", { ...deps, summaries: { getSummaryByPdfSha: async () => Promise.reject(new Error("db down")) } })).text();
    expect(broken).toBe(plain);
  });

  it("never shows another deal's summary", async () => {
    const { token, deps, record } = await withSummary();
    const html = await (await handleShareRequest(token, "ip", { ...deps, summaries: { getSummaryByPdfSha: async () => ({ ...record, dealId: "another-deal" }) } })).text();
    expect(html).not.toContain("loan request summary");
  });
});
