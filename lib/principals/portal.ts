// Borrower portal magic links and sessions.
//
// A broker issues a link for one principal (or the deal's main contact). The
// link carries a random 256-bit token; only its SHA-256 is stored, it expires
// (PORTAL_LINK_TTL_HOURS, default 72) and works once. Redeeming it starts a
// portal session: an HMAC-signed, httpOnly cookie (PORTAL_SESSION_SECRET)
// scoped to that deal and principal, re-checked against the invite row on
// every request so revoking the invite ends the session.
//
// Sending the link by email is an outbound action, so it goes through the
// broker approval gate (Global rule 2). The approval request carries the
// invite id, recipient and expiry only, never the link: the approvals queue is
// readable by every staff role. Once a broker approves, the portal_invite
// executor (lib/principals/portal-mail.ts) mints a fresh token for the same
// invite and emails it, so the link the issuing broker copied stops working.
// The broker can instead copy the link and send it from their own mailbox.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveAuthMode } from "@/lib/auth/config";
import type { ApprovalDecision, ApprovalGate } from "@/lib/compliance/approval-gate";
import type { PortalInvite, PortalInviteStore } from "./store";

export const PORTAL_COOKIE = "corin_portal";
const HOUR = 3_600_000;

export type PortalSession = { inviteId: string; dealId: string; principalId: string | null; email: string; expiresAt: string };

export class PortalLinkError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "expired" | "used" | "revoked" | "unconfigured",
  ) {
    super(message);
    this.name = "PortalLinkError";
  }
}

/**
 * Public, demo-only session secret for fake-auth mode (local development and
 * e2e), where the portal runs on the in-memory demo desks (lib/deals/demo.ts).
 * It signs sessions for invented data only; fake mode is refused in production.
 */
export const DEMO_PORTAL_SESSION_SECRET = "corin-demo-portal-session-secret-not-for-production";

export function portalSessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.PORTAL_SESSION_SECRET?.trim();
  if (s && s.length >= 32) return s;
  return resolveAuthMode(env).mode === "fake" ? DEMO_PORTAL_SESSION_SECRET : null;
}

export function portalConfig(env: Record<string, string | undefined> = process.env) {
  const ttl = Number(env.PORTAL_LINK_TTL_HOURS);
  const session = Number(env.PORTAL_SESSION_TTL_HOURS);
  return {
    linkTtlHours: Number.isFinite(ttl) && ttl >= 1 && ttl <= 168 ? ttl : 72,
    sessionTtlHours: Number.isFinite(session) && session >= 1 && session <= 24 ? session : 8,
  };
}

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export type IssueInput = {
  dealId: string;
  principalId: string | null;
  email: string;
  issuedBy: string;
  /** Site origin for the link, e.g. https://corincommercial.com. */
  origin: string;
  now: Date;
  ttlHours?: number;
};

export type IssuedInvite = { invite: PortalInvite; url: string; email: ApprovalDecision["status"] | "not_requested"; approval?: ApprovalDecision };

export const newPortalToken = () => randomBytes(32).toString("base64url");

export function portalLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/portal/access?token=${encodeURIComponent(token)}`;
}

/** Idempotency key (and approval key) of the invitation email for an invite. */
export const portalInviteEmailKey = (inviteId: string) => `email:portal_invite:${inviteId}`;
export const PORTAL_INVITE_TEMPLATE = "portal_invite";

/** What the broker approves for the invitation email: no link, no token. */
export type PortalInviteApprovalPayload = { to: string; dealId: string; principalId: string | null; inviteId: string; expiresAt: string };

/**
 * Creates a single-use link. The URL (with its token) is returned once to the
 * issuing broker and never stored; the email approval names the invite only.
 */
export async function issuePortalInvite(store: PortalInviteStore, input: IssueInput, mail?: { gate: ApprovalGate }): Promise<IssuedInvite> {
  const token = newPortalToken();
  const ttl = input.ttlHours ?? portalConfig().linkTtlHours;
  const invite = await store.insert(
    { dealId: input.dealId, principalId: input.principalId, email: input.email.trim().toLowerCase(), tokenHash: hashToken(token), expiresAt: new Date(input.now.getTime() + ttl * HOUR).toISOString(), createdBy: input.issuedBy },
    input.now,
  );
  const url = portalLinkUrl(input.origin, token);
  if (!mail) return { invite, url, email: "not_requested" };
  const payload: PortalInviteApprovalPayload = { to: invite.email, dealId: invite.dealId, principalId: invite.principalId, inviteId: invite.id, expiresAt: invite.expiresAt };
  const decision = await mail.gate.request({
    kind: "email",
    idempotencyKey: portalInviteEmailKey(invite.id),
    summary: `Send the borrower portal link to ${invite.email}`,
    templateId: PORTAL_INVITE_TEMPLATE,
    payload,
    requestedBy: input.issuedBy,
  });
  return { invite, url, email: decision.status, approval: decision };
}

/** Redeems a link: validates and consumes it, returning the session to set. */
export async function redeemPortalLink(store: PortalInviteStore, token: string, now: Date, sessionTtlHours = portalConfig().sessionTtlHours): Promise<PortalSession> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PortalLinkError("This link is not valid.", "invalid");
  const invite = await store.getByTokenHash(hashToken(token));
  if (!invite) throw new PortalLinkError("This link is not valid.", "invalid");
  if (invite.revokedAt) throw new PortalLinkError("This link was cancelled. Ask your advisor for a new one.", "revoked");
  if (invite.consumedAt) throw new PortalLinkError("This link was already used. Ask your advisor for a new one.", "used");
  if (Date.parse(invite.expiresAt) <= now.getTime()) throw new PortalLinkError("This link has expired. Ask your advisor for a new one.", "expired");
  const expiresAt = new Date(now.getTime() + sessionTtlHours * HOUR).toISOString();
  const consumed = await store.consume(invite.id, expiresAt, now);
  if (!consumed) throw new PortalLinkError("This link was already used. Ask your advisor for a new one.", "used");
  return { inviteId: invite.id, dealId: invite.dealId, principalId: invite.principalId, email: invite.email, expiresAt };
}

// --- Session cookie --------------------------------------------------------------------------------

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`portal-session:v1:${payload}`).digest("base64url");
}

export function encodeSession(session: PortalSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, i: session.inviteId, d: session.dealId, p: session.principalId, e: session.email, x: session.expiresAt })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(value: string | undefined, secret: string, now: Date): PortalSession | null {
  if (!value) return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; i?: string; d?: string; p?: string | null; e?: string; x?: string };
    if (o.v !== 1 || !o.i || !o.d || !o.e || !o.x) return null;
    if (Date.parse(o.x) <= now.getTime()) return null;
    return { inviteId: o.i, dealId: o.d, principalId: o.p ?? null, email: o.e, expiresAt: o.x };
  } catch {
    return null;
  }
}

/** Full check for each request: signature, expiry, and the invite still live with the same session. */
export async function verifySession(store: PortalInviteStore, value: string | undefined, secret: string, now: Date): Promise<PortalSession | null> {
  const s = decodeSession(value, secret, now);
  if (!s) return null;
  const invite = await store.get(s.inviteId);
  if (!invite || invite.revokedAt || !invite.consumedAt || invite.sessionExpiresAt !== s.expiresAt || invite.dealId !== s.dealId) return null;
  return s;
}
