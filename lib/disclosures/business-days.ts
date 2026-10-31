// Business-day calendar for disclosure clocks (MLDS: B&P §10240, 3 business days).
//
// A business day is Monday–Friday that is neither a US federal holiday
// (5 U.S.C. §6103) nor a California state holiday (Gov. Code §6700), counted in
// Kubera's licensed-office time zone. Dates are handled as civil dates
// ("YYYY-MM-DD") so DST and server time zones never shift a deadline.
//
// VERIFY (counsel gate A, open question 5): which holiday calendar the DRE
// applies to "business days" under §10240, and whether optional California
// holidays (Lincoln Day, Admission Day, Genocide Remembrance Day) count. The
// list is data so counsel's answer is a one-line change.

export const OFFICE_TIME_ZONE = "America/Los_Angeles";

/** Civil date in ISO form, e.g. "2026-11-02". */
export type CivilDate = string;

type Rule =
  | { kind: "fixed"; month: number; day: number; name: string }
  | { kind: "nth"; month: number; weekday: number; n: number; name: string } // n = -1 → last
  | { kind: "afterNth"; month: number; weekday: number; n: number; offsetDays: number; name: string };

type Calendar = { name: string; rules: Rule[]; saturdayToFriday: boolean; sundayToMonday: boolean };

// 5 U.S.C. §6103. A Saturday holiday is observed the Friday before, a Sunday
// holiday the Monday after.
const FEDERAL: Calendar = {
  name: "US federal",
  saturdayToFriday: true,
  sundayToMonday: true,
  rules: [
    { kind: "fixed", month: 1, day: 1, name: "New Year's Day" },
    { kind: "nth", month: 1, weekday: 1, n: 3, name: "Martin Luther King Jr. Day" },
    { kind: "nth", month: 2, weekday: 1, n: 3, name: "Washington's Birthday" },
    { kind: "nth", month: 5, weekday: 1, n: -1, name: "Memorial Day" },
    { kind: "fixed", month: 6, day: 19, name: "Juneteenth" },
    { kind: "fixed", month: 7, day: 4, name: "Independence Day" },
    { kind: "nth", month: 9, weekday: 1, n: 1, name: "Labor Day" },
    { kind: "nth", month: 10, weekday: 1, n: 2, name: "Columbus Day" },
    { kind: "fixed", month: 11, day: 11, name: "Veterans Day" },
    { kind: "nth", month: 11, weekday: 4, n: 4, name: "Thanksgiving Day" },
    { kind: "fixed", month: 12, day: 25, name: "Christmas Day" },
  ],
};

// Gov. Code §6700 (VERIFY: as amended through 2026). Sunday holidays move to
// the following Monday; Saturday holidays are not moved for state purposes
// (the federal calendar already covers the Friday for shared holidays).
const CALIFORNIA: Calendar = {
  name: "California state",
  saturdayToFriday: false,
  sundayToMonday: true,
  rules: [
    { kind: "fixed", month: 1, day: 1, name: "New Year's Day" },
    { kind: "nth", month: 1, weekday: 1, n: 3, name: "Martin Luther King Jr. Day" },
    { kind: "fixed", month: 2, day: 12, name: "Lincoln Day" },
    { kind: "nth", month: 2, weekday: 1, n: 3, name: "Washington Day" },
    { kind: "fixed", month: 3, day: 31, name: "Cesar Chavez Day" },
    { kind: "fixed", month: 4, day: 24, name: "Genocide Remembrance Day" },
    { kind: "nth", month: 5, weekday: 1, n: -1, name: "Memorial Day" },
    { kind: "fixed", month: 7, day: 4, name: "Independence Day" },
    { kind: "nth", month: 9, weekday: 1, n: 1, name: "Labor Day" },
    { kind: "fixed", month: 9, day: 9, name: "Admission Day" },
    { kind: "nth", month: 9, weekday: 5, n: 4, name: "Native American Day" },
    { kind: "nth", month: 10, weekday: 1, n: 2, name: "Indigenous Peoples Day" },
    { kind: "fixed", month: 11, day: 11, name: "Veterans Day" },
    { kind: "nth", month: 11, weekday: 4, n: 4, name: "Thanksgiving Day" },
    { kind: "afterNth", month: 11, weekday: 4, n: 4, offsetDays: 1, name: "Day after Thanksgiving" },
    { kind: "fixed", month: 12, day: 25, name: "Christmas Day" },
  ],
};

