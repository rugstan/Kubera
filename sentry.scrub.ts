// PII scrubbing for everything that leaves the app for Sentry. Kubera handles
// borrower contact details, financials and identity data, so events are
// treated as hostile by default: unknown request bodies, cookies, auth headers
// and user records are dropped, sensitive keys are redacted wherever they
// appear, and free-text values are pattern-scrubbed. Pure functions, no SDK
// import, so they are unit-tested directly and shared by every runtime.

export const REDACTED = "[redacted]";
const MAX_DEPTH = 10;
const MAX_STRING = 2_000;

/** Keys whose values are never sent, at any depth. Matched case-insensitively. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential|session|ssn|social|tax[-_]?id|\bein\b|dob|birth|account(?:number|num|_no)?|routing|iban|e-?mail|phone|mobile|first[-_]?name|last[-_]?name|full[-_]?name|contact|intake|notes?$|address|license[-_]?(?:no|num|number)|x-forwarded-for|x-real-ip|ip[-_]?address|\bvars\b/i;

/** Structural identifiers that must survive intact or Sentry cannot link events and spans. */
const PASSTHROUGH_KEY = /^(?:trace_id|span_id|parent_span_id|event_id|sentry_trace|baggage|release|environment|platform|level|timestamp|start_timestamp|type|op)$/i;

const PATTERNS: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED], // JWTs
  [/\b(?:sk|pk|rk|whsec|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g, REDACTED], // vendor API keys
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED], // email addresses
  [/\b\d{3}-\d{2}-\d{4}\b/g, REDACTED], // SSN
  [/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, REDACTED], // US phone
  [/(?<![\d.])\d{9,17}(?![\d.])/g, REDACTED], // bare account / routing / card style numbers
];

export function scrubString(value: string): string {
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Drops the query string and fragment: they carry tokens and form values. */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return scrubString(cut === -1 ? url : url.slice(0, cut));
}

export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (PASSTHROUGH_KEY.test(k) && (typeof v === "string" || typeof v === "number")) {
      out[k] = v;
      continue;
    }
    out[k] = SENSITIVE_KEY.test(k) && v !== null && v !== undefined && v !== "" ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

const SAFE_REQUEST_HEADERS = new Set(["user-agent", "content-type", "accept", "accept-language", "host"]);

type Loose = Record<string, unknown>;

function scrubRequest(request: Loose): Loose {
  const out: Loose = { ...request };
  delete out.data; // request bodies are form submissions
  delete out.cookies;
  delete out.query_string;
  if (typeof out.url === "string") out.url = scrubUrl(out.url);
  if (out.headers && typeof out.headers === "object") {
    out.headers = Object.fromEntries(Object.entries(out.headers as Loose).filter(([k]) => SAFE_REQUEST_HEADERS.has(k.toLowerCase())).map(([k, v]) => [k, scrubValue(v)]));
  }
  return out;
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction`. Typed loosely on purpose so the
 * same function satisfies the error and transaction event types; it returns the
 * same shape it received.
 */
export function scrubEvent<T extends object>(event: T): T {
  const e = { ...(event as Loose) };
  delete e.user; // never send ids, emails, usernames or IPs
  if (e.request && typeof e.request === "object") e.request = scrubRequest(e.request as Loose);
  if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction);
  for (const key of ["message", "logentry", "exception", "breadcrumbs", "extra", "contexts", "tags", "spans", "threads"]) {
    if (e[key] !== undefined) e[key] = scrubValue(e[key]);
  }
  return e as T;
}

/** Sentry `beforeBreadcrumb`: strips URLs/queries and drops raw keystroke capture. */
export function scrubBreadcrumb<T extends object>(breadcrumb: T): T | null {
  const b = { ...(breadcrumb as Loose) };
  if (b.category === "ui.input" || b.category === "ui.keyDown") return null;
  if (typeof b.message === "string") b.message = scrubString(b.message);
  if (b.data && typeof b.data === "object") {
    const data = { ...(b.data as Loose) };
    delete data.body;
    delete data.request_body;
    for (const k of ["url", "from", "to"]) if (typeof data[k] === "string") data[k] = scrubUrl(data[k] as string);
    b.data = scrubValue(data);
  }
  return b as T;
}

const URL_ATTRIBUTE = /url|query|target|path|origin|referrer/i;

/**
 * Sentry `beforeSendSpan` (span streaming is the SDK default). Span names and
 * HTTP attributes routinely embed full URLs, query strings and bodies.
 */
export function scrubSpan<T extends object>(span: T): T {
  const s = { ...(span as Loose) };
  if (typeof s.name === "string") s.name = scrubUrl(s.name);
  if (s.attributes && typeof s.attributes === "object") {
    const attrs: Loose = {};
    for (const [key, raw] of Object.entries(s.attributes as Loose)) {
      if (/body|cookie|authorization|header/i.test(key)) continue;
      const strip = (v: unknown) => (typeof v === "string" && URL_ATTRIBUTE.test(key) ? scrubUrl(v) : v);
      const value = raw && typeof raw === "object" && "value" in raw ? { ...(raw as Loose), value: strip((raw as Loose).value) } : strip(raw);
      attrs[key] = value;
    }
    s.attributes = scrubValue(attrs);
  }
  return s as T;
}
