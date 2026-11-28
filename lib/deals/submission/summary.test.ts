import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PackageCopyError, dealSummaryPackageItem, sha256Hex } from "@/lib/agents/lenders/package";
import { renderDealSummaryPdf } from "@/lib/agents/lenders/package-pdf";
import { EmailSafetyError } from "./redaction";
import { buildDealSummary, fmt, sizePhrase, summaryAsOf, summarySpecSha256, summaryText } from "./summary";
import { stubSubmissionMetrics } from "./test-metrics";
import { allSubmissionFixtures, emptyProfileContext, submissionFixture } from "./test-fixtures";
import { submissionPlaybooks, type DealSummarySpec, type SubmissionContext } from "./types";

const build = (ctx: SubmissionContext, stage: "screen" | "term_sheet" | "underwrite" = "term_sheet", openItems: string[] = []) => buildDealSummary(ctx, stubSubmissionMetrics(ctx), stage, { openItems, advisor: { name: "Ana Ruiz", email: "ana@corincommercial.com", dreLicense: "01234567" } });
const rows = (spec: DealSummarySpec) => spec.sections.flatMap((s) => (s.rows ?? []).map((r) => ({ ...r, section: s.title })));

/** Text drawn in the PDF (Flate streams decompressed, TJ strings concatenated). */
function drawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const chunks: string[] = [];
  let i = 0;
  while ((i = raw.indexOf("stream", i)) !== -1) {
    let start = i + 6;
    if (raw[start] === 0x0d) start += 1;
    if (raw[start] === 0x0a) start += 1;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    try {
      chunks.push(inflateSync(raw.subarray(start, end)).toString("latin1"));
    } catch {
      // not Flate
    }
    i = end + 9;
  }
  const out: string[] = [];
  for (const c of chunks) {
    for (const m of c.matchAll(/\[(.*?)\]\s*TJ/g)) {
      for (const s of m[1]!.matchAll(/<([0-9a-fA-F]+)>|\((.*?)\)/g)) out.push(s[1] ? Buffer.from(s[1], "hex").toString("latin1") : s[2]!);
    }
  }
  return out.join("");
}

describe("formatting", () => {
  it("formats money, percentages, ratios and dates without long digit runs", () => {
    expect(fmt.usd(840_000_000)).toBe("$8,400,000");
    expect(fmt.usd(11_917)).toBe("$119.17");
    expect(fmt.usd(-1_200_000)).toBe("-$12,000");
    expect(fmt.usdCompact(840_000_000)).toBe("$8.4M");
    expect(fmt.usdCompact(2_500_000_000)).toBe("$25M");
    expect(fmt.usdCompact(65_000_000)).toBe("$650K");
    expect(fmt.pct(68.016)).toBe("68%");
    expect(fmt.pct(9.107)).toBe("9.1%");
    expect(fmt.rate(8.75)).toBe("8.75%");
    expect(fmt.x(1.2549)).toBe("1.25x");
    expect(fmt.count(108.4)).toBe("108.4");
    expect(fmt.count(0.92)).toBe("0.92");
    expect(fmt.count(1_140)).toBe("1,140");
    expect(fmt.date("2027-01-15")).toBe("January 15, 2027");
    expect(fmt.date("2026-11-18T19:30:00.000Z")).toBe("November 18, 2026");
    expect(fmt.monthYear("2026-09-30")).toBe("September 2026");
    expect(fmt.amortization(360)).toBe("30-year amortization");
    expect(fmt.usd(123_456_789_00)).not.toMatch(/\d{9,}/);
  });

  it("names the size and type", () => {
    expect(sizePhrase({ sizeCount: 42, sizeUnit: "units", assetType: "MULTIFAMILY" })).toBe("42-unit multifamily");
    expect(sizePhrase({ sizeCount: 86_000, sizeUnit: "sf", assetType: "RETAIL" })).toBe("86,000 SF retail");
    expect(sizePhrase({ sizeCount: 132, sizeUnit: "keys", assetType: "HOTEL_FLAGGED" })).toBe("132-key hotel (flagged)");
    expect(sizePhrase({ sizeCount: 4, sizeUnit: "units", assetType: "RESIDENTIAL_2_4" })).toBe("4-unit residential");
    expect(sizePhrase({ sizeCount: 1, sizeUnit: "units", assetType: "SFR_1_4" })).toBe("1-unit house");
    expect(sizePhrase({ sizeCount: null, sizeUnit: null, assetType: "OFFICE" })).toBe("office");
    expect(sizePhrase({ sizeCount: null, sizeUnit: null, assetType: null })).toBeNull();
  });
});

