// Access-request export (CCPA right to know, Civ. Code §1798.110 / .115 / .130):
// everything Kubera holds about one person, keyed by email, in a portable
// JSON document, plus the categories, sources, purposes and recipients the
// statute requires us to describe.
//
// Internal plumbing (CRM ids, retry state, IP hashes) is left out because it
// is not information *about* the person; inferences (Jev program-fit and
// urgency tier) are included because the CCPA treats them as personal
// information. Encrypted fields are decrypted with their row context when a
// keyring is available and otherwise listed as withheld for manual handling.

import { createHash } from "node:crypto";
import { PI_CATEGORIES, PURPOSES, SERVICE_PROVIDERS } from "@/components/legal/legal";
import { decryptField, isEncrypted, type PiiKeyring } from "./crypto";
import { normalizeEmail } from "./requests";

export type ExportRecord = Record<string, unknown>;

export interface SubjectDataSource {
  leads(email: string): Promise<ExportRecord[]>;
  partners(email: string): Promise<ExportRecord[]>;
  consentEvents(email: string): Promise<ExportRecord[]>;
  conversationsForLeads(leadIds: readonly string[]): Promise<ExportRecord[]>;
  documentsForLeads(leadIds: readonly string[]): Promise<ExportRecord[]>;
  privacyRequests(email: string): Promise<ExportRecord[]>;
  preferences(email: string): Promise<ExportRecord | null>;
}

/** Columns exported per table; anything else is internal plumbing. */
export const EXPORT_COLUMNS = {
  leads: ["id", "created_at", "source", "contact", "intake", "decision", "rationale", "primary_program", "urgency_tier"],
  partners: ["id", "created_at", "partner_type", "organization", "email", "profile", "status"],
  consent_events: ["id", "occurred_at", "event_type", "form", "text_version", "channels", "email", "phone", "page", "ip", "user_agent"],
  ai_conversations: ["id", "created_at", "last_message_at", "page", "messages"],
  documents: ["id", "created_at", "kind", "file_name", "content_type"],
  privacy_requests: ["id", "created_at", "request_type", "status", "completed_at"],
  privacy_preferences: ["human_review_only", "ai_processing_opt_out", "opt_out_sale_share", "updated_at"],
} as const satisfies Record<string, readonly string[]>;

type ExportTable = keyof typeof EXPORT_COLUMNS;

export type SubjectExport = {
  format: "kubera-privacy-export/v1";
  generatedAt: string;
  requestId: string | null;
  subject: { email: string };
  about: {
    categories: { category: string; examples: string; sensitive: boolean; retention: string }[];
    sources: string[];
    purposes: readonly string[];
    recipients: { name: string; role: string }[];
    sale: string;
  };
  records: {
    leads: ExportRecord[];
    documents: ExportRecord[];
    aiConversations: ExportRecord[];
    partnerRegistrations: ExportRecord[];
    consentRecords: ExportRecord[];
    privacyRequests: ExportRecord[];
    privacyPreferences: ExportRecord | null;
  };
  withheld: { table: string; id: unknown; field: string; reason: string }[];
  notes: string[];
};

function pick(table: ExportTable, row: ExportRecord, withheld: SubjectExport["withheld"], keyring: PiiKeyring | null | undefined): ExportRecord {
  const out: ExportRecord = {};
  for (const col of EXPORT_COLUMNS[table]) {
    if (!(col in row)) continue;
    const v = row[col];
    if (isEncrypted(v)) {
      try {
        out[col] = decryptField(v, { context: `${table}.${col}:${String(row.id)}`, keyring });
      } catch {
        withheld.push({ table, id: row.id, field: col, reason: "encrypted field; compliance will provide it after manual decryption" });
      }
    } else {
      out[col] = v;
    }
  }
  return out;
}

/** Stable JSON (sorted keys) so the export hash is reproducible. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export function exportSha256(doc: SubjectExport): string {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

export async function buildSubjectExport(
  source: SubjectDataSource,
  rawEmail: string,
  opts: { now?: Date; requestId?: string | null; keyring?: PiiKeyring | null } = {},
): Promise<SubjectExport> {
  const email = normalizeEmail(rawEmail);
  const withheld: SubjectExport["withheld"] = [];
  const [leads, partners, consent, requests, prefs] = await Promise.all([
    source.leads(email),
    source.partners(email),
    source.consentEvents(email),
    source.privacyRequests(email),
    source.preferences(email),
  ]);
  const leadIds = leads.map((l) => String(l.id));
  const [conversations, documents] = leadIds.length
    ? await Promise.all([source.conversationsForLeads(leadIds), source.documentsForLeads(leadIds)])
    : [[], []];

  return {
    format: "kubera-privacy-export/v1",
    generatedAt: (opts.now ?? new Date()).toISOString(),
    requestId: opts.requestId ?? null,
    subject: { email },
    about: {
      categories: PI_CATEGORIES.map((c) => ({ category: c.label, examples: c.examples, sensitive: c.sensitive, retention: c.retention })),
      sources: [
        "You, through our website forms, Kubera AI, email, phone, and text",
        "People you authorize, such as your referring broker, co-borrowers, accountants, and attorneys",
        "Lenders and third-party report providers working on your loan",
        "Public sources such as property records and license lookups",
        "Your browser or device when you visit our sites",
      ],
      purposes: PURPOSES,
      recipients: [
        { name: "Lenders and capital sources you asked us to approach", role: "Arranging your financing" },
        { name: "Third-party report providers", role: "Appraisal, environmental, title, and escrow work on your loan" },
        ...SERVICE_PROVIDERS.map((s) => ({ name: s.name, role: s.role })),
      ],
      sale: "We do not sell personal information or share it for cross-context behavioral advertising.",
    },
    records: {
      leads: leads.map((r) => pick("leads", r, withheld, opts.keyring)),
      documents: (documents as ExportRecord[]).map((r) => pick("documents", r, withheld, opts.keyring)),
      aiConversations: (conversations as ExportRecord[]).map((r) => pick("ai_conversations", r, withheld, opts.keyring)),
      partnerRegistrations: partners.map((r) => pick("partners", r, withheld, opts.keyring)),
      consentRecords: consent.map((r) => pick("consent_events", r, withheld, opts.keyring)),
      privacyRequests: requests.map((r) => pick("privacy_requests", r, withheld, opts.keyring)),
      privacyPreferences: prefs ? pick("privacy_preferences", prefs, withheld, opts.keyring) : null,
    },
    withheld,
    notes: [
      "Documents are listed by name; compliance will send copies of the files through a secure link on request.",
      "Information held by lenders you asked us to approach is covered by their own privacy policies.",
    ],
  };
}
