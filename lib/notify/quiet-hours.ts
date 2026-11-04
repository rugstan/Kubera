// TCPA quiet hours: no marketing-style text before 8 a.m. or after 9 p.m. in
// the recipient's local time. We do not store a recipient time zone, so borrower
// texts go out only in the window that is lawful across the continental US:
// 8 a.m. Pacific (11:00 Eastern) to 9 p.m. Eastern. Staff alerts and the
// STOP / HELP / START replies are exempt (see TemplateDef.quietHours).

export const SMS_WINDOW_START_HOUR_ET = 11;
export const SMS_WINDOW_END_HOUR_ET = 21;

function easternHour(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function insideSmsWindow(at: Date): boolean {
  const h = easternHour(at);
  return h >= SMS_WINDOW_START_HOUR_ET && h < SMS_WINDOW_END_HOUR_ET;
}
