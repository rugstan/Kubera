// Lender-facing view of a share link: lists the documents in the locked
// package version with short-lived signed download URLs. Responses are
// uncacheable and unindexed; unknown, expired and revoked links look alike to
// the visitor (no oracle), while the access count records valid opens only.

import { licenseLine } from "@/lib/site";
import { resolveShareLink } from "./share-links";
import type { DealDeskStore } from "./store";

export type ShareDeps = {
  store: DealDeskStore;
  /** Signed URL for a vault object (5 minutes), or null when storage is unavailable. */
  signUrl: (storagePath: string) => Promise<string | null>;
  now: () => Date;
  /** True when this client may make another request. */
  allow: (key: string) => Promise<boolean>;
};

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

// This standalone page does not load app/globals.css; these mirror its design tokens.
const TOKENS = ":root{--color-canvas:#f5f5f7;--color-surface:#ffffff;--color-ink:#1d1d1f;--color-titanium:#6e6e73;--color-accent:#047857}";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>${TOKENS}body{font-family:-apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;background:var(--color-canvas);color:var(--color-ink);margin:0;padding:24px 16px}main{max-width:720px;margin:0 auto;background:var(--color-surface);border-radius:20px;padding:24px}a{color:var(--color-accent)}li{margin:8px 0}p.small{color:var(--color-titanium);font-size:13px}</style></head>
<body><main>${body}<p class="small">${esc(licenseLine())}. Kubera is the broker, not the lender. This link is for the addressed institution only.</p></main></body></html>`;
  return new Response(html, { status, headers: HEADERS });
}

export async function handleShareRequest(token: string, clientKey: string, deps: ShareDeps): Promise<Response> {
  if (!(await deps.allow(`share:${clientKey}`))) return page("Too many requests", "<h1>Too many requests</h1><p>Try again in a minute.</p>", 429);
  const r = await resolveShareLink(deps.store, token, deps.now());
  if (r.status !== "ok") return page("Link unavailable", "<h1>This link is not available</h1><p>It may have expired or been withdrawn. Ask your Kubera contact for a new one.</p>", 404);
  const deal = await deps.store.getDeal(r.link.dealId);
  const items = await Promise.all(r.pkg.manifest.map(async (i) => ({ ...i, url: await deps.signUrl(i.storagePath) })));
  const list = items
    .map((i) => `<li>${i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer">${esc(i.label)}</a>` : esc(i.label)} <span class="small">(${esc(i.kind)} · SHA-256 ${esc(i.sha256.slice(0, 12))}…)</span></li>`)
    .join("");
  const body = `<h1>${esc(deal?.title ?? "Loan package")}</h1>
<p>Package version ${r.pkg.version} · ${r.pkg.manifest.length} document${r.pkg.manifest.length === 1 ? "" : "s"} · available until ${esc(new Date(r.link.expiresAt).toUTCString())}</p>
${r.newerVersionAvailable ? "<p><strong>A newer version of this package exists.</strong> Ask your Kubera contact for the current link.</p>" : ""}
<ul>${list}</ul><p class="small">Download links expire after 5 minutes; reload this page for fresh ones.</p>`;
  return page(deal?.title ?? "Loan package", body, 200);
}
