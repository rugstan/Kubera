import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSealedAccount, isUuid } from "./lender-accounts";
import { deriveLenderContacts } from "./lender-contacts";
import { fromRow, loanBrokerOfRecordFromRow, toRow, type Row } from "./rows";
import type { StageTemplate } from "./stages";
import {
  ACCOUNT_NOT_FOUND,
  CONTACT_NOT_FOUND,
  ConcurrentUpdateError,
  DUPLICATE_ACCOUNT_MESSAGE,
  GuardError,
  assertContactPatch,
  lenderWritable,
  sortLenderAccounts,
  sortLenderContacts,
  type ClosedLoan,
  type DealDeskStore,
  type NewDealRow,
} from "./store";
import type {
  LenderAccount,
  LenderAccountPatch,
  LenderAccountSecret,
  LenderContact,
  LenderContactInfo,
  LenderContactPatch,
  NewLenderAccount,
  NewLenderContact,
} from "./types";
import type {
  AuditEntry,
  Deal,
  DealPackage,
  DreReport,
  FeeEntry,
  Form159Record,
  Invoice,
  LenderOutreach,
  LenderPanelEntry,
  LoanBrokerOfRecord,
  ModificationRecord,
  NewFeeEntry,
  NewLender,
  ShareLink,
} from "./types";

// Supabase-backed deal desk store (service role; RLS denies the API roles on
// these tables). Column names are the snake_case of the record fields; only
// top-level keys are converted, jsonb values pass through untouched.

const DEAL_NUM = ["loanAmountCents", "recordVersion", "stageTemplateVersion"];
const FEE_NUM = ["ratePct", "baseCents", "amountCents"];
const LENDER_NUM = ["minLoanCents", "maxLoanCents", "feeSplitValue", "contactInfoVersion"];
const CONTACT_NUM = ["recordVersion"];
const ACCOUNT_NUM = ["recordVersion"];
/** Rows per page when reading whole tables (stays under any PostgREST max-rows cap: the next page starts after what came back). */
const PAGE = 1000;

/** Every lender_accounts column except number_enc: list, insert and update never bring ciphertext back. */
export const LENDER_ACCOUNT_COLUMNS = "id, lender_id, kind, label, number_last4, notes, record_version, created_at, created_by, updated_at, updated_by";
const ACTIVE_CONTACT_COLUMNS = "id, lender_id, full_name, email, is_primary, status";

type PgError = { message: string; code?: string };

/**
 * Directory (lender contacts and accounts) errors. Postgres puts the failing
 * row ("Failing row contains (...)") in `details`, which for contacts is
 * personal information, so only the code and the constraint name are read;
 * `details` and `hint` are never read, logged or shown.
 */
function failDirectory(error: PgError | null, what: string, lenderId?: string): void {
  if (!error) return;
  const message = error.message ?? "";
  if (error.code === "23505" && message.includes("lender_accounts_lender_id_kind_label_key")) throw new GuardError(DUPLICATE_ACCOUNT_MESSAGE);
  if (error.code === "23505" && message.includes("lender_contacts_one_primary")) throw new ConcurrentUpdateError("Lender contact");
  if (error.code === "23514") {
    const constraint = /constraint "([a-z0-9_]+)"/.exec(message)?.[1] ?? "a";
    throw new GuardError(`${what}: a value failed the ${constraint} check`);
  }
  if (error.code === "23503" && lenderId) throw new GuardError(`lender_panel ${lenderId} not found`);
  fail(error, what);
}

/** The panel row without the legacy contact columns (never read again), with the derived recipient. */
function lenderFromRow(row: Row, contacts: Row[]): LenderPanelEntry {
  const r: Row = { ...row };
  delete r.contact_name;
  delete r.contact_email;
  const lender = fromRow<Omit<LenderPanelEntry, "primaryContactId" | "primaryContactName" | "contactName" | "contactEmail" | "contactDomains">>(r, LENDER_NUM);
  return { ...lender, ...deriveLenderContacts(lender, contacts.map((c) => fromRow<Pick<LenderContact, "id" | "fullName" | "email" | "isPrimary" | "status">>(c))) };
}

