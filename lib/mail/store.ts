// mail_messages persistence (Supabase) plus the Supabase-backed deal directory
// the router uses. Tests use MemoryMailStore and MemoryDealDirectory.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttachmentRecord } from "./attachments";
import type { MailClassification } from "./classify";
import { MAILBOXES, type InboundMailbox } from "./mailboxes";
import type { DealDirectory, DealMatch, MailRoute } from "./route";
import type { AuthVerdict } from "./types";

export type MailRow = {
  mailbox: InboundMailbox;
  provider: string;
  providerMessageId: string;
  folderId: string;
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  receivedAt: string;
  snippet: string;
  /** Body with restricted values masked (safe to show staff). */
  bodyText: string;
  /** Full body sealed with lib/privacy/crypto.ts when it contained restricted values. */
  bodyEncrypted: string | null;
  bodyRestricted: boolean;
  attachments: AttachmentRecord[];
  automated: boolean;
  bulk: boolean;
  dmarc: AuthVerdict;
  classification: MailClassification;
  route: MailRoute;
  agentRunId: string | null;
  processedAt: string;
  error: string | null;
};

/** A message whose processing failed (stored so the poller can retry it). */
export type MailFailure = {
  mailbox: InboundMailbox;
  provider: string;
  providerMessageId: string;
  folderId: string;
  /** From the poll listing; falls back to the failure time. */
  receivedAt: string | null;
  error: string;
  agentRunId: string | null;
  at: string;
};

export type FailedMail = { providerMessageId: string; folderId: string; receivedAt: string; attempts: number; lastAttemptAt: string };

/** A message waiting in a staff review queue (needs_review, or failed with every retry used). */
export type ReviewMail = {
  id: string;
  mailbox: InboundMailbox;
  queue: string;
  status: "needs_review" | "failed";
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  receivedAt: string;
  category: MailClassification["category"];
  classification: MailClassification;
  suspicious: boolean;
  dmarc: AuthVerdict;
  reviewReasons: string[];
  leadId: string | null;
  dealId: string | null;
  attachments: AttachmentRecord[];
  attempts: number;
  error: string | null;
};

export type ReviewResolution = {
  reviewer: string;
  at: string;
  outcome: "assigned" | "dismissed";
  leadId?: string | null;
  dealId?: string | null;
  attachments?: AttachmentRecord[];
};

export interface MailStore {
  find(mailbox: InboundMailbox, providerMessageId: string): Promise<{ id: string; status: string } | null>;
  /** Which of `ids` already have a row (any status, failed included). */
  knownIds(mailbox: InboundMailbox, ids: string[]): Promise<Set<string>>;
  /** Newest received_at of a successfully stored message (polling cursor; failed rows are retried separately). */
  latestReceivedAt(mailbox: InboundMailbox): Promise<Date | null>;
  /** Inserts, replaces a failed row, or returns the existing row for (mailbox, providerMessageId). */
  save(row: MailRow): Promise<{ id: string; created: boolean }>;
  /** Stores (or bumps) a failed row. Null when the message has since been processed. */
  recordFailure(f: MailFailure): Promise<{ id: string; attempts: number } | null>;
  /** Failed rows with fewer than `maxAttempts` attempts, oldest attempt first. */
  listFailed(mailbox: InboundMailbox, opts: { maxAttempts: number; limit: number }): Promise<FailedMail[]>;
  /**
   * The staff review queue, newest first: unreviewed needs_review rows
   * (mail_messages_review_idx) plus failed rows that used every retry.
   */
  listReview(opts: { queue?: string | null; limit: number; maxAttempts: number }): Promise<ReviewMail[]>;
  getReview(id: string, opts: { maxAttempts: number }): Promise<ReviewMail | null>;
  /** Closes a review (compare-and-set: only while it is still unreviewed). False when someone else got there first. */
  markReviewed(id: string, resolution: ReviewResolution): Promise<boolean>;
}

type ReviewState = { reviewedAt?: string | null; reviewedBy?: string | null; reviewOutcome?: ReviewResolution["outcome"] | null };

