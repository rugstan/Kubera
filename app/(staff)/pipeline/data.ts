import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffContext } from "@/lib/auth/dal";
import { getApprovalService } from "@/lib/approvals/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DEMO_PIPELINE } from "./demo";
import type { MldsStatus, PipelineRow } from "./model";

// Pipeline loader. Deals are read with the signed-in user's token so RLS
// (staff + MFA) applies; the MLDS state comes from the service-role-only
// deal_disclosure_status view for just those deal ids.

type DealRow = {
  id: string;
  name: string;
  program: string | null;
  asset_type: string | null;
  stage: string;
  status: string;
  loan_amount_usd: number | string | null;
  property_city: string | null;
  property_state: string | null;
  owner_id: string | null;
  updated_at: string;
};

export function toPipelineRow(d: DealRow, ownerName: string | null, mlds: MldsStatus, pendingApprovals: number): PipelineRow {
  const amount = d.loan_amount_usd === null ? null : Number(d.loan_amount_usd);
  return {
    id: d.id,
    name: d.name,
    program: d.program,
    assetType: d.asset_type,
    stage: d.stage,
    status: d.status,
    loanAmountUsd: amount !== null && Number.isFinite(amount) ? amount : null,
    location: [d.property_city, d.property_state].filter(Boolean).join(", ") || null,
    ownerName,
    mldsStatus: mlds,
    pendingApprovals,
    updatedAt: d.updated_at,
  };
}

const MLDS = new Set(["required", "generated", "sent", "signed", "held_for_counsel"]);

async function pendingByDeal(): Promise<Map<string, number>> {
  const service = await getApprovalService();
  const counts = new Map<string, number>();
  if (!service) return counts;
  for (const a of await service.list({ status: "pending", limit: 500 })) {
    if (a.dealId) counts.set(a.dealId, (counts.get(a.dealId) ?? 0) + 1);
  }
  return counts;
}

async function mldsByDeal(admin: SupabaseClient | null, ids: string[]): Promise<Map<string, MldsStatus>> {
  const out = new Map<string, MldsStatus>();
  if (!admin || ids.length === 0) return out;
  const { data, error } = await admin.from("deal_disclosure_status").select("deal_id, mlds_status").in("deal_id", ids);
  if (error) {
    console.error("[pipeline] MLDS status lookup failed:", error.message);
    return out;
  }
  for (const r of (data ?? []) as { deal_id: string | null; mlds_status: string | null }[]) {
    if (r.deal_id && r.mlds_status && MLDS.has(r.mlds_status)) out.set(r.deal_id, r.mlds_status as MldsStatus);
  }
  return out;
}

export async function loadPipeline(ctx: StaffContext): Promise<PipelineRow[]> {
  const pending = await pendingByDeal();
  if (ctx.services.mode === "fake") return DEMO_PIPELINE.map((d) => ({ ...d, pendingApprovals: pending.get(d.id) ?? 0 }));

  const db = ctx.services.userClient(ctx.accessToken);
  if (!db) return [];
  const { data, error } = await db
    .from("deals")
    .select("id, name, program, asset_type, stage, status, loan_amount_usd, property_city, property_state, owner_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`pipeline query failed: ${error.message}`);
  const deals = (data ?? []) as DealRow[];
  const [owners, mlds] = await Promise.all([
    ctx.services.directory.profiles(deals.map((d) => d.owner_id).filter((x): x is string => Boolean(x))),
    mldsByDeal(supabaseAdmin(), deals.map((d) => d.id)),
  ]);
  return deals.map((d) => {
    const owner = d.owner_id ? owners.get(d.owner_id) : undefined;
    return toPipelineRow(d, owner ? owner.fullName || owner.email : null, mlds.get(d.id) ?? null, pending.get(d.id) ?? 0);
  });
}
