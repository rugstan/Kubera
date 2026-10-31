import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/rates";

export async function GET() {
  const snapshot = await getMarketSnapshot();
  return NextResponse.json(snapshot, { headers: { "cache-control": "public, s-maxage=900, stale-while-revalidate=3600" } });
}
