// Data classification for every field Corin stores or sends to a model.
//
// Four levels, lowest to highest:
//   public        published or public-record data (rates, knowledge base, program facts)
//   internal      Corin business data that identifies no one (asset type, program fit)
//   confidential  personal information and borrower deal data (names, email, phone,
//                 loan amounts, operating statements, rent rolls)
//   restricted    sensitive personal information (CCPA §1798.140(ae)): SSN/ITIN,
//                 date of birth, financial account and routing numbers, card
//                 numbers, government ID numbers, personal financial statements
//
// Three ways a value gets a level: an explicit entry in FIELD_CLASSIFICATION
// (table.column or table.column.jsonKey), a key-name heuristic for payloads
// that are not tied to a table, and value detectors that scan strings for
// SSNs, card and account numbers, email addresses and phone numbers. The
// highest of the three wins. Unknown structured leaves default to `internal`;
// free text is scanned.
//
// Restricted fields are encrypted at the application layer (lib/privacy/crypto.ts)
// and the model routing guard (lib/ai/routing.ts) uses these levels to decide
// what may reach which model.

export const CLASSIFICATION_LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export type Classification = (typeof CLASSIFICATION_LEVELS)[number];

/** Whose data it is. "borrower" covers borrowers, guarantors, principals and their deal data. */
export const DATA_CATEGORIES = ["borrower", "partner", "deal", "market", "system"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export type FieldRule = {
  level: Classification;
  category: DataCategory;
  /** Personal information about an identifiable person. */
  pii: boolean;
  /** Stored encrypted with lib/privacy/crypto.ts (all restricted fields). */
  encrypt?: boolean;
  note?: string;
};

export function levelRank(level: Classification): number {
  return CLASSIFICATION_LEVELS.indexOf(level);
}

export function maxLevel(...levels: Classification[]): Classification {
  let best: Classification = "public";
  for (const l of levels) if (levelRank(l) > levelRank(best)) best = l;
  return best;
}

/** True when `level` is at or below `ceiling`. */
export function withinCeiling(level: Classification, ceiling: Classification): boolean {
  return levelRank(level) <= levelRank(ceiling);
}

const C = (category: DataCategory, pii = true): FieldRule => ({ level: "confidential", category, pii });
const R = (category: DataCategory, note?: string): FieldRule => ({ level: "restricted", category, pii: true, encrypt: true, ...(note ? { note } : {}) });
const I = (category: DataCategory): FieldRule => ({ level: "internal", category, pii: false });
const P = (category: DataCategory): FieldRule => ({ level: "public", category, pii: false });

/**
 * Field registry, keyed `table.column` or `table.column.jsonKey` (JSON keys as
 * the app writes them). Tables added by later workstreams register their
 * fields here (principals, screenings, deals …) so the routing guard and the
 * retention/export code agree on what each field is.
 */
export const FIELD_CLASSIFICATION: Readonly<Record<string, FieldRule>> = {
  // leads (qualifier intake)
  "leads.id": I("borrower"),
  "leads.source": I("system"),
  "leads.contact": C("borrower"),
  "leads.contact.firstName": C("borrower"),
  "leads.contact.lastName": C("borrower"),
  "leads.contact.email": C("borrower"),
  "leads.contact.phone": C("borrower"),
  "leads.contact.company": C("borrower"),
  "leads.contact.consent": I("borrower"),
  "leads.intake": C("deal", false),
  "leads.intake.assetType": I("deal"),
  "leads.intake.transaction": I("deal"),
  "leads.intake.source": I("system"),
  "leads.intake.loanAmount": C("deal", false),
  "leads.intake.noi": C("deal", false),
  "leads.intake.value": C("deal", false),
  "leads.intake.notes": C("borrower"),
  "leads.decision": I("deal"),
  "leads.rationale": I("deal"),
  "leads.crm_error": I("system"),
  // partners
  "partners.email": C("partner"),
  "partners.organization": C("partner", false),
  "partners.profile": C("partner"),
  "partners.profile.contact": C("partner"),
  // documents (vault metadata; the files themselves are restricted)
  "documents.file_name": C("borrower"),
  "documents.storage_path": I("system"),
  "documents.kind": I("deal"),
  "documents.extracted": R("borrower", "Extractions can contain account and ID numbers from PFS and tax returns."),
  "documents.content": R("borrower", "Raw borrower files (T-12, PFS, tax returns, bank statements)."),
  // consent ledger and AI transcripts
  "consent_events.email": C("borrower"),
  "consent_events.phone": C("borrower"),
  "consent_events.ip": C("borrower"),
  "consent_events.user_agent": I("system"),
  // Transcripts are confidential; restricted values a visitor types are masked
  // before the row is written (lib/conversations/store.ts redactForStorage).
  "ai_conversations.messages": { level: "confidential", category: "borrower", pii: true, note: "Restricted values (SSN, DOB, account numbers) are redacted before storage." },
  "ai_conversations.ip_hash": I("system"),
  // privacy requests (WS-Y)
  "privacy_requests.subject_email": C("borrower"),
  "privacy_requests.subject_name": C("borrower"),
  "privacy_requests.subject_phone": C("borrower"),
  "privacy_requests.details": C("borrower"),
  "privacy_requests.export_payload": C("borrower"),
  // principals / guarantors (WS-U, Phase 2): PFS fields are encrypted at rest.
  "principals.ssn": R("borrower"),
  "principals.itin": R("borrower"),
  "principals.dob": R("borrower"),
  "principals.drivers_license": R("borrower"),
  "principals.passport_number": R("borrower"),
  "principals.pfs": R("borrower", "Personal financial statement."),
  "principals.bank_account_number": R("borrower"),
  "principals.routing_number": R("borrower"),
  "principals.credit_report": R("borrower"),
  "principals.name": C("borrower"),
  "principals.email": C("borrower"),
  "principals.phone": C("borrower"),
  "principals.home_address": C("borrower"),
  "principals.reo_schedule": C("borrower"),
  // document extractions and spreads (WS-L, Phase 3). Extraction fields are
  // confidential deal data; a PFS extraction (doc_type = 'PFS') is restricted,
  // which the document agent enforces per row (the registry is per column).
  "document_extractions.fields": { level: "confidential", category: "borrower", pii: true, note: "Restricted when doc_type = 'PFS' (personal financial statement)." },
  "document_extraction_events.detail": I("system"),
  "construction_budgets.line_items": C("deal", false),
  "spreads.inputs": C("deal", false),
  "spreads.results": C("deal", false),
  // AI supervision (WS-O, Phase 3)
  "ai_guardrail_events.excerpt": C("borrower"),
  "ai_review_annotations.note": C("borrower"),
  // lender panel contact info (business data) and lender contacts (WS-T, lender contacts)
  "lender_panel.main_phone": I("partner"),
  "lender_panel.general_email": C("partner", false),
  "lender_panel.submission_email": C("partner", false),
  "lender_panel.website_url": P("partner"),
  "lender_panel.portal_url": I("partner"),
  "lender_panel.submission_instructions": I("partner"),
  "lender_panel.credentials_location": I("system"),
  "lender_panel.loan_types": I("partner"),
  "lender_contacts.full_name": C("partner"),
  "lender_contacts.title": C("partner"),
  "lender_contacts.email": C("partner"),
  "lender_contacts.phone_direct": C("partner"),
  "lender_contacts.phone_mobile": C("partner"),
  "lender_contacts.territory": C("partner"),
  "lender_contacts.notes": C("partner"),
  "lender_accounts.number_enc": R("partner", "Account numbers a lender assigned to Corin; sealed with lib/privacy/crypto.ts, context lender_accounts:<id>.number."),
  "lender_accounts.number_last4": I("partner"),
  // public data
  "rate_snapshots.benchmarks": P("market"),
  "kb_chunks.content": P("market"),
  "kb_chunks.source": P("market"),
};

/** Looks up `table.column` (and `table.column.jsonKey`) in the registry. */
export function fieldRule(path: string): FieldRule | undefined {
  return FIELD_CLASSIFICATION[path];
}

// --- Key-name heuristics --------------------------------------------------------

type KeyHeuristic = { re: RegExp; rule: FieldRule };

// Ordered: the first match wins, so the specific restricted patterns come first.
// Keys are normalized to lower case with separators removed before matching.
const KEY_HEURISTICS: readonly KeyHeuristic[] = [
  { re: /^(ssn|socialsecurity|socialsecuritynumber|sin|itin|taxpayerid|tin)$|ssn$|socialsecurity/, rule: R("borrower") },
  { re: /^(dob|dateofbirth|birthdate|birthday)$|dateofbirth|birthdate/, rule: R("borrower") },
  { re: /(accountnumber|acctnumber|acctno|accountno|bankaccount|iban|routingnumber|abanumber|aba$|swift|bic$)/, rule: R("borrower") },
  { re: /(cardnumber|creditcard|debitcard|cvv|cvc|pan$)/, rule: R("borrower") },
  { re: /(driverslicense|driverlicense|dlnumber|passport|stateid|governmentid|nationalid|alienregistration)/, rule: R("borrower") },
  { re: /^(pfs|personalfinancialstatement)$|personalfinancial|creditreport|ficoscore|creditscore|taxreturn/, rule: R("borrower") },
  { re: /(password|secret|apikey|token|privatekey)$/, rule: { level: "restricted", category: "system", pii: false, encrypt: true } },
  { re: /^(email|emailaddress|phone|phonenumber|mobile|cell|fax)$|email$|phone$/, rule: C("borrower") },
  { re: /^(firstname|lastname|fullname|name|middlename|contactname|borrowername|guarantorname|sponsorname)$/, rule: C("borrower") },
  { re: /(homeaddress|mailingaddress|residentialaddress|streetaddress|^address$|^ip$|ipaddress)/, rule: C("borrower") },
  { re: /^(ein|employerid|federaltaxid)$/, rule: C("borrower") },
  { re: /(borrower|guarantor|principal|sponsor|contact|applicant|owner)/, rule: C("borrower") },
  { re: /(noi|t12|rentroll|census|strreport|loanamount|purchaseprice|appraisedvalue|netincome|revenue|expenses|dscr|ltv|occupancy|notes)$/, rule: C("deal", false) },
];

/** Classifies a bare key (no table), e.g. a JSON property in a prompt payload. */
export function classifyKey(key: string): FieldRule | undefined {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!k) return undefined;
  return KEY_HEURISTICS.find((h) => h.re.test(k))?.rule;
}

