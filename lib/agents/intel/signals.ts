// Public signals for the weekly market-intel note.
//
// A signal is a public item: a rate-benchmark snapshot, a Federal Register
// notice from HUD or SBA, or an item from an RSS/Atom feed staff configured.
// Signals are the ONLY input the market-intel model sees. Everything that
// comes from outside is scrubbed on the way in:
//   - markup removed, whitespace collapsed, length capped
//   - emails, phone numbers and account-like numbers masked (press contacts
//     in a notice must not make the whole payload "personal data")
//   - instruction-like sentences stripped (feeds are untrusted web content)
// and the model routing guard checks the final payload again before anything
// leaves the server (lib/ai/routing.ts).
//
// Every source is an interface with a fake. A source that fails reports an
// error string and contributes no signals; it never fails the run.

import { createHash } from "node:crypto";
import { guardText } from "@/lib/agents/core/inbound";
import type { InjectionFinding } from "@/lib/agents/core/injection";
import { asArray, asRecord, firstStr, getJson, isoDate, logOnce, type FetchLike } from "@/lib/data/http";
import { redactText } from "@/lib/privacy/classification";
import type { PublicSignal, SignalSource } from "./types";

export const SIGNAL_LIMITS = { title: 200, summary: 800, perRun: 40, urlMax: 500 } as const;

export function signalId(source: SignalSource, key: string): string {
  return `${source}-${createHash("sha256").update(`${source}\n${key}`).digest("hex").slice(0, 12)}`;
}

const TAGS = /<[^>]*>/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#8217": "'", "#8220": '"', "#8221": '"', "#8211": "-", "#8212": "-" };

/** Plain text from markup: tags removed, common entities decoded, whitespace collapsed. */
export function plainText(input: string): string {
  const noCdata = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return noCdata
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(TAGS, " ")
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Only http(s) links to a plain host survive; anything else is dropped. */
export function safeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const out = u.toString();
    return out.length <= SIGNAL_LIMITS.urlMax ? out : null;
  } catch {
    return null;
  }
}

export type SignalDraft = {
  source: SignalSource;
  title: string;
  summary: string;
  url?: string | null;
  publishedAt?: string | null;
  /** Stable key for the id when there is no URL. */
  key?: string;
};

export type ScrubbedSignal = { signal: PublicSignal; findings: InjectionFinding[]; removed: number; masked: number };

/** Normalizes one raw item into a PublicSignal: plain text, masked personal values, no instruction-like sentences. */
export function scrubSignal(draft: SignalDraft): ScrubbedSignal | null {
  const rawTitle = plainText(draft.title);
  const rawSummary = plainText(draft.summary);
  const guardedTitle = guardText(rawTitle);
  const guardedSummary = guardText(rawSummary);
  const maskedTitle = redactText(guardedTitle.text, "public");
  const maskedSummary = redactText(guardedSummary.text, "public");
  const masked = Number(maskedTitle !== guardedTitle.text) + Number(maskedSummary !== guardedSummary.text);
  const title = clip(maskedTitle.trim(), SIGNAL_LIMITS.title);
  if (!title) return null;
  const url = safeUrl(draft.url);
  return {
    signal: {
      id: signalId(draft.source, url ?? draft.key ?? title),
      source: draft.source,
      title,
      summary: clip(maskedSummary.trim(), SIGNAL_LIMITS.summary),
      url,
      publishedAt: isoDate(draft.publishedAt) ?? null,
    },
    findings: [...guardedTitle.findings, ...guardedSummary.findings],
    removed: guardedTitle.removed + guardedSummary.removed,
    masked,
  };
}

// ---------------------------------------------------------------------------
// Sources

export type SignalFetchResult = { drafts: SignalDraft[]; error?: string };

export interface SignalSourceClient {
  readonly name: string;
  fetch(opts: { since: string; until: string }): Promise<SignalFetchResult>;
}

