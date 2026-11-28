// What never goes in a lender email body (spec 5.4), and the fair-lending copy
// check on staff-typed text (spec 6.5).
//
// Three layers keep restricted data out of the email:
//   1. By construction: the email builder takes EmailFacts, which has no field
//      for a restricted value; sponsor strength reaches it only through
//      guarantorCovenantLine() (booleans, or rounded combined figures).
//   2. assertEmailSafe() below, run on the rendered text and again in the send
//      gate (lib/deals/packages.ts).
//   3. The database checks (public.submission_text_restricted, the same
//      shapes after the same normalization) on lender_outreach and on every
//      free-text column of the submission and sponsor profiles.
//
// Text is normalized before any pattern runs (normalizeForScan): NFKC, every
// Unicode decimal digit as its ASCII digit, and format characters
// (zero-width, bidi marks) removed, so full-width or Arabic-Indic digits, a
// zero-width space inside a number and a dash other than "-" all read as the
// plain shape. The patterns are shared with lib/deals/submission/schema.ts,
// which refuses the same shapes in free text when staff save it (and stores
// the normalized text). Nothing here echoes the matched value: findings name
// the kind of data, never the data.

import { GUARANTOR_COVENANT_DEFAULTS, ROUNDED_FINANCIALS_STEP_CENTS, type EmailFinancialsMode, type GuarantorCovenantLine, type SponsorStrength } from "./types";

export type RestrictedKind = "ssn" | "ein" | "digit_run" | "dob" | "account" | "name";

export type RestrictedPattern = { kind: Exclude<RestrictedKind, "name">; label: string; re: RegExp };

const digitCache = new Map<string, string>();
/** The ASCII digit for a Unicode decimal digit (each script's digits run 0–9 in code-point order). */
function asciiDigit(ch: string): string {
  const hit = digitCache.get(ch);
  if (hit) return hit;
  const cp = ch.codePointAt(0)!;
  let zero = cp;
  while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
  const out = String((cp - zero) % 10);
  digitCache.set(ch, out);
  return out;
}

/**
 * Text as the restricted-identifier patterns read it, and as staff free text
 * is stored: NFKC, Unicode decimal digits as ASCII, format characters (\p{Cf}:
 * zero-width spaces and joiners, bidi marks, soft hyphens) removed.
 */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\x00-\x7f]/gu, (c) => (/\p{Nd}/u.test(c) ? asciiDigit(c) : c));
}

// Between digit groups: any dash, a slash, a dot, an underscore, or spaces.
const SEP = String.raw`(?:\s*[\p{Pd}\u2212/._]\s*|\s+)`;
const group = (...sizes: number[]) => new RegExp(String.raw`(?<!\d)${sizes.map((n) => `\\d{${n}}`).join(SEP)}(?!\d)`, "u");

/**
 * Shapes that never belong in an email body or in saved free text, matched on
 * normalizeForScan(text). Formatted money ("$8,400,000"), dates, APNs and
 * phone numbers written 415-555-0100 do not match.
 */
export const RESTRICTED_TEXT_PATTERNS: readonly RestrictedPattern[] = [
  // SSN and ITIN share the 3-2-4 shape (an ITIN starts with 9); 3-3-3 is the same nine digits grouped another way.
  { kind: "ssn", label: "a Social Security number or ITIN", re: group(3, 2, 4) },
  { kind: "ssn", label: "a Social Security number or ITIN", re: group(3, 3, 3) },
  { kind: "ssn", label: "a Social Security number or ITIN", re: /\b(?:ssns?|s\.\s?s\.\s?n|itins?|i\.\s?t\.\s?i\.\s?n)\b|\bsocial[\s_.-]*security[\s_.-]*(?:numbers?\b|nos?\b|#)|\bsoc\.?\s?sec\b/i },
  { kind: "ein", label: "an employer identification number", re: group(2, 7) },
  { kind: "digit_run", label: "a run of nine or more digits (an account, routing or tax id)", re: /\d{9,}/ },
  { kind: "account", label: "a bank account or routing number", re: new RegExp(String.raw`(?<!\d)\d{4}(?:${SEP}\d{4}){2,}(?!\d)`, "u") },
  { kind: "dob", label: "a date of birth", re: /\b(?:dob|d\.\s?o\.\s?b|date[\s_.-]*of[\s_.-]*birth|birth[\s_.-]?(?:dates?|days?)|born)\b/i },
  {
    kind: "account",
    label: "a bank account or routing number",
    re: /\brouting\b|\b(?:account|acct)s?\.?\s*(?:#|no\b|numbers?\b|num\b|ending\b|ends?\s+(?:in|with)\b)|\b(?:checking|savings)\s+(?:#|no\b|number\b|ending\b|ends?\s+in\b)|\biban\b|\baba\s*(?:#|no\b|number\b)/i,
  },
];

export type RestrictedFinding = { kind: RestrictedKind; label: string };

export type EmailSafetyOptions = {
  /** Legal names that must not appear (the deal's individual principals). */
  names?: readonly string[];
  /** Phrases removed before the name check, e.g. the borrowing entity's own name (see safeAllowPhrases). */
  allow?: readonly string[];
};

// ---------------------------------------------------------------------------
// Names (spec 5.4 "Guarantor names: not by default"). Text and names are
// compared as token streams: NFKD with combining marks removed, format
// characters (zero-width, bidi) removed, lower case, and every run of
// anything that is not a letter or digit (spaces, "_", "-", ".", ",") one
// separator. A principal matches on the full name, first plus last name in
// either order (with or without the middle names), an honorific with the
// surname, or the surname alone (initials with the surname are caught by it).

const FORMAT_CHARS = /\p{Cf}/gu;
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "esq", "md", "phd", "cpa"]);
const HONORIFICS = ["mr", "mrs", "ms", "mx", "miss", "dr", "sir", "madam"];
/**
 * Surnames that are also everyday words the email or staff copy prints
 * (labels, months, numbers, the parties' roles). They are matched only with a first name or an
 * honorific, so a guarantor named Price or May does not block every email
 * with a purchase price or a May date.
 */
const COMMON_WORD_SURNAMES = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "price", "cash", "stack", "bond", "bonds", "bank", "banks", "rent", "rate", "cost", "value", "worth", "fund", "capital", "credit", "equity", "loan", "trust", "grant",
  "senior", "brand", "scope", "budget", "exit", "plan", "term", "close", "closing", "link", "package", "summary", "request", "property", "hotel", "business",
  "young", "long", "short", "little", "small", "strong", "best", "good", "rich", "wise", "hope", "love", "day", "days", "way", "case", "page", "king",
  "white", "black", "brown", "green", "gray", "grey", "gold", "golden", "silver", "rose", "hill", "hall", "wood", "woods", "lane", "park", "parks", "field", "fields",
  "ford", "west", "east", "north", "south", "street", "lake", "river", "rivers", "stone", "wall", "walls", "wells", "house", "cross", "bell", "cook", "mason",
  "baker", "hunt", "frost", "snow", "winter", "summer", "spring", "storm", "moon", "star", "fox", "wolf", "lamb", "bird", "fisher", "glass", "steel", "iron",
  "owner", "sponsor", "guarantor", "borrower", "member", "manager", "partner", "principal", "buyer", "seller", "tenant", "lender", "broker", "builder", "contractor",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "first", "second", "third", "fourth", "fifth", "half", "demo", "example", "sample", "test",
]);

