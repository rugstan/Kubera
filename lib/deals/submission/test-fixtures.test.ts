// The shared fixtures are what every builder tests against, so they must be
// internally consistent and safe to render into an email or summary.

import { describe, expect, it } from "vitest";
import { checkSummaryCopy } from "@/lib/agents/lenders/package";
import { isPlaybookAllowed, isIncomeProperty, programDetailKeysFor, playbookTrancheSource, SHORT_TERM_PLAYBOOKS } from "./playbooks";
import { allSubmissionFixtures, emptyProfileContext, emptySubmissionContext, SUBMISSION_FIXTURE_NOW } from "./test-fixtures";
import { creditEventKinds, PFS_MAX_AGE_DAYS, programDetailKeys, SUBMISSION_TEXT_LIMITS, submissionPlaybooks, type SubmissionContext } from "./types";

const DAY = 86_400_000;
const fixtures = allSubmissionFixtures();
const sum = (lines: readonly { amountCents: number }[]) => lines.reduce((s, l) => s + l.amountCents, 0);

/** Every string staff typed that an email or summary may print. */
function freeText(ctx: SubmissionContext): string[] {
  const p = ctx.profile!;
  const s = ctx.sponsor!;
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([p.closeDriver, p.prepayPreference, p.existingLender, p.cashOutUse, p.propertyName, p.businessPlan, p.exitDetail, p.highlights, p.risks, p.sources, p.uses, p.programDetails]);
  walk([s.experienceSummary, s.portfolioSizeNote, s.managementCompany, s.notes]);
  walk([ctx.deal.title, ctx.vaultDocuments.map((d) => d.fileName)]);
  return strings.filter((t) => t.length > 0);
}

