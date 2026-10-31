// Self-contained HTML rendering of a disclosure (staff preview, borrower copy
// in the portal, and the text that the PDF mirrors). Every value is escaped.

import type { DocumentSpec } from "./mlds";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function renderDisclosureHtml(doc: DocumentSpec): string {
  const e = escapeHtml;
  const sections = doc.sections
    .map((s) => {
      const rows = s.rows?.length
        ? `<table><tbody>${s.rows.map((r) => `<tr${r.emphasis ? ' class="em"' : ""}><th scope="row">${e(r.label)}</th><td>${e(r.value)}</td></tr>`).join("")}</tbody></table>`
        : "";
      const paras = (s.paragraphs ?? []).map((p) => `<p>${e(p)}</p>`).join("");
      return `<section><h2>${e(s.title)}</h2>${rows}${paras}</section>`;
    })
    .join("");
  const notice = doc.notice.map((n) => `<p class="draft" role="note">${e(n)}</p>`).join("");
  const signatures = doc.signatureLines
    .map((s) => `<div class="sig"><div class="line"></div><p>${e(s.label)}: ${e(s.name)}${s.detail ? ` (${e(s.detail)})` : ""}</p><p>Date: ____________</p></div>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(doc.title)}</title>
<style>
body{font-family:Inter,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f;background:#fff;margin:0 auto;max-width:820px;padding:32px 16px;font-size:14px;line-height:1.5}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #d2d2d7;padding-bottom:4px}
.sub{color:#424245;font-size:12px;margin:0 0 16px}
.draft{border:2px solid #b42318;color:#b42318;font-weight:700;padding:8px 12px;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:4px 8px;border-bottom:1px solid #f0f0f2}
th{font-weight:500;width:55%}tr.em th,tr.em td{font-weight:700}
.sig{margin-top:28px}.line{border-bottom:1px solid #1d1d1f;height:28px;max-width:360px}
footer{margin-top:32px;color:#424245;font-size:12px}
</style>
</head>
<body>
<header><h1>${e(doc.title)}</h1><p class="sub">${e(doc.subtitle)}</p>${notice}</header>
<main>${sections}<section><h2>Signatures</h2>${signatures}</section></main>
<footer>${e(doc.footer)}</footer>
</body>
</html>`;
}
