// Nothing reaches a lender without broker approval: submissions from a match
// go through the lender-ready submission (lib/deals/submission/send.ts: the
// readiness gate, the locked deal summary, each lender's exact email), then
// lender_outreach and the approval gate; pending, rejected and expired
// approvals send nothing.
import { describe, expect, it } from "vitest";
import { MemoryDocumentStorage } from "@/lib/disclosures/store";
import type { LenderMailer } from "@/lib/deals/packages";
import { computeSubmissionMetrics } from "@/lib/deals/submission/metrics";
import { submissionFixture } from "@/lib/deals/submission/test-fixtures";
import type { DealSummaryRecord, EmailAdvisor } from "@/lib/deals/submission/types";
import { docs, lenderInput, newDeal, noHolds, setup } from "@/lib/deals/test-fixtures";
import { MemoryAgentEventStore } from "@/lib/agents/core/events";
import { logLenderMatch, matchDecisionCandidates } from "./decision-log";
import { matchLenders } from "./matcher";
import { submitToLenders, type OutreachDeps, type SubmitInput } from "./outreach";
import { renderDealSummaryPdf } from "./package-pdf";
import { dealProfile } from "./service";
import { MemoryLenderMatchStore } from "./store";
import type { NewCreditBox } from "./types";

class RecordingMailer implements LenderMailer {
  readonly sent: { to: string; subject: string; text: string; idempotencyKey: string }[] = [];
  async send(msg: { to: string; subject: string; text: string; idempotencyKey: string }) {
    this.sent.push(msg);
    return { messageId: `msg-${this.sent.length}` };
  }
}

const approvedBox = (lenderId: string, over: Partial<NewCreditBox> = {}): NewCreditBox => ({
  label: "HUD 232",
  programs: ["HUD_232"],
  assetClasses: ["SENIOR_LIVING"],
  states: [],
  minLoanCents: 100_000_000,
  maxLoanCents: 5_000_000_000,
  maxLtvPct: 80,
  maxLtcPct: null,
  minDscr: 1.2,
  minDebtYieldPct: null,
  lienPositions: ["first"],
  recourse: "non_recourse",
  maxTermMonths: null,
  maxAmortizationMonths: null,
  maxIoMonths: null,
  rateMinPct: null,
  rateMaxPct: null,
  originationFeePct: null,
  brokerCompensationPct: null,
  typicalCloseDays: null,
  franchiseRequirements: null,
  notes: null,
  lenderId,
  partnerId: null,
  source: "staff",
  status: "approved",
  verifiedAt: "2026-10-20T00:00:00.000Z",
  verifiedBy: "broker:ana",
  reviewedAt: "2026-10-20T00:00:00.000Z",
  reviewedBy: "broker:ana",
  reviewNote: null,
  ...over,
});

const advisor: EmailAdvisor = { name: "Ana Ruiz", title: "Senior Advisor", dreLicense: "01234567", email: "ana@corincommercial.com", phone: "415-555-0100" };

/**
 * A HUD 232 deal on the desk whose submission context is the shared fixture
 * (complete at Screen and Term sheet), three lenders with approved boxes (the
 * third lends only in Texas), and a fourth whose box wants a higher DSCR than
 * the deal's computed one.
 */
