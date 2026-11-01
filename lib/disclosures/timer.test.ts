import { afterEach, describe, expect, it, vi } from "vitest";
import { computeMldsTimer } from "./timer";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Wed 2026-11-25 10:00 PST; Thanksgiving and the weekend follow. Until counsel
// rules on optional California holidays (open question 5) the clock runs on the
// strictest, federal-only calendar, so Fri 11-27 is business day 1.
const received = new Date("2026-11-25T18:00:00Z");

describe("MLDS timer", () => {
  it("is due at the end of the third business day after receipt", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, now: received });
    expect(t.receivedOn).toBe("2026-11-25");
    expect(t.thirdBusinessDay).toBe("2026-12-01");
    expect(t.dueAt.toISOString()).toBe("2026-12-02T07:59:59.999Z");
    expect(t.dueReason).toBe("three_business_days");
    expect(t.status).toBe("on_track");
    expect(t.businessDaysElapsed).toBe(0);
  });

  it.each([
    // Lincoln Day (Feb 12) is a California-only holiday; Presidents Day (Feb 16) is federal.
    ["2026-02-11T18:00:00Z", "2026-02-17", "2026-02-18"],
    // The day after Thanksgiving is a California-only holiday.
    ["2026-11-25T18:00:00Z", "2026-12-01", "2026-12-02"],
    // Genocide Remembrance Day (Apr 24) and Admission Day (Sep 9) are California-only.
    ["2026-04-22T18:00:00Z", "2026-04-27", "2026-04-28"],
    ["2026-09-08T18:00:00Z", "2026-09-11", "2026-09-14"],
  ])("uses the strictest calendar by default: received %s is due %s (with CA holidays: %s)", (at, strict, withCa) => {
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "");
    expect(computeMldsTimer({ applicationCompletedAt: new Date(at), now: new Date(at) }).thirdBusinessDay).toBe(strict);
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "true");
    expect(computeMldsTimer({ applicationCompletedAt: new Date(at), now: new Date(at) }).thirdBusinessDay).toBe(withCa);
  });

  it("flags the MLDS overdue on the strict deadline even though the California reading is later", () => {
    const now = new Date("2026-02-18T20:00:00Z");
    expect(computeMldsTimer({ applicationCompletedAt: new Date("2026-02-11T18:00:00Z"), now }).status).toBe("overdue");
  });

  it("warns from the start of business day 2", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-11-27T20:00:00Z") });
    expect(t.status).toBe("on_track");
    expect(t.businessDaysElapsed).toBe(1);
    const w = computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-11-30T08:00:00Z") });
    expect(w.warnAt.toISOString()).toBe("2026-11-30T08:00:00.000Z");
    expect(w.status).toBe("warning");
    expect(w.businessDaysElapsed).toBe(2);
  });

  it("is overdue after the due instant", () => {
    expect(computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-12-02T07:59:59.999Z") }).status).toBe("warning");
    expect(computeMldsTimer({ applicationCompletedAt: received, now: new Date("2026-12-02T08:00:00Z") }).status).toBe("overdue");
  });

  it("is due before the borrower becomes obligated when that comes first", () => {
    const obligated = new Date("2026-11-30T20:00:00Z");
    const t = computeMldsTimer({ applicationCompletedAt: received, borrowerObligatedAt: obligated, now: new Date("2026-11-29T21:00:00Z") });
    expect(t.dueAt).toEqual(obligated);
    expect(t.dueReason).toBe("before_obligation");
    expect(t.warnAt.toISOString()).toBe("2026-11-29T20:00:00.000Z");
    expect(t.status).toBe("warning");
  });

  it("ignores an obligation date after the statutory deadline", () => {
    const t = computeMldsTimer({ applicationCompletedAt: received, borrowerObligatedAt: new Date("2026-12-20T00:00:00Z"), now: received });
    expect(t.dueReason).toBe("three_business_days");
  });

  it("is satisfied when delivered on time and late when delivered after", () => {
    expect(computeMldsTimer({ applicationCompletedAt: received, deliveredAt: new Date("2026-12-01T23:00:00Z"), now: new Date("2027-01-10T00:00:00Z") }).status).toBe("satisfied");
    expect(computeMldsTimer({ applicationCompletedAt: received, deliveredAt: new Date("2026-12-02T09:00:00Z"), now: new Date("2027-01-10T00:00:00Z") }).status).toBe("late");
  });

  it("uses the Pacific date of receipt across the DST change", () => {
    // Sun 2026-11-01 23:30 PST.
    const t = computeMldsTimer({ applicationCompletedAt: new Date("2026-11-02T07:30:00Z"), now: new Date("2026-11-02T07:30:00Z") });
    expect(t.receivedOn).toBe("2026-11-01");
    expect(t.thirdBusinessDay).toBe("2026-11-04");
    expect(t.dueAt.toISOString()).toBe("2026-11-05T07:59:59.999Z");
  });
});