function fail(error: { message: string; code?: string } | null, what: string): never | void {
  if (!error) return;
  if (/locked|append-only|immutable|never deleted|cannot change|cannot be reinstated|final|No-custody/i.test(error.message)) throw new GuardError(error.message);
  throw new Error(`${what}: ${error.message}`);
}

export class SupabaseDealDeskStore implements DealDeskStore {
  constructor(private readonly db: SupabaseClient) {}

  private async insert<T>(table: string, row: Row, numeric: string[] = []): Promise<T> {
    const { data, error } = await this.db.from(table).insert(row).select().single();
    fail(error, `insert ${table}`);
    return fromRow<T>(data as Row, numeric);
  }

  private async patch<T>(table: string, id: string, row: Row, numeric: string[] = []): Promise<T> {
    const { data, error } = await this.db.from(table).update(row).eq("id", id).select().maybeSingle();
    fail(error, `update ${table}`);
    if (!data) throw new GuardError(`${table} ${id} not found`);
    return fromRow<T>(data as Row, numeric);
  }

  private async byId<T>(table: string, id: string, numeric: string[] = []): Promise<T | null> {
    const { data, error } = await this.db.from(table).select("*").eq("id", id).maybeSingle();
    fail(error, `read ${table}`);
    return data ? fromRow<T>(data as Row, numeric) : null;
  }

  // Deals --------------------------------------------------------------------
  async createDeal(input: NewDealRow, actor: string, now: Date): Promise<Deal> {
    return this.insert<Deal>("deals", { ...toRow(input), stage_entered_at: now.toISOString(), updated_by: actor, record_version: 1 }, DEAL_NUM);
  }

  async getDeal(id: string): Promise<Deal | null> {
    return this.byId<Deal>("deals", id, DEAL_NUM);
  }

  async findDealByOriginKey(originKey: string): Promise<Deal | null> {
    const { data, error } = await this.db.from("deals").select("*").eq("origin_key", originKey).maybeSingle();
    fail(error, "read deals");
    return data ? fromRow<Deal>(data as Row, DEAL_NUM) : null;
  }

  async listDeals(opts: { limit?: number; openOnly?: boolean } = {}): Promise<Deal[]> {
    let q = this.db.from("deals").select("*").not("program", "is", null);
    if (opts.openOnly) q = q.not("stage", "in", "(closed,withdrawn,lost)");
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(opts.limit ?? 200);
    fail(error, "list deals");
    return ((data ?? []) as Row[]).map((r) => fromRow<Deal>(r, DEAL_NUM));
  }

  async updateDeal(id: string, expectedVersion: number, patch: Partial<Deal>, actor: string): Promise<Deal> {
    const { id: _id, createdAt: _c, updatedAt: _u, recordVersion: _v, ...rest } = patch;
    void _id;
    void _c;
    void _u;
    void _v;
    const { data, error } = await this.db
      .from("deals")
      .update({ ...toRow(rest), record_version: expectedVersion + 1, updated_by: actor })
      .eq("id", id)
      .eq("record_version", expectedVersion)
      .select()
      .maybeSingle();
    fail(error, "update deals");
    if (!data) throw new ConcurrentUpdateError(`Deal ${id}`);
    return fromRow<Deal>(data as Row, DEAL_NUM);
  }

  async closedLoans(range: { from: string; to: string }): Promise<ClosedLoan[]> {
    const { data, error } = await this.db
      .from("deals")
      .select("id, title, closed_on, loan_amount_cents, collateral_real_property, program, property_state")
      .eq("stage", "closed")
      .gte("closed_on", range.from)
      .lte("closed_on", range.to);
    fail(error, "closed loans");
    return ((data ?? []) as Row[]).map((r) => ({
      dealId: String(r.id),
      title: String(r.title ?? ""),
      closedOn: String(r.closed_on),
      loanAmountCents: Number(r.loan_amount_cents ?? 0),
      collateralRealProperty: Boolean(r.collateral_real_property),
      program: r.program as Deal["program"],
      propertyState: (r.property_state as string | null) ?? null,
    }));
  }