function memoryReview(r: MailRow & { id: string; attempts: number }): ReviewMail {
  return {
    id: r.id,
    mailbox: r.mailbox,
    queue: r.route.queue,
    status: r.error ? "failed" : "needs_review",
    fromAddress: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.receivedAt,
    category: r.classification.category,
    classification: r.classification,
    suspicious: r.classification.suspicious,
    dmarc: r.dmarc,
    reviewReasons: r.route.reviewReasons,
    leadId: r.route.leadId,
    dealId: r.route.dealId,
    attachments: r.attachments,
    attempts: r.attempts,
    error: r.error,
  };
}

/** Placeholder classification/route for a failed row (the NOT NULL columns need values). */
function failedRow(f: MailFailure): MailRow {
  return {
    mailbox: f.mailbox,
    provider: f.provider,
    providerMessageId: f.providerMessageId,
    folderId: f.folderId,
    internetMessageId: null,
    inReplyTo: null,
    references: [],
    fromAddress: "",
    fromName: null,
    toAddresses: [],
    ccAddresses: [],
    subject: "",
    receivedAt: f.receivedAt ?? f.at,
    snippet: "",
    bodyText: "",
    bodyEncrypted: null,
    bodyRestricted: false,
    attachments: [],
    automated: false,
    bulk: false,
    dmarc: "unknown",
    classification: { category: "other", summary: "", dealReference: null, propertyName: null, counterparty: null, documentKinds: [], urgency: "normal", needsBroker: true, suspicious: false, confidence: 0, source: "rules", model: null, flags: ["processing_failed"] },
    route: { dealId: null, leadId: null, method: "none", confidence: 0, queue: MAILBOXES[f.mailbox].queue, status: "needs_review", reviewReasons: ["processing_failed"] },
    agentRunId: f.agentRunId,
    processedAt: f.at,
    error: f.error.slice(0, 2000),
  };
}

export class MemoryMailStore implements MailStore {
  readonly rows: (MailRow & { id: string; attempts: number } & ReviewState)[] = [];

  private inReview(r: MemoryMailStore["rows"][number], maxAttempts: number): boolean {
    if (r.reviewedAt) return false;
    return r.error ? r.attempts >= maxAttempts : r.route.status === "needs_review";
  }

  async listReview(opts: { queue?: string | null; limit: number; maxAttempts: number }) {
    return this.rows
      .filter((r) => this.inReview(r, opts.maxAttempts) && (!opts.queue || r.route.queue === opts.queue))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, opts.limit)
      .map(memoryReview);
  }

  async getReview(id: string, opts: { maxAttempts: number }) {
    const r = this.rows.find((x) => x.id === id);
    return r && this.inReview(r, opts.maxAttempts) ? memoryReview(r) : null;
  }

  async markReviewed(id: string, res: ReviewResolution) {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.reviewedAt) return false;
    if (!r.error && r.route.status !== "needs_review") return false;
    Object.assign(r, { reviewedAt: res.at, reviewedBy: res.reviewer, reviewOutcome: res.outcome });
    if (res.attachments) r.attachments = res.attachments;
    if (!r.error) {
      r.route = {
        ...r.route,
        status: res.outcome === "assigned" ? "processed" : "ignored",
        ...(res.outcome === "assigned" ? { leadId: res.leadId ?? null, dealId: res.dealId ?? null } : {}),
      };
    }
    return true;
  }

  private status(r: MailRow): string {
    return r.error ? "failed" : r.route.status;
  }

  async find(mailbox: InboundMailbox, providerMessageId: string) {
    const r = this.rows.find((x) => x.mailbox === mailbox && x.providerMessageId === providerMessageId);
    return r ? { id: r.id, status: this.status(r) } : null;
  }

  async knownIds(mailbox: InboundMailbox, ids: string[]) {
    const wanted = new Set(ids);
    return new Set(this.rows.filter((r) => r.mailbox === mailbox && wanted.has(r.providerMessageId)).map((r) => r.providerMessageId));
  }

  async latestReceivedAt(mailbox: InboundMailbox) {
    const times = this.rows.filter((r) => r.mailbox === mailbox && !r.error).map((r) => Date.parse(r.receivedAt));
    return times.length ? new Date(Math.max(...times)) : null;
  }

  async save(row: MailRow) {
    const i = this.rows.findIndex((x) => x.mailbox === row.mailbox && x.providerMessageId === row.providerMessageId);
    if (i >= 0) {
      const existing = this.rows[i]!;
      if (!existing.error) return { id: existing.id, created: false };
      this.rows[i] = { ...row, id: existing.id, attempts: existing.attempts };
      return { id: existing.id, created: true };
    }
    const id = globalThis.crypto.randomUUID();
    this.rows.push({ ...row, id, attempts: 0 });
    return { id, created: true };
  }

  async recordFailure(f: MailFailure) {
    const existing = this.rows.find((x) => x.mailbox === f.mailbox && x.providerMessageId === f.providerMessageId);
    if (existing && !existing.error) return null;
    if (existing) {
      Object.assign(existing, { error: f.error.slice(0, 2000), processedAt: f.at, agentRunId: f.agentRunId, attempts: existing.attempts + 1 });
      return { id: existing.id, attempts: existing.attempts };
    }
    const id = globalThis.crypto.randomUUID();
    this.rows.push({ ...failedRow(f), id, attempts: 1 });
    return { id, attempts: 1 };
  }

  async listFailed(mailbox: InboundMailbox, opts: { maxAttempts: number; limit: number }) {
    return this.rows
      .filter((r) => r.mailbox === mailbox && r.error && r.attempts < opts.maxAttempts)
      .sort((a, b) => a.processedAt.localeCompare(b.processedAt))
      .slice(0, opts.limit)
      .map((r) => ({ providerMessageId: r.providerMessageId, folderId: r.folderId, receivedAt: r.receivedAt, attempts: r.attempts, lastAttemptAt: r.processedAt }));
  }
}

