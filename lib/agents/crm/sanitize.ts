// Text that reaches Twenty. Notes and tasks are built from inbound email, call
// transcripts and model output, all untrusted: strip control characters and
// markup, neutralise links and images (a planted link in a CRM note is a
// phishing vector), mask restricted values (SSNs, account numbers) and cap
// lengths. Applied by the builders and again by the writer.

import { redactText } from "@/lib/privacy/classification";

const CONTROL = new RegExp(
  ["[", String.raw`\u0000-\u0008`, String.raw`\u000B\u000C`, String.raw`\u000E-\u001F`, String.raw`\u007F`, String.raw`​-‏`, String.raw`‪-‮`, String.raw`⁦-⁩`, "]"].join(""),
  "g",
);

/** One line of plain text (titles, labels). */
export function cleanLine(input: string, max: number): string {
  return redactText(
    input
      .replace(CONTROL, "")
      .replace(/<[^>]*>/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
    "confidential",
  ).slice(0, max);
}

/** Multi-line markdown with no raw HTML, images, links or autolinked URLs. */
export function cleanMarkdown(input: string, max: number): string {
  const text = input
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/<[^>]*>/g, "")
    // ![alt](url) and [text](url) keep only the visible text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Bare URLs are defanged so the CRM does not autolink them.
    .replace(/\bhttps?:\/\/\S+/gi, (u) => u.replace(/^http/i, "hxxp"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return redactText(text, "confidential").slice(0, max);
}