// --- Value detectors ---------------------------------------------------------------

export type DetectorId = "ssn" | "card_number" | "routing_number" | "account_number" | "date_of_birth" | "ein" | "email" | "phone";

export type ValueFinding = { detector: DetectorId; level: Classification; index: number; length: number };

type Detector = { id: DetectorId; level: Classification; re: RegExp; accept?: (match: RegExpExecArray) => boolean };

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function abaChecksum(d: string): boolean {
  const n = [...d].map(Number);
  const sum = 3 * (n[0]! + n[3]! + n[6]!) + 7 * (n[1]! + n[4]! + n[7]!) + (n[2]! + n[5]! + n[8]!);
  return sum % 10 === 0;
}

function validSsn(area: string, group: string, serial: string): boolean {
  if (area === "000" || area === "666" || area[0] === "9") return false;
  return group !== "00" && serial !== "0000";
}

const DETECTORS: readonly Detector[] = [
  {
    id: "ssn",
    level: "restricted",
    // 123-45-6789 / 123 45 6789, or 9 bare digits next to an SSN/TIN label.
    // The label is a lookbehind so redaction masks only the number.
    re: /\b(\d{3})[- ](\d{2})[- ](\d{4})\b|(?<=\b(?:ssn|social security(?: number| no\.?)?|s\.s\.n\.|itin|tin)\s*(?:#|no\.?|number)?\s*[:=]?\s*)(\d{3})-?(\d{2})-?(\d{4})\b/gi,
    accept: (m) => (m[1] ? validSsn(m[1], m[2]!, m[3]!) : validSsn(m[4]!, m[5]!, m[6]!)),
  },
  {
    id: "card_number",
    level: "restricted",
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (m) => {
      const digits = m[0].replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && /^[2-6]/.test(digits) && luhn(digits);
    },
  },
  {
    id: "routing_number",
    level: "restricted",
    re: /(?<=\b(?:routing|aba|rtn)(?:\s*(?:#|no\.?|number))?\s*[:=]?\s*)(\d{9})\b/gi,
    accept: (m) => abaChecksum(m[1]!),
  },
  {
    id: "account_number",
    level: "restricted",
    re: /(?<=\b(?:account|acct|a\/c)(?:\s*(?:#|no\.?|number))?\s*[:=]?\s*)(\d[\d -]{4,20}\d)\b/gi,
  },
  {
    id: "date_of_birth",
    level: "restricted",
    re: /\b(?:dob|d\.o\.b\.|date of birth|born(?: on)?|birth ?date)\s*[:=]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|[a-z]{3,9}\.? \d{1,2},? \d{4})/gi,
  },
  { id: "ein", level: "confidential", re: /\b(?:ein|fein|employer id(?:entification)?(?: number)?|tax id)\s*[:#]?\s*\d{2}-?\d{7}\b/gi },
  { id: "email", level: "confidential", re: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi },
  {
    id: "phone",
    level: "confidential",
    // US numbers with a separator or parentheses, optionally +1 (bare 10-digit runs are too noisy: loan amounts).
    re: /(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g,
  },
];

/** Scans free text for sensitive values. Findings are sorted by position. */
export function detectSensitiveValues(text: string): ValueFinding[] {
  const out: ValueFinding[] = [];
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    for (let m = d.re.exec(text); m; m = d.re.exec(text)) {
      if (!d.accept || d.accept(m)) out.push({ detector: d.id, level: d.level, index: m.index, length: m[0].length });
      if (m[0].length === 0) d.re.lastIndex++;
    }
  }
  // Drop findings fully inside a higher-or-equal finding (a card number also matches "phone").
  out.sort((a, b) => a.index - b.index || b.length - a.length);
  const kept: ValueFinding[] = [];
  for (const f of out) {
    const inside = kept.some((k) => f.index >= k.index && f.index + f.length <= k.index + k.length && levelRank(k.level) >= levelRank(f.level));
    if (!inside) kept.push(f);
  }
  return kept;
}

// --- Payload classification ------------------------------------------------------------

export type Finding = {
  /** JSON path of the leaf, e.g. "contact.email" or "messages[2].content". */
  path: string;
  level: Classification;
  category: DataCategory;
  source: "registry" | "key" | "value" | "declared";
  detail: string;
};

export type PayloadClassification = {
  level: Classification;
  categories: DataCategory[];
  pii: boolean;
  findings: Finding[];
};

export type ClassifyOptions = {
  /** Table the payload's top-level keys belong to (enables registry lookups). */
  table?: string;
  /** Level for structured leaves nothing else classifies. Default "internal". */
  defaultLevel?: Classification;
  /** Max depth walked; deeper values are treated as restricted (fail closed). */
  maxDepth?: number;
};

function keyPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

/**
 * Walks a value and returns its overall classification plus every finding
 * above `public`. Used by the routing guard on whatever is about to leave for
 * a model, and by tests to pin the registry.
 */
export function classifyPayload(value: unknown, opts: ClassifyOptions = {}): PayloadClassification {
  const findings: Finding[] = [];
  const defaultLevel = opts.defaultLevel ?? "internal";
  const maxDepth = opts.maxDepth ?? 12;
  let level: Classification = "public";
  const categories = new Set<DataCategory>();
  let pii = false;

  const note = (f: Finding, isPii: boolean) => {
    level = maxLevel(level, f.level);
    if (f.level !== "public") categories.add(f.category);
    if (isPii) pii = true;
    if (f.level !== "public") findings.push(f);
  };

  const scanString = (s: string, path: string, category: DataCategory) => {
    for (const v of detectSensitiveValues(s)) note({ path, level: v.level, category, source: "value", detail: v.detector }, true);
  };

  const walk = (v: unknown, path: string, registryPath: string | undefined, inherited: FieldRule | undefined, depth: number) => {
    if (v === null || v === undefined) return;
    if (depth > maxDepth) {
      note({ path, level: "restricted", category: inherited?.category ?? "borrower", source: "value", detail: "max depth exceeded" }, true);
      return;
    }
    const category = inherited?.category ?? "borrower";
    if (typeof v === "string") {
      if (inherited) note({ path, level: inherited.level, category: inherited.category, source: registryPath && fieldRule(registryPath) ? "registry" : "key", detail: registryPath ?? path }, inherited.pii);
      else if (v.trim()) note({ path, level: defaultLevel, category: "system", source: "value", detail: "unclassified text" }, false);
      scanString(v, path, category);
      return;
    }
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      if (inherited) note({ path, level: inherited.level, category: inherited.category, source: registryPath && fieldRule(registryPath) ? "registry" : "key", detail: registryPath ?? path }, inherited.pii);
      else note({ path, level: defaultLevel, category: "system", source: "value", detail: "unclassified value" }, false);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, keyPath(path, i), registryPath, inherited, depth + 1));
      return;
    }
    if (typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        const childRegistry = registryPath ? `${registryPath}.${k}` : opts.table ? `${opts.table}.${k}` : undefined;
        const fromRegistry = childRegistry ? fieldRule(childRegistry) : undefined;
        const fromKey = classifyKey(k);
        // Highest of registry, key heuristic and inherited parent rule.
        const candidates = [fromRegistry, fromKey, inherited].filter((r): r is FieldRule => Boolean(r));
        const rule = candidates.reduce<FieldRule | undefined>((best, r) => (!best || levelRank(r.level) > levelRank(best.level) ? r : best), undefined);
        walk(child, keyPath(path, k), childRegistry, rule, depth + 1);
      }
    }
  };

  walk(value, "", opts.table, undefined, 0);
  return { level, categories: [...categories].sort(), pii, findings };
}

// --- Redaction ---------------------------------------------------------------------------

export const REDACTED = (what: Classification | DetectorId) => `[REDACTED:${what}]`;

/** Replaces sensitive substrings above `ceiling` in free text. */
export function redactText(text: string, ceiling: Classification): string {
  const hits = detectSensitiveValues(text).filter((f) => !withinCeiling(f.level, ceiling));
  let out = "";
  let cursor = 0;
  for (const h of hits) {
    if (h.index < cursor) continue;
    out += text.slice(cursor, h.index) + REDACTED(h.detector);
    cursor = h.index + h.length;
  }
  return out + text.slice(cursor);
}

/**
 * Returns a copy of `value` with every leaf above `ceiling` replaced by a
 * `[REDACTED:…]` marker and sensitive substrings in text masked.
 */
export function redactPayload<T>(value: T, ceiling: Classification, opts: Pick<ClassifyOptions, "table"> = {}): T {
  const walk = (v: unknown, registryPath: string | undefined, inherited: FieldRule | undefined): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") return redactText(v, ceiling);
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((item) => walk(item, registryPath, inherited));
    const out: Record<string, unknown> = {};
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      const childRegistry = registryPath ? `${registryPath}.${k}` : opts.table ? `${opts.table}.${k}` : undefined;
      const candidates = [childRegistry ? fieldRule(childRegistry) : undefined, classifyKey(k), inherited].filter((r): r is FieldRule => Boolean(r));
      const rule = candidates.reduce<FieldRule | undefined>((best, r) => (!best || levelRank(r.level) > levelRank(best.level) ? r : best), undefined);
      out[k] = rule && !withinCeiling(rule.level, ceiling) ? REDACTED(rule.level) : walk(child, childRegistry, rule);
    }
    return out;
  };
  return walk(value, opts.table, undefined) as T;
}

/** Registry entries that must be stored encrypted (every restricted field). */
export function encryptedFields(table?: string): string[] {
  return Object.entries(FIELD_CLASSIFICATION)
    .filter(([path, rule]) => (rule.encrypt || rule.level === "restricted") && (!table || path.startsWith(`${table}.`)))
    .map(([path]) => path)
    .sort();
}
