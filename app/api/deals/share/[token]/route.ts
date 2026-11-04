import { demoDesks } from "@/lib/deals/demo";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { handleShareRequest } from "@/lib/deals/share-page";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp, hashIp } from "@/lib/security";
import { DOCUMENT_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

// Lender share link (WS-T). The token is the only credential; it is hashed
// before lookup and every valid open is counted and audited. In fake-auth mode
// links resolve against the in-memory demo desk, which has no vault, so the
// package page lists its files without download links.

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const demo = demoDesks();
  const db = demo ? null : supabaseAdmin();
  if (!demo && !db) return new Response("Package sharing is not configured", { status: 503, headers: { "cache-control": "no-store" } });
  const { token } = await ctx.params;
  return handleShareRequest(token, hashIp(clientIp(req)), {
    store: demo ? demo.deals : new SupabaseDealDeskStore(db!),
    now: () => new Date(),
    allow: (key) => rateLimit(key, 30, 60_000),
    signUrl: async (path) => {
      if (!db) return null;
      const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 300, { download: true });
      return error ? null : data.signedUrl;
    },
  });
}
