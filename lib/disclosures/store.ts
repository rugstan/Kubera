// Persistence contract for disclosures and their append-only audit trail,
// plus an in-memory implementation for tests. The Supabase implementation is
// in store-supabase.ts (server only).

import type { EsignProviderName } from "@/lib/esign/types";
import type { DisclosureKind, DisclosureStatus } from "./state";

export type UetaConsent = {
  /** Version id of the consent text shown (lib/disclosures/ueta.ts). */
  textVersion: string;
  consentedAt: string;
  email: string;
  ip?: string;
  userAgent?: string;
};

export type DisclosureRecord = {
  id: string;
  kind: DisclosureKind;
  status: DisclosureStatus;
  version: number;
  leadId: string | null;
  dealId: string | null;
  twentyOpportunityId: string | null;
  supersedesId: string | null;
  applicationCompletedAt: string | null;
  borrowerObligatedAt: string | null;
  dueAt: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  signedAt: string | null;
  heldReason: string | null;
  flags: string[];
  templateVersion: string | null;
  payload: Record<string, unknown> | null;
  documentPath: string | null;
  documentSha256: string | null;
  signedDocumentPath: string | null;
  signedDocumentSha256: string | null;
  provider: EsignProviderName | null;
  providerRequestId: string | null;
  signerActions: { actionId: string; role: string; email: string; embedded: boolean }[];
  uetaConsent: UetaConsent[];
  retainUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewDisclosure = Pick<DisclosureRecord, "kind" | "status"> & Partial<Omit<DisclosureRecord, "id" | "kind" | "status" | "version" | "createdAt" | "updatedAt">>;

export type DisclosureEvent = {
  disclosureId: string;
  occurredAt: string;
  eventType: string;
  fromStatus: DisclosureStatus | null;
  toStatus: DisclosureStatus | null;
  actor: string;
  /** Provider event id; unique, so a redelivered webhook is recorded once. */
  providerEventId?: string;
  detail: Record<string, unknown>;
};

export class ConcurrentUpdateError extends Error {
  constructor(id: string) {
    super(`Disclosure ${id} was modified concurrently`);
    this.name = "ConcurrentUpdateError";
  }
}

export interface DisclosureStore {
  insert(record: NewDisclosure, now: Date): Promise<DisclosureRecord>;
  get(id: string): Promise<DisclosureRecord | null>;
  getByProviderRequest(provider: EsignProviderName, requestId: string): Promise<DisclosureRecord | null>;
  /** Current (non-superseded) disclosures for a lead or deal. */
  listForDeal(ref: { leadId?: string; dealId?: string }): Promise<DisclosureRecord[]>;
  /** Optimistic update: applies only when the stored version equals `expectedVersion`; bumps the version. */
  update(id: string, expectedVersion: number, patch: Partial<Omit<DisclosureRecord, "id" | "version" | "createdAt">>, now: Date): Promise<DisclosureRecord>;
  /** Append to the audit trail. Returns false when `providerEventId` was already recorded. */
  appendEvent(event: DisclosureEvent): Promise<boolean>;
  events(disclosureId: string): Promise<DisclosureEvent[]>;
  hasProviderEvent(providerEventId: string): Promise<boolean>;
}

/** Object storage for rendered and signed documents (private vault bucket). */
export interface DocumentStorage {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export class MemoryDisclosureStore implements DisclosureStore {
  readonly rows = new Map<string, DisclosureRecord>();
  readonly log: DisclosureEvent[] = [];
  private seq = 0;

  async insert(record: NewDisclosure, now: Date): Promise<DisclosureRecord> {
    this.seq += 1;
    const ts = now.toISOString();
    const row: DisclosureRecord = {
      leadId: null,
      dealId: null,
      twentyOpportunityId: null,
      supersedesId: null,
      applicationCompletedAt: null,
      borrowerObligatedAt: null,
      dueAt: null,
      generatedAt: null,
      sentAt: null,
      signedAt: null,
      heldReason: null,
      flags: [],
      templateVersion: null,
      payload: null,
      documentPath: null,
      documentSha256: null,
      signedDocumentPath: null,
      signedDocumentSha256: null,
      provider: null,
      providerRequestId: null,
      signerActions: [],
      uetaConsent: [],
      retainUntil: null,
      ...record,
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  async get(id: string): Promise<DisclosureRecord | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async getByProviderRequest(provider: EsignProviderName, requestId: string): Promise<DisclosureRecord | null> {
    for (const r of this.rows.values()) if (r.provider === provider && r.providerRequestId === requestId) return structuredClone(r);
    return null;
  }

  async listForDeal(ref: { leadId?: string; dealId?: string }): Promise<DisclosureRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.status !== "superseded" && ((ref.leadId && r.leadId === ref.leadId) || (ref.dealId && r.dealId === ref.dealId)))
      .map((r) => structuredClone(r));
  }

  async update(id: string, expectedVersion: number, patch: Partial<Omit<DisclosureRecord, "id" | "version" | "createdAt">>, now: Date): Promise<DisclosureRecord> {
    const r = this.rows.get(id);
    if (!r || r.version !== expectedVersion) throw new ConcurrentUpdateError(id);
    const next: DisclosureRecord = { ...r, ...structuredClone(patch), id, version: r.version + 1, createdAt: r.createdAt, updatedAt: now.toISOString() };
    this.rows.set(id, next);
    return structuredClone(next);
  }

  async appendEvent(event: DisclosureEvent): Promise<boolean> {
    if (event.providerEventId && this.log.some((e) => e.providerEventId === event.providerEventId)) return false;
    this.log.push(structuredClone(event));
    return true;
  }

  async events(disclosureId: string): Promise<DisclosureEvent[]> {
    return this.log.filter((e) => e.disclosureId === disclosureId).map((e) => structuredClone(e));
  }

  async hasProviderEvent(providerEventId: string): Promise<boolean> {
    return this.log.some((e) => e.providerEventId === providerEventId);
  }
}

export class MemoryDocumentStorage implements DocumentStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** Write-once: re-putting identical bytes (a redelivered webhook) is a no-op; different bytes fail. */
  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const existing = this.objects.get(path);
    if (existing) {
      if (Buffer.compare(Buffer.from(existing.bytes), Buffer.from(bytes)) !== 0) throw new Error(`Object exists with different content: ${path}`);
      return;
    }
    this.objects.set(path, { bytes, contentType });
  }
}