/** Lower-case tokens of `s` for the name check (see above). */
export function nameTokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(FORMAT_CHARS, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

type NameForms = { combos: string[][]; surnames: string[] };

function nameForms(name: string): NameForms {
  const words = name
    .normalize("NFKD")
    .replace(FORMAT_CHARS, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !NAME_SUFFIXES.has(nameTokens(w).join("")));
  while (words.length > 1 && HONORIFICS.includes(nameTokens(words[0]!).join(""))) words.shift();
  const tokens = words.flatMap(nameTokens);
  if (!tokens.length || tokens.join("").length < 3) return { combos: [], surnames: [] };
  if (tokens.length === 1) return { combos: [tokens], surnames: tokens[0]!.length >= 3 ? tokens : [] };
  const surname = nameTokens(words.at(-1)!);
  const first = words.length > 1 ? nameTokens(words[0]!) : [tokens[0]!];
  const middles = words.slice(1, -1).flatMap(nameTokens);
  const combos = [tokens, [...first, ...surname], [...surname, ...first], [...surname, ...first, ...middles], ...HONORIFICS.map((h) => [h, ...surname])];
  const surnames = surname.filter((t) => t.length >= 3 && !COMMON_WORD_SURNAMES.has(t));
  return { combos, surnames };
}

const stream = (tokens: readonly string[]) => ` ${tokens.join(" ")} `;
const hasSeq = (hay: string, seq: readonly string[]) => seq.length > 0 && hay.includes(stream(seq));

/** True when `text` names one of `names` in a full-name form (full, first and last either way, honorific with the surname); the surname alone does not count. */
export function fullNameIn(text: string, names: readonly string[]): boolean {
  const hay = stream(nameTokens(text));
  return names.some((n) => nameForms(n).combos.some((c) => c.length > 1 && hasSeq(hay, c)));
}

function nameFound(text: string, opts: EmailSafetyOptions): boolean {
  if (!opts.names?.length) return false;
  let hay = stream(nameTokens(text));
  for (const phrase of opts.allow ?? []) {
    const seq = nameTokens(phrase);
    if (seq.length) hay = hay.split(stream(seq)).join(" | ");
  }
  return opts.names.some((n) => {
    const f = nameForms(n);
    return f.combos.some((c) => hasSeq(hay, c)) || f.surnames.some((t) => hasSeq(hay, [t]));
  });
}

/**
 * The phrases the name check may skip: an entity's (or the deal's borrower)
 * name is allowed only when it names no individual principal in a full-name
 * form and is not made only of their name tokens ("Ellingsworth" alone would
 * otherwise switch the surname check off).
 */
export function safeAllowPhrases(candidates: readonly (string | null | undefined)[], individuals: readonly string[]): string[] {
  const personal = new Set(individuals.flatMap(nameTokens));
  return [...new Set(candidates.filter((c): c is string => typeof c === "string" && c.trim().length > 0))].filter((c) => {
    const t = nameTokens(c);
    return t.length > 0 && !fullNameIn(c, individuals) && !t.every((x) => personal.has(x));
  });
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
  const scan = normalizeForScan(text);
  for (const p of RESTRICTED_TEXT_PATTERNS) if (p.re.test(scan)) add({ kind: p.kind, label: p.label });
  if (nameFound(scan, opts)) add({ kind: "name", label: "a guarantor's or principal's name (write \"the guarantors\")" });
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
