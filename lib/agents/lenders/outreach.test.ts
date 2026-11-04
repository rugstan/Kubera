// Nothing reaches a lender without broker approval: submissions from a match
// go through lender_outreach and the approval gate; pending, rejected and
// expired approvals send nothing.
import { describe, expect, it } from "vitest";
import { MemoryDocumentStorage } from "@/lib/disclosures/store";
import type { LenderMailer } from "@/lib/deals/packages";
import { docs, lenderInput, newDeal, noHolds, setup } from "@/lib/deals/test-fixtures";
import { MemoryAgentEventStore } from "@/lib/agents/core/events";
import { logLenderMatch, matchDecisionCandidates } from "./decision-log";
import { matchLenders } from "./matcher";
import { submitToLenders, type OutreachDeps } from "./outreach";
import { renderExecutiveSummaryPdf } from "./package-pdf";
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
  minDscr: 1.45,
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

async function world(gateDefault: "approved" | "pending" | "rejected" | "expired") {
  const { store, gate, now } = setup(gateDefault);
  const boxes = new MemoryLenderMatchStore();
  const mailer = new RecordingMailer();
  const storage = new MemoryDocumentStorage();
  const a = await store.insertLender(lenderInput(), "broker:ana", now());
  const b = await store.insertLender(lenderInput({ name: "Greystone", contactEmail: "kim@greystone.example" }), "broker:ana", now());
  const c = await store.insertLender(lenderInput({ name: "Out Of Box Capital", contactEmail: "x@oob.example" }), "broker:ana", now());
  await boxes.insertBox(approvedBox(a.id), "broker:ana", now());
  await boxes.insertBox(approvedBox(b.id), "broker:ana", now());
  await boxes.insertBox(approvedBox(c.id, { states: ["TX"] }), "broker:ana", now());
  const deal = await newDeal(store, now);
  const deps: OutreachDeps = { desk: store, boxes, gate, mailer, storage, renderPdf: renderExecutiveSummaryPdf, baseUrl: "https://corincommercial.com", now, holds: noHolds };
  const profile = dealProfile(deal, { ltvPct: 70, dscr: 1.6 });
  const summary = { asOf: "2026-11-04", spreads: { noiCents: 150_000_000, dscr: 1.6, ltvPct: 70 }, highlights: ["Stabilized at 92% occupancy for three years."] };
  return { store, gate, mailer, storage, deps, deal, profile, summary, lenders: { a, b, c } };
}

