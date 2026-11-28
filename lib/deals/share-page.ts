// Lender-facing view of a share link: lists the documents in the locked
// package version with short-lived signed download URLs. Responses are
// uncacheable and unindexed; unknown, expired and revoked links look alike to
// the visitor (no oracle), while the access count records valid opens only.
//
// When the locked manifest holds a deal summary (kind DEAL_SUMMARY), the
// summary the lender was shown is loaded from deal_summaries by the PDF's
// SHA-256 and rendered above the documents, which are then grouped by kind.
// Every value is HTML-escaped. Without a summary the page is unchanged.

import { DEAL_SUMMARY_KIND } from "@/lib/agents/lenders/package";
import { licenseLine } from "@/lib/site";
import { resolveShareLink } from "./share-links";
import type { DealDeskStore } from "./store";
import type { DealSummarySpec, SubmissionStore } from "./submission/types";
import type { PackageItem } from "./types";

export type ShareDeps = {
  store: DealDeskStore;
  /** Signed URL for a vault object (5 minutes), or null when storage is unavailable. */
  signUrl: (storagePath: string) => Promise<string | null>;
  now: () => Date;
  /** True when this client may make another request. */
  allow: (key: string) => Promise<boolean>;
  /** Locked deal summaries (deal_summaries). Null: the page lists documents only. */
  summaries: Pick<SubmissionStore, "getSummaryByPdfSha"> | null;
};

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

// This standalone page does not load app/globals.css; these mirror its design tokens.
const TOKENS = ":root{--color-canvas:#f5f5f7;--color-surface:#ffffff;--color-ink:#1d1d1f;--color-titanium:#6e6e73;--color-accent:#047857}";

// Summary layout: wraps at phone width, no horizontal scroll (tables scroll inside their own box).
const SUMMARY_CSS =
  "section.summary{margin:16px 0 24px;border-top:1px solid #d2d2d7;padding-top:8px}.tiles{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.tile{border:1px solid #d2d2d7;border-radius:12px;padding:8px 12px;min-width:120px}.tile b{display:block;font-size:18px}.tile span{color:var(--color-titanium);font-size:12px}h3{font-size:15px;margin:18px 0 6px}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:4px 8px 4px 0;border-bottom:1px solid #f0f0f2;overflow-wrap:anywhere}th{font-weight:500;color:var(--color-titanium);width:34%}td.src{color:var(--color-titanium);font-size:12px;width:24%}thead th{color:var(--color-ink);font-weight:600}";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status: number, extraCss = ""): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>${TOKENS}body{font-family:-apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;background:var(--color-canvas);color:var(--color-ink);margin:0;padding:24px 16px}main{max-width:720px;margin:0 auto;background:var(--color-surface);border-radius:20px;padding:24px}a{color:var(--color-accent)}li{margin:8px 0}p.small{color:var(--color-titanium);font-size:13px}${extraCss}</style></head>
