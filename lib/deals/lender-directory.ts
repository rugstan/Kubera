// Lender directory service: contact info, contact persons and account numbers
// for a panel lender, plus the audited reveal of a sealed account number.
// Pure (no server-only): the server actions pass the runtime's store, clock and
// keyring, and tests pass in-memory ones.
//
// Every function validates its input with the schemas in lender-contacts.ts /
// lender-accounts.ts and checks the lender exists before touching the store;
// every store call filters on the lender id as well as the row id, so an id
// swapped across lenders never touches another lender's row.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditSink } from "@/lib/auth/audit";
import { piiKeyring, type PiiKeyring } from "@/lib/privacy/crypto";
import { openLenderAccountNumber, parseLenderAccount, sealLenderAccountNumber } from "./lender-accounts";
import { LenderDirectoryError, parseLenderContact, parseLenderContactInfo } from "./lender-contacts";
import { explainLenderLoanTypes, lenderLoanTypes, sortLoanTypes, type LenderLoanType, type LoanTypeReason } from "./loan-types";
import { can, type StaffSession } from "./session";
import { ConcurrentUpdateError, type DealDeskStore } from "./store";
import type { LenderAccount, LenderContact, LenderContactInfo, LenderPanelEntry } from "./types";

export type DirectoryDeps = { store: DealDeskStore; now: () => Date; keyring?: PiiKeyring | null };

async function lenderOrThrow(deps: DirectoryDeps, lenderId: string): Promise<LenderPanelEntry> {
  const lender = await deps.store.getLender(lenderId);
  if (!lender) throw new LenderDirectoryError("Lender not found");
  return lender;
}

/** Keeps a stored address when only its letter case differs (the legacy rows keep theirs, so the approval recipient does not change). */
const sameEmail = (next: string | null, cur: string | null) => (next !== null && cur !== null && next.toLowerCase() === cur.toLowerCase() ? cur : next);

// --- Contacts ---------------------------------------------------------------------------------------

export async function addLenderContact(deps: DirectoryDeps, lenderId: string, rawInput: unknown, opts: { makePrimary?: boolean }, actor: string): Promise<LenderContact> {
  const input = parseLenderContact(rawInput);
  await lenderOrThrow(deps, lenderId);
  const contact = await deps.store.insertLenderContact({ ...input, lenderId }, actor, deps.now());
  return opts.makePrimary ? deps.store.setPrimaryLenderContact(lenderId, contact.id, actor, deps.now()) : contact;
}

export async function editLenderContact(deps: DirectoryDeps, lenderId: string, contactId: string, expectedVersion: number, rawInput: unknown, actor: string): Promise<LenderContact> {
  await lenderOrThrow(deps, lenderId);
  const cur = await deps.store.getLenderContact(lenderId, contactId);
  if (!cur) throw new ConcurrentUpdateError("Lender contact");
  // A directory-imported contact keeps that source until staff pick another one.
  const raw = rawInput && typeof rawInput === "object" ? { ...(rawInput as Record<string, unknown>) } : {};
  const keepImport = cur.source === "directory_import" && raw.source === "directory_import";
  if (keepImport) delete raw.source;
  const input = parseLenderContact(raw);
  return deps.store.updateLenderContact(lenderId, contactId, expectedVersion, { ...input, email: sameEmail(input.email, cur.email), source: keepImport ? "directory_import" : input.source }, actor, deps.now());
}

export const LENDER_CONTACT_OPS = ["make_primary", "clear_primary", "mark_left", "reactivate", "verify", "delete"] as const;
export type LenderContactOp = (typeof LENDER_CONTACT_OPS)[number];

/** One-click contact changes. Returns null after a delete. */
export async function lenderContactOp(
  deps: DirectoryDeps,
  input: { lenderId: string; contactId: string; expectedVersion: number; op: LenderContactOp },
  actor: string,
): Promise<LenderContact | null> {
  const { lenderId, contactId, expectedVersion, op } = input;
  await lenderOrThrow(deps, lenderId);
  const now = deps.now();
  const patch = (p: Parameters<DealDeskStore["updateLenderContact"]>[3]) => deps.store.updateLenderContact(lenderId, contactId, expectedVersion, p, actor, now);
  switch (op) {
    case "make_primary": {
      const cur = await deps.store.getLenderContact(lenderId, contactId);
      if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Lender contact");
      return deps.store.setPrimaryLenderContact(lenderId, contactId, actor, now);
    }
    case "clear_primary":
      return patch({ isPrimary: false });
    case "mark_left":
      return patch({ status: "left", leftAt: now.toISOString(), isPrimary: false });
    case "reactivate":
      return patch({ status: "active", leftAt: null });
    case "verify":
      return patch({ verifiedAt: now.toISOString(), verifiedBy: actor });
    case "delete": {
      const cur = await deps.store.getLenderContact(lenderId, contactId);
      if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError("Lender contact");
      await deps.store.deleteLenderContact(lenderId, contactId);
      return null;
    }
  }
}