describe("shared submission fixtures", () => {
  it("cover every playbook once", () => {
    expect(fixtures.map(([p]) => p)).toEqual([...submissionPlaybooks]);
  });

  it("return fresh objects on every call", () => {
    const [, a] = allSubmissionFixtures()[0]!;
    const [, b] = allSubmissionFixtures()[0]!;
    a.profile!.highlights.push("changed");
    a.sponsor!.creditEvents.bankruptcy!.occurred = true;
    a.principals[1]!.owes.push("form_1919");
    expect(b.profile!.highlights).not.toContain("changed");
    expect(b.sponsor!.creditEvents.bankruptcy!.occurred).toBe(false);
    expect(b.principals[1]!.owes).not.toContain("form_1919");
  });

  describe.each(fixtures)("%s", (playbook, ctx) => {
    const p = ctx.profile!;
    const loan = ctx.deal.loanAmountCents!;

    it("uses a playbook its deal program allows", () => {
      expect(p.playbook).toBe(playbook);
      expect(isPlaybookAllowed(ctx.deal.program, playbook)).toBe(true);
      expect(ctx.profile!.dealId).toBe(ctx.deal.id);
      expect(ctx.sponsor!.dealId).toBe(ctx.deal.id);
    });

    it("balances sources and uses, and the tranche line equals the loan", () => {
      expect(p.sources.length).toBeGreaterThan(0);
      expect(p.uses.length).toBeGreaterThan(0);
      expect(sum(p.sources)).toBe(sum(p.uses));
      expect(sum(p.sources.filter((l) => l.kind === playbookTrancheSource[playbook]))).toBe(loan);
      for (const l of [...p.sources, ...p.uses]) {
        expect(Number.isInteger(l.amountCents)).toBe(true);
        expect(l.amountCents).toBeGreaterThan(0);
      }
    });

    it("keeps the loan request, value and financials coherent", () => {
      if (p.requestedIoMonths !== null && p.requestedTermMonths !== null) expect(p.requestedIoMonths).toBeLessThanOrEqual(p.requestedTermMonths);
      if (p.noiInPlaceCents !== null) expect(p.revenueCents! - p.expensesCents!).toBe(p.noiInPlaceCents);
      if (ctx.spreads?.underwrittenNoiCents) expect(ctx.spreads.revenueCents! - ctx.spreads.expensesCents!).toBe(ctx.spreads.underwrittenNoiCents);
      if (ctx.spreads?.noiCents) expect(ctx.spreads.noiCents).toBe(p.noiInPlaceCents);
      if (p.purpose === "acquisition") expect(p.purchasePriceCents).toBeGreaterThan(0);
      else expect(p.asIsValueCents !== null && p.asIsValueSource !== null && p.asIsValueAsOf !== null).toBe(true);
      if (["refinance", "cash_out_refinance"].includes(p.purpose ?? "")) {
        expect(p.existingLender && p.existingDebtCents && p.existingMaturityDate).toBeTruthy();
        expect(p.existingMaturityDate! >= p.targetCloseDate!).toBe(true);
      }
      if ((p.cashOutCents ?? 0) > 0) expect(sum(p.uses.filter((u) => u.kind === "cash_out"))).toBe(p.cashOutCents);
      if (SHORT_TERM_PLAYBOOKS.includes(playbook)) expect(p.stabilizedValueCents !== null && p.stabilizedValueSource !== null && p.exitMonths !== null).toBe(true);
      if (isIncomeProperty(playbook, p)) {
        expect(p.noiInPlaceCents).not.toBeNull();
        expect(p.occupancyPct !== null && p.occupancyAsOf !== null).toBe(true);
        expect(p.assumedRatePct !== null && p.assumedAmortMonths !== null).toBe(true);
        expect(ctx.vaultDocuments.some((d) => d.kind === "T12")).toBe(true);
      }
    });

    it("answers exactly the program sections the playbook shows", () => {
      const shown = programDetailKeysFor(playbook, p);
      for (const key of shown) expect(p.programDetails[key], key).toBeDefined();
      for (const key of programDetailKeys) if (!shown.includes(key)) expect(p.programDetails[key], key).toBeUndefined();
      const budget = p.programDetails.construction?.budget;
      if (budget) expect(Object.values(budget).reduce((s, v) => s + v, 0)).toBe(sum(p.uses));
      if (ctx.spreadFigures.constructionBudget) expect(ctx.spreadFigures.constructionBudget.totalCents).toBe(sum(p.uses));
      const hotel = p.programDetails.hotel;
      if (hotel) expect(Math.abs(hotel.revparCents! - (hotel.adrCents! * p.occupancyPct!) / 100)).toBeLessThan(hotel.revparCents! * 0.01);
    });

    it("has a hard money file only where the playbook runs on one, and it matches the profile", () => {
      expect(ctx.hardMoney !== null).toBe(playbook === "hard_money" || playbook === "fix_flip");
      if (!ctx.hardMoney) return;
      expect(ctx.hardMoney.metrics.flags).toEqual([]);
      expect(ctx.hardMoney.requestedLoanAmount * 100).toBe(loan);
      expect(ctx.hardMoney.metrics.totalCost * 100).toBe(sum(p.uses));
      expect(ctx.hardMoney.arv * 100).toBe(p.stabilizedValueCents);
      expect(ctx.hardMoney.purchasePrice * 100).toBe(p.purchasePriceCents);
    });

    it("has a sponsor with fresh PFS for every backer and every credit event answered", () => {
      const s = ctx.sponsor!;
      expect((s.experienceSummary ?? "").length).toBeGreaterThanOrEqual(80);
      expect(s.statedAsOf).not.toBeNull();
      expect(s.creditBand).not.toBeNull();
      for (const k of creditEventKinds) expect(s.creditEvents[k]?.occurred).toBe(false);
      const t = ctx.guarantorTotals!;
      expect(t.pfsCount).toBe(t.guarantorCount);
      expect(t.guarantorCount).toBeGreaterThan(0);
      expect((SUBMISSION_FIXTURE_NOW.getTime() - Date.parse(`${t.oldestPfsAsOf}T00:00:00Z`)) / DAY).toBeLessThanOrEqual(PFS_MAX_AGE_DAYS);
      expect(ctx.principals.filter((x) => x.roles.includes("borrower_entity"))).toHaveLength(1);
      expect(ctx.principals.find((x) => x.roles.includes("borrower_entity"))!.legalName).toBe(ctx.deal.borrowerName);
      for (const x of ctx.principals) if (x.kind === "individual") expect(x.hasPfs && x.hasReoSchedule && x.hasCreditAuthorization).toBe(true);
    });

    it("lists checklist items once each, with the per-principal items for the principals that owe them", () => {
      const ids = ctx.checklistItems.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ctx.checklistItems.map((i) => i.itemKey)).size).toBe(ids.length);
      for (const i of ctx.checklistItems) if (i.principalId) expect(ctx.principals.find((x) => x.id === i.principalId)?.owes.length).toBeGreaterThan(0);
    });

    it("keeps free text plausible, within limits and safe to print", () => {
      expect((p.businessPlan ?? "").length).toBeGreaterThanOrEqual(200);
      expect(p.risks.every((r) => r.risk && r.mitigant)).toBe(true);
      for (const [key, max] of Object.entries(SUBMISSION_TEXT_LIMITS)) {
        const v = (p as Record<string, unknown>)[key] ?? (ctx.sponsor as Record<string, unknown>)[key];
        if (typeof v === "string") expect(v.length, key).toBeLessThanOrEqual(max);
      }
      const texts = freeText(ctx);
      expect(() => checkSummaryCopy(texts)).not.toThrow();
      const surnames = ctx.principals.filter((x) => x.kind === "individual").map((x) => x.legalName.split(" ").at(-1)!.toLowerCase());
      for (const t of texts) {
        expect(t).not.toMatch(/[0-9]{3}-[0-9]{2}-[0-9]{4}/);
        expect(t).not.toMatch(/[0-9]{9,}/);
        expect(t).not.toMatch(/\b(dob|born|date of birth|routing|account #)\b/i);
        for (const name of surnames) expect(t.toLowerCase(), `"${t}" names a principal`).not.toContain(name);
      }
    });
  });

  it("the empty contexts carry no facts", () => {
    const empty = emptySubmissionContext();
    expect(empty.profile).toBeNull();
    expect(empty.sponsor).toBeNull();
    expect(empty.deal.loanAmountCents).toBeNull();
    expect(empty.principals).toEqual([]);
    for (const pb of submissionPlaybooks) {
      const ctx = emptyProfileContext(pb);
      expect(ctx.profile!.playbook).toBe(pb);
      expect(isPlaybookAllowed(ctx.deal.program, pb)).toBe(true);
      expect(Object.entries(ctx.profile!).filter(([, v]) => typeof v === "number" && v !== 1)).toEqual([]);
      expect(ctx.profile!.sources).toEqual([]);
      expect(ctx.profile!.programDetails).toEqual({});
    }
  });
});
