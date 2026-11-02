// Contractor license check against the California Contractors State License
// Board (CSLB) public license lookup. Env-gated (Global rule 3): without
// CSLB_LOOKUP_ENABLED=true the lookup reports itself unavailable, logs once,
// and staff verify at cslb.ca.gov by hand.
//
// The CSLB site has no documented JSON API, so the real client reads the public
// license detail page and the parser is label based and tolerant of layout
// changes. VERIFY the parser against a live page before relying on it for
// closing decisions, and keep fixtures in cslb.test.ts current.

import type { ContractorLicense, LicenseIssue } from "./types";

export class LicenseLookupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LicenseLookupError";
  }
}

export interface ContractorLicenseLookup {
  readonly name: string;
  /** False when the lookup is not configured; checks then record `lookup_unavailable`. */
  readonly available: boolean;
  /** Returns null when CSLB has no record of the number. Throws LicenseLookupError on transport failure. */
  lookup(licenseNumber: string): Promise<ContractorLicense | null>;
}

/** CSLB license numbers are numeric, up to seven digits today; accept up to eight. */
export function normalizeLicenseNumber(raw: string): string | null {
  const digits = raw.trim().replace(/^(cslb|lic(ense)?)\s*#?\s*/i, "").replace(/[\s#-]/g, "");
  return /^\d{1,8}$/.test(digits) ? digits : null;
}

// Parsing -------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&rsquo;": "'", "&lsquo;": "'" };

function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|td|th|span)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ");
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LABELS = [
  "business information",
  "entity",
  "issue date",
  "reissue date",
  "expire date",
  "license status",
  "classifications",
  "bonding information",
  "contractor's bond",
  "contractor bond",
  "workers' compensation",
  "workers compensation",
  "disciplinary action",
  "public disclosure",
  "personnel list",
  "asbestos registration",
  "back to",
  "contractor's license detail",
];

const isLabel = (line: string) => LABELS.some((l) => line.toLowerCase().replace(/[:\s]+$/, "").startsWith(l));

/** Lines belonging to the section that starts at the first line matching `label`, up to the next known label. */
function section(lines: string[], ...labels: string[]): string[] | null {
  const start = lines.findIndex((l) => labels.some((label) => l.toLowerCase().replace(/[:\s]+$/, "").startsWith(label)));
  if (start < 0) return null;
  const first = lines[start]!;
  const inline = labels.reduce((acc, label) => (acc !== null ? acc : first.toLowerCase().startsWith(label) ? first.slice(label.length).replace(/^[:\s]+/, "") : null), null as string | null);
  const out: string[] = inline ? [inline] : [];
  for (let i = start + 1; i < lines.length && !isLabel(lines[i]!); i++) out.push(lines[i]!);
  return out;
}