// --- Contact info -------------------------------------------------------------------------------------

/**
 * Saves the lender-level contact info. A changed callback number or submission
 * inbox must be confirmed again, so changing the main phone, its extension or
 * the submission inbox clears the verification unless `verifiedNow`.
 */
export async function saveLenderContactInfo(
  deps: DirectoryDeps,
  lenderId: string,
  expectedVersion: number,
  rawInput: unknown,
  opts: { verifiedNow?: boolean },
  actor: string,
): Promise<LenderPanelEntry> {
  const input = parseLenderContactInfo(rawInput);
  const cur = await lenderOrThrow(deps, lenderId);
  const next: Partial<LenderContactInfo> = { ...input, submissionEmail: sameEmail(input.submissionEmail, cur.submissionEmail), generalEmail: sameEmail(input.generalEmail, cur.generalEmail) };
  const callbackChanged = next.mainPhone !== cur.mainPhone || next.mainPhoneExt !== cur.mainPhoneExt || next.submissionEmail !== cur.submissionEmail;
  const now = deps.now();
  if (opts.verifiedNow) Object.assign(next, { contactVerifiedAt: now.toISOString(), contactVerifiedBy: actor });
  else if (callbackChanged) Object.assign(next, { contactVerifiedAt: null, contactVerifiedBy: null });
  return deps.store.updateLenderContactInfo(lenderId, expectedVersion, next, actor, now);
}

// --- Account numbers -------------------------------------------------------------------------------------

/** Validates, seals under a fresh id (the AAD context), then stores. Without a key nothing is written (PiiKeyError). */
export async function addLenderAccount(deps: DirectoryDeps, lenderId: string, rawInput: unknown, actor: string): Promise<LenderAccount> {
  const input = parseLenderAccount(rawInput, { requireNumber: true });
  await lenderOrThrow(deps, lenderId);
  const id = randomUUID();
  const sealed = sealLenderAccountNumber(id, input.number!, deps.keyring);
  return deps.store.insertLenderAccount({ id, lenderId, kind: input.kind, label: input.label, notes: input.notes, ...sealed }, actor, deps.now());
}

/** Label and notes; a blank number keeps the stored one, a new one is sealed again under the same id. */
export async function editLenderAccount(deps: DirectoryDeps, lenderId: string, accountId: string, expectedVersion: number, rawInput: unknown, actor: string): Promise<LenderAccount> {
  await lenderOrThrow(deps, lenderId);
  const cur = (await deps.store.listLenderAccounts(lenderId)).find((a) => a.id === accountId);
  if (!cur) throw new ConcurrentUpdateError("Lender account");
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const input = parseLenderAccount({ ...raw, kind: cur.kind }, { requireNumber: false });
  const sealed = input.number === null ? {} : sealLenderAccountNumber(accountId, input.number, deps.keyring);
  return deps.store.updateLenderAccount(lenderId, accountId, expectedVersion, { label: input.label, notes: input.notes, ...sealed }, actor, deps.now());
}

export async function removeLenderAccount(deps: DirectoryDeps, lenderId: string, accountId: string): Promise<void> {
  await lenderOrThrow(deps, lenderId);
  await deps.store.deleteLenderAccount(lenderId, accountId);
}

// --- Reveal -------------------------------------------------------------------------------------------------

export type RevealDeps = DirectoryDeps & {
  audit: AuditSink | null;
  /** True when the request may proceed (lib/ratelimit.ts rateLimit). */
  allow: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  fingerprint: () => Promise<{ ipHash?: string; userAgent?: string }>;
};

export type RevealFailure = "forbidden" | "rate_limited" | "not_found" | "no_key" | "audit_unavailable" | "cannot_open";
export type RevealResult = { ok: true; value: string; label: string } | { ok: false; reason: RevealFailure };

export const REVEAL_LIMITS = { perTenMinutes: 10, perDay: 100 } as const;

/**
 * Opens one sealed account number for an admin or the designated officer.
 * Order (each early exit returns a reason, never the value): permission, rate
 * limits, the account under that lender, a key, then the audit event, written
 * before decrypting (fail closed), then decryption. The audit detail never
 * holds the value, its hint or its label.
 */