/** Benchmarks as the rates ticker computes them (lib/rates). Derived program rates are Kubera's indicative figures. */
export type RateSnapshotLike = { items: { key: string; label: string; value: string; changeBps?: number; derived: boolean }[]; asOf: string; live: boolean };

export function ratesSignalDraft(snapshot: RateSnapshotLike): SignalDraft {
  const bench = snapshot.items.filter((i) => !i.derived);
  const derived = snapshot.items.filter((i) => i.derived);
  const fmt = (i: RateSnapshotLike["items"][number]) => `${i.label} ${i.value}${i.changeBps !== undefined ? ` (${i.changeBps > 0 ? "+" : ""}${i.changeBps} bps on the day)` : ""}`;
  const parts = [
    `Benchmarks (FRED, as of ${snapshot.asOf}${snapshot.live ? "" : "; some series use indicative fallback values"}): ${bench.map(fmt).join("; ")}.`,
    derived.length ? `Kubera indicative program ranges derived from them (not quotes): ${derived.map((i) => `${i.label} ${i.value}`).join("; ")}.` : "",
  ];
  return { source: "rates", title: `Rate benchmarks as of ${snapshot.asOf}`, summary: parts.filter(Boolean).join(" "), url: "https://fred.stlouisfed.org/", publishedAt: snapshot.asOf, key: `rates:${snapshot.asOf}` };
}

export class RatesSignalSource implements SignalSourceClient {
  readonly name = "rates";
  constructor(private readonly snapshot: () => Promise<RateSnapshotLike>) {}
  async fetch(): Promise<SignalFetchResult> {
    try {
      return { drafts: [ratesSignalDraft(await this.snapshot())] };
    } catch (err) {
      return { drafts: [], error: `rates: ${err instanceof Error ? err.message : "failed"}` };
    }
  }
}

const FR_BASE = "https://www.federalregister.gov/api/v1/documents.json";
const FR_AGENCIES = ["housing-and-urban-development-department", "small-business-administration"] as const;

/** HUD and SBA notices from the Federal Register's public API (no key). */
export class FederalRegisterSource implements SignalSourceClient {
  readonly name = "federal_register";
  constructor(
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = FR_BASE,
  ) {}

  async fetch(opts: { since: string; until: string }): Promise<SignalFetchResult> {
    const params = new URLSearchParams({ per_page: "25", order: "newest" });
    for (const a of FR_AGENCIES) params.append("conditions[agencies][]", a);
    params.set("conditions[publication_date][gte]", opts.since);
    params.set("conditions[publication_date][lte]", opts.until);
    for (const f of ["title", "abstract", "html_url", "publication_date", "document_number", "type"]) params.append("fields[]", f);
    const res = await getJson(`${this.baseUrl}?${params.toString()}`, { fetchImpl: this.fetchImpl });
    if (!res.ok) return { drafts: [], error: `federal_register: ${res.error}` };
    const drafts: SignalDraft[] = [];
    for (const row of asArray(asRecord(res.data)?.results)) {
      const r = asRecord(row);
      const title = firstStr(r?.title);
      if (!title) continue;
      drafts.push({
        source: "federal_register",
        title,
        summary: [firstStr(r?.type), firstStr(r?.abstract)].filter(Boolean).join(": "),
        url: firstStr(r?.html_url) ?? null,
        publishedAt: firstStr(r?.publication_date) ?? null,
        key: firstStr(r?.document_number),
      });
    }
    return { drafts };
  }
}

function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return m?.[1];
}

/** Items from an RSS 2.0 or Atom document. Tolerant: a malformed item is skipped. */
export function parseFeed(xml: string): SignalDraft[] {
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  const out: SignalDraft[] = [];
  for (const b of blocks) {
    const title = tagText(b, "title");
    if (!title) continue;
    const atomLink = /<link[^>]*\shref=["']([^"']+)["'][^>]*>/i.exec(b)?.[1];
    const link = tagText(b, "link")?.trim() || atomLink;
    const date = tagText(b, "pubDate") ?? tagText(b, "updated") ?? tagText(b, "published") ?? tagText(b, "dc:date");
    const parsed = date ? Date.parse(plainText(date)) : NaN;
    out.push({
      source: "feed",
      title,
      summary: tagText(b, "description") ?? tagText(b, "summary") ?? tagText(b, "content") ?? "",
      url: link ? plainText(link) : null,
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null,
    });
  }
  return out;
}

