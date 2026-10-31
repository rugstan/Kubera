/**
 * Escapes untrusted text for an XML-ish data block in a prompt, so an email
 * cannot close its <email> block or forge one of ours.
 */
export function escapeXmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
