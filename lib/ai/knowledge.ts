import "server-only";
import { embedQuery, toPgVector } from "@/lib/ai/embeddings";
import { ASSUMPTIONS_REVIEWED, HUD } from "@/lib/sizing/assumptions";
import { AGENCY_GRID } from "@/lib/sizing/programs/assumptions";
import { supabaseAdmin } from "@/lib/supabase/server";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const x = (n: number) => `${n.toFixed(2)}x`;
const s232 = HUD.section232;
const mf = HUD.multifamily;
const agencyTerms = (terms: readonly number[]) => `${Math.min(...terms)}–${Math.max(...terms)}`;
const fannieT = AGENCY_GRID.fannie;
const freddieT = AGENCY_GRID.freddie;
const usdM = (n: number) => `$${n / 1_000_000}M`;

/** As-of date the HUD figures in the primer were last checked against sources. */
export const HUD_FACTS_AS_OF = ASSUMPTIONS_REVIEWED;

// Core program primer, always in the advisor's context. Handbook-level detail
// (HUD 4232.1, MAP Guide, SOP 50 10, CMBS/STR standards, Title 22) lives in the
// kb_chunks table and is retrieved per question; see scripts/ingest-kb.ts.
export const PROGRAM_PRIMER = `
# Kubera Commercial program primer (summary — defer to current handbooks)

## HUD Section 232 (healthcare: assisted living, board & care / RCFE, memory care, SNF)
- 232/223(f) refinance or acquisition of existing licensed facilities: up to ${s232.refi.termYears}-year fixed, fully amortizing, non-recourse, assumable. Typical max ${pct(s232.refi.maxLtv)} LTV (for-profit), ${x(s232.refi.minDscr)} minimum DSCR. Generally requires ${s232.minYearsSinceCompletion}+ years since construction completion and stabilized operations.
- 232 new construction / substantial rehab: construction period plus up to ${s232.newConstruction.termYears}-year term, ~${pct(s232.newConstruction.maxLtc)} LTC (for-profit), ${x(s232.newConstruction.minDscr)} DSCR.
- Costs: upfront MIP (~${pct(s232.refi.upfrontMip)}), annual MIP (~${pct(s232.refi.annualMip, 2)} for 223(f), ~${pct(s232.newConstruction.annualMip, 2)} new construction), lender financing fee, HUD application fees, third-party reports, legal. Annual audited financial statements (CPA audit, ~$20k/yr) required. HUD LEAN processing typically 120–180 days.
- Section 232 leverage and coverage were not changed by HUD Mortgagee Letter 2025-03 (as of ${HUD_FACTS_AS_OF}). Whether the Sept 2025 flat 0.25% MIP notice reaches Section 232 is unconfirmed; quote the 232 MIP above and say it is being verified.
- Green certification does not lower HUD MIP on any program (multifamily or Section 232).
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
- HUD 223(f) (as of ${HUD_FACTS_AS_OF}; HUD Mortgagee Letter 2025-03, Jan 2025): ${mf.s223f.termYears}-year fixed, non-recourse; market-rate max ${pct(mf.s223f.maxLtv)} LTV at ${x(mf.s223f.minDscr)} minimum DSCR; affordable or rental-assistance properties ${pct(mf.s223f.maxLtvAffordable)} LTV at ${x(mf.s223f.minDscrAffordable)}. Cash-out refinances remain capped at ${pct(mf.s223f.cashOutMaxLtv)} LTV.
- HUD 221(d)(4) (as of ${HUD_FACTS_AS_OF}; ML 2025-03): construction + ${mf.s221d4.termYears}-year fixed; market-rate max ${pct(mf.s221d4.maxLtc)} LTC at ${x(mf.s221d4.minDscr)}; affordable or rental-assistance ${pct(mf.s221d4.maxLtcAffordable)} LTC at ${x(mf.s221d4.minDscrAffordable)}. A middle-income 221(d)(4) tier has been reported by a single source; do not quote it until a HUD lender confirms it.
- HUD multifamily MIP (as of ${HUD_FACTS_AS_OF}; Federal Register, Sept 23, 2025): a flat ${pct(mf.mip.annual, 2)} annual MIP for all FHA multifamily programs on applications submitted or amended on or after Oct 1, 2025; the separate green, affordable and market-rate MIP tiers no longer apply. Upfront premium modeled at ${pct(mf.mip.upfront, 2)} (being verified with HUD lenders).
- Agency (Fannie Mae / Freddie Mac): ~${AGENCY_GRID.amortYears}-year amortization, ~${pct(AGENCY_GRID.tiers.TIER_2.maxLtv)} LTV, ${x(AGENCY_GRID.tiers.TIER_2.minDscr)} DSCR, non-recourse. Fannie Mae Small Loan (up to ${usdM(fannieT.smallLoanMax)}): fixed terms of ${agencyTerms(fannieT.terms)} years (${fannieT.terms.join("/")}). Freddie Mac Conventional Small (${usdM(freddieT.smallMin)}–${usdM(freddieT.smallMax)}): ${freddieT.terms.join("/")}-year fixed terms. Modeled assumptions, as of ${HUD_FACTS_AS_OF}; confirm with the lender.
- Private bridge, hard money & construction ($750k–$25M): Kubera arranges loans from private lenders and debt funds, which fund at closing as lender of record. Many close in 10–21 days after a complete file, subject to lender approval, appraisal, title and diligence; timing is never guaranteed.
- Usury: California limits interest on some loans, but exemptions exist, including for certain lenders and for real-property-secured loans made or arranged by a licensed real estate broker (Civ. Code § 1916.1). Whether one applies depends on the lender, the collateral, and how the loan and any later extension or modification are arranged. Never tell a borrower that a specific loan is exempt; refer them to their attorney.

## California regulatory
- Kubera Commercial, Inc. is a California DRE-licensed real estate corporation; arranging loans secured by real property for compensation requires a broker license (Bus. & Prof. Code § 10131(d)). Kubera is a broker, not a lender: it never funds loans, holds borrower or investor money, services loans, or handles construction draws.
- For loans it arranges that are secured by real property, Kubera provides a California Mortgage Loan Disclosure Statement (DRE form RE 882), including on commercial loans.
- Title 22 (Cal. Code Regs.) governs RCFE licensing through CDSS Community Care Licensing; licensing timelines matter for hotel-to-RCFE conversions and HUD 232 eligibility.
`.trim();

export type KbChunk = { source: string; section: string | null; content: string };

/**
 * Hybrid retrieval over kb_chunks: full-text ranking fused with vector
 * similarity when an embedding provider is configured (lib/ai/embeddings.ts;
 * the query is checked by the routing guard first), full-text alone otherwise.
 * Returns [] when Supabase isn't configured.
 */
export async function retrieve(query: string, count = 5, subject?: { aiProcessingOptOut?: boolean }): Promise<KbChunk[]> {
  const db = supabaseAdmin();
  if (!db || !query.trim()) return [];
  const embedding = await embedQuery(query, subject ? { subject } : {});
  const { data, error } = await db.rpc("match_kb_chunks", {
    query_text: query.slice(0, 500),
    match_count: count,
    ...(embedding ? { query_embedding: toPgVector(embedding) } : {}),
  });
  if (error) {
    console.error("kb retrieve failed", error.message);
    return [];
  }
  return (data ?? []) as KbChunk[];
}
