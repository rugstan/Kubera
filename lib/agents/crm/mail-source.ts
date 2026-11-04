// Reads the routed mail row the CRM agents write notes from (mail_messages,
// WS-Q). Only the classification and routing columns are read, not the body.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoutedMail } from "./notes";

export interface RoutedMailSource {
  get(mailMessageId: string): Promise<RoutedMail | null>;
}

export class MemoryRoutedMailSource implements RoutedMailSource {
  readonly rows = new Map<string, RoutedMail>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
}

type MailRowDb = {
  id: string;
  mailbox: string;
  subject: string;
  from_address: string;
  from_name: string | null;
  received_at: string;
  status: RoutedMail["status"];
  deal_id: string | null;
  lead_id: string | null;
  category: string;
  confidence: number | string;
  classifier_source: "model" | "rules";
  suspicious: boolean;
  classification: Record<string, unknown> | null;
  attachments: unknown[] | null;
  automated: boolean;
  bulk: boolean;
};

const COLUMNS = "id, mailbox, subject, from_address, from_name, received_at, status, deal_id, lead_id, category, confidence, classifier_source, suspicious, classification, attachments, automated, bulk";

export function routedMailFromRow(r: MailRowDb): RoutedMail {
  const c = r.classification ?? {};
  const urgency = c.urgency === "low" || c.urgency === "high" ? c.urgency : "normal";
  return {
    id: r.id,
    mailbox: r.mailbox,
    subject: r.subject,
    fromAddress: r.from_address,
    fromName: r.from_name,
    receivedAt: r.received_at,
    status: r.status,
    dealId: r.deal_id,
    leadId: r.lead_id,
    category: r.category,
    summary: typeof c.summary === "string" ? c.summary : "",
    confidence: Number(r.confidence),
    source: r.classifier_source,
    suspicious: r.suspicious,
    needsBroker: c.needsBroker === true,
    urgency,
    documentKinds: Array.isArray(c.documentKinds) ? c.documentKinds.filter((k): k is string => typeof k === "string") : [],
    attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
    automated: r.automated,
    bulk: r.bulk,
    injectionCodes: Array.isArray(c.flags) ? c.flags.filter((f): f is string => typeof f === "string" && f.startsWith("injection.")) : [],
  };
}

export function supabaseRoutedMailSource(db: SupabaseClient): RoutedMailSource {
  return {
    async get(id) {
      const { data, error } = await db.from("mail_messages").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`mail_messages lookup failed: ${error.message}`);
      return data ? routedMailFromRow(data as unknown as MailRowDb) : null;
    },
  };
}