async function world(gateDefault: "approved" | "pending" | "rejected" | "expired") {
  const { store, gate, now } = setup(gateDefault);
  const boxes = new MemoryLenderMatchStore();
  const mailer = new RecordingMailer();
  const storage = new MemoryDocumentStorage();
  const a = await store.insertLender(lenderInput(), "broker:ana", now());
  const b = await store.insertLender(lenderInput({ name: "Greystone", submissionEmail: "kim@greystone.example" }), "broker:ana", now());
  const c = await store.insertLender(lenderInput({ name: "Out Of Box Capital", submissionEmail: "x@oob.example" }), "broker:ana", now());
  const d = await store.insertLender(lenderInput({ name: "Strict Senior Lender", submissionEmail: "y@strict.example" }), "broker:ana", now());
  await boxes.insertBox(approvedBox(a.id), "broker:ana", now());
  await boxes.insertBox(approvedBox(b.id), "broker:ana", now());
  await boxes.insertBox(approvedBox(c.id, { states: ["TX"] }), "broker:ana", now());
  await boxes.insertBox(approvedBox(d.id, { minDscr: 1.45 }), "broker:ana", now());
  const created = await newDeal(store, now);
  const ctx = submissionFixture("hud_232");
  // The desk deal takes the fixture's address and loan so the profile's facts line up.
  const deal = await store.updateDeal(created.id, created.recordVersion, { propertyAddress: ctx.deal.propertyAddress, loanAmountCents: ctx.deal.loanAmountCents }, "broker:ana", now());
  ctx.deal = deal;
  ctx.profile!.dealId = deal.id;
  const rows = new Map<string, DealSummaryRecord>();
  const summaries = {
    async insertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">, at: Date) {
      const found = [...rows.values()].find((r) => r.dealId === s.dealId && r.pdfSha256 === s.pdfSha256);
      if (found) return found;
      const row = { ...s, id: `summary-${rows.size + 1}`, createdAt: at.toISOString() };
      rows.set(row.id, row);
      return row;
    },
    getSummary: async (id: string) => rows.get(id) ?? null,
  };
  const deps: OutreachDeps = {
    desk: store,
    boxes,
    gate,
    mailer,
    storage,
    submission: { summaries, renderPdf: renderDealSummaryPdf, loadContext: async (id) => (id === deal.id ? ctx : null), computeMetrics: computeSubmissionMetrics },
    baseUrl: "https://corincommercial.com",
    now,
    holds: noHolds,
  };
  // What the matcher ranks on (staff may type it on the matching desk); the fit reads the computed metrics.
  const profile = dealProfile(deal, { ltvPct: 70, dscr: 1.6 });
  const input = (over: Partial<SubmitInput> = {}): SubmitInput => ({ dealId: deal.id, profile, lenderIds: [a.id], items: docs(1), actor: "broker:ana", advisor, ...over });
  return { store, gate, mailer, storage, deps, deal, ctx, profile, rows, input, lenders: { a, b, c, d } };
}

