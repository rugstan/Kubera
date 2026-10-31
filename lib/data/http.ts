import { failed, type SourceOutcome } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 8_000;

export type GetJsonOptions = {
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

/**
 * GET a JSON document. Never throws: HTTP, network, timeout and parse
 * failures come back as `{ ok: false, error }` with a short code. Error text
 * never includes the URL, which can carry an API key in its query string.
 */
export async function getJson(url: string, opts: GetJsonOptions = {}): Promise<{ ok: true; status: number; data: unknown } | { ok: false; status?: number; error: string }> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", ...opts.headers },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status, error: `http-${res.status}` };
    try {
      return { ok: true, status: res.status, data: await res.json() };
    } catch {
      return { ok: false, status: res.status, error: "invalid-json" };
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: timedOut ? "timeout" : "network-error" };
  }
}

/** Map a transport failure to an outcome; 404 is "not found", everything else an error. */
export function outcomeFromFailure(res: { status?: number; error: string }): SourceOutcome<never> {
  return res.status === 404 ? { status: "not_found" } : failed(res.error);
}

// --- Tolerant value readers for provider payloads ---------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Dig into nested records; any non-record on the way yields undefined. */
export function dig(v: unknown, ...path: string[]): unknown {
  let cur: unknown = v;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Positive-or-zero finite number from a number or numeric string ("1,200", "$5,000"). */
export function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? undefined : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** First value that is defined, treating zero/empty-string placeholders as missing for `num`. */
export function firstNum(...vs: unknown[]): number | undefined {
  for (const v of vs) {
    const n = num(v);
    if (n !== undefined) return n;
  }
  return undefined;
}

export function firstStr(...vs: unknown[]): string | undefined {
  for (const v of vs) {
    const s = str(v);
    if (s !== undefined) return s;
  }
  return undefined;
}

/** A positive number or undefined (zero is a provider placeholder for "unknown" on counts, areas and prices). */
export function positive(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/** ISO date (YYYY-MM-DD) from a date-ish string or epoch millis; undefined when unparsable. */
export function isoDate(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 1e11) return new Date(v).toISOString().slice(0, 10);
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return undefined;
}

const logged = new Set<string>();

/** Log a message once per process (missing API keys must not spam logs). */
export function logOnce(key: string, message: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
}

/** Test hook. */
export function resetLogOnce(): void {
  logged.clear();
}

export function median(values: number[]): number | undefined {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1]! + v[mid]!) / 2;
}

/** Drop undefined-valued keys so records stay clean when serialized or compared. */
export function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
