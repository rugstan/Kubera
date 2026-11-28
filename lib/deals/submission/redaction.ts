// What never goes in a lender email body (spec 5.4), and the fair-lending copy
// check on staff-typed text (spec 6.5).
//
// Three layers keep restricted data out of the email:
//   1. By construction: the email builder takes EmailFacts, which has no field
//      for a restricted value; sponsor strength reaches it only through
//      guarantorCovenantLine() (booleans, or rounded combined figures).
//   2. assertEmailSafe() below, run on the rendered text and again in the send
//      gate (lib/deals/packages.ts).
//   3. The lender_outreach check constraints (no SSN shape, no nine-digit run).
//
// The patterns are shared with lib/deals/submission/schema.ts, which refuses
// the same shapes in free text when staff save it. Nothing here echoes the
// matched value: findings name the kind of data, never the data.

import { GUARANTOR_COVENANT_DEFAULTS, ROUNDED_FINANCIALS_STEP_CENTS, type EmailFinancialsMode, type GuarantorCovenantLine, type SponsorStrength } from "./types";

export type RestrictedKind = "ssn" | "ein" | "digit_run" | "dob" | "account" | "name";

export type RestrictedPattern = { kind: Exclude<RestrictedKind, "name">; label: string; re: RegExp };

/**
 * Shapes that never belong in an email body or in saved free text. Formatted
 * money ("$8,400,000"), dates, APNs and phone numbers written 415-555-0100 do
 * not match.
 */