describe("submitToLenders", () => {
  it("submits nothing for a deal under a sanctions hold (no summary stored, no approval asked)", async () => {
    const w = await world("approved");
    const holds = { active: async () => [{ detail: "Possible sanctions match for Pat Owner" }] };
    await expect(submitToLenders({ ...w.deps, holds }, w.input())).rejects.toThrow(/Possible sanctions match/);
    await expect(submitToLenders({ ...w.deps, holds: null }, w.input())).rejects.toThrow(/cannot be checked/);
    expect(w.gate.requests).toHaveLength(0);
    expect(w.mailer.sent).toEqual([]);
    expect(w.rows.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
  });

  it("sends nothing while the broker approval is pending", async () => {
    const w = await world("pending");
    const r = await submitToLenders(w.deps, w.input({ items: docs(2) }));
    expect(r.outcomes).toHaveLength(1);
    const o = r.outcomes[0]!;
    expect(o.ok && o.result.outreach.status).toBe("pending_approval");
    expect(w.mailer.sent).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
    expect(w.gate.requests).toHaveLength(1);
    expect(w.gate.requests[0]).toMatchObject({ kind: "lender_submission", templateId: "lender_package_submission_v2" });
    expect(w.gate.requests[0]!.summary).toMatch(/match \d+(\.\d)?\/100/);
  });

  it.each(["rejected", "expired"] as const)("sends nothing when the approval is %s", async (status) => {
    const w = await world(status);
    const r = await submitToLenders(w.deps, w.input());
    const o = r.outcomes[0]!;
    expect(o.ok && o.result.outreach.status).toBe(status);
    expect(w.mailer.sent).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
  });

  it("after approval sends each lender its approved email once, with one locked package that includes the deal summary", async () => {
    const w = await world("approved");
    const r = await submitToLenders(w.deps, w.input({ lenderIds: [w.lenders.a.id, w.lenders.b.id, w.lenders.a.id], items: docs(2), targetStage: "term_sheet" }));
    expect(r.outcomes.map((o) => o.ok && o.result.outreach.status)).toEqual(["sent", "sent"]);
    expect(w.mailer.sent.map((m) => m.to)).toEqual(["dana@lender.example", "kim@greystone.example"]);
    expect(w.mailer.sent[0]!.text).toMatch(/is the broker on this request, not the lender/);
    expect(w.mailer.sent[0]!.subject).toMatch(/^Loan request: \$11,250,000 HUD 232 \| 88-bed assisted living, Santa Rosa CA/);
    expect(w.mailer.sent[0]!.text).toMatch(/\nhttps:\/\/corincommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}\n/);
    for (const p of w.ctx.principals.filter((x) => x.kind === "individual")) expect(w.mailer.sent[0]!.text).not.toContain(p.legalName);
    const pkgs = await w.store.listPackages(w.deal.id);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.manifest.map((i) => i.kind)).toContain("DEAL_SUMMARY");
    expect(pkgs[0]!.manifest.map((i) => i.kind)).not.toContain("EXECUTIVE_SUMMARY");
    expect(r.summaryItem).toMatchObject({ kind: "DEAL_SUMMARY", label: "Deal summary (Corin)" });
    expect(r.summaryItem?.storagePath).toMatch(new RegExp(`^packages/${w.deal.id}/deal-summary-[0-9a-f]{16}\\.pdf$`));
    expect([...w.storage.objects.keys()]).toEqual([r.summaryItem!.storagePath]);
    expect(w.rows.size).toBe(1);
    expect(w.gate.requests.every((q) => q.templateId === "lender_package_submission_v2")).toBe(true);

    // Re-submitting is idempotent: the same summary bytes, the same approval key, nothing sent twice.
    await submitToLenders(w.deps, w.input({ items: docs(2), targetStage: "term_sheet" }));
    expect(w.mailer.sent).toHaveLength(2);
    expect(await w.store.listPackages(w.deal.id)).toHaveLength(1);
    expect(w.rows.size).toBe(1);
  });

  it("refuses a lender the matcher excluded unless a broker writes an override reason", async () => {
    const w = await world("pending");
    const refused = await submitToLenders(w.deps, w.input({ lenderIds: [w.lenders.c.id] }));
    expect(refused.outcomes[0]).toMatchObject({ ok: false });
    expect(!refused.outcomes[0]!.ok && refused.outcomes[0]!.error).toMatch(/Does not lend in CA/);
    expect(w.gate.requests).toEqual([]);
    // Nobody was admitted, so nothing was stored or locked.
    expect(w.rows.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);

    const overridden = await submitToLenders(w.deps, w.input({ lenderIds: [w.lenders.c.id], overrideReason: "Lender confirmed a CA exception by phone" }));
    expect(overridden.outcomes[0]).toMatchObject({ ok: true, matched: false });
    expect(w.gate.requests[0]!.summary).toMatch(/override: Lender confirmed a CA exception/);
    expect(w.mailer.sent).toEqual([]);
  });

  it("refuses a ranked lender whose recorded box the computed figures fall outside, unless a reason is given", async () => {
    const w = await world("approved");
    // The typed profile (DSCR 1.6x) ranks the strict lender; the computed DSCR sits below its 1.45x minimum.
    const refused = await submitToLenders(w.deps, w.input({ lenderIds: [w.lenders.d.id] }));
    expect(!refused.outcomes[0]!.ok && refused.outcomes[0]!.error).toMatch(/^Outside Strict Senior Lender's recorded box: DSCR \d\.\d\dx vs 1\.45x minimum\. Add an override reason to submit anyway\.$/);
    expect(w.gate.requests).toEqual([]);
    const r = await submitToLenders(w.deps, w.input({ lenderIds: [w.lenders.d.id], overrideReason: "The lender sizes HUD 232 on its own DSCR" }));
    expect(r.outcomes[0]).toMatchObject({ ok: true, matched: true });
    expect(w.gate.requests[0]!.summary).toContain("fit override: The lender sizes HUD 232 on its own DSCR");
    expect(w.gate.requests[0]!.summary).toMatch(/Lender fit exceptions: DSCR \d\.\d\dx vs 1\.45x minimum/);
  });

  it("keeps the readiness gate: a missing required item needs its own reason, which the broker sees", async () => {
    const w = await world("pending");
    w.ctx.profile!.purpose = null;
    await expect(submitToLenders(w.deps, w.input())).rejects.toThrow(/required item is missing for a soft-quote request: Loan purpose/);
    expect(w.gate.requests).toEqual([]);
    expect(w.rows.size).toBe(0);
    const sent = await submitToLenders(w.deps, w.input({ readinessOverrideReason: "Purpose is confirmed by phone; the profile is being updated" }));
    expect(sent.outcomes[0]).toMatchObject({ ok: true });
    expect(w.gate.requests[0]!.payload).toMatchObject({ readinessMissing: ["request.purpose"], overrideReason: "Purpose is confirmed by phone; the profile is being updated" });
  });

  it("rejects summary copy that overclaims, before anything is stored or requested", async () => {
    const w = await world("approved");
    w.ctx.profile!.highlights = ["Borrower is pre-approved and will close in 30 days."];
    await expect(submitToLenders(w.deps, w.input())).rejects.toThrow(/approves a loan/);
    expect(w.storage.objects.size).toBe(0);
    expect(w.rows.size).toBe(0);
    expect(w.gate.requests).toEqual([]);
  });

  it("validates the request", async () => {
    const w = await world("approved");
    await expect(submitToLenders(w.deps, w.input({ lenderIds: [] }))).rejects.toThrow(/at least one lender/);
    await expect(submitToLenders(w.deps, w.input({ dealId: "missing" }))).rejects.toThrow(/not found/);
    await expect(submitToLenders(w.deps, w.input({ advisor: { ...advisor, name: " " } }))).rejects.toThrow(/advisor/);
    // No vault documents is fine: the deal summary is always in the package.
    const r = await submitToLenders(w.deps, w.input({ items: [] }));
    expect(r.outcomes[0]).toMatchObject({ ok: true });
    expect((await w.store.listPackages(w.deal.id))[0]!.manifest.map((i) => i.kind)).toEqual(["DEAL_SUMMARY"]);
  });
});