function parseUsDate(text: string | undefined): string | null {
  const m = text?.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (!m) return null;
  const [mm, dd, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function normalizeStatus(text: string): string {
  const t = text.toLowerCase();
  if (/current and active|^active|^clear/.test(t)) return "ACTIVE";
  if (/expired/.test(t)) return "EXPIRED";
  if (/suspend/.test(t)) return "SUSPENDED";
  if (/revok/.test(t)) return "REVOKED";
  if (/cancel/.test(t)) return "CANCELLED";
  if (/inactive/.test(t)) return "INACTIVE";
  return "UNKNOWN";
}

export function normalizeClassification(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Parse a CSLB license detail page. Returns null when the page says the license
 * number is not on file. Throws LicenseLookupError when the page has no license
 * content at all (blocked, error page or a layout the parser does not know).
 */
export function parseCslbLicensePage(html: string, licenseNumber: string): ContractorLicense | null {
  const lines = htmlToLines(html);
  const joined = lines.join(" ").toLowerCase();
  if (/(license|record)s? (number )?[^.]{0,40}(was )?not found|no (matching )?records? found|is not on file/.test(joined)) return null;

  const statusSection = section(lines, "license status");
  if (!statusSection || statusSection.length === 0) {
    throw new LicenseLookupError("CSLB page did not contain a license status; the page layout may have changed");
  }

  const business = section(lines, "business information");
  const businessName = business?.find((l) => !/^(business phone|entity|\(\d{3}\)|\d{3}[-.\s]\d{3})/i.test(l) && !/^\d/.test(l)) ?? null;

  const classLines = section(lines, "classifications") ?? [];
  const classifications = classLines.flatMap((l) => {
    const m = l.match(/^([A-Z][A-Z0-9-]{0,5})\s+[-–]\s+\S/);
    return m ? [normalizeClassification(m[1]!)] : [];
  });

  const bond = section(lines, "contractor's bond", "contractor bond", "bonding information");
  const bondText = bond?.join(" ") ?? "";
  const bondOnFile = bondText !== "" && /(filed a contractor'?s bond|bond number|surety)/i.test(bondText) && !/(no (contractor'?s )?bond|not (on file|filed)|has not)/i.test(bondText);
  const bondCancel = bondText.match(/cancellation date[:\s]*([\d/]+)/i)?.[1];

  const wc = (section(lines, "workers' compensation", "workers compensation") ?? []).join(" ");
  const workersCompStatus: ContractorLicense["workersCompStatus"] = !wc
    ? "unknown"
    : /exempt/i.test(wc) && !/not exempt/i.test(wc)
      ? "exempt"
      : /(no workers|has not|not (on file|reported)|none)/i.test(wc)
        ? "none"
        : /(workers'? ?comp|insurance|policy)/i.test(wc)
          ? "active"
          : "unknown";

  const disc = (section(lines, "disciplinary action", "public disclosure") ?? []).join(" ").trim();
  const disciplinaryAction = disc !== "" && !/(^|\b)(none|no (public )?(disciplinary|disclosure|record|action)|not applicable|n\/a)/i.test(disc);

  return {
    licenseNumber,
    businessName,
    status: normalizeStatus(statusSection.join(" ")),
    issueDate: parseUsDate((section(lines, "issue date") ?? []).join(" ")),
    expirationDate: parseUsDate((section(lines, "expire date") ?? []).join(" ")),
    classifications,
    bondOnFile,
    bondExpiresOn: parseUsDate(bondCancel),
    workersCompStatus,
    disciplinaryAction,
  };
}

// Evaluation ----------------------------------------------------------------------

/** General building (B) and general engineering (A) cover a general contractor on a ground-up project. VERIFY per lender. */
export const DEFAULT_ACCEPTED_CLASSIFICATIONS = ["B", "A"] as const;

export function evaluateLicense(
  license: ContractorLicense,
  now: Date,
  options: { acceptedClassifications?: readonly string[] } = {},
): LicenseIssue[] {
  const today = now.toISOString().slice(0, 10);
  const accepted = (options.acceptedClassifications ?? DEFAULT_ACCEPTED_CLASSIFICATIONS).map(normalizeClassification);
  const issues: LicenseIssue[] = [];

  if (license.status === "EXPIRED") issues.push("license_expired");
  else if (license.status !== "ACTIVE") issues.push("license_not_active");

  if (license.expirationDate && license.status === "ACTIVE") {
    if (license.expirationDate < today) issues.push("license_expired");
    else {
      const ninety = new Date(now.getTime() + 90 * 86_400_000).toISOString().slice(0, 10);
      if (license.expirationDate <= ninety) issues.push("expires_within_90_days");
    }
  }
  if (!license.classifications.some((c) => accepted.includes(c))) issues.push("classification_mismatch");
  if (!license.bondOnFile) issues.push("no_bond_on_file");
  else if (license.bondExpiresOn && license.bondExpiresOn < today) issues.push("bond_expired");
  if (license.workersCompStatus === "none") issues.push("no_workers_comp");
  if (license.disciplinaryAction) issues.push("disciplinary_action");
  return issues;
}

export const LICENSE_ISSUE_LABELS: Record<LicenseIssue, string> = {
  license_not_active: "License is not active",
  license_expired: "License is expired",
  expires_within_90_days: "License expires within 90 days",
  classification_mismatch: "No general building (B) or general engineering (A) classification",
  no_bond_on_file: "No contractor's bond on file",
  bond_expired: "Contractor's bond has been cancelled or expired",
  no_workers_comp: "No workers' compensation coverage on file",
  disciplinary_action: "Public disciplinary action on the record",
};

/** A check older than this should be repeated before closing. */
export const LICENSE_CHECK_MAX_AGE_DAYS = 30;

export function isCheckStale(checkedAt: string, now: Date): boolean {
  return now.getTime() - new Date(checkedAt).getTime() > LICENSE_CHECK_MAX_AGE_DAYS * 86_400_000;
}

// Implementations -----------------------------------------------------------------

const DEFAULT_BASE_URL = "https://www.cslb.ca.gov";

export class CslbPublicLookup implements ContractorLicenseLookup {
  readonly name = "cslb";
  readonly available = true;

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async lookup(licenseNumber: string): Promise<ContractorLicense | null> {
    const number = normalizeLicenseNumber(licenseNumber);
    if (!number) throw new LicenseLookupError("License number must be 1 to 8 digits");
    const url = `${this.baseUrl.replace(/\/$/, "")}/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${encodeURIComponent(number)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Accept: "text/html", "User-Agent": "CorinCommercial-LicenseCheck/1.0 (+https://corincommercial.com)" },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      throw new LicenseLookupError("CSLB lookup request failed", { cause: err });
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new LicenseLookupError(`CSLB lookup returned HTTP ${res.status}`);
    return parseCslbLicensePage(await res.text(), number);
  }
}

let warned = false;

export class UnavailableLicenseLookup implements ContractorLicenseLookup {
  readonly name = "unavailable";
  readonly available = false;

  async lookup(): Promise<ContractorLicense | null> {
    if (!warned) {
      warned = true;
      console.warn("[construction] CSLB license lookup is not enabled (set CSLB_LOOKUP_ENABLED=true); contractor licenses must be verified by hand.");
    }
    throw new LicenseLookupError("CSLB lookup is not enabled");
  }
}

export class FakeLicenseLookup implements ContractorLicenseLookup {
  readonly name = "fake";
  readonly available = true;
  readonly calls: string[] = [];
  private readonly records = new Map<string, ContractorLicense | "error">();

  set(licenseNumber: string, record: ContractorLicense | "error"): this {
    this.records.set(licenseNumber, record);
    return this;
  }

  async lookup(licenseNumber: string): Promise<ContractorLicense | null> {
    this.calls.push(licenseNumber);
    const r = this.records.get(licenseNumber);
    if (r === "error") throw new LicenseLookupError("fake transport failure");
    return r ?? null;
  }
}

export function createContractorLicenseLookup(env: Record<string, string | undefined> = process.env): ContractorLicenseLookup {
  if (env.CSLB_LOOKUP_ENABLED === "true") return new CslbPublicLookup(env.CSLB_LOOKUP_BASE_URL || DEFAULT_BASE_URL);
  return new UnavailableLicenseLookup();
}
