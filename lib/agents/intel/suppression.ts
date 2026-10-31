// Do-not-contact list for prospecting (WS-S).
//
// Cold outreach to a property owner is only acceptable if "no" sticks. The
// list stores SHA-256 hashes of normalized values (email, owner name, mailing
// or property address) plus a masked label for staff, and is checked when a
// scan stores a prospect, when a draft is created and again right before a
// send. A prospect whose email, owner or address matches is never drafted
// for. The shared consent ledger is checked too (a revoked email consent
// blocks), see outreach.ts.

import { createHash } from "node:crypto";
import type { Prospect, SuppressionKind } from "./types";

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "live.com", "msn.com", "me.com"]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Owner and address text: lower case, punctuation to spaces, common suffix variants collapsed. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(limited liability company)\b/g, "llc")
    .replace(/\bl l c\b/g, "llc")
    .replace(/\bl l p\b/g, "llp")
    .replace(/\bl p\b/g, "lp")
    .replace(/\b(incorporated)\b/g, "inc")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeValue(kind: SuppressionKind, raw: string): string {
  switch (kind) {
    case "email":
      return normalizeEmail(raw);
    case "domain":
      return raw.trim().toLowerCase().replace(/^@/, "");
    default:
      return normalizeText(raw);
  }
}

export function suppressionHash(kind: SuppressionKind, raw: string): string {
  return createHash("sha256").update(`${kind}:${normalizeValue(kind, raw)}`).digest("hex");
}

/** "j***@example.com" / "Acme P***" / "123 M*** St": enough for staff to recognize the entry. */
export function maskLabel(kind: SuppressionKind, raw: string): string {
  const v = raw.trim();
  if (kind === "email") {
    const [local = "", domain = ""] = v.split("@");
    return `${local.slice(0, 1).toLowerCase()}***@${domain.toLowerCase()}`.slice(0, 120);
  }
  if (kind === "domain") return v.replace(/^@/, "").slice(0, 120);
  const words = v.split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w : `${w.slice(0, 1)}***`)).join(" ").slice(0, 120) || "entry";
}

export type SuppressionKey = { kind: SuppressionKind; hash: string };

const addressOf = (line1: string | null | undefined, zip: string | null | undefined) => (line1 ? `${line1} ${zip ?? ""}`.trim() : null);

/** Every list entry that would block outreach to this prospect. */
export function suppressionKeys(p: Pick<Prospect, "contactEmail" | "ownerName" | "addressLine1" | "zip" | "mailing">): SuppressionKey[] {
  const out: SuppressionKey[] = [];
  if (p.contactEmail) {
    out.push({ kind: "email", hash: suppressionHash("email", p.contactEmail) });
    const domain = normalizeEmail(p.contactEmail).split("@")[1];
    if (domain && !FREE_MAIL.has(domain)) out.push({ kind: "domain", hash: suppressionHash("domain", domain) });
  }
  if (p.ownerName) out.push({ kind: "owner", hash: suppressionHash("owner", p.ownerName) });
  const property = addressOf(p.addressLine1, p.zip);
  if (property) out.push({ kind: "address", hash: suppressionHash("address", property) });
  const mailing = addressOf(p.mailing?.line1, p.mailing?.zip);
  if (mailing) out.push({ kind: "address", hash: suppressionHash("address", mailing) });
  return out;
}

export interface SuppressionLookup {
  /** The entries among `keys` that are on the list. */
  find(keys: readonly SuppressionKey[]): Promise<{ kind: SuppressionKind; label: string }[]>;
}

export async function isSuppressed(lookup: SuppressionLookup, p: Parameters<typeof suppressionKeys>[0]): Promise<{ suppressed: boolean; matches: { kind: SuppressionKind; label: string }[] }> {
  const keys = suppressionKeys(p);
  if (!keys.length) return { suppressed: false, matches: [] };
  const matches = await lookup.find(keys);
  return { suppressed: matches.length > 0, matches };
}
