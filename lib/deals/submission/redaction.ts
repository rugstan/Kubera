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
//      shapes after the same normalization and money masking) on
//      lender_outreach and on every free-text column of the submission and
//      sponsor profiles.
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

/** Marks and fillers that can sit after a digit without changing how it reads: combining marks, variation selectors, CGJ, Hangul fillers. */
const AFTER_DIGIT_NOISE = /(?<=\d)[\p{M}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u034F\u115F\u1160\u3164\uFFA0]+/gu;

/**
 * Text as the restricted-identifier patterns read it, and as staff free text
 * is stored: NFKC, Unicode decimal digits as ASCII, format characters (\p{Cf}:
 * zero-width spaces and joiners, bidi marks, soft hyphens) removed, the marks
 * and fillers above removed after a digit (inside a number they only hide
 * it), and NEL (U+0085) read as a space, as the database does.
 */
export function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\u0085/g, " ")
    .replace(/[^\x00-\x7f]/gu, (c) => (/\p{Nd}/u.test(c) ? asciiDigit(c) : c))
    .replace(AFTER_DIGIT_NOISE, "");
}

/**
 * Money amounts, read as money before any identifier pattern runs, so their
 * digit groups never start or join an identifier ("Rent of $850.00 (2024)",
 * "NOI $468,250.00 2025", "Insurance 310.50, 2026"): anything after "$", a
 * number with comma thousands, and a number ending in cents (".dd", unless
 * another digit group follows the dot as in "123.45.6789"). Each amount is
 * replaced by "$".
 */
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?|(?<!\d)\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d|,\d)|(?<![\d.,])\d+\.\d{2}(?!\d|[./-]\d)/g;

/** normalizeForScan text with its money amounts masked: what the identifier patterns read. */
export function maskMoney(scan: string): string {
  return scan.replace(MONEY, "$");
}

// Between digit groups: one to three characters that are neither a letter nor a digit
// ("-", "--", " - ", "·", "|", ") " as in "(123) 45-6789", a newline...).
const SEP = String.raw`[^\p{L}\p{N}]{1,3}`;
const grouped = (...sizes: number[]) => String.raw`(?<!\d)${sizes.map((n) => String.raw`\d{${n}}`).join(SEP)}(?!\d)`;
/**
 * The SSN / ITIN 3-2-4 shape. Separators that hold a comma, colon or
 * semicolon are list punctuation ("Suite 200, 15, 2025"), so they count only
 * when both are the same character: with no space ("123,45,6789",
 * "123:45:6789"), or with a space when the last group is not a year.
 */
const SSN_SEP = String.raw`[^\p{L}\p{N},:;]{1,3}`;
const SSN_SHAPE = String.raw`(?<!\d)\d{3}(?:${SSN_SEP}\d{2}${SSN_SEP}|,\d{2},|:\d{2}:|;\d{2};|(?:,\s{1,2}\d{2},|:\s{1,2}\d{2}:|;\s{1,2}\d{2};)\s{1,2}(?!(?:19|20)\d{2}(?!\d)))\d{4}(?!\d)`;
/** The EIN 2-7 shape: dashes, spaces, dots or slashes between, never list punctuation or brackets ("Phase 12: 8400000", "Lot 12 (1234567)"). */
const EIN_SHAPE = String.raw`(?<!\d)\d{2}[^\p{L}\p{N},:;()\[\]{}]{1,3}\d{7}(?!\d)`;
/**
 * An identity or account word directly before its number: only punctuation
 * and "no.", "number" or "is" between ("SSN: 123 456 789", "tax id number
 * 123-456-789"); "account for units 101 102 103" and "tax ID parcel
 * 226-180-021" are not.
 */