  // Stage templates ------------------------------------------------------------
  async publishStageTemplate(t: StageTemplate, digest: string): Promise<void> {
    const { error } = await this.db
      .from("stage_templates")
      .upsert({ program: t.program, version: t.version, name: t.name, stages: t.stages, events: t.events, locked_fields: t.lockedFields, digest }, { onConflict: "program,version", ignoreDuplicates: true });
    fail(error, "publish stage template");
    const { data } = await this.db.from("stage_templates").select("digest").eq("program", t.program).eq("version", t.version).maybeSingle();
    if (data && (data as Row).digest !== digest) throw new GuardError(`Stage template ${t.program} v${t.version} is published with different content; bump STAGE_TEMPLATE_VERSION`);
  }

  // Lenders -----------------------------------------------------------------------
  /** Reads every page of a query; each page starts after the rows the last one returned, so a server-side cap cannot skip rows. */
  private async selectAll(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: PgError | null }>, what: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; ) {
      const { data, error } = await build(from, from + PAGE - 1);
      fail(error, what);
      const rows = (data ?? []) as Row[];
      if (!rows.length) return out;
      out.push(...rows);
      from += rows.length;
    }
  }

  private async activeContactsOf(lenderId: string): Promise<Row[]> {
    const { data, error } = await this.db.from("lender_contacts").select(ACTIVE_CONTACT_COLUMNS).eq("lender_id", lenderId).eq("status", "active");
    fail(error, "read lender contacts");
    return (data ?? []) as Row[];
  }

  async listLenders(opts: { activeOnly?: boolean } = {}): Promise<LenderPanelEntry[]> {
    const [lenders, contacts] = await Promise.all([
      this.selectAll((from, to) => {
        let q = this.db.from("lender_panel").select("*");
        if (opts.activeOnly) q = q.eq("active", true);
        return q.order("name").order("id").range(from, to);
      }, "list lenders"),
      this.selectAll((from, to) => this.db.from("lender_contacts").select(ACTIVE_CONTACT_COLUMNS).eq("status", "active").order("id").range(from, to), "list lender contacts"),
    ]);
    const byLender = new Map<string, Row[]>();
    for (const c of contacts) byLender.set(String(c.lender_id), [...(byLender.get(String(c.lender_id)) ?? []), c]);
    return lenders.map((r) => lenderFromRow(r, byLender.get(String(r.id)) ?? []));
  }

  async getLender(id: string): Promise<LenderPanelEntry | null> {
    const { data, error } = await this.db.from("lender_panel").select("*").eq("id", id).maybeSingle();
    fail(error, "read lender_panel");
    if (!data) return null;
    return lenderFromRow(data as Row, await this.activeContactsOf(id));
  }

  async insertLender(input: NewLender, actor: string): Promise<LenderPanelEntry> {
    const { data, error } = await this.db.from("lender_panel").insert({ ...toRow(lenderWritable(input)), updated_by: actor }).select().single();
    fail(error, "insert lender_panel");
    return lenderFromRow(data as Row, []);
  }

  async updateLender(id: string, patch: Partial<NewLender>, actor: string): Promise<LenderPanelEntry> {
    const { data, error } = await this.db.from("lender_panel").update({ ...toRow(lenderWritable(patch)), updated_by: actor }).eq("id", id).select().maybeSingle();
    fail(error, "update lender_panel");
    if (!data) throw new GuardError(`lender_panel ${id} not found`);
    return lenderFromRow(data as Row, await this.activeContactsOf(id));
  }

  async updateLenderContactInfo(id: string, expectedVersion: number, patch: Partial<LenderContactInfo>, actor: string): Promise<LenderPanelEntry> {
    const { data, error } = await this.db
      .from("lender_panel")
      .update({ ...toRow(lenderWritable(patch)), contact_info_version: expectedVersion + 1, updated_by: actor })
      .eq("id", id)
      .eq("contact_info_version", expectedVersion)
      .select("id")
      .maybeSingle();
    failDirectory(error, "Lender contact info");
    if (!data) throw new ConcurrentUpdateError("Lender contact info");
    const lender = await this.getLender(id);
    if (!lender) throw new ConcurrentUpdateError("Lender contact info");
    return lender;
  }

  // Lender contacts ---------------------------------------------------------------------
  async listLenderContacts(lenderId: string, opts: { includeLeft?: boolean } = {}): Promise<LenderContact[]> {
    let q = this.db.from("lender_contacts").select("*").eq("lender_id", lenderId);
    if (!opts.includeLeft) q = q.eq("status", "active");
    const { data, error } = await q.order("full_name").order("id").limit(PAGE);
    failDirectory(error, "List lender contacts");
    return sortLenderContacts(((data ?? []) as Row[]).map((r) => fromRow<LenderContact>(r, CONTACT_NUM)));
  }

  async getLenderContact(lenderId: string, id: string): Promise<LenderContact | null> {
    const { data, error } = await this.db.from("lender_contacts").select("*").eq("lender_id", lenderId).eq("id", id).maybeSingle();
    failDirectory(error, "Read lender contact");
    return data ? fromRow<LenderContact>(data as Row, CONTACT_NUM) : null;
  }

  async insertLenderContact(input: NewLenderContact, actor: string): Promise<LenderContact> {
    const { data, error } = await this.db
      .from("lender_contacts")
      .insert({ ...toRow(input), is_primary: false, created_by: actor })
      .select("*")
      .single();
    failDirectory(error, "Lender contact", input.lenderId);
    return fromRow<LenderContact>(data as Row, CONTACT_NUM);
  }

  async updateLenderContact(lenderId: string, id: string, expectedVersion: number, patch: LenderContactPatch, actor: string): Promise<LenderContact> {
    assertContactPatch(patch);
    const { lenderId: _l, ...rest } = patch as LenderContactPatch & { lenderId?: string };
    void _l;
    const { data, error } = await this.db
      .from("lender_contacts")
      .update({ ...toRow(rest), record_version: expectedVersion + 1, updated_by: actor })
      .eq("id", id)
      .eq("lender_id", lenderId)
      .eq("record_version", expectedVersion)
      .select("*")
      .maybeSingle();
    failDirectory(error, "Lender contact");
    if (!data) throw new ConcurrentUpdateError("Lender contact");
    return fromRow<LenderContact>(data as Row, CONTACT_NUM);
  }

  async setPrimaryLenderContact(lenderId: string, id: string, actor: string): Promise<LenderContact> {
    const { data, error } = await this.db.rpc("set_lender_primary_contact", { p_lender_id: lenderId, p_contact_id: id, p_actor: actor });
    failDirectory(error, "Lender contact");
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : ((data as Row | null) ?? undefined);
    if (!row) throw new GuardError(CONTACT_NOT_FOUND);
    return fromRow<LenderContact>(row, CONTACT_NUM);
  }

  async deleteLenderContact(lenderId: string, id: string): Promise<void> {
    const { data, error } = await this.db.from("lender_contacts").delete().eq("id", id).eq("lender_id", lenderId).select("id");
    failDirectory(error, "Lender contact");
    if (!((data ?? []) as Row[]).length) throw new GuardError(CONTACT_NOT_FOUND);
  }

  // Lender accounts --------------------------------------------------------------------------
  async listLenderAccounts(lenderId: string): Promise<LenderAccount[]> {
    const { data, error } = await this.db.from("lender_accounts").select(LENDER_ACCOUNT_COLUMNS).eq("lender_id", lenderId).limit(PAGE);
    failDirectory(error, "List lender accounts");
    return sortLenderAccounts(((data ?? []) as unknown as Row[]).map((r) => fromRow<LenderAccount>(r, ACCOUNT_NUM)));
  }

  async getLenderAccountSecret(lenderId: string, id: string): Promise<LenderAccountSecret | null> {
    const { data, error } = await this.db.from("lender_accounts").select("id, lender_id, kind, label, number_enc").eq("lender_id", lenderId).eq("id", id).maybeSingle();
    failDirectory(error, "Read lender account");
    return data ? fromRow<LenderAccountSecret>(data as Row) : null;
  }

  async insertLenderAccount(input: NewLenderAccount, actor: string): Promise<LenderAccount> {
    if (!isUuid(input.id)) throw new GuardError("Lender account ids are generated by the app (a UUID) before sealing");
    assertSealedAccount(input);
    const { data, error } = await this.db
      .from("lender_accounts")
      .insert({ ...toRow(input), created_by: actor })
      .select(LENDER_ACCOUNT_COLUMNS)
      .single();
    failDirectory(error, "Lender account", input.lenderId);
    return fromRow<LenderAccount>(data as unknown as Row, ACCOUNT_NUM);
  }

  async updateLenderAccount(lenderId: string, id: string, expectedVersion: number, patch: LenderAccountPatch, actor: string): Promise<LenderAccount> {
    if (patch.numberEnc !== undefined) {
      assertSealedAccount(patch);
      if (!("numberLast4" in patch) || patch.numberLast4 === undefined) throw new GuardError("Replacing an account number also replaces its masked hint");
    }
    const { label, notes, numberLast4, numberEnc } = patch;
    const { data, error } = await this.db
      .from("lender_accounts")
      .update({ ...toRow({ label, notes, numberLast4, numberEnc }), record_version: expectedVersion + 1, updated_by: actor })
      .eq("id", id)
      .eq("lender_id", lenderId)
      .eq("record_version", expectedVersion)
      .select(LENDER_ACCOUNT_COLUMNS)
      .maybeSingle();
    failDirectory(error, "Lender account");
    if (!data) throw new ConcurrentUpdateError("Lender account");
    return fromRow<LenderAccount>(data as unknown as Row, ACCOUNT_NUM);
  }

  async deleteLenderAccount(lenderId: string, id: string): Promise<void> {
    const { data, error } = await this.db.from("lender_accounts").delete().eq("id", id).eq("lender_id", lenderId).select("id");
    failDirectory(error, "Lender account");
    if (!((data ?? []) as Row[]).length) throw new GuardError(ACCOUNT_NOT_FOUND);
  }

  // Packages ------------------------------------------------------------------------
  async listPackages(dealId: string): Promise<DealPackage[]> {
    const { data, error } = await this.db.from("deal_packages").select("*").eq("deal_id", dealId).order("version");
    fail(error, "list packages");
    return ((data ?? []) as Row[]).map((r) => fromRow<DealPackage>(r));
  }

  async getPackage(id: string): Promise<DealPackage | null> {
    return this.byId<DealPackage>("deal_packages", id);
  }

  async insertPackage(pkg: Omit<DealPackage, "id" | "createdAt">): Promise<DealPackage> {
    try {
      return await this.insert<DealPackage>("deal_packages", toRow(pkg));
    } catch (e) {
      if (e instanceof Error && /duplicate key/.test(e.message)) throw new ConcurrentUpdateError(`Package ${pkg.dealId} v${pkg.version}`);
      throw e;
    }
  }

  async lockPackage(id: string, by: string, now: Date): Promise<DealPackage> {
    return this.patch<DealPackage>("deal_packages", id, { status: "locked", locked_at: now.toISOString(), locked_by: by });
  }

  // Share links ------------------------------------------------------------------------
  async insertShareLink(link: Omit<ShareLink, "id" | "createdAt" | "accessCount" | "lastAccessedAt" | "revokedAt" | "revokedBy" | "revokeReason">, now: Date): Promise<ShareLink> {
    return this.insert<ShareLink>("share_links", { ...toRow(link), created_at: now.toISOString() });
  }

  async getShareLinkByHash(tokenHash: string): Promise<ShareLink | null> {
    const { data, error } = await this.db.from("share_links").select("*").eq("token_hash", tokenHash).maybeSingle();
    fail(error, "read share link");
    return data ? fromRow<ShareLink>(data as Row) : null;
  }

  async recordShareLinkAccess(tokenHash: string): Promise<ShareLink | null> {
    const { data, error } = await this.db.rpc("record_share_link_access", { p_token_hash: tokenHash });
    fail(error, "record share link access");
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
    return row ? fromRow<ShareLink>(row) : null;
  }

  async revokeShareLink(id: string, by: string, reason: string, now: Date): Promise<ShareLink> {
    return this.patch<ShareLink>("share_links", id, { revoked_at: now.toISOString(), revoked_by: by, revoke_reason: reason, updated_by: by });
  }

  async listShareLinks(dealId: string): Promise<ShareLink[]> {
    const { data, error } = await this.db.from("share_links").select("*").eq("deal_id", dealId).order("created_at");
    fail(error, "list share links");
    return ((data ?? []) as Row[]).map((r) => fromRow<ShareLink>(r));
  }

  // Outreach ---------------------------------------------------------------------------
  async getOutreachByKey(approvalKey: string): Promise<LenderOutreach | null> {
    const { data, error } = await this.db.from("lender_outreach").select("*").eq("approval_key", approvalKey).maybeSingle();
    fail(error, "read outreach");
    return data ? fromRow<LenderOutreach>(data as Row) : null;
  }

  async getOutreach(id: string): Promise<LenderOutreach | null> {
    return this.byId<LenderOutreach>("lender_outreach", id);
  }

  async insertOutreach(o: Omit<LenderOutreach, "id" | "createdAt" | "updatedAt">): Promise<LenderOutreach> {
    return this.insert<LenderOutreach>("lender_outreach", { ...toRow(o), updated_by: o.requestedBy });
  }

  async updateOutreach(id: string, patch: Partial<LenderOutreach>, actor: string): Promise<LenderOutreach> {
    return this.patch<LenderOutreach>("lender_outreach", id, { ...toRow(patch), updated_by: actor });
  }

  async listOutreach(dealId: string): Promise<LenderOutreach[]> {
    const { data, error } = await this.db.from("lender_outreach").select("*").eq("deal_id", dealId).order("created_at");
    fail(error, "list outreach");
    return ((data ?? []) as Row[]).map((r) => fromRow<LenderOutreach>(r));
  }

  // Fee ledger ----------------------------------------------------------------------------
  async insertFeeEntry(e: NewFeeEntry, actor: string): Promise<FeeEntry> {
    const { data, error } = await this.db
      .from("fee_ledger")
      .upsert({ status: "projected", ...toRow(e), updated_by: actor }, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select()
      .maybeSingle();
    fail(error, "insert fee entry");
    if (data) return fromRow<FeeEntry>(data as Row, FEE_NUM);
    const { data: existing, error: readError } = await this.db.from("fee_ledger").select("*").eq("idempotency_key", e.idempotencyKey).single();
    fail(readError, "read fee entry");
    return fromRow<FeeEntry>(existing as Row, FEE_NUM);
  }

  async listFeeEntries(dealId: string): Promise<FeeEntry[]> {
    const { data, error } = await this.db.from("fee_ledger").select("*").eq("deal_id", dealId).order("created_at").order("id");
    fail(error, "list fee entries");
    return ((data ?? []) as Row[]).map((r) => fromRow<FeeEntry>(r, FEE_NUM));
  }

  async updateFeeEntry(id: string, patch: Partial<Pick<FeeEntry, "status" | "invoiceId" | "voidReason" | "earnedOn">>, actor: string): Promise<FeeEntry> {
    return this.patch<FeeEntry>("fee_ledger", id, { ...toRow(patch), updated_by: actor }, FEE_NUM);
  }

  // Invoices -----------------------------------------------------------------------------------
  async nextInvoiceNumber(year: number): Promise<string> {
    const { data, error } = await this.db.rpc("next_invoice_number", { p_year: year });
    fail(error, "next invoice number");
    return String(data);
  }

  async insertInvoice(i: Omit<Invoice, "id" | "createdAt" | "updatedAt">, actor: string): Promise<Invoice> {
    return this.insert<Invoice>("invoices", { ...toRow(i), updated_by: actor }, ["totalCents"]);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    return this.byId<Invoice>("invoices", id, ["totalCents"]);
  }

  async updateInvoice(id: string, patch: Partial<Invoice>, actor: string): Promise<Invoice> {
    return this.patch<Invoice>("invoices", id, { ...toRow(patch), updated_by: actor }, ["totalCents"]);
  }

  async listInvoices(dealId: string): Promise<Invoice[]> {
    const { data, error } = await this.db.from("invoices").select("*").eq("deal_id", dealId).order("created_at");
    fail(error, "list invoices");
    return ((data ?? []) as Row[]).map((r) => fromRow<Invoice>(r, ["totalCents"]));
  }

  // Broker of record + modifications -----------------------------------------------------------------
  async getLoanBrokerOfRecord(dealId: string): Promise<LoanBrokerOfRecord | null> {
    const { data, error } = await this.db.from("broker_of_record").select("*").eq("deal_id", dealId).eq("record_kind", "loan").order("created_at", { ascending: false }).limit(1).maybeSingle();
    fail(error, "read broker of record");
    return data ? loanBrokerOfRecordFromRow(data as Row) : null;
  }

  async insertBrokerOfRecordRow(row: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.db.from("broker_of_record").insert(row).select("id").single();
    fail(error, "insert broker of record");
    return String((data as Row).id);
  }

  async updateBrokerOfRecordRow(id: string, row: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from("broker_of_record").update(row).eq("id", id);
    fail(error, "update broker of record");
  }

  async insertModification(m: Omit<ModificationRecord, "id" | "createdAt" | "updatedAt">, actor: string): Promise<ModificationRecord> {
    return this.insert<ModificationRecord>("deal_modifications", { ...toRow(m), updated_by: actor });
  }

  async getModification(id: string): Promise<ModificationRecord | null> {
    return this.byId<ModificationRecord>("deal_modifications", id);
  }

  async updateModification(id: string, patch: Partial<ModificationRecord>, actor: string): Promise<ModificationRecord> {
    return this.patch<ModificationRecord>("deal_modifications", id, { ...toRow(patch), updated_by: actor });
  }

  async listModifications(dealId: string): Promise<ModificationRecord[]> {
    const { data, error } = await this.db.from("deal_modifications").select("*").eq("deal_id", dealId).order("created_at");
    fail(error, "list modifications");
    return ((data ?? []) as Row[]).map((r) => fromRow<ModificationRecord>(r));
  }

  // Form 159 ----------------------------------------------------------------------------------------
  async insertForm159(f: Omit<Form159Record, "id" | "createdAt" | "updatedAt">, actor: string): Promise<Form159Record> {
    try {
      return await this.insert<Form159Record>("sba_form159", { ...toRow(f), updated_by: actor });
    } catch (e) {
      if (e instanceof Error && /duplicate key/.test(e.message)) throw new ConcurrentUpdateError(`Form 159 ${f.dealId} v${f.version}`);
      throw e;
    }
  }

  async getForm159(id: string): Promise<Form159Record | null> {
    return this.byId<Form159Record>("sba_form159", id);
  }

  async getForm159ByProviderRequest(provider: string, requestId: string): Promise<Form159Record | null> {
    const { data, error } = await this.db.from("sba_form159").select("*").eq("provider", provider).eq("provider_request_id", requestId).maybeSingle();
    fail(error, "read form 159");
    return data ? fromRow<Form159Record>(data as Row) : null;
  }

  async updateForm159(id: string, patch: Partial<Form159Record>, actor: string): Promise<Form159Record> {
    return this.patch<Form159Record>("sba_form159", id, { ...toRow(patch), updated_by: actor });
  }

  async listForm159(dealId: string): Promise<Form159Record[]> {
    const { data, error } = await this.db.from("sba_form159").select("*").eq("deal_id", dealId).order("version");
    fail(error, "list form 159");
    return ((data ?? []) as Row[]).map((r) => fromRow<Form159Record>(r));
  }

  // DRE ------------------------------------------------------------------------------------------------
  async saveDreReport(r: Omit<DreReport, "id" | "createdAt">): Promise<DreReport> {
    const { data, error } = await this.db.from("dre_reporting").upsert(toRow(r), { onConflict: "report_kind,as_of" }).select().single();
    fail(error, "save DRE report");
    return fromRow<DreReport>(data as Row);
  }

  async listDreReports(kind?: DreReport["reportKind"]): Promise<DreReport[]> {
    let q = this.db.from("dre_reporting").select("*").order("as_of", { ascending: false }).limit(200);
    if (kind) q = q.eq("report_kind", kind);
    const { data, error } = await q;
    fail(error, "list DRE reports");
    return ((data ?? []) as Row[]).map((r) => fromRow<DreReport>(r));
  }

  // Audit ----------------------------------------------------------------------------------------------------
  async auditForDeal(dealId: string, limit = 100): Promise<AuditEntry[]> {
    const { data, error } = await this.db.from("audit_log").select("id, occurred_at, table_name, row_id, deal_id, action, actor, changed").eq("deal_id", dealId).order("id", { ascending: false }).limit(limit);
    fail(error, "read audit log");
    return ((data ?? []) as Row[]).map((r) => fromRow<AuditEntry>(r, ["id"]));
  }
}
