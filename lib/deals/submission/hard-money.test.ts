// F1 / F11: hard money and fix & flip submissions say one thing. The ratios
// are the deal's loan (the one the email prints) over the file's values and
// cost; the as-is value prints with the source and date of the record it came
// from; and a profile that disagrees with the file is flagged and must be
// fixed (or the send given a reason).

import { describe, expect, it } from "vitest";
import { dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import { lenderInput, toPanelEntry } from "../test-fixtures";
import { buildLenderEmail, emailLenderFrom } from "./email";
import { computeSubmissionMetrics } from "./metrics";
import { playbookLoanTypes } from "./playbooks";
import { evaluateReadiness } from "./readiness";
import { buildDealSummary } from "./summary";
import { lenderFit, tailorDealFrom } from "./tailor";
import { submissionFixture } from "./test-fixtures";
import type { SubmissionContext } from "./types";

const ADVISOR = { name: "Ana Ruiz", title: null, dreLicense: "01234567", email: "ana@corincommercial.com", phone: null };

function email(ctx: SubmissionContext) {
  const metrics = computeSubmissionMetrics(ctx);
  const panel = toPanelEntry(lenderInput({ name: "Harborline Capital", programs: [ctx.deal.program], loanTypes: [...playbookLoanTypes[ctx.profile!.playbook]], minLoanCents: 50_000_000, maxLoanCents: 5_000_000_000, states: ["CA"], assetTypes: [] }), "lender-x", []);
  return buildLenderEmail({ ctx, metrics, stage: "term_sheet", lender: emailLenderFrom(panel), fit: lenderFit(panel, [], tailorDealFrom(ctx), metrics.metrics), documents: [dealSummaryPackageItem(ctx.deal.id, "ab".repeat(32))], notYetInHand: [], advisor: ADVISOR });
}
const line = (text: string, re: RegExp) => text.split("\n").find((l) => re.test(l)) ?? "";

describe("hard money ratios (F1)", () => {
  it("print the deal's loan over the file's cost and ARV, never the file's own loan", () => {
    const ctx = submissionFixture("fix_flip");
    ctx.deal = { ...ctx.deal, loanAmountCents: 95_000_000 };
    const e = email(ctx);
    // $950,000 over $978,000 total cost and a $1,195,000 ARV.
    expect(e.subject).toContain("$950,000 fix & flip");
    expect(e.subject).toContain("97.1% LTC, 79.5% LTARV");
    expect(line(e.text, /^ {2}LTC:/)).toContain("97.1% of $978,000 total cost");
    expect(line(e.text, /^ {2}LTARV:/)).toContain("79.5% of the after-repair value");
    const summary = buildDealSummary(ctx, computeSubmissionMetrics(ctx), "term_sheet");
    expect(summary.headline).toEqual(expect.arrayContaining([{ label: "LTC", value: "97.1%" }, { label: "LTARV", value: "79.5%" }]));
  });
});

describe("the as-is value comes from one record (F11)", () => {
  it("prints the profile's source and date when the profile holds the file's value", () => {
    const ctx = submissionFixture("fix_flip");
    expect(ctx.profile!.asIsValueCents).toBe(Math.round(ctx.hardMoney!.asIsValue * 100));
    expect(line(email(ctx).text, /As-is value:/)).toContain("As-is value: $790,000 (Comparable sales, October 28, 2026)");
    expect(evaluateReadiness(ctx, computeSubmissionMetrics(ctx), "term_sheet").missing).not.toContain("hm.values_agree");
  });

  it("prints the file's value as the file's when the profile disagrees, warns, and holds the send to a reason", () => {
    const ctx = submissionFixture("fix_flip");
    ctx.profile = { ...ctx.profile!, asIsValueCents: 60_000_000, asIsValueSource: "appraisal", asIsValueAsOf: "2026-11-01" };
    const m = computeSubmissionMetrics(ctx);
    const l = line(email(ctx).text, /As-is value:/);
    expect(l).toContain("As-is value: $790,000 (from the hard money file)");
    expect(l).not.toContain("Appraisal");
    expect(l).not.toContain("November 1, 2026");
    expect(m.warnings.some((w) => w.includes("as-is value on the profile ($600,000) is not the hard money file's ($790,000)"))).toBe(true);
    for (const stage of ["screen", "term_sheet"] as const) expect(evaluateReadiness(ctx, m, stage).missing, stage).toContain("hm.values_agree");
    // The summary labels the two records apart.
    const rows = buildDealSummary(ctx, m, "term_sheet").sections.flatMap((s) => s.rows ?? []);
    expect(rows.filter((r) => r.label === "As-is value").map((r) => r.value)).toEqual(["$600,000 (Appraisal, November 1, 2026)"]);
    expect(rows.find((r) => r.label === "As-is value (hard money file)")).toMatchObject({ value: "$790,000", source: "From the hard money file" });
  });

  it("flags a purchase price that disagrees with the file the same way", () => {
    const ctx = submissionFixture("hard_money");
    ctx.profile = { ...ctx.profile!, purchasePriceCents: (ctx.profile!.purchasePriceCents ?? 0) + 1_000_000 };
    const m = computeSubmissionMetrics(ctx);
    expect(m.warnings.some((w) => w.startsWith("The purchase price on the profile"))).toBe(true);
    expect(evaluateReadiness(ctx, m, "screen").missing).toContain("hm.values_agree");
  });
});
