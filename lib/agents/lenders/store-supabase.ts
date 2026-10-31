import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRow, toRow, type Row } from "@/lib/deals/rows";
import type { PartnerRow } from "./credit-box";
import { LenderStoreError, type LenderMatchStore, type PartnerSource, type TermSheetMail, type TermSheetMailSource } from "./store";
import type { CreditBox, NewCreditBox, NewQuote, Quote } from "./types";

// Supabase-backed lender-matching store (service role; RLS denies the API
// roles on credit_boxes and quotes). Column names are the snake_case of the
// record fields; jsonb values pass through untouched.

const BOX_NUM = [
  "minLoanCents",
  "maxLoanCents",
  "maxLtvPct",
  "maxLtcPct",
  "minDscr",
  "minDebtYieldPct",
  "maxTermMonths",
  "maxAmortizationMonths",
  "maxIoMonths",
  "rateMinPct",
  "rateMaxPct",
  "originationFeePct",
  "brokerCompensationPct",
  "typicalCloseDays",
  "recordVersion",
];
const QUOTE_NUM = ["allInRatePct"];

function fail(error: { message: string } | null, what: string): void {
  if (!error) return;
  if (/violates check constraint|duplicate key/i.test(error.message)) throw new LenderStoreError(`${what}: ${error.message}`);
  throw new Error(`${what}: ${error.message}`);
}

const box = (r: Row) => fromRow<CreditBox>(r, BOX_NUM);
const quote = (r: Row) => fromRow<Quote>(r, QUOTE_NUM);

export class SupabaseLenderMatchStore implements LenderMatchStore {
  constructor(private readonly db: SupabaseClient) {}

  async listBoxes(opts: { status?: CreditBox["status"]; lenderId?: string } = {}): Promise<CreditBox[]> {
    let q = this.db.from("credit_boxes").select("*").order("label").limit(1_000);
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.lenderId) q = q.eq("lender_id", opts.lenderId);
    const { data, error } = await q;
    fail(error, "list credit_boxes");
    return ((data ?? []) as Row[]).map(box);
  }

  async getBox(id: string): Promise<CreditBox | null> {
    const { data, error } = await this.db.from("credit_boxes").select("*").eq("id", id).maybeSingle();
    fail(error, "read credit_boxes");
    return data ? box(data as Row) : null;
  }

  async findBoxByPartner(partnerId: string): Promise<CreditBox | null> {
    const { data, error } = await this.db.from("credit_boxes").select("*").eq("partner_id", partnerId).eq("source", "partner_registration").maybeSingle();
    fail(error, "read credit_boxes");
    return data ? box(data as Row) : null;
  }

  async insertBox(input: NewCreditBox, actor: string): Promise<CreditBox> {
    const { data, error } = await this.db.from("credit_boxes").insert({ ...toRow(input), updated_by: actor }).select().single();
    fail(error, "insert credit_boxes");
    return box(data as Row);
  }

  async updateBox(id: string, expectedVersion: number, patch: Partial<NewCreditBox>, actor: string): Promise<CreditBox> {
    const { data, error } = await this.db
      .from("credit_boxes")
      .update({ ...toRow(patch), record_version: expectedVersion + 1, updated_by: actor })
      .eq("id", id)
      .eq("record_version", expectedVersion)
      .select()
      .maybeSingle();
    fail(error, "update credit_boxes");
    if (!data) throw new LenderStoreError("Credit box was modified concurrently; reload and try again");
    return box(data as Row);
  }

  async listQuotes(dealId: string): Promise<Quote[]> {
    const { data, error } = await this.db.from("quotes").select("*").eq("deal_id", dealId).order("received_at", { ascending: false }).limit(200);
    fail(error, "list quotes");
    return ((data ?? []) as Row[]).map(quote);
  }

  async getQuote(id: string): Promise<Quote | null> {
    const { data, error } = await this.db.from("quotes").select("*").eq("id", id).maybeSingle();
    fail(error, "read quotes");
    return data ? quote(data as Row) : null;
  }

  async getQuoteByKey(key: string): Promise<Quote | null> {
    const { data, error } = await this.db.from("quotes").select("*").eq("idempotency_key", key).maybeSingle();
    fail(error, "read quotes");
    return data ? quote(data as Row) : null;
  }

  async insertQuote(input: NewQuote, actor: string): Promise<Quote> {
    const existing = await this.getQuoteByKey(input.idempotencyKey);
    if (existing) return existing;
    const { data, error } = await this.db.from("quotes").insert({ ...toRow(input), updated_by: actor }).select().single();
    if (error && /duplicate key/i.test(error.message)) {
      const raced = await this.getQuoteByKey(input.idempotencyKey);
      if (raced) return raced;
    }
    fail(error, "insert quotes");
    return quote(data as Row);
  }

  async updateQuote(id: string, patch: Partial<NewQuote>, actor: string): Promise<Quote> {
    const { data, error } = await this.db.from("quotes").update({ ...toRow(patch), updated_by: actor }).eq("id", id).select().maybeSingle();
    fail(error, "update quotes");
    if (!data) throw new LenderStoreError(`Quote ${id} not found`);
    return quote(data as Row);
  }
}

export class SupabasePartnerSource implements PartnerSource {
  constructor(private readonly db: SupabaseClient) {}

  async listLenderRegistrations(opts: { limit?: number } = {}): Promise<PartnerRow[]> {
    const { data, error } = await this.db
      .from("partners")
      .select("id, partner_type, organization, email, profile, status, created_at")
      .eq("partner_type", "LENDER")
      .neq("status", "REJECTED")
      .order("created_at")
      .limit(opts.limit ?? 500);
    fail(error, "list partners");
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      partnerType: String(r.partner_type),
      organization: r.organization === null ? null : String(r.organization),
      email: String(r.email),
      profile: (r.profile ?? {}) as Record<string, unknown>,
      status: String(r.status),
      createdAt: new Date(String(r.created_at)).toISOString(),
    }));
  }
}

export class SupabaseTermSheetMailSource implements TermSheetMailSource {
  constructor(private readonly db: SupabaseClient) {}

  async listTermSheetMail(opts: { dealId?: string; limit?: number } = {}): Promise<TermSheetMail[]> {
    let q = this.db
      .from("mail_messages")
      .select("id, deal_id, from_address, from_name, subject, body_text, received_at, category")
      .eq("category", "term_sheet")
      .in("status", ["processed", "needs_review"])
      .eq("suspicious", false)
      .not("deal_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(opts.limit ?? 50);
    if (opts.dealId) q = q.eq("deal_id", opts.dealId);
    const { data, error } = await q;
    fail(error, "list term-sheet mail");
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      dealId: String(r.deal_id),
      fromAddress: String(r.from_address),
      fromName: r.from_name === null ? null : String(r.from_name),
      subject: String(r.subject ?? ""),
      bodyText: String(r.body_text ?? ""),
      receivedAt: new Date(String(r.received_at)).toISOString(),
      category: String(r.category),
    }));
  }
}
