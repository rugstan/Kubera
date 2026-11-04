import "server-only";
import type { StaffContext } from "@/lib/auth/dal";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";
import { DEMO_DOCUMENTS } from "./demo";
import { SIGNED_URL_TTL_SECONDS, scanStatusOf, type StaffDocument } from "./model";

// Vault reads for the staff viewer. Metadata is read with the user's token
// (RLS: staff + MFA). Files are never proxied or made public: the server mints
// a 60-second signed URL with the service role after the access check and the
// audit write.

type DocumentRow = Record<string, unknown> & {
  id: string;
  created_at: string;
  kind: string;
  file_name: string;
  content_type: string;
  lead_id: string;
  storage_path: string;
};

function toDocument(r: DocumentRow, deal?: { id: string; name: string }): StaffDocument {
  return {
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    fileName: r.file_name,
    contentType: r.content_type,
    leadId: r.lead_id,
    storagePath: r.storage_path,
    dealId: deal?.id ?? null,
    dealName: deal?.name ?? null,
    scanStatus: scanStatusOf(r),
  };
}

export type DocumentFilter = { dealId?: string; kind?: string };

export async function listDocuments(ctx: StaffContext, filter: DocumentFilter = {}): Promise<StaffDocument[]> {
  if (ctx.services.mode === "fake") {
    return DEMO_DOCUMENTS.filter((d) => (!filter.dealId || d.dealId === filter.dealId) && (!filter.kind || d.kind === filter.kind)).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }
  const db = ctx.services.userClient(ctx.accessToken);
  if (!db) return [];

  let leadIds: string[] | undefined;
  const dealsById = new Map<string, { id: string; name: string; lead_id: string | null }>();
  if (filter.dealId) {
    const { data, error } = await db.from("deals").select("id, name, lead_id").eq("id", filter.dealId).maybeSingle<{ id: string; name: string; lead_id: string | null }>();
    if (error) throw new Error(`deal lookup failed: ${error.message}`);
    if (!data?.lead_id) return [];
    leadIds = [data.lead_id];
    dealsById.set(data.id, data);
  }

  let q = db.from("documents").select("*").order("created_at", { ascending: false }).limit(500);
  if (leadIds) q = q.in("lead_id", leadIds);
  if (filter.kind) q = q.eq("kind", filter.kind);
  const { data, error } = await q;
  if (error) throw new Error(`documents query failed: ${error.message}`);
  const rows = (data ?? []) as DocumentRow[];

  const byLead = new Map<string, { id: string; name: string }>();
  for (const d of dealsById.values()) if (d.lead_id) byLead.set(d.lead_id, d);
  const missing = [...new Set(rows.map((r) => r.lead_id))].filter((id) => !byLead.has(id));
  if (missing.length > 0) {
    const { data: deals } = await db.from("deals").select("id, name, lead_id").in("lead_id", missing);
    for (const d of (deals ?? []) as { id: string; name: string; lead_id: string }[]) byLead.set(d.lead_id, d);
  }
  return rows.map((r) => toDocument(r, byLead.get(r.lead_id)));
}

export async function getDocument(ctx: StaffContext, id: string): Promise<StaffDocument | null> {
  if (ctx.services.mode === "fake") return DEMO_DOCUMENTS.find((d) => d.id === id) ?? null;
  const db = ctx.services.userClient(ctx.accessToken);
  if (!db) return null;
  const { data, error } = await db.from("documents").select("*").eq("id", id).maybeSingle<DocumentRow>();
  if (error) throw new Error(`document lookup failed: ${error.message}`);
  if (!data) return null;
  const { data: deal } = await db.from("deals").select("id, name").eq("lead_id", data.lead_id).limit(1).maybeSingle<{ id: string; name: string }>();
  return toDocument(data, deal ?? undefined);
}

export type OpenResult = { kind: "redirect"; url: string } | { kind: "inline"; body: string; contentType: string } | { kind: "unavailable" };

/** A short-lived link to the file itself (or, in fake mode, a placeholder body). */
export async function openDocument(ctx: StaffContext, doc: StaffDocument, opts: { download: boolean }): Promise<OpenResult> {
  if (ctx.services.mode === "fake") {
    return {
      kind: "inline",
      contentType: "text/plain; charset=utf-8",
      body: `Demo document placeholder\n\n${doc.fileName}\n${doc.kind}\n\nIn production this opens the stored file through a ${SIGNED_URL_TTL_SECONDS}-second signed link.\n`,
    };
  }
  const admin = supabaseAdmin();
  if (!admin) return { kind: "unavailable" };
  const { data, error } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storagePath, SIGNED_URL_TTL_SECONDS, opts.download ? { download: doc.fileName } : undefined);
  if (error || !data?.signedUrl) {
    console.error("[documents] signed URL failed:", error?.message);
    return { kind: "unavailable" };
  }
  return { kind: "redirect", url: data.signedUrl };
}
