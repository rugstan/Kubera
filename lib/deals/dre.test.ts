import { describe, expect, it } from "vitest";
import { annualActivity, annualActivityCsv, re853Data, THRESHOLD_AGGREGATE_CENTS, thresholdCsv, thresholdMonitor, thresholdSnapshot, toCsv, trailingWindow } from "./dre";
import type { ClosedLoan } from "./store";
import type { Deal, DreReport, FeeEntry } from "./types";

const loan = (i: number, closedOn: string, amountCents: number, realProperty = true): ClosedLoan => ({
  dealId: `deal-${i}`,
  title: `Loan ${i}`,
  closedOn,
  loanAmountCents: amountCents,
  collateralRealProperty: realProperty,
  program: "PRIVATE_BRIDGE",
  propertyState: "CA",
});

const loans = (n: number, closedOn: string, amountCents: number) => Array.from({ length: n }, (_, i) => loan(i + 1, closedOn, amountCents));

const pipelineDeal = (i: number, stage: string, amountCents: number, realProperty = true) =>
  ({ id: `open-${i}`, stage, loanAmountCents: amountCents, collateralRealProperty: realProperty, program: "PRIVATE_BRIDGE" }) as Deal;

const broker = { legalName: "Corin Commercial, Inc.", dreLicense: "02234567", address: "100 Market St", designatedOfficer: "Neeli Khanna", officerLicense: "01234567" };

describe("§10232 threshold counter", () => {
  it("uses a 12-month window ending on the as-of date", () => {
    expect(trailingWindow("2026-10-31")).toEqual({ from: "2025-11-01", to: "2026-10-31" });
  });

  it("is not met at 9 loans even with a large aggregate", () => {
    const c = thresholdMonitor({ asOf: "2026-10-31", closed: loans(9, "2026-06-01", 500_000_000), pipeline: [], history: [] });
    expect(c.trailing.count).toBe(9);
    expect(c.thresholdMet).toBe(false);
    expect(c.approaching).toBe(true);
  });

  it("is met at 10 loans aggregating more than $1,000,000, and not at exactly $1,000,000", () => {
    const exactly = thresholdMonitor({ asOf: "2026-10-31", closed: loans(10, "2026-06-01", THRESHOLD_AGGREGATE_CENTS / 10), pipeline: [], history: [] });
    expect(exactly.trailing.aggregateCents).toBe(THRESHOLD_AGGREGATE_CENTS);
    expect(exactly.thresholdMet).toBe(false);

    const over = thresholdMonitor({ asOf: "2026-10-31", closed: [...loans(9, "2026-06-01", 10_000_000), loan(10, "2026-06-02", 10_000_001)], pipeline: [], history: [] });
    expect(over.thresholdMet).toBe(true);
    expect(over.criteria).toEqual({ pastTwelveMonths: true, nextTwelveMonths: false, servicing: false });
    expect(over.firstMetOn).toBe("2026-10-31");
    expect(over.notifyBy).toBe("2026-11-30");
  });

  it("drops loans that closed outside the window and excludes business-asset-only loans (listed for review)", () => {
    const closed = [...loans(9, "2026-06-01", 50_000_000), loan(10, "2025-10-31", 50_000_000), loan(11, "2026-07-01", 50_000_000, false)];
    const c = thresholdMonitor({ asOf: "2026-10-31", closed, pipeline: [], history: [] });
    expect(c.trailing.count).toBe(9);
    expect(c.excludedForReview).toEqual({ count: 1, dealIds: ["deal-11"] });
    expect(c.thresholdMet).toBe(false);
  });

  it("counts the forward pipeline (term sheet onward) for the next-12-months criterion", () => {
    const pipeline = [...Array.from({ length: 10 }, (_, i) => pipelineDeal(i, "underwriting", 20_000_000)), pipelineDeal(99, "intake", 900_000_000), pipelineDeal(98, "commitment", 900_000_000, false)];
    const c = thresholdMonitor({ asOf: "2026-10-31", closed: [], pipeline, history: [] });
    expect(c.forward.count).toBe(10);
    expect(c.forward.aggregateCents).toBe(200_000_000);
    expect(c.criteria.nextTwelveMonths).toBe(true);
    expect(c.thresholdMet).toBe(true);
  });

  it("keeps the first date the threshold was met (notification clock) and sees an RE 853 filing", () => {
    const history = [
      { reportKind: "threshold_monitor", asOf: "2026-09-15", thresholdMet: true, firstMetOn: "2026-09-15", notifiedOn: null },
      { reportKind: "RE853", asOf: "2026-09-20", thresholdMet: true, firstMetOn: "2026-09-15", notifiedOn: "2026-09-20" },
    ] as DreReport[];
    const c = thresholdMonitor({ asOf: "2026-10-31", closed: loans(12, "2026-08-01", 20_000_000), pipeline: [], history });
    expect(c.firstMetOn).toBe("2026-09-15");
    expect(c.notifyBy).toBe("2026-10-15");
    expect(c.notified).toBe(true);
    expect(c.servicing).toEqual({ payments: 0, aggregateCents: 0 });
  });

  it("builds RE 853 data only when met, and a persistable snapshot", () => {
    const notMet = thresholdMonitor({ asOf: "2026-10-31", closed: [], pipeline: [], history: [] });
    expect(re853Data(notMet, broker)).toBeNull();
    const met = thresholdMonitor({ asOf: "2026-10-31", closed: loans(10, "2026-08-01", 20_000_000), pipeline: [], history: [] });
    const d = re853Data(met, broker)!;
    expect(d.criteriaMet).toHaveLength(1);
    expect(d.note).toMatch(/does not service loans/);
    const snap = thresholdSnapshot(met, "system:dre");
    expect(snap).toMatchObject({ reportKind: "threshold_monitor", asOf: "2026-10-31", periodStart: "2025-11-01", thresholdMet: true, notifyBy: "2026-11-30" });
    expect(thresholdCsv(met).split("\r\n")[1]).toBe("2026-10-31,2025-11-01,2026-10-31,10,2000000.00,0,0.00,0,yes,2026-10-31,2026-11-30");
  });
});

