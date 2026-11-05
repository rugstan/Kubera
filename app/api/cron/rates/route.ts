import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/rates";
import { safeEqual } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase/server";

// Vercel Cron hits this every 15 minutes (vercel.json) with
// `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // "max" marks the rates entry stale rather than expiring it: the next visit to
  // a page with the rate ticker is answered from the cached static page while
  // it regenerates in the background. `{ expire: 0 }` made that visit wait for
  // a render, and on the [slug] routes it was answered from the generic
  // fallback shell plus a per-request resume (`Cache-Control: private,
  // no-store`, about 60% more HTML) on most crawler visits. The snapshot below
  // can therefore be one cycle old; the next run records the fresh one.
  revalidateTag("rates", "max");
  const snapshot = await getMarketSnapshot();
  const db = supabaseAdmin();
  if (db) {
    const { error } = await db.from("rate_snapshots").insert({ as_of: snapshot.asOf, live: snapshot.live, benchmarks: snapshot.benchmarks });
    if (error) console.error("rate snapshot insert failed", error.message);
  }
  return NextResponse.json({ ok: true, asOf: snapshot.asOf, live: snapshot.live });
}
