// Persistence contract for the deal desk, plus an in-memory implementation
// for tests that mirrors the database guards in the WS-T migration (term
// locks, frozen ledger entries, locked package versions, append-only audit).
// The Supabase implementation is store-supabase.ts (server only).

import type { StageTemplate } from "./stages";
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
  NewDeal,
  NewFeeEntry,
  NewLender,
  ShareLink,
} from "./types";

export class ConcurrentUpdateError extends Error {
  constructor(what: string) {
    super(`${what} was modified concurrently; reload and try again`);
    this.name = "ConcurrentUpdateError";
  }
}

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export type NewDealRow = NewDeal & { stage: string; stageTemplateVersion: number };

export type ClosedLoan = { dealId: string; title: string; closedOn: string; loanAmountCents: number; collateralRealProperty: boolean; program: Deal["program"]; propertyState: string | null };

export interface DealDeskStore {
  // Deals
  createDeal(input: NewDealRow, actor: string, now: Date): Promise<Deal>;
  getDeal(id: string): Promise<Deal | null>;
  /** The deal opened under an idempotency key (deals.origin_key), if any. */
  findDealByOriginKey(originKey: string): Promise<Deal | null>;
  listDeals(opts?: { limit?: number; openOnly?: boolean }): Promise<Deal[]>;
  /** Optimistic update on `recordVersion`. Enforces the term lock like the database trigger. */
  updateDeal(id: string, expectedVersion: number, patch: Partial<Deal>, actor: string, now: Date): Promise<Deal>;
  closedLoans(range: { from: string; to: string }): Promise<ClosedLoan[]>;

  // Stage templates
  publishStageTemplate(t: StageTemplate, digest: string): Promise<void>;

  // Lender panel
  listLenders(opts?: { activeOnly?: boolean }): Promise<LenderPanelEntry[]>;
  getLender(id: string): Promise<LenderPanelEntry | null>;
  insertLender(input: NewLender, actor: string, now: Date): Promise<LenderPanelEntry>;
  updateLender(id: string, patch: Partial<NewLender>, actor: string, now: Date): Promise<LenderPanelEntry>;

  // Packages
  listPackages(dealId: string): Promise<DealPackage[]>;
  getPackage(id: string): Promise<DealPackage | null>;
  insertPackage(pkg: Omit<DealPackage, "id" | "createdAt">, now: Date): Promise<DealPackage>;
  lockPackage(id: string, by: string, now: Date): Promise<DealPackage>;

  // Share links
  insertShareLink(link: Omit<ShareLink, "id" | "createdAt" | "accessCount" | "lastAccessedAt" | "revokedAt" | "revokedBy" | "revokeReason">, now: Date): Promise<ShareLink>;
  getShareLinkByHash(tokenHash: string): Promise<ShareLink | null>;
  /** Atomically counts an access; null when the link is unknown, revoked or expired at `now`. */
  recordShareLinkAccess(tokenHash: string, now: Date): Promise<ShareLink | null>;
  revokeShareLink(id: string, by: string, reason: string, now: Date): Promise<ShareLink>;
  listShareLinks(dealId: string): Promise<ShareLink[]>;

  // Outreach
  getOutreachByKey(approvalKey: string): Promise<LenderOutreach | null>;
  getOutreach(id: string): Promise<LenderOutreach | null>;
  insertOutreach(o: Omit<LenderOutreach, "id" | "createdAt" | "updatedAt">, now: Date): Promise<LenderOutreach>;
  updateOutreach(id: string, patch: Partial<LenderOutreach>, actor: string, now: Date): Promise<LenderOutreach>;
  listOutreach(dealId: string): Promise<LenderOutreach[]>;

  // Fee ledger
  /** Idempotent on `idempotencyKey`: returns the existing entry when the key was used. */
  insertFeeEntry(e: NewFeeEntry, actor: string, now: Date): Promise<FeeEntry>;
  listFeeEntries(dealId: string): Promise<FeeEntry[]>;
  updateFeeEntry(id: string, patch: Partial<Pick<FeeEntry, "status" | "invoiceId" | "voidReason" | "earnedOn">>, actor: string, now: Date): Promise<FeeEntry>;