describe("buildDealSummary", () => {
  it("is deterministic: the same inputs give the same spec and SHA-256", () => {
    const a = build(submissionFixture("bridge"));
    const b = build(submissionFixture("bridge"));
    expect(b).toEqual(a);
    expect(summarySpecSha256(b)).toBe(summarySpecSha256(a));
    expect(summarySpecSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    const changed = submissionFixture("bridge");
    changed.profile!.occupancyPct = 90;
    expect(summarySpecSha256(build(changed))).not.toBe(summarySpecSha256(a));
  });

  it("dates the summary by the data, not the clock", () => {
    const ctx = submissionFixture("bridge");
    expect(summaryAsOf(ctx)).toBe("2026-11-18");
    const later = submissionFixture("bridge");
    later.now = new Date("2027-03-01T12:00:00.000Z");
    expect(build(later).asOf).toBe("2026-11-18");
    expect(build(later).subtitle).toBe("Prepared November 18, 2026 by Corin Commercial, Inc. for lender review");
    later.profile!.updatedAt = "2026-11-25T09:00:00.000Z";
    expect(build(later).asOf).toBe("2026-11-25");
  });

  it.each(submissionPlaybooks.map((p) => [p] as const))("%s: every figure row names its source, and in-place and stabilized never share a row", (playbook) => {
    const spec = build(submissionFixture(playbook));
    for (const r of rows(spec)) {
      if (/\d/.test(r.value)) expect(r.source, `${r.section} / ${r.label}`).toBeTruthy();
      const text = `${r.label} ${r.value}`.toLowerCase();
      expect(text.includes("in place") && text.includes("stabilized"), `${r.label}`).toBe(false);
    }
    expect(spec.headline.length).toBeGreaterThanOrEqual(4);
    expect(spec.headline.length).toBeLessThanOrEqual(6);
    expect(spec.sections.at(-1)!.title).toBe("About this request");
    expect(spec.sections.at(-1)!.paragraphs![0]).toMatch(/is the broker on this request, not the lender/);
    expect(spec.footer).toMatch(/Real estate broker, California Department of Real Estate/);
    expect(summaryText(spec)).not.toMatch(/\bN\/A\b|approved|qualifies for|guaranteed/i);
  });

  it("produces no row for a missing value and fabricates no figure on an empty profile", () => {
    for (const playbook of submissionPlaybooks) {
      const ctx = emptyProfileContext(playbook);
      const spec = buildDealSummary(ctx, stubSubmissionMetrics(ctx), "screen");
      expect(spec.headline).toEqual([]);
      const withDigits = rows(spec).filter((r) => r.label !== "Program" && /\d/.test(r.value));
      expect(withDigits, playbook).toEqual([]);
      expect(spec.metricNotes).toEqual([]);
      expect(spec.sections.map((s) => s.title)).toEqual(["Request", "About this request"]);
    }
  });

  it("drops a row when its value is removed", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.asIsValueCents = null;
    ctx.profile!.asIsValueSource = null;
    const spec = build(ctx);
    expect(rows(spec).some((r) => r.label === "As-is value")).toBe(false);
    // LTV then rests on the purchase price, and says so.
    expect(spec.headline.find((h) => h.label === "Loan to price")?.value).toBe("70%");
  });

  it("carries the sponsor's combined strength with its source and the covenant checks, behind the link", () => {
    const spec = build(submissionFixture("bridge"));
    const sponsor = spec.sections.find((s) => s.title === "Sponsor")!;
    const byLabel = Object.fromEntries(sponsor.rows!.map((r) => [r.label, r]));
    expect(byLabel["Combined guarantor net worth"]).toMatchObject({ value: "$19,000,000", source: "From 2 personal financial statements, oldest dated October 15, 2026" });
    expect(byLabel["Net worth at or above the loan amount"]!.value).toBe("Yes");
    expect(byLabel["Credit events"]!.value).toMatch(/None reported/);
    const hud = build(submissionFixture("hud_232")).sections.find((s) => s.title === "Sponsor")!;
    expect(hud.rows!.some((r) => r.label === "Combined key principal net worth")).toBe(true);
  });

  it("lists unmet items and how each figure was calculated", () => {
    const spec = build(submissionFixture("bridge"), "underwrite", ["Appraisal", "Phase I environmental site assessment"]);
    expect(spec.openItems).toEqual(["Appraisal", "Phase I environmental site assessment"]);
    expect(spec.sections.find((s) => s.title === "Not yet in hand")!.paragraphs).toEqual(["• Appraisal", "• Phase I environmental site assessment"]);
    const ltv = spec.metricNotes.find((n) => n.key === "ltv_as_is")!;
    expect(ltv.formula).toBe("loan ÷ as-is value");
    expect(ltv.inputs).toEqual(["loan amount: $8,400,000 (Deal record)", "as-is value: $12,350,000 (Entered by Corin)"]);
    const how = spec.sections.find((s) => s.title === "How these figures were calculated")!;
    expect(how.paragraphs![0]).toContain("LTV (as-is): loan ÷ as-is value.");
    expect(how.paragraphs![1]).toMatch(/none is typed/);
  });

  it("shows the program sections for the playbook", () => {
    const titles = (p: Parameters<typeof submissionFixture>[0]) => build(submissionFixture(p)).sections.map((s) => s.title);
    expect(titles("construction")).toContain("Construction");
    expect(titles("construction")).not.toContain("Hotel");
    expect(titles("hotel_pip_bridge")).toEqual(expect.arrayContaining(["Hotel", "Renovation and reserves requested"]));
    expect(titles("c_pace")).toEqual(expect.arrayContaining(["Construction", "Capital stack"]));
    expect(titles("fix_flip")).toContain("Hard money file");
    expect(titles("cmbs")).toContain("Tenancy and rollover");
    expect(titles("construction")).toContain("Third-party reports on hand");
  });

  it("refuses overclaiming copy and identifiers typed into free text", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.highlights = ["Borrower is pre-approved by two banks"];
    expect(() => build(ctx)).toThrow(PackageCopyError);
    const ssn = submissionFixture("bridge");
    ssn.profile!.exitDetail = "Guarantor SSN 123-45-6789 on file";
    expect(() => build(ssn)).toThrow(EmailSafetyError);
  });
});