describe("annual RE 860 / RE 881 data", () => {
  it("lists the year's closed loans with Corin's compensation from the ledger", () => {
    const closed = [loan(1, "2026-02-01", 300_000_000), loan(2, "2026-05-01", 150_000_000, false), loan(3, "2025-12-31", 1)];
    const fee = (dealId: string, payer: "borrower" | "lender", amountCents: number, status: FeeEntry["status"] = "settled") => ({ dealId, payer, payee: "corin", amountCents, status }) as FeeEntry;
    const ledgers = new Map([
      ["deal-1", [fee("deal-1", "borrower", 3_000_000), fee("deal-1", "lender", 1_000_000), fee("deal-1", "borrower", 999, "void")]],
      ["deal-2", [fee("deal-2", "lender", 750_000)]],
    ]);
    const d = annualActivity("RE881", 2026, closed, ledgers, broker);
    expect(d.loans.map((l) => l.dealId)).toEqual(["deal-1", "deal-2"]);
    expect(d.loans[0]).toMatchObject({ compensationCents: 4_000_000, compensationFromBorrowerCents: 3_000_000, compensationFromLenderCents: 1_000_000 });
    expect(d.totals).toMatchObject({ count: 2, aggregateCents: 450_000_000, realPropertyCount: 1, compensationCents: 4_750_000 });
    expect(d.trustFunds).toBe("none");
    const csv = annualActivityCsv(d).split("\r\n");
    expect(csv[0]).toContain("broker_compensation_usd");
    expect(csv[1]).toBe("RE881,2026,deal-1,Loan 1,2026-02-01,Private bridge,CA,3000000.00,yes,40000.00,30000.00,10000.00");
  });

  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    expect(toCsv(["a"], [["=HYPERLINK(1)"], ['x,"y"']])).toBe("a\r\n'=HYPERLINK(1)\r\n\"x,\"\"y\"\"\"\r\n");
  });
});
