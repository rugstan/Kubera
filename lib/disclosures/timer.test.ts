import { describe, expect, it } from "vitest";
import { computeMldsTimer } from "./timer";

// Wed 2026-11-25 10:00 PST; Thanksgiving + day after + weekend follow.
const received = new Date("2026-11-25T18:00:00Z");

describe("MLDS timer", () => {
  it("is due at the end of the third business day after receipt", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, now: received });
    expect(t.receivedOn).toBe("2026-11-25");
    expect(t.thirdBusinessDay).toBe("2026-12-02");
    expect(t.dueAt.toISOString()).toBe("2026-12-03T07:59:59.999Z");
    expect(t.dueReason).toBe("three_business_days");
    expect(t.status).toBe("on_track");
    expect(t.businessDaysElapsed).toBe(0);
  });

  it("warns from the start of business day 2", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-11-30T20:00:00Z") });
    expect(t.status).toBe("on_track");
    expect(t.businessDaysElapsed).toBe(1);
    const w = computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-12-01T08:00:00Z") });
    expect(w.warnAt.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(w.status).toBe("warning");
    expect(w.businessDaysElapsed).toBe(2);
  });

  it("is overdue after the due instant", () => {
    expect(computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-12-03T07:59:59.999Z") }).status).toBe("warning");
    expect(computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-12-03T08:00:00Z") }).status).toBe("overdue");
  });

  it("is due before the borrower becomes obligated when that comes first", () => {
    const obligated = new Date("2026-12-01T20:00:00Z");
    const t = computeMldsTimer({ applicationCompletedAt: received, borrowerObligatedAt: obligated, now: new Date("2026-11-30T21:00:00Z") });
    expect(t.dueAt).toEqual(obligated);
    expect(t.dueReason).toBe("before_obligation");
    expect(t.warnAt.toISOString()).toBe("2026-11-30T20:00:00.000Z");
    expect(t.status).toBe("warning");
  });

  it("ignores an obligation date after the statutory deadline", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, borrowerObligatedAt: new Date("2026-12-20T00:00:00Z"), now: received });
    expect(t.dueReason).toBe("three_business_days");
  });

  it("is satisfied when delivered on time and late when delivered after", () => {
    expect(computeMldsTimer({ applicationCompletedAt: received, deliveredAt: new Date("2026-12-02T23:00:00Z"), now: new Date("2027-01-10T00:00:00Z") }).status).toBe("satisfied");
    expect(computeMldsTimer({ applicationCompletedAt: received, deliveredAt: new Date("2026-12-04T00:00:00Z"), now: new Date("2027-01-10T00:00:00Z") }).status).toBe("late");
  });

  it("uses the Pacific date of receipt across the DST change", () => {
    // Sun 2026-11-01 23:30 PST.
    const t = computeMldsTimer({ applicationCompletedAt: new Date("2026-11-02T07:30:00Z"), now: new Date("2026-11-02T07:30:00Z") });
    expect(t.receivedOn).toBe("2026-11-01");
    expect(t.thirdBusinessDay).toBe("2026-11-04");
    expect(t.dueAt.toISOString()).toBe("2026-11-05T07:59:59.999Z");
  });
});
