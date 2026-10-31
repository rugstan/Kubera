import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

// Core program primer, always in the advisor's context. Handbook-level detail
// (HUD 4232.1, MAP Guide, SOP 50 10, CMBS/STR standards, Title 22) lives in the
// kb_chunks table and is retrieved per question; see scripts/ingest-kb.ts.
export const PROGRAM_PRIMER = `
# Kubera Commercial program primer (summary — defer to current handbooks)

## HUD Section 232 (healthcare: assisted living, board & care / RCFE, memory care, SNF)
- 232/223(f) refinance or acquisition of existing licensed facilities: up to 35-year fixed, fully amortizing, non-recourse, assumable. Typical max 80% LTV (for-profit), 1.45x minimum DSCR. Generally requires 3+ years since construction completion and stabilized operations.
- 232 new construction / substantial rehab: construction period plus up to 40-year term.
- Costs: upfront MIP (~1%), annual MIP (~0.65% for 223(f)), lender financing fee, HUD application fees, third-party reports, legal. Annual audited financial statements (CPA audit, ~$20k/yr) required. HUD LEAN processing typically 120–180 days.
- The 0.25% Green MIP reduction is a HUD multifamily (223(f), 221(d)(4)) incentive; do not promise it for Section 232 without current HUD guidance.
- Under ~$3.5M, HUD's fixed costs often make SBA 504 the cheaper all-in choice.

## Bridge-to-HUD (senior living)
- Floating-rate, interest-only bridge (SOFR + spread), typically up to ~75% LTV, 24–36 months, to acquire or stabilize census before a HUD 232/223(f) takeout.

## SBA 504 (owner-operated care facilities and hotels)
- Bank 1st lien (~50%), CDC/SBA debenture 2nd (25-year fixed), borrower equity. Special-purpose properties (hotels, care facilities) need +5% equity (15% total); start-ups / new construction +5% more.
- Standard CDC debenture cap $5M per project ($5.5M for qualifying energy-efficiency/manufacturing projects). Personal guaranties from 20%+ owners required (full recourse). Operating company must occupy ≥51%.
- Kubera models a 2026 combined 7(a) + 504 structure of up to $10M SBA exposure plus the bank 1st for larger hotel and care-facility projects; confirm against the SOP 50 10 revision in effect at application.
- Ongoing SBA guarantee, CDC servicing, and CSA fees (~1% annually on the debenture) are shown separately from P&I.

## Hospitality
- Hotel CMBS: 10-year fixed, ~30-year amortization, non-recourse with carve-outs, ~65% LTV, 11–12.5% minimum debt yield, 1.40x DSCR, defeasance/yield maintenance. Conduits typically start at $5M. PIP must be complete or reserved.
- PIP bridge: floating, interest-only, funds franchise PIP renovations with holdbacks; exit to CMBS or SBA after stabilization.
- Key metrics: ADR, occupancy, RevPAR (= ADR × occupancy), STR comp-set penetration (RGI), NOI per key, franchise term remaining and PIP scope.

## Multifamily & commercial
- HUD 223(f): 35-year fixed, non-recourse; ~85% LTV / 1.176x DSCR market-rate (higher leverage for affordable). HUD 221(d)(4): construction + 40-year fixed, ~85% LTC.
- HUD multifamily annual MIP ~0.60–0.65% market-rate, ~0.35% affordable, 0.25% Green (with qualifying green certification).
- Agency (Fannie Mae / Freddie Mac): 5–12 year fixed, ~30-year amortization, ~80% LTV, 1.25x DSCR, non-recourse.
- Private bridge, hard money & construction ($750k–$25M): Kubera arranges loans from private lenders and debt funds, which fund at closing as lender of record. Many close in 10–21 days after a complete file, subject to lender approval, appraisal, title and diligence; timing is never guaranteed.
- Usury: California limits interest on some loans, but exemptions exist, including for certain lenders and for real-property-secured loans made or arranged by a licensed real estate broker (Civ. Code § 1916.1). Whether one applies depends on the lender, the collateral, and how the loan and any later extension or modification are arranged. Never tell a borrower that a specific loan is exempt; refer them to their attorney.

## California regulatory
- Kubera Commercial, Inc. is a California DRE-licensed real estate corporation; arranging loans secured by real property for compensation requires a broker license (Bus. & Prof. Code § 10131(d)). Kubera is a broker, not a lender: it never funds loans, holds borrower or investor money, services loans, or handles construction draws.
- For loans it arranges that are secured by real property, Kubera provides a California Mortgage Loan Disclosure Statement (DRE form RE 882), including on commercial loans.
- Title 22 (Cal. Code Regs.) governs RCFE licensing through CDSS Community Care Licensing; licensing timelines matter for hotel-to-RCFE conversions and HUD 232 eligibility.
`.trim();

export type KbChunk = { source: string; section: string | null; content: string };

/** Full-text retrieval over kb_chunks. Returns [] when Supabase isn't configured. */
export async function retrieve(query: string, count = 5): Promise<KbChunk[]> {
  const db = supabaseAdmin();
  if (!db || !query.trim()) return [];
  const { data, error } = await db.rpc("match_kb_chunks", { query_text: query.slice(0, 500), match_count: count });
  if (error) {
    console.error("kb retrieve failed", error.message);
    return [];
  }
  return (data ?? []) as KbChunk[];
}