/** Public RSS/Atom feeds (INTEL_FEED_URLS). */
export class FeedSource implements SignalSourceClient {
  readonly name = "feed";
  constructor(
    private readonly urls: readonly string[],
    private readonly fetchImpl?: FetchLike,
  ) {}

  async fetch(): Promise<SignalFetchResult> {
    const drafts: SignalDraft[] = [];
    const errors: string[] = [];
    for (const raw of this.urls) {
      const url = safeUrl(raw);
      if (!url) {
        errors.push("feed: a configured URL is not http(s)");
        continue;
      }
      try {
        const res = await (this.fetchImpl ?? ((i, init) => fetch(i, init)))(url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
        if (!res.ok) {
          errors.push(`feed: HTTP ${res.status}`);
          continue;
        }
        const text = (await res.text()).slice(0, 2_000_000);
        drafts.push(...parseFeed(text).slice(0, 20));
      } catch (err) {
        errors.push(`feed: ${err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network error"}`);
      }
    }
    return { drafts, ...(errors.length ? { error: [...new Set(errors)].join("; ") } : {}) };
  }
}

/** Fixed signals, for tests and fake mode. */
export class StaticSignalSource implements SignalSourceClient {
  constructor(
    readonly name: string,
    private readonly result: SignalFetchResult,
  ) {}
  async fetch(): Promise<SignalFetchResult> {
    return this.result;
  }
}

/** Feed URLs from the environment (comma or whitespace separated). */
export function feedUrlsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  return (env.INTEL_FEED_URLS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Collection

export type CollectedSignals = {
  signals: PublicSignal[];
  /** Injection finding codes seen (the sentences were stripped). */
  injectionCodes: string[];
  removed: number;
  masked: number;
  errors: string[];
};

export async function collectSignals(sources: readonly SignalSourceClient[], opts: { since: string; until: string; max?: number }): Promise<CollectedSignals> {
  const settled = await Promise.allSettled(sources.map((s) => s.fetch({ since: opts.since, until: opts.until })));
  const errors: string[] = [];
  const byId = new Map<string, PublicSignal>();
  const codes = new Set<string>();
  let removed = 0;
  let masked = 0;
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      errors.push(`${sources[i]!.name}: ${r.reason instanceof Error ? r.reason.message : "failed"}`);
      return;
    }
    if (r.value.error) errors.push(r.value.error);
    for (const d of r.value.drafts) {
      const s = scrubSignal(d);
      if (!s) continue;
      // Items outside the window are dropped; undated ones are kept (rate snapshots carry their own date).
      if (s.signal.publishedAt && (s.signal.publishedAt < opts.since || s.signal.publishedAt > opts.until)) continue;
      for (const f of s.findings) codes.add(f.code);
      removed += s.removed;
      masked += s.masked;
      if (!byId.has(s.signal.id)) byId.set(s.signal.id, s.signal);
    }
  });
  const max = opts.max ?? SIGNAL_LIMITS.perRun;
  // Rates first (the note leads with them), then newest first.
  const rank = (s: PublicSignal) => (s.source === "rates" ? 0 : 1);
  const signals = [...byId.values()]
    .sort((a, b) => rank(a) - rank(b) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.id.localeCompare(b.id))
    .slice(0, max);
  for (const e of errors) logOnce(`intel:${e}`, `intel: signal source problem (${e})`);
  return { signals, injectionCodes: [...codes].sort(), removed, masked, errors };
}

// ---------------------------------------------------------------------------
// Weeks

/** Monday (ISO date) of the week containing `d`, in UTC. */
export function weekStartOf(d: Date): string {
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
  return monday.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
