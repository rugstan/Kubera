// Persistence contract for principals and borrower-portal magic links, with
// in-memory implementations for tests. Stores only ever see sealed rows:
// restricted columns hold `pii1.` envelopes (the memory store enforces the
// same rule the migration's check constraints do).

import { randomUUID } from "node:crypto";
import { isEncrypted } from "@/lib/privacy/crypto";
import type { PrincipalRow } from "./types";

export class PrincipalConcurrencyError extends Error {
  constructor() {
    super("This principal was changed by someone else; reload and try again");
    this.name = "PrincipalConcurrencyError";
  }
}

export type PrincipalUpdate = Partial<Omit<PrincipalRow, "id" | "dealId" | "version" | "createdAt" | "updatedAt">>;

export interface PrincipalStore {
  insert(row: Omit<PrincipalRow, "version" | "createdAt" | "updatedAt">, now: Date): Promise<PrincipalRow>;
  get(id: string): Promise<PrincipalRow | null>;
  forDeal(dealId: string): Promise<PrincipalRow[]>;
  update(id: string, expectedVersion: number, patch: PrincipalUpdate, now: Date): Promise<PrincipalRow>;
  /** Removes a principal with no children on the chart. */
  remove(id: string): Promise<void>;
  /** Other principal records with the same tax id (blind index), across deals. */
  findByTaxIdIndex(index: string): Promise<{ id: string; dealId: string; legalName: string }[]>;
}

const RESTRICTED: (keyof PrincipalRow)[] = ["ssnEnc", "dobEnc", "pfsEnc", "form1919Enc"];

export function assertSealed(row: Partial<PrincipalRow>): void {
  for (const k of RESTRICTED) {
    const v = row[k];
    if (v !== undefined && v !== null && !isEncrypted(v)) throw new Error(`principals.${String(k)} must be encrypted before it is stored`);
  }
}

export class MemoryPrincipalStore implements PrincipalStore {
  readonly rows = new Map<string, PrincipalRow>();

  async insert(row: Omit<PrincipalRow, "version" | "createdAt" | "updatedAt">, now: Date) {
    assertSealed(row);
    if (this.rows.has(row.id)) throw new Error("duplicate principal id");
    if (row.parentId) {
      const parent = this.rows.get(row.parentId);
      if (!parent || parent.dealId !== row.dealId) throw new Error("parent principal must be on the same deal");
    }
    const ts = now.toISOString();
    const full: PrincipalRow = { ...structuredClone(row), version: 1, createdAt: ts, updatedAt: ts };
    this.rows.set(full.id, full);
    return structuredClone(full);
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async forDeal(dealId: string) {
    return [...this.rows.values()].filter((r) => r.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => structuredClone(r));
  }

  async update(id: string, expectedVersion: number, patch: PrincipalUpdate, now: Date) {
    assertSealed(patch);
    const cur = this.rows.get(id);
    if (!cur) throw new Error(`Principal ${id} not found`);
    if (cur.version !== expectedVersion) throw new PrincipalConcurrencyError();
    const next: PrincipalRow = { ...cur, ...structuredClone(patch), version: cur.version + 1, updatedAt: now.toISOString() };
    this.rows.set(id, next);
    return structuredClone(next);
  }

  async remove(id: string) {
    if ([...this.rows.values()].some((r) => r.parentId === id)) throw new Error("Remove this entity's owners first");
    this.rows.delete(id);
  }

  async findByTaxIdIndex(index: string) {
    return [...this.rows.values()].filter((r) => r.taxIdIndex === index).map((r) => ({ id: r.id, dealId: r.dealId, legalName: r.legalName }));
  }
}

// --- Portal magic links --------------------------------------------------------------------

export type PortalInvite = {
  id: string;
  dealId: string;
  principalId: string | null;
  email: string;
  /** SHA-256 of the link token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  /** Portal sessions started from this link end at this time. */
  sessionExpiresAt: string | null;
  createdBy: string;
  createdAt: string;
};

export interface PortalInviteStore {
  insert(invite: Omit<PortalInvite, "id" | "createdAt" | "consumedAt" | "revokedAt" | "sessionExpiresAt">, now: Date): Promise<PortalInvite>;
  get(id: string): Promise<PortalInvite | null>;
  getByTokenHash(tokenHash: string): Promise<PortalInvite | null>;
  /** Marks the link used, only if it is still unused; returns the updated row or null when someone else won. */
  consume(id: string, sessionExpiresAt: string, now: Date): Promise<PortalInvite | null>;
  revoke(id: string, now: Date): Promise<void>;
  /**
   * Replaces the token of a still-usable link (not used, revoked or expired);
   * the previous link stops working. Returns the updated row, or null.
   */
  rotateToken(id: string, tokenHash: string, now: Date): Promise<PortalInvite | null>;
  forDeal(dealId: string): Promise<PortalInvite[]>;
}

export class MemoryPortalInviteStore implements PortalInviteStore {
  readonly rows = new Map<string, PortalInvite>();

  async insert(invite: Omit<PortalInvite, "id" | "createdAt" | "consumedAt" | "revokedAt" | "sessionExpiresAt">, now: Date) {
    const row: PortalInvite = { ...invite, id: randomUUID(), createdAt: now.toISOString(), consumedAt: null, revokedAt: null, sessionExpiresAt: null };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async getByTokenHash(tokenHash: string) {
    const r = [...this.rows.values()].find((x) => x.tokenHash === tokenHash);
    return r ? { ...r } : null;
  }

  async rotateToken(id: string, tokenHash: string, now: Date) {
    const r = this.rows.get(id);
    if (!r || r.consumedAt || r.revokedAt || Date.parse(r.expiresAt) <= now.getTime()) return null;
    const next = { ...r, tokenHash };
    this.rows.set(id, next);
    return { ...next };
  }

  async consume(id: string, sessionExpiresAt: string, now: Date) {
    const r = this.rows.get(id);
    if (!r || r.consumedAt || r.revokedAt) return null;
    const next = { ...r, consumedAt: now.toISOString(), sessionExpiresAt };
    this.rows.set(id, next);
    return { ...next };
  }

  async revoke(id: string, now: Date) {
    const r = this.rows.get(id);
    if (r && !r.revokedAt) this.rows.set(id, { ...r, revokedAt: now.toISOString() });
  }

  async forDeal(dealId: string) {
    return [...this.rows.values()].filter((r) => r.dealId === dealId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => ({ ...r }));
  }
}
