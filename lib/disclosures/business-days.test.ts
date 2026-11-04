import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeCalendarSet,
  addBusinessDays,
  addCalendarDays,
  businessDaysBetween,
  civilDateOf,
  endOfOfficeDay,
  holidayName,
  holidaysInYear,
  isBusinessDay,
  startOfOfficeDay,
} from "./business-days";

afterEach(() => {
  vi.unstubAllEnvs();
});

const CA_ONLY: [string, string][] = [
  ["2026-02-12", "Lincoln Day"],
  ["2026-03-31", "Cesar Chavez Day"],
  ["2026-04-24", "Genocide Remembrance Day"],
  ["2026-09-09", "Admission Day"],
  ["2026-09-25", "Native American Day"],
  ["2026-11-27", "Day after Thanksgiving"],
];

describe("holiday calendar", () => {
  it.each([
    ["2026-01-01", "New Year's Day"],
    ["2026-01-19", "Martin Luther King Jr. Day"],
    ["2026-02-16", "Washington"],
    ["2026-05-25", "Memorial Day"],
    ["2026-06-19", "Juneteenth"],
    ["2026-07-03", "Independence Day (US federal, observed)"],
    ["2026-09-07", "Labor Day"],
    ["2026-10-12", "Columbus Day"],
    ["2026-11-11", "Veterans Day"],
    ["2026-11-26", "Thanksgiving Day"],
    ["2026-12-25", "Christmas Day"],
  ])("%s is a federal holiday (%s)", (date, name) => {
    expect(holidayName(date)).toContain(name);
    expect(isBusinessDay(date)).toBe(false);
  });

  it("defaults to the strictest calendar (federal only) until counsel approves California holidays", () => {
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "");
    expect(activeCalendarSet()).toBe("federal");
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "1");
    expect(activeCalendarSet()).toBe("federal");
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "true");
    expect(activeCalendarSet()).toBe("federal_ca");
  });

  it.each(CA_ONLY)("%s (%s) is a business day on the default federal-only calendar", (date) => {
    expect(holidayName(date)).toBeUndefined();
    expect(isBusinessDay(date)).toBe(true);
  });

  it.each(CA_ONLY)("%s is a California holiday (%s) when the counsel flag is set", (date, name) => {
    expect(holidayName(date, "federal_ca")).toContain(name);
    expect(isBusinessDay(date, "federal_ca")).toBe(false);
    vi.stubEnv("MLDS_CA_OPTIONAL_HOLIDAYS", "true");
    expect(isBusinessDay(date)).toBe(false);
  });

  it("moves federal Saturday holidays to Friday and Sunday holidays to Monday", () => {
    expect(holidayName("2027-12-24")).toMatch(/Christmas Day \(US federal, observed\)/);
    expect(holidayName("2027-07-05")).toMatch(/Independence Day.*observed/);
  });

  it("observes a Saturday New Year's Day on the prior year's Dec 31", () => {
    expect(holidaysInYear(2021).get("2021-12-31")).toMatch(/New Year's Day \(US federal, observed\)/);
  });

  it("moves California-only Sunday holidays to Monday but not Saturday ones", () => {
    expect(holidayName("2029-09-10", "federal_ca")).toMatch(/Admission Day \(California state, observed\)/);
    // 2029-03-31 is a Saturday: state-only holidays get no Friday observance.
    expect(holidayName("2029-03-30", "federal_ca")).toBeUndefined();
  });

  it("treats ordinary weekdays as business days and weekends as not", () => {
    expect(isBusinessDay("2026-11-02")).toBe(true);
    expect(isBusinessDay("2026-10-31")).toBe(false);
    expect(isBusinessDay("2026-11-01")).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(() => isBusinessDay("2026-02-30")).toThrow(/Invalid civil date/);
    expect(() => isBusinessDay("11/02/2026")).toThrow(/Invalid civil date/);
  });
});

describe("business-day arithmetic", () => {
  it("skips Thanksgiving and the weekend on the default federal calendar", () => {
    expect(addBusinessDays("2026-11-25", 1)).toBe("2026-11-27");
    expect(addBusinessDays("2026-11-25", 3)).toBe("2026-12-01");
  });

  it("also skips the day after Thanksgiving on the California calendar", () => {
    expect(addBusinessDays("2026-11-25", 1, "federal_ca")).toBe("2026-11-30");
    expect(addBusinessDays("2026-11-25", 3, "federal_ca")).toBe("2026-12-02");
  });

  it("never gives a later date on the default calendar than with California holidays", () => {
    for (let d = "2026-01-01"; d <= "2027-12-31"; d = addCalendarDays(d, 1)) {
      expect(addBusinessDays(d, 3) <= addBusinessDays(d, 3, "federal_ca")).toBe(true);
    }
  });

  it("counts from a weekend receipt to the next business days", () => {
    expect(addBusinessDays("2026-10-31", 1)).toBe("2026-11-02");
    expect(addBusinessDays("2026-10-31", 3)).toBe("2026-11-04");
  });

  it("returns the same date for zero days and rejects negatives", () => {
    expect(addBusinessDays("2026-11-02", 0)).toBe("2026-11-02");
    expect(() => addBusinessDays("2026-11-02", -1)).toThrow();
  });

  it("counts business days in a half-open range", () => {
    expect(businessDaysBetween("2026-11-25", "2026-12-01")).toBe(3);
    expect(businessDaysBetween("2026-11-25", "2026-12-02", "federal_ca")).toBe(3);
    expect(businessDaysBetween("2026-11-25", "2026-11-25")).toBe(0);
    expect(businessDaysBetween("2026-12-02", "2026-11-25")).toBe(0);
  });

  it("adds calendar days across month and year ends", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("office time zone", () => {
  it("maps instants to Pacific civil dates", () => {
    expect(civilDateOf(new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
    expect(civilDateOf(new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-02");
    expect(civilDateOf(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30");
  });

  it("computes local midnight and end of day across DST", () => {
    expect(startOfOfficeDay("2026-07-01").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(endOfOfficeDay("2026-12-02").toISOString()).toBe("2026-12-03T07:59:59.999Z");
    // DST ends 2026-11-01 at 02:00 PDT.
    expect(startOfOfficeDay("2026-11-01").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(endOfOfficeDay("2026-11-01").toISOString()).toBe("2026-11-02T07:59:59.999Z");
    // DST starts 2027-03-14 at 02:00 PST.
    expect(endOfOfficeDay("2027-03-14").toISOString()).toBe("2027-03-15T06:59:59.999Z");
  });
});
