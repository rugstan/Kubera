// Email text helpers: HTML → plain text, quoted-reply trimming, header parsing.
// Deliberately conservative: output is only ever stored or shown as text,
// never rendered as HTML.

import type { AuthVerdict } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return safeCodePoint(parseInt(lower.slice(2), 16)) ?? m;
    if (lower.startsWith("#")) return safeCodePoint(parseInt(lower.slice(1), 10)) ?? m;
    return ENTITIES[lower] ?? m;
  });
}

function safeCodePoint(n: number): string | undefined {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : undefined;
}

/** Converts an HTML email body to readable plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/t[dh]>/gi, "\t")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_MARKERS = [
  /^On .{1,200}wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^From: .+\n(?:Sent|Date): .+/m,
  /^_{10,}\s*$/m,
  /^={4,} Forwarded message ={4,}/im,
];

/** Drops the quoted history below the newest reply (forwards are kept). */
export function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index > 0 && m.index < cut && !/forwarded/i.test(m[0])) cut = m.index;
  }
  return text
    .slice(0, cut)
    .split("\n")
    .filter((l) => !/^>/.test(l))
    .join("\n")
    .trim();
}

/** Parses raw RFC 5322 headers (unfolding continuation lines). Names are lower-cased. */
export function parseHeaders(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const unfolded = raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

export function headerValue(h: Map<string, string[]>, name: string): string | null {
  return h.get(name.toLowerCase())?.[0] ?? null;
}

/** Message-IDs in a header value ("<a@b> <c@d>"), normalized without brackets, lower-cased. */
export function messageIds(value: string | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/<([^<>\s]{1,300})>/g)].map((m) => m[1]!.toLowerCase());
}

export function isAutomated(h: Map<string, string[]>): boolean {
  const auto = headerValue(h, "auto-submitted");
  if (auto && auto.toLowerCase() !== "no") return true;
  const precedence = headerValue(h, "precedence")?.toLowerCase();
  if (precedence === "auto_reply" || precedence === "junk") return true;
  return h.has("x-autoreply") || h.has("x-autorespond") || /^(mailer-daemon|postmaster)@/i.test(headerValue(h, "return-path")?.replace(/[<>]/g, "") ?? "");
}

export function isBulk(h: Map<string, string[]>): boolean {
  const precedence = headerValue(h, "precedence")?.toLowerCase();
  return h.has("list-unsubscribe") || h.has("list-id") || precedence === "bulk" || precedence === "list";
}

/** DMARC verdict from Authentication-Results (the receiving server's, first header). */
export function dmarcVerdict(h: Map<string, string[]>): AuthVerdict {
  const results = h.get("authentication-results");
  if (!results?.length) return "unknown";
  const m = /\bdmarc=(pass|fail|none|bestguesspass|temperror|permerror)\b/i.exec(results[0]!);
  if (!m) return "unknown";
  const v = m[1]!.toLowerCase();
  if (v === "pass" || v === "bestguesspass") return "pass";
  if (v === "fail") return "fail";
  if (v === "none") return "none";
  return "unknown";
}

/** "Pat Lee <pat@example.com>" → { name, address }. */
export function parseAddress(value: string): { name: string | null; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(value);
  if (m) return { name: m[1]!.trim() || null, address: m[2]!.toLowerCase() };
  const bare = /([^\s<>,;"]+@[^\s<>,;"]+)/.exec(value);
  return { name: null, address: (bare?.[1] ?? value.trim()).toLowerCase() };
}

/** Splits a comma/semicolon list of addresses, honoring quoted display names. */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === ";") && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => parseAddress(p).address)
    .filter((a) => a.includes("@"));
}