  // Invoices
  nextInvoiceNumber(year: number): Promise<string>;
  insertInvoice(i: Omit<Invoice, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<Invoice>;
  getInvoice(id: string): Promise<Invoice | null>;
  updateInvoice(id: string, patch: Partial<Invoice>, actor: string, now: Date): Promise<Invoice>;
  listInvoices(dealId: string): Promise<Invoice[]>;

  // Broker of record (WS-W table) and modifications
  getLoanBrokerOfRecord(dealId: string): Promise<LoanBrokerOfRecord | null>;
  insertBrokerOfRecordRow(row: Record<string, unknown>): Promise<string>;
  updateBrokerOfRecordRow(id: string, row: Record<string, unknown>): Promise<void>;
  insertModification(m: Omit<ModificationRecord, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<ModificationRecord>;
  getModification(id: string): Promise<ModificationRecord | null>;
  updateModification(id: string, patch: Partial<ModificationRecord>, actor: string, now: Date): Promise<ModificationRecord>;
  listModifications(dealId: string): Promise<ModificationRecord[]>;

  // SBA Form 159
  insertForm159(f: Omit<Form159Record, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<Form159Record>;
  getForm159(id: string): Promise<Form159Record | null>;
  getForm159ByProviderRequest(provider: string, requestId: string): Promise<Form159Record | null>;
  updateForm159(id: string, patch: Partial<Form159Record>, actor: string, now: Date): Promise<Form159Record>;
  listForm159(dealId: string): Promise<Form159Record[]>;

  // DRE reporting
  saveDreReport(r: Omit<DreReport, "id" | "createdAt">, now: Date): Promise<DreReport>;
  listDreReports(kind?: DreReport["reportKind"]): Promise<DreReport[]>;

  // Audit
  auditForDeal(dealId: string, limit?: number): Promise<AuditEntry[]>;
}

// ---------------------------------------------------------------------------
// In-memory implementation

const clone = <T>(v: T): T => structuredClone(v);

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export class MemoryDealDeskStore implements DealDeskStore {
  readonly deals = new Map<string, Deal>();
  readonly templates = new Map<string, { template: StageTemplate; digest: string }>();
  readonly lenders = new Map<string, LenderPanelEntry>();
  readonly packages = new Map<string, DealPackage>();
  readonly links = new Map<string, ShareLink>();
  readonly outreach = new Map<string, LenderOutreach>();
  readonly fees = new Map<string, FeeEntry>();
  readonly invoices = new Map<string, Invoice>();
  readonly brokerOfRecord = new Map<string, Record<string, unknown>>();
  readonly modifications = new Map<string, ModificationRecord>();
  readonly form159 = new Map<string, Form159Record>();
  readonly dre = new Map<string, DreReport>();
  readonly audit: AuditEntry[] = [];
  private seq = 0;
  private invoiceSeq = new Map<number, number>();

  private id(): string {
    this.seq += 1;
    return uuid(this.seq);
  }

  private log(tableName: string, row: { id: string; dealId?: string | null }, action: AuditEntry["action"], actor: string, now: Date, changed: string[] = []): void {
    this.audit.push({ id: this.audit.length + 1, occurredAt: now.toISOString(), tableName, rowId: row.id, dealId: tableName === "deals" ? row.id : (row.dealId ?? null), action, actor, changed });
  }

  private patchRow<T extends { id: string; dealId?: string | null }>(table: string, map: Map<string, T>, id: string, patch: Partial<T>, actor: string, now: Date, touch = true): T {
    const cur = map.get(id);
    if (!cur) throw new GuardError(`${table} ${id} not found`);
    const next = { ...cur, ...clone(patch), id } as T;
    if (touch && "updatedAt" in next) (next as { updatedAt: string }).updatedAt = now.toISOString();
    const changed = Object.keys(patch).filter((k) => k !== "updatedAt" && JSON.stringify((cur as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]));
    map.set(id, next);
    if (changed.length) this.log(table, next, "UPDATE", actor, now, changed.sort());
    return clone(next);
  }

  // Deals ---------------------------------------------------------------------
  async createDeal(input: NewDealRow, actor: string, now: Date): Promise<Deal> {
    if (input.originKey && [...this.deals.values()].some((d) => d.originKey === input.originKey)) throw new GuardError(`A deal already exists for ${input.originKey} (deals_origin_key_key)`);
    const ts = now.toISOString();
    const deal: Deal = {
      leadId: null,
      twentyOpportunityId: null,
      ownerId: null,
      borrowerName: null,
      propertyAddress: null,
      propertyState: null,
      loanAmountCents: null,
      collateralRealProperty: null,
      engagementAgreementRef: null,
      originKey: null,
      ...clone(input),
      status: "active",
      id: this.id(),
      stageEnteredAt: ts,
      termSheetAcceptedAt: null,
      lockedFields: [],
      lockedTerms: null,
      lockOverrideRef: null,
      closedOn: null,
      recordVersion: 1,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: actor,
    };
    this.deals.set(deal.id, deal);
    this.log("deals", deal, "INSERT", actor, now);
    return clone(deal);
  }

  async getDeal(id: string): Promise<Deal | null> {
    const d = this.deals.get(id);
    return d ? clone(d) : null;
  }

  async findDealByOriginKey(originKey: string): Promise<Deal | null> {
    const d = [...this.deals.values()].find((x) => x.originKey === originKey);
    return d ? clone(d) : null;
  }

  async listDeals(opts: { limit?: number; openOnly?: boolean } = {}): Promise<Deal[]> {
    return [...this.deals.values()]
      .filter((d) => !opts.openOnly || !["closed", "withdrawn", "lost"].includes(d.stage))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, opts.limit ?? 200)
      .map(clone);
  }

  async updateDeal(id: string, expectedVersion: number, patch: Partial<Deal>, actor: string, now: Date): Promise<Deal> {
    const cur = this.deals.get(id);
    if (!cur || cur.recordVersion !== expectedVersion) throw new ConcurrentUpdateError(`Deal ${id}`);
    if (cur.termSheetAcceptedAt) {
      const lockedChange = (["program", "loanAmountCents", "lockedTerms", "termSheetAcceptedAt"] as const).some(
        (k) => k in patch && JSON.stringify(patch[k] ?? null) !== JSON.stringify(cur[k] ?? null),
      );
      const freshOverride = patch.lockOverrideRef && patch.lockOverrideRef !== cur.lockOverrideRef;
      if (lockedChange && !freshOverride) throw new GuardError(`Deal ${id} terms are locked since term-sheet acceptance; record a modification first`);
    }
    return this.patchRow("deals", this.deals, id, { ...patch, recordVersion: cur.recordVersion + 1, updatedBy: actor }, actor, now);
  }

  async closedLoans(range: { from: string; to: string }): Promise<ClosedLoan[]> {
    return [...this.deals.values()]
      .filter((d) => d.stage === "closed" && d.closedOn && d.closedOn >= range.from && d.closedOn <= range.to)
      .map((d) => ({ dealId: d.id, title: d.title, closedOn: d.closedOn!, loanAmountCents: d.loanAmountCents ?? 0, collateralRealProperty: Boolean(d.collateralRealProperty), program: d.program, propertyState: d.propertyState }));
  }

  // Stage templates -------------------------------------------------------------
  async publishStageTemplate(t: StageTemplate, digest: string): Promise<void> {
    const key = `${t.program}:${t.version}`;
    const existing = this.templates.get(key);
    if (existing && existing.digest !== digest) throw new GuardError(`Stage template ${key} is already published with different content; bump the version`);
    if (!existing) this.templates.set(key, { template: clone(t), digest });
  }

  // Lenders ------------------------------------------------------------------------
  async listLenders(opts: { activeOnly?: boolean } = {}): Promise<LenderPanelEntry[]> {
    return [...this.lenders.values()].filter((l) => !opts.activeOnly || l.active).sort((a, b) => a.name.localeCompare(b.name)).map(clone);
  }

  async getLender(id: string): Promise<LenderPanelEntry | null> {
    const l = this.lenders.get(id);
    return l ? clone(l) : null;
  }

  async insertLender(input: NewLender, actor: string, now: Date): Promise<LenderPanelEntry> {
    const ts = now.toISOString();
    const row: LenderPanelEntry = { ...clone(input), id: this.id(), createdAt: ts, updatedAt: ts, updatedBy: actor };
    this.lenders.set(row.id, row);
    this.log("lender_panel", row, "INSERT", actor, now);
    return clone(row);
  }

  async updateLender(id: string, patch: Partial<NewLender>, actor: string, now: Date): Promise<LenderPanelEntry> {
    return this.patchRow("lender_panel", this.lenders, id, { ...patch, updatedBy: actor } as Partial<LenderPanelEntry>, actor, now);
  }

  // Packages -------------------------------------------------------------------------
  async listPackages(dealId: string): Promise<DealPackage[]> {
    return [...this.packages.values()].filter((p) => p.dealId === dealId).sort((a, b) => a.version - b.version).map(clone);
  }

  async getPackage(id: string): Promise<DealPackage | null> {
    const p = this.packages.get(id);
    return p ? clone(p) : null;
  }

  async insertPackage(pkg: Omit<DealPackage, "id" | "createdAt">, now: Date): Promise<DealPackage> {
    if ([...this.packages.values()].some((p) => p.dealId === pkg.dealId && p.version === pkg.version)) throw new ConcurrentUpdateError(`Package ${pkg.dealId} v${pkg.version}`);
    const row: DealPackage = { ...clone(pkg), id: this.id(), createdAt: now.toISOString() };
    this.packages.set(row.id, row);
    this.log("deal_packages", row, "INSERT", pkg.lockedBy ?? "system", now);
    return clone(row);
  }

  async lockPackage(id: string, by: string, now: Date): Promise<DealPackage> {
    const p = this.packages.get(id);
    if (!p) throw new GuardError(`Package ${id} not found`);
    if (p.status === "locked") throw new GuardError(`Package ${p.dealId} version ${p.version} is locked`);
    return this.patchRow("deal_packages", this.packages, id, { status: "locked", lockedAt: now.toISOString(), lockedBy: by }, by, now, false);
  }

  // Share links -------------------------------------------------------------------------
  async insertShareLink(link: Omit<ShareLink, "id" | "createdAt" | "accessCount" | "lastAccessedAt" | "revokedAt" | "revokedBy" | "revokeReason">, now: Date): Promise<ShareLink> {
    if ([...this.links.values()].some((l) => l.tokenHash === link.tokenHash)) throw new GuardError("Duplicate share-link token");
    const created = now.getTime();
    const expires = Date.parse(link.expiresAt);
    if (!(expires > created) || expires - created > 30 * 86_400_000) throw new GuardError("Share links expire within 30 days");
    const row: ShareLink = { ...clone(link), id: this.id(), createdAt: now.toISOString(), accessCount: 0, lastAccessedAt: null, revokedAt: null, revokedBy: null, revokeReason: null };
    this.links.set(row.id, row);
    this.log("share_links", row, "INSERT", link.createdBy, now);
    return clone(row);
  }

  async getShareLinkByHash(tokenHash: string): Promise<ShareLink | null> {
    const l = [...this.links.values()].find((x) => x.tokenHash === tokenHash);
    return l ? clone(l) : null;
  }

  async recordShareLinkAccess(tokenHash: string, now: Date): Promise<ShareLink | null> {
    const l = [...this.links.values()].find((x) => x.tokenHash === tokenHash);
    if (!l || l.revokedAt || Date.parse(l.expiresAt) <= now.getTime()) return null;
    return this.patchRow("share_links", this.links, l.id, { accessCount: l.accessCount + 1, lastAccessedAt: now.toISOString() }, "share_link:access", now, false);
  }

  async revokeShareLink(id: string, by: string, reason: string, now: Date): Promise<ShareLink> {
    return this.patchRow("share_links", this.links, id, { revokedAt: now.toISOString(), revokedBy: by, revokeReason: reason }, by, now, false);
  }

  async listShareLinks(dealId: string): Promise<ShareLink[]> {
    return [...this.links.values()].filter((l) => l.dealId === dealId).map(clone);
  }

  // Outreach ------------------------------------------------------------------------------
  async getOutreachByKey(approvalKey: string): Promise<LenderOutreach | null> {
    const o = [...this.outreach.values()].find((x) => x.approvalKey === approvalKey);
    return o ? clone(o) : null;
  }

  async getOutreach(id: string): Promise<LenderOutreach | null> {
    const o = this.outreach.get(id);
    return o ? clone(o) : null;
  }

  async insertOutreach(o: Omit<LenderOutreach, "id" | "createdAt" | "updatedAt">, now: Date): Promise<LenderOutreach> {
    if ([...this.outreach.values()].some((x) => x.approvalKey === o.approvalKey)) throw new GuardError("Duplicate outreach approval key");
    const ts = now.toISOString();
    const row: LenderOutreach = { ...clone(o), id: this.id(), createdAt: ts, updatedAt: ts };
    this.outreach.set(row.id, row);
    this.log("lender_outreach", row, "INSERT", o.requestedBy, now);
    return clone(row);
  }

  async updateOutreach(id: string, patch: Partial<LenderOutreach>, actor: string, now: Date): Promise<LenderOutreach> {
    return this.patchRow("lender_outreach", this.outreach, id, patch, actor, now);
  }

  async listOutreach(dealId: string): Promise<LenderOutreach[]> {
    return [...this.outreach.values()].filter((o) => o.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone);
  }

  // Fee ledger -------------------------------------------------------------------------------
  async insertFeeEntry(e: NewFeeEntry, actor: string, now: Date): Promise<FeeEntry> {
    const existing = [...this.fees.values()].find((x) => x.idempotencyKey === e.idempotencyKey);
    if (existing) return clone(existing);
    const ts = now.toISOString();
    const row: FeeEntry = {
      status: "projected",
      earnedOn: null,
      counterparty: null,
      modificationId: null,
      sba159Category: null,
      ...clone(e),
      id: this.id(),
      invoiceId: null,
      voidReason: null,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: actor,
    };
    this.fees.set(row.id, row);
    this.log("fee_ledger", row, "INSERT", actor, now);
    return clone(row);
  }

  async listFeeEntries(dealId: string): Promise<FeeEntry[]> {
    return [...this.fees.values()].filter((f) => f.dealId === dealId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(clone);
  }

  async updateFeeEntry(id: string, patch: Partial<Pick<FeeEntry, "status" | "invoiceId" | "voidReason" | "earnedOn">>, actor: string, now: Date): Promise<FeeEntry> {
    const cur = this.fees.get(id);
    if (!cur) throw new GuardError(`Fee entry ${id} not found`);
    if (cur.status === "void" && patch.status && patch.status !== "void") throw new GuardError("A void fee_ledger entry cannot be reinstated");
    if (cur.status === "settled" && patch.status && patch.status !== "settled") throw new GuardError("A settled fee_ledger entry is final");
    if (patch.status === "void" && !(patch.voidReason ?? cur.voidReason)) throw new GuardError("Voiding needs a reason");
    return this.patchRow("fee_ledger", this.fees, id, { ...patch, updatedBy: actor }, actor, now);
  }

  // Invoices -----------------------------------------------------------------------------------
  async nextInvoiceNumber(year: number): Promise<string> {
    const n = (this.invoiceSeq.get(year) ?? 0) + 1;
    this.invoiceSeq.set(year, n);
    return `KC-${year}-${String(n).padStart(4, "0")}`;
  }

  async insertInvoice(i: Omit<Invoice, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<Invoice> {
    const ts = now.toISOString();
    const row: Invoice = { ...clone(i), id: this.id(), createdAt: ts, updatedAt: ts };
    this.invoices.set(row.id, row);
    this.log("invoices", row, "INSERT", actor, now);
    return clone(row);
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const i = this.invoices.get(id);
    return i ? clone(i) : null;
  }

  async updateInvoice(id: string, patch: Partial<Invoice>, actor: string, now: Date): Promise<Invoice> {
    const cur = this.invoices.get(id);
    if (!cur) throw new GuardError(`Invoice ${id} not found`);
    if (["issued", "settled", "void"].includes(cur.status) && (patch.lines || patch.totalCents !== undefined || patch.billToName)) throw new GuardError(`Invoice ${cur.number} is ${cur.status} and its lines cannot change`);
    return this.patchRow("invoices", this.invoices, id, patch, actor, now);
  }

  async listInvoices(dealId: string): Promise<Invoice[]> {
    return [...this.invoices.values()].filter((i) => i.dealId === dealId).map(clone);
  }

  // Broker of record + modifications ----------------------------------------------------------------
  /** Test helper: seed the loan-level broker-of-record file for a deal. */
  seedLoanBrokerOfRecord(r: LoanBrokerOfRecord): void {
    this.brokerOfRecord.set(r.id, { record_kind: "loan", ...clone(r) });
  }

  async getLoanBrokerOfRecord(dealId: string): Promise<LoanBrokerOfRecord | null> {
    for (const r of this.brokerOfRecord.values()) if (r.record_kind === "loan" && r.dealId === dealId) return clone(r) as unknown as LoanBrokerOfRecord;
    return null;
  }

  async insertBrokerOfRecordRow(row: Record<string, unknown>): Promise<string> {
    const id = this.id();
    this.brokerOfRecord.set(id, { ...clone(row), id });
    return id;
  }

  async updateBrokerOfRecordRow(id: string, row: Record<string, unknown>): Promise<void> {
    const cur = this.brokerOfRecord.get(id);
    if (!cur) throw new GuardError(`broker_of_record ${id} not found`);
    this.brokerOfRecord.set(id, { ...cur, ...clone(row), id });
  }

  async insertModification(m: Omit<ModificationRecord, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<ModificationRecord> {
    const ts = now.toISOString();
    const row: ModificationRecord = { ...clone(m), id: this.id(), createdAt: ts, updatedAt: ts };
    this.modifications.set(row.id, row);
    this.log("deal_modifications", row, "INSERT", actor, now);
    return clone(row);
  }

  async getModification(id: string): Promise<ModificationRecord | null> {
    const m = this.modifications.get(id);
    return m ? clone(m) : null;
  }

  async updateModification(id: string, patch: Partial<ModificationRecord>, actor: string, now: Date): Promise<ModificationRecord> {
    return this.patchRow("deal_modifications", this.modifications, id, patch, actor, now);
  }

  async listModifications(dealId: string): Promise<ModificationRecord[]> {
    return [...this.modifications.values()].filter((m) => m.dealId === dealId).map(clone);
  }

  // Form 159 -------------------------------------------------------------------------------------------
  async insertForm159(f: Omit<Form159Record, "id" | "createdAt" | "updatedAt">, actor: string, now: Date): Promise<Form159Record> {
    if ([...this.form159.values()].some((x) => x.dealId === f.dealId && x.version === f.version)) throw new ConcurrentUpdateError(`Form 159 ${f.dealId} v${f.version}`);
    const ts = now.toISOString();
    const row: Form159Record = { ...clone(f), id: this.id(), createdAt: ts, updatedAt: ts };
    this.form159.set(row.id, row);
    this.log("sba_form159", row, "INSERT", actor, now);
    return clone(row);
  }

  async getForm159(id: string): Promise<Form159Record | null> {
    const f = this.form159.get(id);
    return f ? clone(f) : null;
  }

  async getForm159ByProviderRequest(provider: string, requestId: string): Promise<Form159Record | null> {
    const f = [...this.form159.values()].find((x) => x.provider === provider && x.providerRequestId === requestId);
    return f ? clone(f) : null;
  }

  async updateForm159(id: string, patch: Partial<Form159Record>, actor: string, now: Date): Promise<Form159Record> {
    return this.patchRow("sba_form159", this.form159, id, patch, actor, now);
  }

  async listForm159(dealId: string): Promise<Form159Record[]> {
    return [...this.form159.values()].filter((f) => f.dealId === dealId).sort((a, b) => a.version - b.version).map(clone);
  }

  // DRE ---------------------------------------------------------------------------------------------------
  async saveDreReport(r: Omit<DreReport, "id" | "createdAt">, now: Date): Promise<DreReport> {
    const key = `${r.reportKind}:${r.asOf}`;
    const existing = this.dre.get(key);
    const row: DreReport = { ...clone(r), id: existing?.id ?? this.id(), createdAt: existing?.createdAt ?? now.toISOString() };
    this.dre.set(key, row);
    this.log("dre_reporting", { id: row.id }, existing ? "UPDATE" : "INSERT", r.createdBy, now);
    return clone(row);
  }

  async listDreReports(kind?: DreReport["reportKind"]): Promise<DreReport[]> {
    return [...this.dre.values()].filter((r) => !kind || r.reportKind === kind).sort((a, b) => b.asOf.localeCompare(a.asOf)).map(clone);
  }

  // Audit -----------------------------------------------------------------------------------------------------
  async auditForDeal(dealId: string, limit = 100): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.dealId === dealId).slice(-limit).reverse().map(clone);
  }
}
