// Persistence contract for lender matching (credit boxes, quotes) and the two
// read-only sources it consumes (lender registrations in public.partners,
// term-sheet mail in public.mail_messages), plus in-memory implementations for
// tests that mirror the migration's constraints. Supabase: store-supabase.ts.

import type { CreditBox, NewCreditBox, NewQuote, Quote } from "./types";
import type { PartnerRow } from "./credit-box";

export class LenderStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LenderStoreError";
  }
}

export interface CreditBoxStore {
  listBoxes(opts?: { status?: CreditBox["status"]; lenderId?: string }): Promise<CreditBox[]>;
  getBox(id: string): Promise<CreditBox | null>;
  findBoxByPartner(partnerId: string): Promise<CreditBox | null>;
  insertBox(box: NewCreditBox, actor: string, now: Date): Promise<CreditBox>;
  /** Optimistic on recordVersion. */
  updateBox(id: string, expectedVersion: number, patch: Partial<NewCreditBox>, actor: string, now: Date): Promise<CreditBox>;
}

export interface QuoteStore {
  listQuotes(dealId: string): Promise<Quote[]>;
  getQuote(id: string): Promise<Quote | null>;
  getQuoteByKey(idempotencyKey: string): Promise<Quote | null>;
  /** Idempotent on idempotencyKey (returns the existing quote). */
  insertQuote(q: NewQuote, actor: string, now: Date): Promise<Quote>;
  updateQuote(id: string, patch: Partial<NewQuote>, actor: string, now: Date): Promise<Quote>;
}

/** Lender registrations from /partners. */
export interface PartnerSource {
  listLenderRegistrations(opts?: { limit?: number }): Promise<PartnerRow[]>;
}

/** A lenders@ message the mail pipeline classified as a term sheet and routed to a deal. */
export type TermSheetMail = {
  id: string;
  dealId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyText: string;
  receivedAt: string;
  category: string;
};

export interface TermSheetMailSource {
  /** Routed term-sheet mail, newest first, optionally for one deal. */
  listTermSheetMail(opts?: { dealId?: string; limit?: number }): Promise<TermSheetMail[]>;
}

export type LenderMatchStore = CreditBoxStore & QuoteStore;

// ---------------------------------------------------------------------------
// In-memory

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

export class MemoryLenderMatchStore implements LenderMatchStore {
  readonly boxes = new Map<string, CreditBox>();
  readonly quotes = new Map<string, Quote>();

  private check(b: CreditBox): void {
    if (!b.lenderId && !b.partnerId) throw new LenderStoreError("credit_boxes_owner: a box belongs to a panel lender or a partner registration");
    if (b.status === "approved" && (!b.lenderId || !b.programs.length || !b.reviewedAt || !b.reviewedBy)) throw new LenderStoreError("credit_boxes_approved_shape");
    if (b.status === "rejected" && !b.reviewNote) throw new LenderStoreError("credit_boxes_rejected_reason");
    if (b.minLoanCents !== null && b.maxLoanCents !== null && b.minLoanCents > b.maxLoanCents) throw new LenderStoreError("credit_boxes_loan_range");
    if (b.source === "partner_registration" && b.partnerId) {
      for (const other of this.boxes.values()) if (other.id !== b.id && other.source === "partner_registration" && other.partnerId === b.partnerId) throw new LenderStoreError("duplicate partner registration box");
    }
  }

  async listBoxes(opts: { status?: CreditBox["status"]; lenderId?: string } = {}): Promise<CreditBox[]> {
    return [...this.boxes.values()].filter((b) => (!opts.status || b.status === opts.status) && (!opts.lenderId || b.lenderId === opts.lenderId)).sort((a, b) => a.label.localeCompare(b.label));
  }

  async getBox(id: string): Promise<CreditBox | null> {
    return this.boxes.get(id) ?? null;
  }

  async findBoxByPartner(partnerId: string): Promise<CreditBox | null> {
    return [...this.boxes.values()].find((b) => b.source === "partner_registration" && b.partnerId === partnerId) ?? null;
  }

  async insertBox(box: NewCreditBox, actor: string, now: Date): Promise<CreditBox> {
    const ts = now.toISOString();
    const row: CreditBox = { ...structuredClone(box), id: uuid(), recordVersion: 1, createdAt: ts, updatedAt: ts, updatedBy: actor };
    this.check(row);
    this.boxes.set(row.id, row);
    return structuredClone(row);
  }

  async updateBox(id: string, expectedVersion: number, patch: Partial<NewCreditBox>, actor: string, now: Date): Promise<CreditBox> {
    const cur = this.boxes.get(id);
    if (!cur) throw new LenderStoreError(`Credit box ${id} not found`);
    if (cur.recordVersion !== expectedVersion) throw new LenderStoreError("Credit box was modified concurrently; reload and try again");
    const next: CreditBox = { ...cur, ...structuredClone(patch), recordVersion: cur.recordVersion + 1, updatedAt: now.toISOString(), updatedBy: actor };
    this.check(next);
    this.boxes.set(id, next);
    return structuredClone(next);
  }

  async listQuotes(dealId: string): Promise<Quote[]> {
    return [...this.quotes.values()].filter((q) => q.dealId === dealId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async getQuote(id: string): Promise<Quote | null> {
    return this.quotes.get(id) ?? null;
  }

  async getQuoteByKey(key: string): Promise<Quote | null> {
    return [...this.quotes.values()].find((q) => q.idempotencyKey === key) ?? null;
  }

  async insertQuote(q: NewQuote, actor: string, now: Date): Promise<Quote> {
    const existing = await this.getQuoteByKey(q.idempotencyKey);
    if (existing) return existing;
    if (q.mailMessageId && [...this.quotes.values()].some((x) => x.mailMessageId === q.mailMessageId)) throw new LenderStoreError("quotes_mail_message_uidx");
    if ((q.status === "active" || q.status === "accepted") && q.source !== "staff" && q.lowConfidenceFields.length && !(q.reviewedAt && q.reviewedBy)) throw new LenderStoreError("quotes_review_shape");
    const ts = now.toISOString();
    const row: Quote = { ...structuredClone(q), id: uuid(), createdAt: ts, updatedAt: ts, updatedBy: actor };
    this.quotes.set(row.id, row);
    return structuredClone(row);
  }

  async updateQuote(id: string, patch: Partial<NewQuote>, actor: string, now: Date): Promise<Quote> {
    const cur = this.quotes.get(id);
    if (!cur) throw new LenderStoreError(`Quote ${id} not found`);
    const next: Quote = { ...cur, ...structuredClone(patch), updatedAt: now.toISOString(), updatedBy: actor };
    if ((next.status === "active" || next.status === "accepted") && next.source !== "staff" && next.lowConfidenceFields.length && !(next.reviewedAt && next.reviewedBy)) throw new LenderStoreError("quotes_review_shape");
    this.quotes.set(id, next);
    return structuredClone(next);
  }
}

export class MemoryPartnerSource implements PartnerSource {
  constructor(readonly rows: PartnerRow[] = []) {}
  async listLenderRegistrations(): Promise<PartnerRow[]> {
    return this.rows.filter((r) => r.partnerType === "LENDER" && r.status !== "REJECTED");
  }
}

export class MemoryTermSheetMailSource implements TermSheetMailSource {
  constructor(readonly rows: TermSheetMail[] = []) {}
  async listTermSheetMail(opts: { dealId?: string; limit?: number } = {}): Promise<TermSheetMail[]> {
    return this.rows
      .filter((r) => !opts.dealId || r.dealId === opts.dealId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, opts.limit ?? 50);
  }
}