const ID_WORDS = String.raw`\b(?:ssns?|social(?:[\s_.-]*security)?|tax[^\p{L}\p{N}]{0,3}id|tins?|itins?|eins?|accounts?|acct|card|routing)\b`;
const ID_LEAD = String.raw`${ID_WORDS}(?:[^\p{L}\p{N}]{0,4}(?:no|nos|number|num|is)\b){0,2}[^\p{L}\p{N}]{0,4}`;
const afterIdWord = (body: string) => new RegExp(String.raw`${ID_LEAD}${body}`, "iu");
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
/** A full date, with day and month: 3/4/1971, 1971-03-04, March 4, 4 March. A bare year is not a birth date ("the brand was born in 1998"). */
const DATE = String.raw`(?<!\d)(?:\d{1,2}[^\p{L}\p{N}]{1,2}\d{1,2}[^\p{L}\p{N}]{1,2}\d{2,4}|\d{4}[^\p{L}\p{N}]\d{1,2}[^\p{L}\p{N}]\d{1,2}|${MONTH}\s+\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH})(?!\d)`;
const BIRTH_WORDS = String.raw`\b(?:d\.?\s?o\.?\s?b|date[\s_.-]*of[\s_.-]*birth|birth[\s_.-]?(?:dates?|days?)|b-?day|born|birth)\b`;
/** Between a birth word and its date: punctuation and at most two of "is / was / on / in / of / date / dated" ("born on March 3, 1980", "DOB: 4/12/71"); "DOB permits filed 2024" is not a birth date. */
const BIRTH_GAP = String.raw`[^\p{L}\p{N}]{0,4}(?:(?:is|was|on|in|of|date|dated)[^\p{L}\p{N}]{1,4}){0,2}`;
/** "Year of birth 1971", "birth year: 1971": a year counts only after these. */
const BIRTH_YEAR = String.raw`\b(?:year[\s_.-]*of[\s_.-]*birth|birth[\s_.-]?year)\b${BIRTH_GAP}(?:19|20)\d{2}(?!\d)`;
/** Four or more digits, possibly grouped or masked first ("x1234", "****1234", "55-1234-889"). */
const DIGIT_RUN = String.raw`[x*•]*\d(?:[^\p{L}\p{N}]{0,3}\d){3,}`;
/** "#", "no.", "number", "ending", "ends in" and the like, then the digits. */
const QUALIFIED_DIGITS = String.raw`(?:#|(?:no|nos|number|numbers|num|(?:ending|ends?)(?:[^\p{L}\p{N}]{1,3}(?:in|with))?)\b)[^\p{L}\p{N}$]{0,6}${DIGIT_RUN}`;
/**
 * Account wording followed by an account number: a qualified number
 * ("# 4821", "no. 55-1234-889", "ending 4821"), a masked one ("x4821",
 * "****1234"), or an unformatted run of six or more digits (seven after
 * "checking", "savings" and "A/C"). A money amount ("reserve account
 * $250,000", masked above) and a lone year or count ("lockbox account 2026",
 * "routing 1200 trucks a day") are not.
 */
const ACCOUNT_WITH_DIGITS = String.raw`\b(?:accounts?|acct|routing|iban|aba)\b[^\p{L}\p{N}$]{0,6}(?:${QUALIFIED_DIGITS}|[x*•]+\d{4}|\d{6,}(?!\d|[.,]\d))|\b(?:checking|savings|a/c)\b[^\p{L}\p{N}$]{0,3}(?:${QUALIFIED_DIGITS}|[x*•]+\d{4}|\d{7,}(?!\d|[.,]\d))`;
/** "Loan", "loan #", "loan no." or "loan number" just before a run: a 10 to 12 digit run there is a loan number. */
const LOAN_LEAD = String.raw`\bloan\b[^\p{L}\p{N}]{0,4}(?:(?:no|nos|number|num)\b[^\p{L}\p{N}]{0,4})?`;
/** Nine or more digits in a row, except a 10 to 12 digit loan number. */
const DIGIT_RUN_9 = String.raw`(?<!\d)(?:\d{9}|\d{13,})(?!\d)|(?<!${LOAN_LEAD})(?<!\d)\d{10,12}(?!\d)`;

/**
 * Shapes that never belong in an email body or in saved free text, matched on
 * maskMoney(normalizeForScan(text)) (public.submission_text_restricted is the
 * database twin). Always refused: nine or more digits in a row (a 10 to 12
 * digit loan number after "loan" excepted), the SSN / ITIN 3-2-4 shape and
 * the EIN 2-7 shape, and SSN / ITIN wording. Refused only in context, so
 * APNs, unit lists, years, rents, money and phone numbers save: a 3-3-3 or
 * 4-4-4 grouping only right after an identity or account word; birth wording
 * only with a full date; and account or routing wording only with an account
 * number.
 */
