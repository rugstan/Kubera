import { describe, expect, it } from "vitest";
import { decideWithRules } from "@/lib/ai/jev";
import { lendersFor } from "@/lib/ai/jev";
import { intakeFromQuick, intakeSchema } from "@/lib/validation";
import { qualifierReasonCodes, recordHumanReviewQualifier, recordLenderMatchDecision, recordQualifierDecision, staticRoutingCandidates } from "./decisions";
import { MemoryAgentEventStore, verifyChain } from "./events";
import { isReasonCode } from "./reasons";

const LEAD = "5e5e5e5e-0000-4000-8000-000000000003";
const DEAL = "1a2b3c4d-0000-4000-8000-000000000001";

const intake = (o: Record<string, unknown> = {}) =>
  intakeSchema.parse({ assetType: "ASSISTED_LIVING", transaction: "REFINANCE", loanAmount: 14_000_000, noi: 1_900_000, value: 24_000_000, unitCount: 96, occupancyPct: 92, timelineDays: 90, ...o });

describe("qualifier reason codes", () => {
  it("explains a stabilized assisted-living refinance", () => {
    const i = intake();
    const r = { ...decideWithRules(i), engine: "rules" as const, latencyMs: 1 };
    const codes = qualifierReasonCodes(r, i);
    expect(codes.every(isReasonCode)).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(["qualifier.engine.rules", `qualifier.tier.${r.decision.leadUrgencyTier.toLowerCase()}`, `qualifier.program.${r.decision.primaryProgramFit.toLowerCase()}`]));
    expect(codes.some((c) => c.startsWith("qualifier.coverage."))).toBe(true);
  });

  it("explains an unqualified lead with no in-place income", () => {
    const i = intake({ noi: 0, loanAmount: 5_000_000 });
    const r = { ...decideWithRules(i), engine: "rules" as const, latencyMs: 1 };
    expect(r.decision.leadUrgencyTier).toBe("UNQUALIFIED");
    expect(qualifierReasonCodes(r, i)).toEqual(expect.arrayContaining(["qualifier.tier.unqualified", "qualifier.no_in_place_income"]));
  });

  it("marks a financing-page lead for broker review without coverage or income codes", () => {
    const i = intakeFromQuick(
      { assetType: "RETAIL", transaction: "PURCHASE", loanAmount: 5_000_000, timelineDays: 90, notes: "", slug: "retail-loans" },
      { slug: "retail-loans", path: "/financing/retail-loans", name: "Retail property loans" },
    );
    const r = { ...decideWithRules(i), engine: "rules" as const, latencyMs: 1 };
    const codes = qualifierReasonCodes(r, i);
    expect(codes.every(isReasonCode)).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(["qualifier.broker_review.partial_intake", "qualifier.flag.needs_broker_review", "qualifier.tier.tier_3_nurture"]));
    expect(codes.some((c) => c.startsWith("qualifier.coverage.") || c === "qualifier.no_in_place_income" || c === "qualifier.no_program_fit")).toBe(false);
  });

  it("explains an immediate call for a short timeline", () => {
    const i = intake({ timelineDays: 21 });
    const r = { ...decideWithRules(i), engine: "rules" as const, latencyMs: 1 };
    if (r.decision.requiresImmediateBrokerCall) expect(qualifierReasonCodes(r, i)).toContain("qualifier.call_now.timeline_30d_or_less");
  });

  it("records the decision with ids and numbers only", async () => {
    const store = new MemoryAgentEventStore();
    const i = intake();
    const r = { ...decideWithRules(i), engine: "rules" as const, latencyMs: 3 };
    const e = await recordQualifierDecision(store, { leadId: LEAD, result: r, intake: { ...i, source: "express" } });
    expect(e).toMatchObject({ eventType: "decision.qualifier", agent: "qualifier", leadId: LEAD, outcome: "recorded", chain: "decisions:qualifier" });
    expect(e.detail).toMatchObject({ engine: "rules", tier: r.decision.leadUrgencyTier, requestedLoan: 14_000_000, source: "express" });
    expect(JSON.stringify(e.detail)).not.toMatch(/@|phone|email/i);
    await recordHumanReviewQualifier(store, { leadId: LEAD, reason: "ai_processing_opt_out" });
    expect(verifyChain(store.all())).toEqual({ ok: true, length: 2 });
    expect(store.all()[1]!.reasonCodes).toEqual(["qualifier.engine.human_review", "qualifier.human_review.ai_processing_opt_out"]);
  });
});

describe("lender-match reason codes", () => {
  it("records a ranking with per-candidate reasons", async () => {
    const store = new MemoryAgentEventStore();
    const e = await recordLenderMatchDecision(store, {
      dealId: DEAL,
      programId: "HUD_232_223F",
      candidates: [
        { lenderId: "box-2", rank: 2, score: 0.61, eligible: true, reasons: ["lender_match.program_fit", "lender_match.box_stale"], source: "credit_box" },
        { lenderId: "box-1", rank: 1, score: 0.92, eligible: true, reasons: ["lender_match.program_fit", "lender_match.ltv_within_box", "lender_match.dscr_meets_min"], source: "credit_box" },
        { lenderId: "box-3", rank: 3, score: 0.1, eligible: false, reasons: ["lender_match.loan_above_max"], source: "credit_box" },
      ],
    });
    expect(e.reasonCodes).toEqual(expect.arrayContaining(["lender_match.program.hud_232_223f", "lender_match.box_stale", "lender_match.loan_above_max"]));
    expect((e.detail.candidates as { lenderId: string }[]).map((c) => c.lenderId)).toEqual(["box-1", "box-2", "box-3"]);
  });

  it("rejects unknown reason codes and flags the static fallback", async () => {
    const store = new MemoryAgentEventStore();
    await expect(recordLenderMatchDecision(store, { programId: "X", candidates: [{ lenderId: "a", rank: 1, score: 1, eligible: true, reasons: ["because.i.said"], source: "credit_box" }] })).rejects.toThrow(/unknown lender-match reason/);
    const e = await recordLenderMatchDecision(store, { programId: "HUD_232_223F", candidates: staticRoutingCandidates(lendersFor("HUD_232_223F")) });
    expect(e.reasonCodes).toContain("lender_match.static_routing_fallback");
    const none = await recordLenderMatchDecision(store, { programId: "HUD_232_223F", candidates: [] });
    expect(none.reasonCodes).toContain("lender_match.no_eligible_lender");
  });
});