export const RESTRICTED_TEXT_PATTERNS: readonly RestrictedPattern[] = [
  // SSN and ITIN share the 3-2-4 shape (an ITIN starts with 9).
  { kind: "ssn", label: "a Social Security number or ITIN", re: /(?<!\d)\d{3}[-\s.]\d{2}[-\s.]\d{4}(?!\d)/ },
  { kind: "ssn", label: "a Social Security number or ITIN", re: /\b(?:ssns?|itins?)\b|\bsocial\s+security\s+(?:numbers?|no)\b/i },
  { kind: "ein", label: "an employer identification number", re: /(?<!\d)\d{2}-\d{7}(?!\d)/ },
  { kind: "digit_run", label: "a run of nine or more digits (an account, routing or tax id)", re: /\d{9,}/ },
  { kind: "dob", label: "a date of birth", re: /\b(?:d\.?o\.?b|date\s+of\s+birth|birth\s?date|born)\b/i },
  { kind: "account", label: "a bank account or routing number", re: /\brouting\b|\b(?:account|acct)\.?\s*(?:#|no\b|numbers?\b|num\b)|\biban\b|\baba\s*(?:#|no\b|number\b)/i },
];

export type RestrictedFinding = { kind: RestrictedKind; label: string };

export type EmailSafetyOptions = {
  /** Legal names that must not appear (the deal's individual principals). */
  names?: readonly string[];
  /** Phrases removed before the name check, e.g. the borrowing entity's own name. */
  allow?: readonly string[];
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namePattern(name: string): RegExp | null {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.join("").length < 3) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRe).join("\\s+")}(?![\\p{L}\\p{N}])`, "iu");
}

/** Every restricted shape in `text`, deduplicated by kind. Empty when the text is safe. */
export function findRestrictedText(text: string, opts: EmailSafetyOptions = {}): RestrictedFinding[] {
  const out: RestrictedFinding[] = [];
  const seen = new Set<string>();
  const add = (f: RestrictedFinding) => {
    if (seen.has(f.label)) return;
    seen.add(f.label);
    out.push(f);
  };
  for (const p of RESTRICTED_TEXT_PATTERNS) if (p.re.test(text)) add({ kind: p.kind, label: p.label });
  if (opts.names?.length) {
    let scan = text;
    for (const phrase of opts.allow ?? []) {
      const re = namePattern(phrase);
      if (re) scan = scan.replace(new RegExp(re.source, "giu"), " ");
    }
    if (opts.names.some((n) => namePattern(n)?.test(scan))) add({ kind: "name", label: "a guarantor's or principal's name (write \"the guarantors\")" });
  }
  return out;
}

/** True when the text carries none of the restricted shapes (names not checked). For zod refinements. */
export function isFreeTextSafe(text: string): boolean {
  return findRestrictedText(text).length === 0;
}

/** The message schema.ts and the send gate show for unsafe text; it names the kind of data, never the value. */
export function restrictedTextMessage(findings: readonly RestrictedFinding[]): string {
  const labels = findings.map((f) => f.label);
  return `The text contains ${labels.join(", ")}. Remove it: personal identifiers stay in the vault and go to a lender only as documents behind the share link.`;
}

export class EmailSafetyError extends Error {
  readonly reason = "email_unsafe" as const;
  constructor(readonly findings: RestrictedFinding[]) {
    super(restrictedTextMessage(findings));
    this.name = "EmailSafetyError";
  }
}

/**
 * Throws EmailSafetyError when the email text holds an SSN or ITIN shape, an
 * EIN, a run of nine or more digits, date-of-birth or account wording, or
 * (with `names`) a principal's legal name.
 */
export function assertEmailSafe(text: string, opts: EmailSafetyOptions = {}): void {
  const findings = findRestrictedText(text, opts);
  if (findings.length) throw new EmailSafetyError(findings);
}

// ---------------------------------------------------------------------------
// Sponsor strength in the email (spec 5.4 row "Guarantor net worth and liquidity")

/**
 * What the email may say about guarantor strength. covenant_only: yes / no
 * against the thresholds, no dollar figures. rounded: also the combined
 * figures rounded down to ROUNDED_FINANCIALS_STEP_CENTS. none: nothing.
 */
export function guarantorCovenantLine(strength: SponsorStrength | null, mode: EmailFinancialsMode): GuarantorCovenantLine | null {
  if (!strength || mode === "none") return null;
  const { covenants } = strength;
  if (covenants.netWorthOk === null && covenants.liquidityOk === null) return null;
  const roundDown = (cents: number | null) => (cents === null ? null : Math.max(0, Math.floor(cents / ROUNDED_FINANCIALS_STEP_CENTS) * ROUNDED_FINANCIALS_STEP_CENTS));
  const nw = roundDown(strength.netWorthCents);
  const liq = roundDown(strength.liquidityCents);
  return {
    basis: strength.basis,
    asOf: strength.asOf,
    netWorthAtLeastLoan: covenants.netWorthOk,
    liquidityAtLeastPct: covenants.liquidityOk,
    thresholds: {
      netWorthMultiple: Number.isFinite(covenants.netWorthMultiple) ? covenants.netWorthMultiple : GUARANTOR_COVENANT_DEFAULTS.netWorthMultiple,
      liquidityPct: Number.isFinite(covenants.liquidityPct) ? covenants.liquidityPct : GUARANTOR_COVENANT_DEFAULTS.liquidityPct,
    },
    rounded: mode === "rounded" && nw !== null && liq !== null ? { netWorthCents: nw, liquidityCents: liq } : null,
  };
}

// ---------------------------------------------------------------------------
// Fair lending (ECOA / Regulation B): staff-typed text that touches a protected
// characteristic is flagged; staff edit it or confirm it, and the confirmation
// is shown to the approving broker. A flag is a prompt, not a refusal.

export const neutralCopyTopics = ["age", "sex", "marital_status", "race", "religion", "national_origin", "public_assistance"] as const;
export type NeutralCopyTopic = (typeof neutralCopyTopics)[number];

export const NEUTRAL_COPY_TOPIC_LABELS: Record<NeutralCopyTopic, string> = {
  age: "age",
  sex: "sex or gender",
  marital_status: "marital status",
  race: "race or color",
  religion: "religion",
  national_origin: "national origin or citizenship",
  public_assistance: "receipt of public assistance",
};

const NEUTRAL_TERMS: readonly { topic: NeutralCopyTopic; re: RegExp }[] = [
  // About a person, not a building or a business ("an 11-year-old bakery" is fine).
  {
    topic: "age",
    re: /\b(?:he|she|borrower|guarantor|sponsor|owner|founder|principal|member|partner)s?\b[^.]{0,30}?\b\d{2,3}\s+years?\s+old\b|\b\d{2,3}[-\s]years?[-\s]old\s+(?:borrower|guarantor|sponsor|owner|founder|principal|man|woman|widow(?:er)?|retiree)s?\b|\bretirees?\b|\bin\s+(?:his|her|their)\s+(?:\d0s|twenties|thirties|forties|fifties|sixties|seventies|eighties)\b/i,
  },
  { topic: "sex", re: /\b(?:wife|husband|woman|women|female|male|gentleman|lady|ladies|mother|father|pregnan\w*|maternity)\b/i },
  { topic: "marital_status", re: /\b(?:married|marriage|divorced?|divorcing|widow(?:ed|er)?|spouses?|fianc[ée]e?|single\s+(?:mother|father|parent))\b/i },
  { topic: "race", re: /\b(?:african[-\s]american|caucasian|hispanic|latin[oax]|asian|black[-\s]owned|white[-\s]owned|minority[-\s]owned|racial(?:ly)?)\b/i },
  { topic: "religion", re: /\b(?:christian|muslim|jewish|hindu|buddhist|sikh|mormon|catholic|protestant|atheist|religious)\b/i },
  {
    topic: "national_origin",
    re: /\b(?:immigrants?|immigrated|foreign\s+nationals?|nationality|citizenship|citizens?|green\s+card|visa\s+holder|undocumented|mexican|chinese|indian|korean|vietnamese|filipino|japanese|iranian|russian|armenian|nigerian|ethiopian|cuban|haitian)\b/i,
  },
  { topic: "public_assistance", re: /\b(?:welfare|food\s+stamps|public\s+assistance|social\s+security\s+income|ssi\s+benefits)\b/i },
];

export type NeutralCopyFlag = { topic: NeutralCopyTopic; label: string; term: string; textIndex: number };

/**
 * Flags protected-characteristic topics in staff-typed text ("wife", "years
 * old", "immigrant", nationality and religion terms). Returns one flag per
 * (text, topic); empty when the copy is neutral.
 */
export function checkNeutralCopy(texts: readonly string[]): NeutralCopyFlag[] {
  const out: NeutralCopyFlag[] = [];
  texts.forEach((text, textIndex) => {
    for (const { topic, re } of NEUTRAL_TERMS) {
      const m = re.exec(text);
      if (m) out.push({ topic, label: NEUTRAL_COPY_TOPIC_LABELS[topic], term: m[0], textIndex });
    }
  });
  return out;
}
