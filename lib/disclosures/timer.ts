// MLDS delivery clock (B&P §10240; counsel gate A).
//
// The clock starts when Corin receives a completed written loan application.
// The MLDS is due by the EARLIER of (a) the end of the third business day after
// receipt or (b) the moment the borrower becomes obligated on the note. Staff
// are warned from the start of business day 2.
//
// Business days follow the strictest calendar (federal holidays only) until
// counsel rules on optional California holidays and sets
// MLDS_CA_OPTIONAL_HOLIDAYS=true; see ./business-days.ts.

import { addBusinessDays, businessDaysBetween, civilDateOf, endOfOfficeDay, startOfOfficeDay, type CivilDate } from "./business-days";

export const MLDS_BUSINESS_DAYS = 3;
export const MLDS_WARN_BUSINESS_DAY = 2;
/** Also warn when the borrower is scheduled to become obligated within this window. */
export const OBLIGATION_WARN_MS = 24 * 60 * 60 * 1000;

export type MldsTimerInput = {
  /** When Corin received the completed written loan application. */
  applicationCompletedAt: Date;
  /** When the borrower is (or is scheduled to be) obligated on the note, if known. */
  borrowerObligatedAt?: Date | null;
  /** When the MLDS was delivered to the borrower (sent for signature), if it was. */
  deliveredAt?: Date | null;
  now: Date;
};

export type MldsTimerStatus = "on_track" | "warning" | "overdue" | "satisfied" | "late";

export type MldsTimer = {
  receivedOn: CivilDate;
  /** Last business day of the 3-business-day window. */
  thirdBusinessDay: CivilDate;
  dueAt: Date;
  dueReason: "three_business_days" | "before_obligation";
  warnAt: Date;
  status: MldsTimerStatus;
  /** Business days elapsed since receipt (receipt day = 0), capped at the due date's count when delivered. */
  businessDaysElapsed: number;
};

export function computeMldsTimer(input: MldsTimerInput): MldsTimer {
  const { applicationCompletedAt, borrowerObligatedAt, deliveredAt, now } = input;
  const receivedOn = civilDateOf(applicationCompletedAt);
  const thirdBusinessDay = addBusinessDays(receivedOn, MLDS_BUSINESS_DAYS);
  const statutoryDue = endOfOfficeDay(thirdBusinessDay);

  const obligationFirst = borrowerObligatedAt != null && borrowerObligatedAt.getTime() < statutoryDue.getTime();
  const dueAt = obligationFirst ? borrowerObligatedAt : statutoryDue;
  const dueReason = obligationFirst ? "before_obligation" : "three_business_days";

  const businessDayWarn = startOfOfficeDay(addBusinessDays(receivedOn, MLDS_WARN_BUSINESS_DAY));
  const obligationWarn = borrowerObligatedAt ? new Date(borrowerObligatedAt.getTime() - OBLIGATION_WARN_MS) : null;
  const warnAt = obligationWarn && obligationWarn.getTime() < businessDayWarn.getTime() ? obligationWarn : businessDayWarn;

  let status: MldsTimerStatus;
  if (deliveredAt) status = deliveredAt.getTime() <= dueAt.getTime() ? "satisfied" : "late";
  else if (now.getTime() > dueAt.getTime()) status = "overdue";
  else if (now.getTime() >= warnAt.getTime()) status = "warning";
  else status = "on_track";

  const reference = deliveredAt ?? now;
  return {
    receivedOn,
    thirdBusinessDay,
    dueAt,
    dueReason,
    warnAt,
    status,
    businessDaysElapsed: businessDaysBetween(receivedOn, civilDateOf(reference)),
  };
}