describe("lender-match decision log (reason codes)", () => {
  it("appends a decision.lender_match event for a submission, with ranked, knocked-out and override candidates", async () => {
    const w = await world("pending");
    const events = new MemoryAgentEventStore();
    const deps = { ...w.deps, events };
    await submitToLenders(deps, w.input({ lenderIds: [w.lenders.a.id, w.lenders.c.id], overrideReason: "Lender confirmed a CA exception by phone" }));
    const [e] = await events.list({ eventType: "decision.lender_match" });
    expect(e).toBeDefined();
    expect(e!).toMatchObject({ agent: "lenders.matching", dealId: w.deal.id, outcome: "recorded" });
    expect(e!.reasonCodes).toEqual(expect.arrayContaining(["lender_match.program.hud_232", "lender_match.program_fit", "lender_match.state_not_covered", "lender_match.manual_override", "lender_match.box_verified"]));
    const detail = e!.detail as { context: string; submittedLenderIds: string[]; override: { lenderIds: string[]; reason: string }; candidates: { lenderId: string; eligible: boolean; reasons: string[] }[] };
    expect(detail.context).toBe("submission");
    expect(detail.submittedLenderIds.sort()).toEqual([w.lenders.a.id, w.lenders.c.id].sort());
    expect(detail.override).toEqual({ lenderIds: [w.lenders.c.id], reason: "Lender confirmed a CA exception by phone" });
    const c = detail.candidates.find((x) => x.lenderId === w.lenders.c.id)!;
    expect(c).toMatchObject({ eligible: false });
    expect(c.reasons).toContain("lender_match.state_not_covered");
    expect(detail.candidates.filter((x) => x.eligible).map((x) => x.lenderId).sort()).toEqual([w.lenders.a.id, w.lenders.b.id, w.lenders.d.id].sort());
  });

  it("logs the static LENDER_ROUTING fallback, and skips an unchanged ranking on re-view", async () => {
    const w = await world("pending");
    const events = new MemoryAgentEventStore();
    const now = new Date("2026-11-04T17:00:00.000Z");
    // No approved box covers SBA 504: the matcher falls back to static routing.
    const match = matchLenders({ profile: { ...w.profile, program: "SBA_504" }, boxes: [], lenders: await w.store.listLenders(), now });
    expect(match.usedFallback).toBe(true);
    const candidates = matchDecisionCandidates(match, now);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === "static_routing" && c.reasons.includes("lender_match.static_routing_fallback"))).toBe(true);

    expect(await logLenderMatch(events, { dealId: w.deal.id, match, now, context: "view" })).toBe("recorded");
    expect(await logLenderMatch(events, { dealId: w.deal.id, match, now, context: "view" })).toBe("unchanged");
    const rows = await events.list({ eventType: "decision.lender_match" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reasonCodes).toContain("lender_match.static_routing_fallback");
    expect(await logLenderMatch(null, { dealId: w.deal.id, match, now, context: "view" })).toBe("unavailable");
  });
});