function toDb(row: MailRow) {
  return {
    mailbox: row.mailbox,
    provider: row.provider,
    provider_message_id: row.providerMessageId,
    folder_id: row.folderId,
    internet_message_id: row.internetMessageId,
    in_reply_to: row.inReplyTo,
    reference_ids: row.references,
    from_address: row.fromAddress,
    from_name: row.fromName,
    to_addresses: row.toAddresses,
    cc_addresses: row.ccAddresses,
    subject: row.subject,
    received_at: row.receivedAt,
    snippet: row.snippet,
    body_text: row.bodyText,
    body_encrypted: row.bodyEncrypted,
    body_restricted: row.bodyRestricted,
    has_attachments: row.attachments.length > 0,
    attachments: row.attachments,
    automated: row.automated,
    bulk: row.bulk,
    dmarc: row.dmarc,
    classification: row.classification,
    category: row.classification.category,
    classifier_source: row.classification.source,
    classifier_model: row.classification.model,
    confidence: row.classification.confidence,
    suspicious: row.classification.suspicious,
    deal_id: row.route.dealId,
    lead_id: row.route.leadId,
    route_method: row.route.method,
    route_confidence: row.route.confidence,
    queue: row.route.queue,
    status: row.error ? "failed" : row.route.status,
    review_reasons: row.route.reviewReasons,
    agent_run_id: row.agentRunId,
    processed_at: row.processedAt,
    error: row.error,
  };
}

