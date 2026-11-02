import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PackageCopyError, buildExecutiveSummary, checkSummaryCopy, defaultAssetClass, sha256Hex, summaryPackageItem, type ExecutiveSummaryInput } from "./package";
import { renderExecutiveSummaryPdf } from "./package-pdf";

const input: ExecutiveSummaryInput = {
  deal: { id: "d1", title: "Sunrise Assisted Living refi", program: "HUD_232", borrowerName: "Sunrise Care LLC", propertyAddress: "100 Main St, Fresno", propertyState: "CA", loanAmountCents: 1_250_000_000 },
  assetClass: "SENIOR_LIVING",
  spreads: { asOf: "2026-10-31", noiCents: 150_000_000, underwrittenNoiCents: 140_000_000, valueCents: 1_800_000_000, dscr: 1.52, occupancyPct: 91.5, units: 96, unitLabel: "beds", payorMix: { "Private pay": 72, Medicaid: 28 } },
  highlights: ["Ninety-six licensed beds with three years of stabilized occupancy."],
  risks: ["Medicaid concentration; mitigated by a private-pay waitlist."],
  purpose: "Refinance bridge debt into HUD 232/223(f)",
  asOf: "2026-11-04",
  advisor: { name: "Ana Ruiz", email: "ana@corincommercial.com", dreLicense: "01234567" },
};

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

describe("buildExecutiveSummary", () => {
  it("lays out the request, metrics derived from spreads and the broker statement", () => {
    const spec = buildExecutiveSummary(input);
    const titles = spec.sections.map((s) => s.title);
    expect(titles).toEqual(["Request", "Underwriting snapshot (spreads as of 2026-10-31)", "Payor mix", "Highlights", "Risks and mitigants", "About this package"]);
    const snap = Object.fromEntries(spec.sections[1]!.rows!.map((r) => [r.label, r.value]));
    expect(snap).toMatchObject({ "Net operating income": "$1,500,000", "Underwritten NOI": "$1,400,000", "Loan-to-value": "69.4%", "Debt service coverage": "1.52x", "Debt yield": "11.20%", Beds: "96" });
    expect(spec.sections.at(-1)!.paragraphs![0]).toMatch(/is the broker for this request, not the lender/);
    expect(spec.footer).toMatch(/Real estate broker, California Department of Real Estate/);
  });

  it("omits sections it has no data for", () => {
    const spec = buildExecutiveSummary({ deal: { ...input.deal, borrowerName: null }, asOf: "2026-11-04" });
    expect(spec.sections.map((s) => s.title)).toEqual(["Request", "About this package"]);
    expect(spec.sections[0]!.rows!.map((r) => r.label)).not.toContain("Borrower");
  });

  it("blocks overclaiming copy", () => {
    for (const bad of ["Loan is approved by the lender", "Borrower qualifies for HUD", "Guaranteed closing in 30 days", "This loan is usury-exempt", "We will close within 21 days", "Fees protected"]) {
      expect(() => checkSummaryCopy([bad])).toThrow(PackageCopyError);
    }
    expect(() => checkSummaryCopy(["Many close in 10–21 days after a complete file, subject to lender review; not guaranteed."])).not.toThrow();
    expect(() => checkSummaryCopy(["Lender review is pending."])).not.toThrow();
    expect(() => buildExecutiveSummary({ ...input, asOf: "Nov 4" })).toThrow(/YYYY-MM-DD/);
  });

  it("defaults the asset class from the program", () => {
    expect(defaultAssetClass("HOTEL_CMBS")).toBe("HOSPITALITY");
    expect(defaultAssetClass("SBA_7A")).toBeNull();
  });
});

describe("executive summary PDF", () => {
  it("renders deterministic bytes that contain the summary text", async () => {
    const spec = buildExecutiveSummary(input);
    const a = await renderExecutiveSummaryPdf(spec);
    const b = await renderExecutiveSummaryPdf(spec);
    expect(Buffer.from(a.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const text = drawnText(a);
    expect(text).toContain("Sunrise Assisted Living refi");
    expect(text).toContain("$12,500,000");
    expect(text).toContain("not the lender");
    const item = summaryPackageItem("d1", sha256Hex(a));
    expect(item).toMatchObject({ kind: "EXECUTIVE_SUMMARY", storagePath: `packages/d1/executive-summary-${sha256Hex(a).slice(0, 16)}.pdf` });
    expect(item.documentId.length).toBeLessThanOrEqual(100);
  });
});
