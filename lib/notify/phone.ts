// Phone helpers. The format matches `normalizePhone` in lib/consent/ledger.ts
// for every number this module accepts, so a STOP received from "+13105550100"
// finds the consent rows recorded from "(310) 555-0100".

/** Strict E.164: a leading +, 8 to 15 digits, no leading zero. Returns null when the input cannot be one. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** Formats an NANP number several ways, the way CRM records tend to store them. */
export function phoneVariants(e164: string): string[] {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) return [e164];
  const [, a, b, c] = m;
  return [e164, `${a}${b}${c}`, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
}

/** Masks a number for logs: +1310***0100. */
export function maskPhone(phone: string): string {
  return phone.length <= 7 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}