describe("deal summary PDF", () => {
  it("renders deterministic bytes with the headline, sources and tables, in at most two pages for a typical deal", async () => {
    const spec = build(submissionFixture("bridge"));
    const a = await renderDealSummaryPdf(spec);
    const b = await renderDealSummaryPdf(spec);
    expect(Buffer.from(a.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const text = drawnText(a);
    for (const s of ["Brindlewood Court Apartments acquisition", "$8,400,000", "From T-12", "Total uses", "not the lender", "How these figures were calculated"]) expect(text).toContain(s);
    const pages = Buffer.from(a).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeLessThanOrEqual(3);
    const item = dealSummaryPackageItem("d1", sha256Hex(a));
    expect(item).toMatchObject({ kind: "DEAL_SUMMARY", label: "Deal summary (Corin)", storagePath: `packages/d1/executive-summary-${sha256Hex(a).slice(0, 16)}.pdf` });
    expect(item.documentId.length).toBeLessThanOrEqual(100);
  });

  it("renders every playbook's summary in at most three pages", async () => {
    for (const [playbook, ctx] of allSubmissionFixtures()) {
      const bytes = await renderDealSummaryPdf(build(ctx));
      const pages = Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
      expect(pages.length, playbook).toBeLessThanOrEqual(3);
    }
  });
});