export const RESTRICTED_TEXT_PATTERNS: readonly RestrictedPattern[] = [
  // SSN and ITIN share the 3-2-4 shape (an ITIN starts with 9). Index 0: schema.ts's APN check reuses it.
  { kind: "ssn", label: "a Social Security number or ITIN", re: new RegExp(SSN_SHAPE, "u") },
  { kind: "ssn", label: "a Social Security number or ITIN", re: afterIdWord(grouped(3, 3, 3)) },
  {
    kind: "ssn",
    label: "a Social Security number or ITIN",
    re: /\b(?:ssns?|s\.\s?s\.\s?n|itins?|i\.\s?t\.\s?i\.\s?n)\b|\bss\s?#|\bsocial[\s_.-]*security[\s_.-]*(?:numbers?\b|nos?\b|#|cards?\b)|\bsocial[\s_.-]*security\b[^\d]{0,25}?(?:last|ending|ends)[^\d]{0,12}\d{4}|\bsoc\.?\s?sec\b/i,
  },
  { kind: "ein", label: "an employer identification number", re: new RegExp(EIN_SHAPE, "u") },
  { kind: "digit_run", label: "a run of nine or more digits (an account, routing or tax id)", re: new RegExp(DIGIT_RUN_9, "iu") },
  { kind: "account", label: "a bank account or routing number", re: afterIdWord(String.raw`(?<!\d)\d{4}(?:${SEP}\d{4}){2,}(?!\d)`) },
  { kind: "dob", label: "a date of birth", re: new RegExp(String.raw`${BIRTH_WORDS}${BIRTH_GAP}${DATE}|${BIRTH_YEAR}`, "iu") },
  {
    kind: "account",
    label: "a bank account or routing number",
    re: new RegExp(ACCOUNT_WITH_DIGITS, "iu"),
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
  // Also first and last name glued into one word ("RowanEllingsworth"), and the plural surname ("the Ellingsworths").
  const combos = [tokens, [...first, ...surname], [...surname, ...first], [...surname, ...first, ...middles], [[...first, ...surname].join("")], ...HONORIFICS.map((h) => [h, ...surname])];
  const surnames = surname.filter((t) => t.length >= 3 && !COMMON_WORD_SURNAMES.has(t)).flatMap((t) => [t, `${t}s`]);
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

/** A principal's first-name and surname tokens (honorifics and suffixes dropped). */
function personParts(name: string): { first: string[]; surname: string[] } | null {
  const words = name
    .normalize("NFKD")
    .replace(FORMAT_CHARS, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w && nameTokens(w).length && !NAME_SUFFIXES.has(nameTokens(w).join("")));
  while (words.length > 1 && HONORIFICS.includes(nameTokens(words[0]!).join(""))) words.shift();
  if (!words.length) return null;
  const surname = nameTokens(words.at(-1)!);
  return { first: words.length > 1 ? nameTokens(words[0]!) : [], surname };
}

/**
 * Words that make a name an entity's: LLC, L.L.C., LP, L.P., LLP, Inc,
 * Incorporated, Corp, Corporation, Ltd, Trust, Fund, Partners, Partnership,
 * Holdings, Company, Co. As tokens ("L.L.C." reads as l l c).
 */
const ENTITY_WORDS = new Set(["llc", "lp", "llp", "inc", "incorporated", "corp", "corporation", "ltd", "trust", "fund", "partners", "partnership", "holdings", "company", "co"]);
const ENTITY_WORD_SEQUENCES = [["l", "l", "c"], ["l", "p"], ["l", "l", "p"]];

/** True when the name carries an entity word (see ENTITY_WORDS). */
export function hasEntityWord(name: string): boolean {
  const t = nameTokens(name);
  const hay = stream(t);
  return t.some((x) => ENTITY_WORDS.has(x)) || ENTITY_WORD_SEQUENCES.some((seq) => hasSeq(hay, seq));
}

/**
 * True when `name` reads as one of the individual principals rather than an
 * entity, so the email must not print it: it holds a full-name form; or an
 * individual's first name (or first initial) and surname anywhere in it
 * ("Rowan J. Ellingsworth", "R. Ellingsworth", "Rowan (Ro) Ellingsworth",
 * "Rowan and Dana Ellingsworth"); or an individual's surname and no entity
 * word ("Noor & Sam Halvorsen", "Ellingsworth Ventures"); or only their name
 * tokens. With `surnameWithoutEntityWord: false` a surname alone does not
 * count (for the fixed phrases, see safeAllowPhrases).
 */
export function looksLikePerson(name: string, individuals: readonly string[], opts: { surnameWithoutEntityWord?: boolean } = {}): boolean {
  const tokens = nameTokens(name);
  if (!tokens.length) return false;
  if (fullNameIn(name, individuals)) return true;
  // "The Halvorsens" names them too.
  const have = new Set(tokens.flatMap((x) => (x.length > 3 && x.endsWith("s") ? [x, x.slice(0, -1)] : [x])));
  const personal = new Set(individuals.flatMap(nameTokens));
  if (tokens.every((x) => personal.has(x))) return true;
  const entityWord = opts.surnameWithoutEntityWord === false || hasEntityWord(name);
  return individuals.some((ind) => {
    const parts = personParts(ind);
    if (!parts || !parts.surname.length || !parts.surname.every((x) => have.has(x))) return false;
    if (!entityWord) return true;
    const initial = parts.first[0]?.[0];
    return (parts.first.length > 0 && parts.first.every((x) => have.has(x))) || (initial !== undefined && have.has(initial));
  });
}

/**
 * The entity names the name check may skip, each only inside its own exact
 * phrase: entity principals whose name does not read as an individual
 * principal (looksLikePerson). Free text such as the deal's borrower name is
 * never a candidate.
 */
export function entityAllowPhrases(entityNames: readonly (string | null | undefined)[], individuals: readonly string[]): string[] {
  return [...new Set(entityNames.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim()))].filter((c) => !looksLikePerson(c, individuals));
}

/**
 * The fixed phrases every email prints that are not the deal's (Corin, its
 * designated officer, the signing advisor, the lender) may be skipped, each
 * only inside its own exact phrase, so a principal who shares a surname with
 * one of them does not block every email. Never one that names an individual
 * principal: a full-name form, their first name (or initial) with their
 * surname anywhere, or only their name tokens.
 */
export function safeAllowPhrases(candidates: readonly (string | null | undefined)[], individuals: readonly string[]): string[] {
  return [...new Set(candidates.filter((c): c is string => typeof c === "string" && c.trim().length > 0))].filter((c) => {
    return nameTokens(c).length > 0 && !looksLikePerson(c, individuals, { surnameWithoutEntityWord: false });
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
  const ids = maskMoney(scan);
  for (const p of RESTRICTED_TEXT_PATTERNS) if (p.re.test(ids)) add({ kind: p.kind, label: p.label });
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