export function supabaseMailStore(db: SupabaseClient): MailStore {
  const table = () => db.from("mail_messages");
  return {
    async find(mailbox, providerMessageId) {
      const { data, error } = await table().select("id, status").eq("mailbox", mailbox).eq("provider_message_id", providerMessageId).maybeSingle();
      if (error) throw new Error(`mail_messages lookup failed: ${error.message}`);
      return (data as { id: string; status: string } | null) ?? null;
    },
    async knownIds(mailbox, ids) {
      const known = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data, error } = await table().select("provider_message_id").eq("mailbox", mailbox).in("provider_message_id", chunk);
        if (error) throw new Error(`mail_messages lookup failed: ${error.message}`);
        for (const r of (data ?? []) as { provider_message_id: string }[]) known.add(r.provider_message_id);
      }
      return known;
    },
    async latestReceivedAt(mailbox) {
      const { data, error } = await table().select("received_at").eq("mailbox", mailbox).neq("status", "failed").order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`mail_messages cursor failed: ${error.message}`);
      return data ? new Date((data as { received_at: string }).received_at) : null;
    },
    async save(row) {
      const ins = await table().insert(toDb(row)).select("id").single();
      if (!ins.error) return { id: (ins.data as { id: string }).id, created: true };
      if (ins.error.code === "23505") {
        // A failed row is replaced by the successful attempt (conditional on still being failed).
        const upd = await table().update(toDb(row)).eq("mailbox", row.mailbox).eq("provider_message_id", row.providerMessageId).eq("status", "failed").select("id");
        if (upd.error) throw new Error(`mail_messages update failed: ${upd.error.message}`);
        const replaced = (upd.data as { id: string }[] | null)?.[0];
        if (replaced) return { id: replaced.id, created: true };
        const existing = await this.find(row.mailbox, row.providerMessageId);
        if (existing) return { id: existing.id, created: false };
      }
      throw new Error(`mail_messages insert failed: ${ins.error.message}`);
    },
    async recordFailure(f) {
      const ins = await table().insert({ ...toDb(failedRow(f)), attempts: 1 }).select("id").single();
      if (!ins.error) return { id: (ins.data as { id: string }).id, attempts: 1 };
      if (ins.error.code !== "23505") throw new Error(`mail_messages failure insert failed: ${ins.error.message}`);
      const { data, error } = await table().select("id, status, attempts").eq("mailbox", f.mailbox).eq("provider_message_id", f.providerMessageId).maybeSingle();
      if (error || !data) throw new Error(`mail_messages failure lookup failed: ${error?.message ?? "row vanished"}`);
      const row = data as { id: string; status: string; attempts: number };
      if (row.status !== "failed") return null;
      const attempts = row.attempts + 1;
      const upd = await table()
        .update({ error: f.error.slice(0, 2000), processed_at: f.at, agent_run_id: f.agentRunId, attempts })
        .eq("id", row.id)
        .eq("status", "failed")
        .eq("attempts", row.attempts)
        .select("id");
      if (upd.error) throw new Error(`mail_messages failure update failed: ${upd.error.message}`);
      return { id: row.id, attempts: upd.data?.length ? attempts : row.attempts };
    },
    async listFailed(mailbox, opts) {
      const { data, error } = await table()
        .select("provider_message_id, folder_id, received_at, attempts, processed_at")
        .eq("mailbox", mailbox)
        .eq("status", "failed")
        .lt("attempts", opts.maxAttempts)
        .order("processed_at", { ascending: true })
        .limit(opts.limit);
      if (error) throw new Error(`mail_messages failed-row lookup failed: ${error.message}`);
      return ((data ?? []) as { provider_message_id: string; folder_id: string; received_at: string; attempts: number; processed_at: string }[]).map((r) => ({
        providerMessageId: r.provider_message_id,
        folderId: r.folder_id,
        receivedAt: r.received_at,
        attempts: r.attempts,
        lastAttemptAt: r.processed_at,
      }));
    },
    async listReview(opts) {
      let q = table()
        .select(REVIEW_COLUMNS)
        .is("reviewed_at", null)
        .or(`status.eq.needs_review,and(status.eq.failed,attempts.gte.${Math.trunc(opts.maxAttempts)})`);
      if (opts.queue) q = q.eq("queue", opts.queue);
      const { data, error } = await q.order("received_at", { ascending: false }).limit(opts.limit);
      if (error) throw new Error(`mail review queue read failed: ${error.message}`);
      return ((data ?? []) as unknown as ReviewDbRow[]).map(fromReviewDb);
    },
    async getReview(id, opts) {
      const { data, error } = await table().select(REVIEW_COLUMNS).eq("id", id).is("reviewed_at", null).maybeSingle();
      if (error) throw new Error(`mail review read failed: ${error.message}`);
      const row = data as unknown as ReviewDbRow | null;
      if (!row) return null;
      if (row.status === "failed" ? row.attempts < opts.maxAttempts : row.status !== "needs_review") return null;
      return fromReviewDb(row);
    },
    async markReviewed(id, res) {
      const { data: current, error: readError } = await table().select("status").eq("id", id).is("reviewed_at", null).maybeSingle();
      if (readError) throw new Error(`mail review read failed: ${readError.message}`);
      const status = (current as { status: string } | null)?.status;
      if (status !== "needs_review" && status !== "failed") return false;
      const patch: Record<string, unknown> = { reviewed_at: res.at, reviewed_by: res.reviewer.slice(0, 200), review_outcome: res.outcome };
      if (res.attachments) patch.attachments = res.attachments;
      if (status === "needs_review") {
        patch.status = res.outcome === "assigned" ? "processed" : "ignored";
        if (res.outcome === "assigned") Object.assign(patch, { lead_id: res.leadId ?? null, deal_id: res.dealId ?? null });
      }
      const { data, error } = await table().update(patch).eq("id", id).eq("status", status).is("reviewed_at", null).select("id");
      if (error) throw new Error(`mail review update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

const REVIEW_COLUMNS =
  "id, mailbox, queue, status, from_address, from_name, subject, snippet, received_at, category, classification, suspicious, dmarc, review_reasons, lead_id, deal_id, attachments, attempts, error";

type ReviewDbRow = {
  id: string;
  mailbox: InboundMailbox;
  queue: string;
  status: string;
  from_address: string;
  from_name: string | null;
  subject: string;
  snippet: string;
  received_at: string;
  category: MailClassification["category"];
  classification: MailClassification;
  suspicious: boolean;
  dmarc: AuthVerdict;
  review_reasons: string[] | null;
  lead_id: string | null;
  deal_id: string | null;
  attachments: AttachmentRecord[] | null;
  attempts: number;
  error: string | null;
};

function fromReviewDb(r: ReviewDbRow): ReviewMail {
  return {
    id: r.id,
    mailbox: r.mailbox,
    queue: r.queue,
    status: r.status === "failed" ? "failed" : "needs_review",
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    category: r.category,
    classification: r.classification,
    suspicious: r.suspicious,
    dmarc: r.dmarc,
    reviewReasons: r.review_reasons ?? [],
    leadId: r.lead_id,
    dealId: r.deal_id,
    attachments: r.attachments ?? [],
    attempts: r.attempts,
    error: r.error,
  };
}

/** True for "relation does not exist" (deals before WS-I's migration is applied). */
function missingTable(error: { code?: string; message: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message);
}

type DealRow = { id: string; lead_id: string | null; name: string | null };
const toMatch = (d: DealRow): DealMatch => ({ dealId: d.id, leadId: d.lead_id, name: d.name });

/** Escapes LIKE wildcards for an exact, case-insensitive match. */
function exactIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

export function supabaseDealDirectory(db: SupabaseClient): DealDirectory {
  let dealsMissing = false;
  const deals = async (build: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<DealRow[]> => {
    if (dealsMissing) return [];
    const { data, error } = await build(db.from("deals").select("id, lead_id, name"));
    if (error) {
      if (missingTable(error)) {
        dealsMissing = true;
        console.warn("[mail] deals table not found; routing by lead only");
        return [];
      }
      throw new Error(`deals lookup failed: ${error.message}`);
    }
    return (data as DealRow[] | null) ?? [];
  };

  return {
    async byReference(reference) {
      const hex = reference.replace(/^KC-/i, "").toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(hex)) return [];
      // uuid order is byte order, so the 8-hex prefix is a range scan.
      const rows = await deals((q) => q.gte("id", `${hex}-0000-0000-0000-000000000000`).lte("id", `${hex}-ffff-ffff-ffff-ffffffffffff`).limit(5));
      return rows.map(toMatch);
    },
    async byThread(ids) {
      if (!ids.length) return null;
      const { data, error } = await db
        .from("mail_messages")
        .select("deal_id, lead_id")
        .in("internet_message_id", ids.slice(0, 50).map((i) => i.toLowerCase()))
        .or("deal_id.not.is.null,lead_id.not.is.null")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`mail thread lookup failed: ${error.message}`);
      const row = data as { deal_id: string | null; lead_id: string | null } | null;
      return row ? { dealId: row.deal_id, leadId: row.lead_id } : null;
    },
    async byParticipant(email) {
      const { data, error } = await db.from("leads").select("id, contact").ilike("contact->>email", exactIlike(email)).order("created_at", { ascending: false }).limit(10);
      if (error) throw new Error(`lead lookup failed: ${error.message}`);
      const leadIds = ((data ?? []) as { id: string; contact: { email?: string } }[]).filter((l) => l.contact?.email?.toLowerCase() === email.toLowerCase()).map((l) => l.id);
      if (!leadIds.length) return { leadIds, deals: [] };
      const rows = await deals((q) => q.in("lead_id", leadIds).eq("status", "active").limit(10));
      return { leadIds, deals: rows.map(toMatch) };
    },
    async byProperty(name) {
      const n = name.trim();
      if (n.length < 4) return [];
      const rows = await deals((q) => q.or(`property_name.ilike.${exactIlike(n).replace(/[,()]/g, "")},name.ilike.${exactIlike(n).replace(/[,()]/g, "")}`).eq("status", "active").limit(5));
      return rows.map(toMatch);
    },
  };
}
