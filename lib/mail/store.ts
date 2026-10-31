// mail_messages persistence (Supabase) plus the Supabase-backed deal directory
// the router uses. Tests use MemoryMailStore and MemoryDealDirectory.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttachmentRecord } from "./attachments";
import type { MailClassification } from "./classify";
import type { InboundMailbox } from "./mailboxes";
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

export interface MailStore {
  find(mailbox: InboundMailbox, providerMessageId: string): Promise<{ id: string; status: string } | null>;
  /** Newest received_at stored for the mailbox (polling cursor). */
  latestReceivedAt(mailbox: InboundMailbox): Promise<Date | null>;
  /** Inserts, or returns the existing row for (mailbox, providerMessageId). */
  save(row: MailRow): Promise<{ id: string; created: boolean }>;
}

export class MemoryMailStore implements MailStore {
  readonly rows: (MailRow & { id: string })[] = [];

  async find(mailbox: InboundMailbox, providerMessageId: string) {
    const r = this.rows.find((x) => x.mailbox === mailbox && x.providerMessageId === providerMessageId);
    return r ? { id: r.id, status: r.route.status } : null;
  }

  async latestReceivedAt(mailbox: InboundMailbox) {
    const times = this.rows.filter((r) => r.mailbox === mailbox).map((r) => Date.parse(r.receivedAt));
    return times.length ? new Date(Math.max(...times)) : null;
  }

  async save(row: MailRow) {
    const existing = await this.find(row.mailbox, row.providerMessageId);
    if (existing) return { id: existing.id, created: false };
    const id = globalThis.crypto.randomUUID();
    this.rows.push({ ...row, id });
    return { id, created: true };
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
  return {
    async find(mailbox, providerMessageId) {
      const { data, error } = await db.from("mail_messages").select("id, status").eq("mailbox", mailbox).eq("provider_message_id", providerMessageId).maybeSingle();
      if (error) throw new Error(`mail_messages lookup failed: ${error.message}`);
      return (data as { id: string; status: string } | null) ?? null;
    },
    async latestReceivedAt(mailbox) {
      const { data, error } = await db.from("mail_messages").select("received_at").eq("mailbox", mailbox).order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`mail_messages cursor failed: ${error.message}`);
      return data ? new Date((data as { received_at: string }).received_at) : null;
    },
    async save(row) {
      const ins = await db.from("mail_messages").insert(toDb(row)).select("id").single();
      if (!ins.error) return { id: (ins.data as { id: string }).id, created: true };
      if (ins.error.code === "23505") {
        const existing = await this.find(row.mailbox, row.providerMessageId);
        if (existing) return { id: existing.id, created: false };
      }
      throw new Error(`mail_messages insert failed: ${ins.error.message}`);
    },
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