export const HOLIDAY_CALENDARS: readonly Calendar[] = [FEDERAL, CALIFORNIA];

// ---------------------------------------------------------------------------
// Civil-date arithmetic (UTC-based so the host time zone never matters)

function parse(date: CivilDate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid civil date: ${date}`);
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error(`Invalid civil date: ${date}`);
  return d;
}

function format(d: Date): CivilDate {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDays(date: CivilDate, days: number): CivilDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: CivilDate): number {
  return parse(date).getUTCDay();
}

function nthWeekday(year: number, month: number, weekdayNum: number, n: number): CivilDate {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const shift = (weekdayNum - first.getUTCDay() + 7) % 7;
    first.setUTCDate(1 + shift + (n - 1) * 7);
    return format(first);
  }
  const last = new Date(Date.UTC(year, month, 0));
  const shift = (last.getUTCDay() - weekdayNum + 7) % 7;
  last.setUTCDate(last.getUTCDate() - shift);
  return format(last);
}

function ruleDate(rule: Rule, year: number): CivilDate {
  switch (rule.kind) {
    case "fixed":
      return format(new Date(Date.UTC(year, rule.month - 1, rule.day)));
    case "nth":
      return nthWeekday(year, rule.month, rule.weekday, rule.n);
    case "afterNth":
      return addCalendarDays(nthWeekday(year, rule.month, rule.weekday, rule.n), rule.offsetDays);
  }
}

const cache = new Map<number, Map<CivilDate, string>>();

/** Every non-business holiday date (actual and observed) that falls in `year`. */
export function holidaysInYear(year: number): Map<CivilDate, string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const out = new Map<CivilDate, string>();
  // Include neighbouring years so a Saturday Jan 1 observed on Dec 31 lands.
  for (const y of [year - 1, year, year + 1]) {
    for (const cal of HOLIDAY_CALENDARS) {
      for (const rule of cal.rules) {
        const actual = ruleDate(rule, y);
        const dow = weekday(actual);
        const observed =
          dow === 6 && cal.saturdayToFriday ? addCalendarDays(actual, -1) : dow === 0 && cal.sundayToMonday ? addCalendarDays(actual, 1) : actual;
        for (const d of new Set([actual, observed])) {
          if (d.startsWith(`${year}-`) && !out.has(d)) out.set(d, `${rule.name} (${cal.name}${d === actual ? "" : ", observed"})`);
        }
      }
    }
  }
  cache.set(year, out);
  return out;
}

export function holidayName(date: CivilDate): string | undefined {
  return holidaysInYear(Number(date.slice(0, 4))).get(date);
}

export function isBusinessDay(date: CivilDate): boolean {
  const dow = weekday(date);
  return dow !== 0 && dow !== 6 && !holidayName(date);
}

/** The `n`th business day strictly after `date` (n ≥ 1). */
export function addBusinessDays(date: CivilDate, n: number): CivilDate {
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer");
  let d = date;
  let left = n;
  while (left > 0) {
    d = addCalendarDays(d, 1);
    if (isBusinessDay(d)) left -= 1;
  }
  return d;
}

/** Business days in the half-open range (from, to]; 0 when `to` ≤ `from`. */
export function businessDaysBetween(from: CivilDate, to: CivilDate): number {
  let count = 0;
  for (let d = addCalendarDays(from, 1); d <= to; d = addCalendarDays(d, 1)) if (isBusinessDay(d)) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// Instants ↔ office civil dates

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Civil date of `instant` in the office time zone. */
export function civilDateOf(instant: Date, timeZone = OFFICE_TIME_ZONE): CivilDate {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant of local wall-clock time `hh:mm:ss.mmm` on `date` in `timeZone`. */
export function zonedInstant(date: CivilDate, time: { h: number; m: number; s: number; ms: number }, timeZone = OFFICE_TIME_ZONE): Date {
  const d = parse(date);
  const wall = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), time.h, time.m, time.s, time.ms);
  let guess = wall - offsetMs(new Date(wall), timeZone);
  // Second pass settles DST boundaries.
  guess = wall - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function endOfOfficeDay(date: CivilDate, timeZone = OFFICE_TIME_ZONE): Date {
  return zonedInstant(date, { h: 23, m: 59, s: 59, ms: 999 }, timeZone);
}

export function startOfOfficeDay(date: CivilDate, timeZone = OFFICE_TIME_ZONE): Date {
  return zonedInstant(date, { h: 0, m: 0, s: 0, ms: 0 }, timeZone);
}