export async function revealLenderAccount(deps: RevealDeps, staff: StaffSession, ids: { lenderId: string; accountId: string }): Promise<RevealResult> {
  const denied = async (reason: "permission" | "rate_limited" | "not_found") => {
    try {
      await deps.audit?.record({
        actorId: staff.userId,
        actorLabel: staff.email,
        action: "lender.account_reveal_denied",
        targetType: "lender_account",
        targetId: ids.accountId,
        ...(await deps.fingerprint()),
        detail: { lenderId: ids.lenderId, reason },
      });
    } catch {
      // Best effort: the denial itself already fails closed.
    }
  };

  if (!can(staff, "reveal_account")) {
    await denied("permission");
    return { ok: false, reason: "forbidden" };
  }
  const allowed =
    (await deps.allow(`lender-reveal:10m:${staff.userId}`, REVEAL_LIMITS.perTenMinutes, 10 * 60_000)) && (await deps.allow(`lender-reveal:1d:${staff.userId}`, REVEAL_LIMITS.perDay, 86_400_000));
  if (!allowed) {
    await denied("rate_limited");
    return { ok: false, reason: "rate_limited" };
  }
  const account = await deps.store.getLenderAccountSecret(ids.lenderId, ids.accountId);
  if (!account) {
    await denied("not_found");
    return { ok: false, reason: "not_found" };
  }
  const keyring = deps.keyring ?? piiKeyring();
  if (!keyring) return { ok: false, reason: "no_key" };
  if (!deps.audit) return { ok: false, reason: "audit_unavailable" };
  try {
    await deps.audit.record({
      actorId: staff.userId,
      actorLabel: staff.email,
      action: "lender.account_reveal",
      targetType: "lender_account",
      targetId: account.id,
      ...(await deps.fingerprint()),
      detail: { lenderId: account.lenderId, kind: account.kind },
    });
  } catch {
    return { ok: false, reason: "audit_unavailable" };
  }
  try {
    return { ok: true, value: openLenderAccountNumber(account, keyring), label: account.label };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    if (name !== "PiiDecryptError" && name !== "PiiKeyError") throw err;
    console.error("[deals] lender account reveal failed", name);
    return { ok: false, reason: "cannot_open" };
  }
}

// --- Loan types ---------------------------------------------------------------------------------------

export type LoanTypeDeps = { store: DealDeskStore; now: () => Date; boxNotes?: (lenderId: string) => Promise<(string | null)[]> };

/** Suggested types for a stored lender (programs, category, notes, asset types, its credit-box notes). */
export async function suggestedLoanTypes(deps: LoanTypeDeps, lender: LenderPanelEntry): Promise<{ types: LenderLoanType[]; reasons: Map<LenderLoanType, LoanTypeReason[]> }> {
  const reasons = explainLenderLoanTypes({
    programs: lender.programs,
    category: lender.category,
    appetiteNotes: lender.appetiteNotes,
    assetTypes: lender.assetTypes,
    boxNotes: (await deps.boxNotes?.(lender.id)) ?? [],
  });
  return { types: sortLoanTypes(reasons.keys()), reasons };
}

const loanTypeList = z.array(z.enum(lenderLoanTypes)).max(lenderLoanTypes.length);

/**
 * op "save" stores the ticked types; op "suggest" stores the current suggestion.
 * `was` is the comma list the form was rendered with: a mismatch means someone else
 * changed them (ConcurrentUpdateError). The read-then-write window is accepted;
 * the cost of a lost update here is one re-tick.
 */
export async function saveLenderLoanTypes(
  deps: LoanTypeDeps,
  lenderId: string,
  input: { op: "save" | "suggest"; loanTypes: string[]; was: string },
  actor: string,
): Promise<{ lender: LenderPanelEntry; changed: boolean }> {
  const lender = await deps.store.getLender(lenderId);
  if (!lender) throw new LenderDirectoryError("Lender not found");
  const current = sortLoanTypes(lender.loanTypes).join(",");
  if (sortLoanTypes(input.was.split(",")).join(",") !== current) throw new ConcurrentUpdateError("Lender loan types");
  const next = input.op === "suggest" ? (await suggestedLoanTypes(deps, lender)).types : sortLoanTypes(loanTypeList.parse(input.loanTypes));
  if (next.join(",") === current) return { lender, changed: false };
  return { lender: await deps.store.updateLender(lenderId, { loanTypes: next }, actor, deps.now()), changed: true };
}
