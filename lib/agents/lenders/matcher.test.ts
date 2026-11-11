import { describe, expect, it } from "vitest";
import type { LenderOutreach } from "@/lib/deals/types";
import { fallbackSuggestions, knockouts, lenderStats, matchLenders } from "./matcher";
import { NOW, creditBox, panelLender, profile } from "./test-fixtures";

const outreach = (lenderId: string, status: LenderOutreach["status"]): LenderOutreach => ({
  id: `o-${lenderId}-${status}-${Math.random()}`,
  dealId: "other-deal",
  lenderId,
  packageId: "p",
  packageVersion: 1,
  shareLinkId: "s",
  status,
  approvalKey: `k-${Math.random()}`,
  approvalId: null,
  approvedBy: null,
  requestedBy: "broker:ana",
  sentAt: NOW.toISOString(),
  externalMessageId: null,
  responseNote: null,
  termSheetRef: null,
  staleLenderOverride: false,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

describe("knockouts", () => {
  it("lists every limit the deal breaks, in plain words", () => {
    const fails = knockouts(
      creditBox({ states: ["AZ", "NV"], maxLtvPct: 70, minDscr: 1.5, maxLoanCents: 1_000_000_000, assetClasses: ["HOSPITALITY"], recourse: "full" }),
      profile({ ltvPct: 75, dscr: 1.3, requiresNonRecourse: true, lienPosition: "second" }),
    );
    expect(fails).toEqual([
      "Loan $12,500,000 is over the $10,000,000 maximum",
      "Does not lend in CA",
      "No appetite for senior living & care",
      "LTV 75% exceeds the 70% maximum",
      "DSCR 1.30x is below the 1.50x minimum",
      "Does not take a second lien",
      "Requires full recourse; the borrower needs non-recourse",
    ]);
  });

  it("does not test metrics the deal has not supplied", () => {
    expect(knockouts(creditBox(), profile({ ltvPct: null, dscr: null, propertyState: null, assetClass: null }))).toEqual([]);
  });
});

describe("matchLenders", () => {
  const lenders = [
    panelLender(),
    panelLender({ id: "lender-2", name: "Greystone", brokerFriendly: false, feeSplitKind: "none", feeAgreementRef: null }),
    panelLender({ id: "lender-3", name: "Lument", programs: ["HUD_MULTIFAMILY"] }),
    panelLender({ id: "lender-4", name: "Inactive Capital", active: false }),
  ];

  it("ranks eligible lenders with reasons, and explains every exclusion", () => {
    const boxes = [
      creditBox(),
      creditBox({ id: "box-2", lenderId: "lender-2", maxLtvPct: 75, minDscr: 1.5, verifiedAt: "2026-03-01T00:00:00.000Z" }),
      creditBox({ id: "box-3", lenderId: "lender-3" }),
      creditBox({ id: "box-4", lenderId: "lender-4" }),
      creditBox({ id: "box-5", lenderId: "lender-1", status: "pending_review", maxLtvPct: 95 }),
      creditBox({ id: "box-6", lenderId: "lender-2", programs: ["HUD_232"], states: ["TX"] }),
    ];
    const r = matchLenders({ profile: profile(), boxes, lenders, now: NOW });
    expect(r.usedFallback).toBe(false);
    expect(r.ranked.map((c) => c.lender.name)).toEqual(["Cambridge Realty Capital", "Greystone"]);
    const [top, second] = r.ranked;
    expect(top!.score).toBeGreaterThan(second!.score);
    expect(top!.reasons).toEqual(expect.arrayContaining(["LTV 72% within 80%", "DSCR 1.60x clears 1.45x", "Broker-friendly", "Fee agreement on file"]));
    expect(second!.warnings.join(" ")).toMatch(/Last verified \d+ days ago/);
    expect(second!.box.id).toBe("box-2"); // the TX-only box was knocked out; the CA box matched
    expect(r.excluded.map((e) => [e.lender?.name, e.failures])).toEqual([
      ["Lument", ["Panel record has no appetite for this program (update the panel)"]],
      ["Inactive Capital", ["Lender is inactive on the panel"]],
    ]);
  });

  it("uses only approved boxes", () => {
    const r = matchLenders({ profile: profile(), boxes: [creditBox({ status: "pending_review" })], lenders, now: NOW });
    expect(r.ranked).toEqual([]);
    expect(r.usedFallback).toBe(true);
  });

  it("rewards past term sheets and headroom", () => {
    const boxes = [creditBox(), creditBox({ id: "box-2", lenderId: "lender-2" })];
    const plain = matchLenders({ profile: profile(), boxes, lenders: [panelLender(), panelLender({ id: "lender-2", name: "Greystone" })], now: NOW });
    expect(plain.ranked[0]!.score).toBe(plain.ranked[1]!.score);
    const history = [outreach("lender-2", "term_sheet"), outreach("lender-2", "term_sheet"), outreach("lender-1", "declined"), outreach("lender-1", "pending_approval")];
    const ranked = matchLenders({ profile: profile(), boxes, lenders: [panelLender(), panelLender({ id: "lender-2", name: "Greystone" })], outreach: history, now: NOW }).ranked;
    expect(ranked[0]!.lender.name).toBe("Greystone");
    expect(ranked[0]!.reasons).toContain("2 term sheets from 2 submissions");
    expect(lenderStats(history).get("lender-1")).toEqual({ submissions: 1, termSheets: 0 });

    const tight = matchLenders({ profile: profile({ ltvPct: 79.5, dscr: 1.46 }), boxes: [creditBox()], lenders, now: NOW }).ranked[0]!;
    const roomy = matchLenders({ profile: profile({ ltvPct: 65, dscr: 1.9 }), boxes: [creditBox()], lenders, now: NOW }).ranked[0]!;
    expect(roomy.score).toBeGreaterThan(tight.score);
  });

  it("lists metrics it could not test", () => {
    const r = matchLenders({ profile: profile({ ltvPct: null, dscr: null }), boxes: [creditBox()], lenders, now: NOW });
    expect(r.untested).toEqual(["LTV", "DSCR"]);
    expect(r.ranked).toHaveLength(1);
  });

  it("warns about non-exempt lenders and missing contacts", () => {
    const r = matchLenders({ profile: profile(), boxes: [creditBox()], lenders: [panelLender({ category: "PRIVATE_NON_EXEMPT", contactEmail: null })], now: NOW });
    expect(r.ranked[0]!.warnings.join(" ")).toMatch(/usury gate applies/);
    expect(r.ranked[0]!.warnings.join(" ")).toMatch(/No primary contact email or submission inbox on the panel record/);
  });

  it("falls back to the static routing table when no approved box covers the program", () => {
    const r = matchLenders({ profile: profile({ program: "HOTEL_CMBS", assetClass: "HOSPITALITY" }), boxes: [creditBox()], lenders: [...lenders, panelLender({ id: "rc", name: "Ready Capital", programs: ["HOTEL_CMBS"] })], now: NOW });
    expect(r.usedFallback).toBe(true);
    expect(r.ranked).toEqual([]);
    expect(r.fallback.map((f) => [f.name, f.lender?.id ?? null])).toEqual([
      ["Ready Capital", "rc"],
      ["Greystone", "lender-2"],
    ]);
  });
});

describe("fallbackSuggestions", () => {
  it("resolves routing codes to readable names even when the lender is not on the panel", () => {
    const s = fallbackSuggestions("SBA_504", []);
    expect(s.map((x) => x.name)).toEqual(["Tmc Financing CDC", "Vium Capital", "Liberty SBF", "Harvest SBF", "Ready Capital"]);
    expect(s.every((x) => x.lender === null && /not on the lender panel/.test(x.reason))).toBe(true);
    expect(fallbackSuggestions("BANK_LIFE_CO", [])).toEqual([]);
  });
});