<body><main>${body}<p class="small">${esc(licenseLine())}. Corin is the broker, not the lender. This link is for the addressed institution only.</p></main></body></html>`;
  return new Response(html, { status, headers: HEADERS });
}

/** The locked summary as HTML (every value escaped). */
export function summaryHtml(spec: DealSummarySpec): string {
  const tiles = spec.headline.length ? `<div class="tiles">${spec.headline.map((h) => `<div class="tile"><span>${esc(h.label)}</span><b>${esc(h.value)}</b></div>`).join("")}</div>` : "";
  const sections = spec.sections
    .map((s) => {
      const rows = s.rows?.length ? `<div class="scroll"><table>${s.rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${esc(r.value)}</td><td class="src">${esc(r.source ?? "")}</td></tr>`).join("")}</table></div>` : "";
      const table = s.table?.rows.length
        ? `<div class="scroll"><table><thead><tr>${s.table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
        : "";
      const paras = (s.paragraphs ?? []).map((p) => `<p>${esc(p)}</p>`).join("");
      return `<h3>${esc(s.title)}</h3>${rows}${table}${paras}`;
    })
    .join("");
  return `<section class="summary" aria-labelledby="deal-summary"><h2 id="deal-summary">${esc(spec.title)}</h2><p class="small">${esc(spec.subtitle)}</p>${tiles}${sections}</section>`;
}

const KIND_GROUPS: [string, string][] = [
  [DEAL_SUMMARY_KIND, "Deal summary"],
  ["EXECUTIVE_SUMMARY", "Executive summary"],
  ["T12", "Operating statements"],
  ["RENT_ROLL", "Rent rolls"],
  ["CENSUS", "Census"],
  ["STR_REPORT", "STR reports"],
  ["APPRAISAL", "Appraisals"],
  ["FRANCHISE_AGREEMENT", "Franchise agreements"],
  ["PIP_BUDGET", "PIP budgets"],
  ["PFS", "Sponsor financial statements"],
  ["TAX_RETURN", "Tax returns"],
  ["OTHER", "Other documents"],
];

type SignedItem = PackageItem & { url: string | null };

const itemHtml = (i: SignedItem) => `<li>${i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer">${esc(i.label)}</a>` : esc(i.label)} <span class="small">(${esc(i.kind)} · SHA-256 ${esc(i.sha256.slice(0, 12))}…)</span></li>`;

function groupedDocuments(items: SignedItem[]): string {
  const known = new Set(KIND_GROUPS.map(([k]) => k));
  const groups = KIND_GROUPS.map(([kind, label]) => [label, items.filter((i) => i.kind === kind || (kind === "OTHER" && !known.has(i.kind)))] as const).filter(([, list]) => list.length);
  return `<h2>Documents</h2>${groups.map(([label, list]) => `<h3>${esc(label)}</h3><ul>${list.map(itemHtml).join("")}</ul>`).join("")}`;
}

async function lockedSummary(deps: ShareDeps, dealId: string, manifest: readonly PackageItem[]): Promise<DealSummarySpec | null> {
  const item = manifest.find((i) => i.kind === DEAL_SUMMARY_KIND);
  if (!item || !deps.summaries) return null;
  try {
    const record = await deps.summaries.getSummaryByPdfSha(dealId, item.sha256);
    return record && record.dealId === dealId ? record.spec : null;
  } catch (err) {
    // The documents still serve; the summary PDF is among them.
    console.error("[deals] share-page summary lookup failed", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function handleShareRequest(token: string, clientKey: string, deps: ShareDeps): Promise<Response> {
  if (!(await deps.allow(`share:${clientKey}`))) return page("Too many requests", "<h1>Too many requests</h1><p>Try again in a minute.</p>", 429);
  const r = await resolveShareLink(deps.store, token, deps.now());
  if (r.status !== "ok") return page("Link unavailable", "<h1>This link is not available</h1><p>It may have expired or been withdrawn. Ask your Corin contact for a new one.</p>", 404);
  const deal = await deps.store.getDeal(r.link.dealId);
  const [items, summary] = await Promise.all([Promise.all(r.pkg.manifest.map(async (i) => ({ ...i, url: await deps.signUrl(i.storagePath) }))), lockedSummary(deps, r.link.dealId, r.pkg.manifest)]);
  const header = `<h1>${esc(deal?.title ?? "Loan package")}</h1>
<p>Package version ${r.pkg.version} · ${r.pkg.manifest.length} document${r.pkg.manifest.length === 1 ? "" : "s"} · available until ${esc(new Date(r.link.expiresAt).toUTCString())}</p>
${r.newerVersionAvailable ? "<p><strong>A newer version of this package exists.</strong> Ask your Corin contact for the current link.</p>" : ""}`;
  const documents = summary ? groupedDocuments(items) : `<ul>${items.map(itemHtml).join("")}</ul>`;
  const body = `${header}${summary ? summaryHtml(summary) : ""}
${documents}<p class="small">Download links expire after 5 minutes; reload this page for fresh ones.</p>`;
  return page(deal?.title ?? "Loan package", body, 200, summary ? SUMMARY_CSS : "");
}