describe("submitToLenders", () => {
  it("submits nothing for a deal under a sanctions hold (no summary stored, no approval asked)", async () => {
    const w = await world("approved");
    const holds = { active: async () => [{ detail: "Possible sanctions match for Pat Owner" }] };
    await expect(submitToLenders({ ...w.deps, holds }, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(1), summary: w.summary, actor: "broker:ana" })).rejects.toThrow(/Possible sanctions match/);
    await expect(submitToLenders({ ...w.deps, holds: null }, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(1), summary: null, actor: "broker:ana" })).rejects.toThrow(/cannot be checked/);
    expect(w.gate.requests).toHaveLength(0);
    expect(w.mailer.sent).toEqual([]);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
  });

  it("sends nothing while the broker approval is pending", async () => {
    const w = await world("pending");
    const r = await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(2), summary: w.summary, actor: "broker:ana" });
    expect(r.outcomes).toHaveLength(1);
    const o = r.outcomes[0]!;
    expect(o.ok && o.result.outreach.status).toBe("pending_approval");
    expect(w.mailer.sent).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
    expect(w.gate.requests).toHaveLength(1);
    expect(w.gate.requests[0]).toMatchObject({ kind: "lender_submission", templateId: "lender_package_submission_v1" });
    expect(w.gate.requests[0]!.summary).toMatch(/match \d+(\.\d)?\/100/);
  });

  it.each(["rejected", "expired"] as const)("sends nothing when the approval is %s", async (status) => {
    const w = await world(status);
    const r = await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(1), summary: null, actor: "broker:ana" });
    const o = r.outcomes[0]!;
    expect(o.ok && o.result.outreach.status).toBe(status);
    expect(w.mailer.sent).toEqual([]);
    expect(await w.store.listShareLinks(w.deal.id)).toEqual([]);
  });

  it("after approval sends once per lender, with one locked package that includes the executive summary", async () => {
    const w = await world("approved");
    const r = await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id, w.lenders.b.id, w.lenders.a.id], items: docs(2), summary: w.summary, actor: "broker:ana" });
    expect(r.outcomes.map((o) => o.ok && o.result.outreach.status)).toEqual(["sent", "sent"]);
    expect(w.mailer.sent.map((m) => m.to)).toEqual(["dana@lender.example", "kim@greystone.example"]);
    expect(w.mailer.sent[0]!.text).toMatch(/broker, not the lender/);
    const pkgs = await w.store.listPackages(w.deal.id);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.manifest.map((i) => i.kind)).toContain("EXECUTIVE_SUMMARY");
    expect(r.summaryItem?.storagePath).toMatch(new RegExp(`^packages/${w.deal.id}/executive-summary-[0-9a-f]{16}\\.pdf$`));
    expect([...w.storage.objects.keys()]).toEqual([r.summaryItem!.storagePath]);

    // Re-submitting is idempotent: same approval key, nothing sent twice.
    await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(2), summary: w.summary, actor: "broker:ana" });
    expect(w.mailer.sent).toHaveLength(2);
    expect(await w.store.listPackages(w.deal.id)).toHaveLength(1);
  });

  it("refuses a lender the matcher excluded unless a broker writes an override reason", async () => {
    const w = await world("pending");
    const refused = await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.c.id], items: docs(1), summary: null, actor: "broker:ana" });
    expect(refused.outcomes[0]).toMatchObject({ ok: false });
    expect(!refused.outcomes[0]!.ok && refused.outcomes[0]!.error).toMatch(/Does not lend in CA/);
    expect(w.gate.requests).toEqual([]);

    const overridden = await submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.c.id], items: docs(1), summary: null, actor: "broker:ana", overrideReason: "Lender confirmed a CA exception by phone" });
    expect(overridden.outcomes[0]).toMatchObject({ ok: true, matched: false });
    expect(w.gate.requests[0]!.summary).toMatch(/override: Lender confirmed a CA exception/);
    expect(w.mailer.sent).toEqual([]);
  });

  it("rejects summary copy that overclaims, before anything is stored or requested", async () => {
    const w = await world("approved");
    await expect(
      submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(1), summary: { asOf: "2026-11-04", highlights: ["Borrower is pre-approved and will close in 30 days."] }, actor: "broker:ana" }),
    ).rejects.toThrow(/approves a loan/);
    expect(w.storage.objects.size).toBe(0);
    expect(w.gate.requests).toEqual([]);
  });

  it("validates the request", async () => {
    const w = await world("approved");
    await expect(submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [], items: docs(1), summary: null, actor: "a" })).rejects.toThrow(/at least one lender/);
    await expect(submitToLenders(w.deps, { dealId: "missing", profile: w.profile, lenderIds: [w.lenders.a.id], items: docs(1), summary: null, actor: "a" })).rejects.toThrow(/not found/);
    await expect(submitToLenders(w.deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id], items: [], summary: null, actor: "a" })).rejects.toThrow(/at least one document/);
  });
});

describe("lender-match decision log (reason codes)", () => {
  it("appends a decision.lender_match event for a submission, with ranked, knocked-out and override candidates", async () => {
    const w = await world("pending");
    const events = new MemoryAgentEventStore();
    const deps = { ...w.deps, events };
    await submitToLenders(deps, { dealId: w.deal.id, profile: w.profile, lenderIds: [w.lenders.a.id, w.lenders.c.id], items: docs(1), summary: null, actor: "broker:ana", overrideReason: "Lender confirmed a CA exception by phone" });
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
    expect(detail.candidates.filter((x) => x.eligible).map((x) => x.lenderId).sort()).toEqual([w.lenders.a.id, w.lenders.b.id].sort());
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
