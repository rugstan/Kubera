// Expiring, per-lender share links to one locked package version. Only the
// SHA-256 of the token is stored; the token itself is shown once, when the
// link is created, and travels only in the approved outreach message.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DealDeskStore } from "./store";
import type { DealPackage, ShareLink } from "./types";

export const SHARE_LINK_DEFAULT_TTL_DAYS = 14;
export const SHARE_LINK_MAX_TTL_DAYS = 30;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN.test(token);
}

/** Constant-time comparison of a presented token against a stored hash. */
export function tokenMatches(token: string, tokenHash: string): boolean {
  if (!isWellFormedToken(token) || !/^[0-9a-f]{64}$/.test(tokenHash)) return false;
  return timingSafeEqual(Buffer.from(hashShareToken(token), "hex"), Buffer.from(tokenHash, "hex"));
}

export function shareLinkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/deals/share/${token}`;
}

export async function createShareLink(
  store: DealDeskStore,
  input: { pkg: DealPackage; lenderId: string; createdBy: string; ttlDays?: number; now: Date },
): Promise<{ token: string; link: ShareLink }> {
  if (input.pkg.status !== "locked") throw new Error("Share links point only at locked package versions");
  const ttl = Math.min(Math.max(input.ttlDays ?? SHARE_LINK_DEFAULT_TTL_DAYS, 1), SHARE_LINK_MAX_TTL_DAYS);
  const token = newShareToken();
  const link = await store.insertShareLink(
    {
      dealId: input.pkg.dealId,
      lenderId: input.lenderId,
      packageId: input.pkg.id,
      packageVersion: input.pkg.version,
      tokenHash: hashShareToken(token),
      createdBy: input.createdBy,
      expiresAt: new Date(input.now.getTime() + ttl * 86_400_000).toISOString(),
    },
    input.now,
  );
  return { token, link };
}

export type ShareResolution =
  | { status: "ok"; link: ShareLink; pkg: DealPackage; newerVersionAvailable: boolean }
  | { status: "not_found" | "expired" | "revoked" };

/**
 * Resolves a presented token. Counts the access only when the link is valid;
 * always serves the exact version the link was issued for.
 */
export async function resolveShareLink(store: DealDeskStore, token: string, now: Date): Promise<ShareResolution> {
  if (!isWellFormedToken(token)) return { status: "not_found" };
  const hash = hashShareToken(token);
  const link = await store.getShareLinkByHash(hash);
  if (!link) return { status: "not_found" };
  if (link.revokedAt) return { status: "revoked" };
  if (Date.parse(link.expiresAt) <= now.getTime()) return { status: "expired" };
  const counted = await store.recordShareLinkAccess(hash, now);
  if (!counted) return { status: "expired" };
  const pkg = await store.getPackage(link.packageId);
  if (!pkg || pkg.status !== "locked" || pkg.version !== link.packageVersion) return { status: "not_found" };
  const versions = await store.listPackages(link.dealId);
  const newerVersionAvailable = versions.some((p) => p.status === "locked" && p.version > pkg.version);
  return { status: "ok", link: counted, pkg, newerVersionAvailable };
}
