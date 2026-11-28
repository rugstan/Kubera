import type { SupabaseClient } from "@supabase/supabase-js";
import { demoDesks } from "@/lib/deals/demo";
import { fromRow, type Row } from "@/lib/deals/rows";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { handleShareRequest, type ShareDeps } from "@/lib/deals/share-page";
import type { DealSummaryRecord } from "@/lib/deals/submission/types";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp, hashIp } from "@/lib/security";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

// Lender share link (WS-T). The token is the only credential; it is hashed
// before lookup and every valid open is counted and audited. In fake-auth mode
// links resolve against the in-memory demo desk, which has no vault, so the
// package page lists its files without download links.
//
// The locked deal summary (deal_summaries, by the PDF's SHA-256) renders above
// the documents. The demo desk has no summary store yet, so demo links list
// documents only.

const SUMMARY_COLUMNS = "id, deal_id, as_of, playbook, target_stage, template_version, spec, spec_sha256, pdf_sha256, pdf_storage_path, profile_version, sponsor_version, created_by, created_at";

/** Reads one locked summary; service role only (RLS has no policies). */
function summaryReader(db: SupabaseClient): NonNullable<ShareDeps["summaries"]> {
  return {
    async getSummaryByPdfSha(dealId, pdfSha256) {
      const { data, error } = await db.from("deal_summaries").select(SUMMARY_COLUMNS).eq("deal_id", dealId).eq("pdf_sha256", pdfSha256).maybeSingle();
      if (error) throw new Error(`deal summary: ${error.message}`);
      return data ? fromRow<DealSummaryRecord>(data as Row, ["profileVersion", "sponsorVersion"]) : null;
    },
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const demo = demoDesks();
  const db = demo ? null : supabaseAdmin();
  if (!demo && !db) return new Response("Package sharing is not configured", { status: 503, headers: { "cache-control": "no-store" } });
  const { token } = await ctx.params;
  return handleShareRequest(token, hashIp(clientIp(req)), {
    store: demo ? demo.deals : new SupabaseDealDeskStore(db!),
    summaries: db ? summaryReader(db) : null,
    now: () => new Date(),
    allow: (key) => rateLimit(key, 30, 60_000),
    signUrl: async (path) => {
      if (!db) return null;
      const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 300, { download: true });
      return error ? null : data.signedUrl;
    },
  });
}
