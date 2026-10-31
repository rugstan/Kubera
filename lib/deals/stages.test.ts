import { describe, expect, it } from "vitest";
import type { DealCompliance } from "@/lib/compliance/gates";
import { MemoryDisclosureStore } from "@/lib/disclosures/store";
import { advanceDeal, editDeal, stageContext } from "./service";
import { LockedFieldError, applyStageEvent, assertEditable, availableEvents, stageTemplate, templateDigest } from "./stages";
import { dealPrograms, type Deal } from "./types";
import { checklistDesk, docs, lenderInput, loanRecord, newDeal, setup } from "./test-fixtures";
import { dispositionScreening } from "@/lib/screening/service";
import { dealStatusHoldSink } from "./holds";
import { MemoryStageEventSink } from "./stage-events";
import { markOutreachSent, recordLenderResponse, sendPackageToLender } from "./packages";
import { sbaPackagingFee } from "./ledger";

const closingOk = { gates: { closing: { allowed: true, reasons: [] } } } as unknown as DealCompliance;
const closingBlocked = { gates: { closing: { allowed: false, reasons: ["No deal moves to closing without a signed MLDS (RE 882) on file."] } } } as unknown as DealCompliance;

const at = (deal: Deal, stage: string): Deal => ({ ...deal, stage });

describe("stage templates", () => {
  it("has a template for every program, starting at intake and ending at closed", () => {
    for (const p of dealPrograms) {
      const t = stageTemplate(p);
      expect(t.stages[0]!.key).toBe("intake");
      expect(t.stages.filter((s) => s.terminal).map((s) => s.key)).toEqual(["closed", "withdrawn", "lost"]);
      // Every non-terminal stage has a way forward.
      for (const s of t.stages.filter((x) => !x.terminal)) expect(availableEvents(t, s.key).some((e) => !["withdraw", "mark_lost"].includes(e.key))).toBe(true);
      // Every event targets a defined stage.
      for (const e of t.events) expect(t.stages.some((s) => s.key === e.to)).toBe(true);
      expect(templateDigest(t)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("models program-specific middles", () => {
    const keys = (p: (typeof dealPrograms)[number]) => stageTemplate(p).stages.map((s) => s.key);
    expect(keys("HUD_232")).toContain("firm_commitment");
    expect(keys("SBA_504")).toContain("sba_authorization");
    expect(keys("CONSTRUCTION")).toContain("plan_and_cost_review");
    expect(keys("HARD_MONEY")).not.toContain("application");
    expect(stageTemplate("SBA_7A").events.find((e) => e.key === "closing_scheduled")!.requires).toContain("form159_signed");
  });
});

describe("applyStageEvent", () => {
  it("checks each event's requirements", async () => {
    const { store, now } = setup();
    const deal = await newDeal(store, now);
    expect(applyStageEvent({ deal, event: "engagement_signed", context: {}, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/engagement/)] });
    expect(applyStageEvent({ deal, event: "engagement_signed", context: { engagementAgreementRef: "vault://e.pdf" }, now: now() })).toMatchObject({ ok: true, to: "engaged" });
    expect(applyStageEvent({ deal: at(deal, "packaging"), event: "package_sent", context: {}, now: now() }).ok).toBe(false);
    expect(applyStageEvent({ deal, event: "loan_closed", context: {}, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/does not apply/)] });
    expect(applyStageEvent({ deal, event: "nope", context: {}, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/Unknown event/)] });
  });

  it("locks the accepted terms at term-sheet acceptance", async () => {
    const { store, now } = setup();
    const deal = at(await newDeal(store, now), "term_sheet");
    expect(applyStageEvent({ deal, event: "term_sheet_accepted", context: { termSheetRef: "ts" }, terms: { lenderName: "X" }, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/noteRatePct, termMonths/)] });
    const r = applyStageEvent({ deal, event: "term_sheet_accepted", context: { termSheetRef: "ts" }, terms: { lenderName: "Cambridge", noteRatePct: 6.1, termMonths: 420, junk: 1 }, now: now() });
    if (!r.ok) throw new Error(r.reasons.join());
    expect(r.to).toBe("application");
    expect(r.patch.termSheetAcceptedAt).toBe(now().toISOString());
    expect(r.patch.lockedTerms).toEqual({ lenderName: "Cambridge", noteRatePct: 6.1, termMonths: 420 });
    expect(r.patch.lockedFields).toEqual(expect.arrayContaining(["loanAmountCents", "lockedTerms.noteRatePct"]));
  });

  it("runs the compliance closing gate and, for SBA, the Form 159 requirement", async () => {
    const { store, now } = setup();
    const hud = at(await newDeal(store, now), "firm_commitment");
    expect(applyStageEvent({ deal: hud, event: "closing_scheduled", context: {}, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/compliance evaluation/)] });
    expect(applyStageEvent({ deal: hud, event: "closing_scheduled", context: { compliance: closingBlocked }, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/signed MLDS/)] });
    expect(applyStageEvent({ deal: hud, event: "closing_scheduled", context: { compliance: closingOk }, now: now() })).toMatchObject({ ok: true, to: "closing" });
    const closed = applyStageEvent({ deal: at(hud, "closing"), event: "loan_closed", context: { compliance: closingOk }, now: now() });
    expect(closed).toMatchObject({ ok: true, to: "closed", patch: { closedOn: "2026-11-03" } });

    const sba = at(await newDeal(store, now, { program: "SBA_7A" }), "sba_authorization");
    expect(applyStageEvent({ deal: sba, event: "closing_scheduled", context: { compliance: closingOk, form159Satisfied: false }, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/Form 159/)] });
    expect(applyStageEvent({ deal: sba, event: "closing_scheduled", context: { compliance: closingOk, form159Satisfied: true }, now: now() }).ok).toBe(true);
  });

  it("refuses a deal on an unknown template version", async () => {
    const { store, now } = setup();
    const deal = { ...(await newDeal(store, now)), stageTemplateVersion: 99 };
    expect(applyStageEvent({ deal, event: "engagement_signed", context: { engagementAgreementRef: "x" }, now: now() })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/v99/)] });
  });
});

describe("field locks", () => {
  it("rejects locked changes without a fresh modification reference", async () => {
    const { store, now } = setup();
    const deal: Deal = { ...(await newDeal(store, now)), termSheetAcceptedAt: now().toISOString(), lockedTerms: { noteRatePct: 6 } };
    expect(() => assertEditable(deal, { loanAmountCents: 1 })).toThrow(LockedFieldError);
    expect(() => assertEditable(deal, { title: "Renamed", loanAmountCents: deal.loanAmountCents })).not.toThrow();
    expect(() => assertEditable(deal, { loanAmountCents: 1, lockOverrideRef: "mod-1" })).not.toThrow();
    expect(() => assertEditable({ ...deal, lockOverrideRef: "mod-1" }, { loanAmountCents: 1, lockOverrideRef: "mod-1" })).toThrow(LockedFieldError);
  });

  it("editDeal enforces the lock and keeps the program fixed after intake", async () => {
    const { store, now } = setup();
    const deal = await newDeal(store, now);
    const renamed = await editDeal({ store, now }, deal.id, deal.recordVersion, { program: "AGENCY" }, "a");
    expect(renamed.program).toBe("AGENCY");
    const moved = await store.updateDeal(deal.id, renamed.recordVersion, { stage: "engaged" }, "a", now());
    await expect(editDeal({ store, now }, deal.id, moved.recordVersion, { program: "HUD_232" }, "a")).rejects.toThrow(/only at intake/);
    const locked = await store.updateDeal(deal.id, moved.recordVersion, { termSheetAcceptedAt: now().toISOString() }, "a", now());
    await expect(editDeal({ store, now }, deal.id, locked.recordVersion, { loanAmountCents: 5 }, "a")).rejects.toBeInstanceOf(LockedFieldError);
    await expect(editDeal({ store, now }, deal.id, 1, { title: "stale" }, "a")).rejects.toThrow(/concurrently/);
  });
});

describe("advanceDeal (end to end with the records)", () => {
  it("moves a HUD deal from intake to closed only when each record exists", async () => {
    const { store, gate, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    let deal = await newDeal(store, now);
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const stageEvents = new MemoryStageEventSink();
    const deps = { store, disclosures, now, checklist, stageEvents };
    const lender = await store.insertLender(lenderInput(), "a", now());

    expect((await advanceDeal(deps, { dealId: deal.id, event: "engagement_signed", actor: "a" })).ok).toBe(false);
    deal = await editDeal({ store, now }, deal.id, deal.recordVersion, { engagementAgreementRef: "vault://engagement.pdf" }, "a");
    expect((await advanceDeal(deps, { dealId: deal.id, event: "engagement_signed", actor: "a" })).ok).toBe(true);
    expect((await advanceDeal(deps, { dealId: deal.id, event: "packaging_started", actor: "a" })).ok).toBe(true);
    expect((await advanceDeal(deps, { dealId: deal.id, event: "package_sent", actor: "a" })).ok).toBe(false);

    const sent = await sendPackageToLender({ store, gate, now, baseUrl: "https://k.test" }, { dealId: deal.id, lenderId: lender.id, items: docs(2), actor: "a" });
    await markOutreachSent(store, sent.outreach.id, "a", now());
    expect((await advanceDeal(deps, { dealId: deal.id, event: "package_sent", actor: "a" })).ok).toBe(true);
    await recordLenderResponse(store, sent.outreach.id, { status: "term_sheet", termSheetRef: "vault://ts.pdf" }, "a", now());
    expect((await advanceDeal(deps, { dealId: deal.id, event: "term_sheet_received", actor: "a" })).ok).toBe(true);
    const acc = await advanceDeal(deps, { dealId: deal.id, event: "term_sheet_accepted", terms: { lenderName: "Cambridge", noteRatePct: 6.2, termMonths: 420 }, actor: "a" });
    expect(acc.deal.termSheetAcceptedAt).not.toBeNull();
    for (const e of ["reports_ordered", "hud_submitted", "firm_commitment_issued"]) expect((await advanceDeal(deps, { dealId: deal.id, event: e, actor: "a" })).ok).toBe(true);

    // No signed MLDS on a real-property loan: closing is blocked by gate A.
    const blocked = await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(blocked).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/signed MLDS/)]) });

    await disclosures.insert({ kind: "MLDS_RE882", status: "signed", dealId: deal.id, signedAt: now().toISOString() }, now());
    store.seedLoanBrokerOfRecord(loanRecord(deal.id, { lender: { name: "Cambridge", category: "STATE_BANK", evidenceRef: "DFPI 1" }, noteRatePct: 6.2 }));
    expect((await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" })).ok).toBe(true);
    const closed = await advanceDeal(deps, { dealId: deal.id, event: "loan_closed", actor: "a" });
    expect(closed.deal).toMatchObject({ stage: "closed", closedOn: "2026-11-03", status: "won" });
    // Every stage change was announced once, with an id stable per deal, stage and record version.
    expect(stageEvents.changes.map((c) => c.stage)).toEqual(["engaged", "packaging", "lender_outreach", "term_sheet", "application", "third_party_reports", "hud_review", "firm_commitment", "closing", "closed"]);
    expect(stageEvents.changes.at(-1)).toMatchObject({ dealId: deal.id, previousStage: "closing", event: "loan_closed", eventId: `deal-stage:${deal.id}:closed:${closed.deal.recordVersion}` });
    expect(new Set(stageEvents.changes.map((c) => c.eventId)).size).toBe(stageEvents.changes.length);
    expect(store.audit.filter((a) => a.tableName === "deals" && a.changed.includes("stage")).length).toBeGreaterThanOrEqual(10);
  });

  it("explains what is missing when compliance cannot be evaluated", async () => {
    const { store, now } = setup();
    const deal = await newDeal(store, now, { collateralRealProperty: null });
    await store.updateDeal(deal.id, deal.recordVersion, { stage: "firm_commitment" }, "a", now());
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const r = await advanceDeal({ store, disclosures: null, now, checklist }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(" ")).toMatch(/lien on real property/);
    expect(r.reasons.join(" ")).toMatch(/disclosure store/);
  });

  it("refuses closing with a signed MLDS but no broker-of-record file (gate H fails closed)", async () => {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    const deal = await newDeal(store, now);
    await store.updateDeal(deal.id, deal.recordVersion, { stage: "firm_commitment" }, "a", now());
    await disclosures.insert({ kind: "MLDS_RE882", status: "signed", dealId: deal.id, signedAt: now().toISOString() }, now());
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const deps = { store, disclosures, now, checklist };
    const r = await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.join(" ")).toMatch(/broker-of-record file/);
    expect((await store.getDeal(deal.id))!.stage).toBe("firm_commitment");

    // A 12.5% private non-exempt loan with an incomplete file stays blocked once the row exists.
    store.seedLoanBrokerOfRecord(loanRecord(deal.id));
    const stillBlocked = await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(stillBlocked.ok).toBe(false);
    if (!stillBlocked.ok) expect(stillBlocked.reasons.join(" ")).toMatch(/Designated-officer approval/);
  });

  it("evaluates modifications even without the loan row and blocks closing on them", async () => {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    const deal = await newDeal(store, now);
    await store.updateDeal(deal.id, deal.recordVersion, { stage: "firm_commitment" }, "a", now());
    await disclosures.insert({ kind: "MLDS_RE882", status: "signed", dealId: deal.id, signedAt: now().toISOString() }, now());
    // An orphaned modification (its parent loan row is gone) is still evaluated as blocking.
    await store.insertModification(
      {
        dealId: deal.id,
        kind: "extension",
        status: "incomplete",
        parentBrokerOfRecordId: "11111111-1111-4111-8111-111111111111",
        brokerOfRecordId: null,
        facts: { kind: "extension", effectiveDate: "2026-10-01", arrangedBy: "kubera", noteRatePct: 12.5 },
        evaluation: { status: "incomplete", brokerArrangementDocumented: false, lenderNoticeRequired: false, missing: [], blocking: true, flags: [] },
        flags: [],
        lenderNoticeApprovalKey: null,
        lenderNoticeApprovalId: null,
        lenderNoticeApprovedAt: null,
        lenderNoticeSentAt: null,
        officerApprovedBy: null,
        officerApprovedAt: null,
        feeEntryId: null,
        termsAppliedAt: null,
      },
      "a",
      now(),
    );
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const ctx = await stageContext({ store, disclosures, now, checklist }, deal);
    expect(ctx.compliance?.gates.closing.allowed).toBe(false);
    expect(ctx.compliance?.gates.closing.reasons.join(" ")).toMatch(/1 recorded modification\(s\) cannot be evaluated/);
    expect(ctx.complianceMissing.join(" ")).toMatch(/broker-of-record file/);
  });

  it("an SBA deal with Kubera compensation needs a signed Form 159 to close", async () => {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    const deal = await newDeal(store, now, { program: "SBA_7A", collateralRealProperty: false });
    await store.updateDeal(deal.id, deal.recordVersion, { stage: "sba_authorization" }, "a", now());
    await store.insertFeeEntry(sbaPackagingFee({ dealId: deal.id, flatCents: 100_000 }), "a", now());
    store.seedLoanBrokerOfRecord(
      loanRecord(deal.id, { lender: { name: "Live Oak", category: "STATE_BANK", evidenceRef: "DFPI 2" }, noteRatePct: 9.5, collateral: { realPropertyLien: false, equityPledgeOrUccOnly: true } }),
    );
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const r = await advanceDeal({ store, disclosures, now, checklist }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r).toMatchObject({ ok: false, reasons: [expect.stringMatching(/Form 159/)] });
  });
});

describe("sanctions holds and the closing gate on the deal desk", () => {
  async function dealAtFirmCommitment() {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    const deal = await newDeal(store, now);
    const moved = await store.updateDeal(deal.id, deal.recordVersion, { stage: "firm_commitment" }, "a", now());
    await disclosures.insert({ kind: "MLDS_RE882", status: "signed", dealId: deal.id, signedAt: now().toISOString() }, now());
    store.seedLoanBrokerOfRecord(loanRecord(deal.id, { lender: { name: "Cambridge", category: "STATE_BANK", evidenceRef: "DFPI 1" }, noteRatePct: 6.2 }));
    return { store, now, disclosures, deal: moved };
  }

  it("a deal with an open sanctions hold cannot advance to closing; only withdraw / lost apply", async () => {
    const { store, now, disclosures, deal } = await dealAtFirmCommitment();
    const { desk, deps: checklist, sdeps, screened } = await checklistDesk(deal.id, now, { sanctions: [{ entryId: "SDN-9", name: "Pat Owner", kind: "individual" }] });
    const sink = dealStatusHoldSink({ store, holds: desk.holds, now });
    // The screening service announced the hold before the sink existed; replay it.
    for (const h of await desk.holds.active(deal.id)) await sink.held(h);
    expect((await store.getDeal(deal.id))!.status).toBe("on_hold");

    const deps = { store, disclosures, now, checklist };
    const blocked = await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(blocked).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/On hold: Possible sanctions match for Pat Owner/)]) });
    expect((await store.getDeal(deal.id))!.stage).toBe("firm_commitment");

    // Confirmed match: held for counsel, still blocked.
    const hit = screened.records.find((r) => r.result === "potential_match")!;
    await dispositionScreening({ ...sdeps, sink }, { screeningId: hit.id, to: "confirmed_match", reviewer: { id: "u1", email: "broker@kuberacommercial.com", name: "B", role: "broker", dreLicense: null }, note: "Same date of birth and nationality as SDN-9." });
    expect((await store.getDeal(deal.id))!.status).toBe("held_for_counsel");
    expect((await advanceDeal(deps, { dealId: deal.id, event: "closing_scheduled", actor: "a" })).ok).toBe(false);

    const withdrawn = await advanceDeal(deps, { dealId: deal.id, event: "withdraw", actor: "a" });
    expect(withdrawn.ok).toBe(true);
    expect(withdrawn.deal).toMatchObject({ stage: "withdrawn", status: "withdrawn" });
  });

  it("releasing a possible-match hold returns the deal to active and lets it close", async () => {
    const { store, now, disclosures, deal } = await dealAtFirmCommitment();
    const { desk, deps: checklist, sdeps, screened } = await checklistDesk(deal.id, now, { sanctions: [{ entryId: "SDN-9", name: "Pat Owner", kind: "individual" }] });
    const sink = dealStatusHoldSink({ store, holds: desk.holds, now });
    for (const h of await desk.holds.active(deal.id)) await sink.held(h);
    const hit = screened.records.find((r) => r.result === "potential_match")!;
    await dispositionScreening({ ...sdeps, sink }, { screeningId: hit.id, to: "false_positive", reviewer: { id: "u1", email: "broker@kuberacommercial.com", name: "B", role: "broker", dreLicense: null }, note: "Different date of birth and nationality from SDN-9." });
    expect((await store.getDeal(deal.id))!.status).toBe("active");
    const r = await advanceDeal({ store, disclosures, now, checklist }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r).toMatchObject({ ok: true, to: "closing" });
  });

  it("closing needs the checklist gate ready and a screening inside the rescreen window", async () => {
    const { store, now, disclosures, deal } = await dealAtFirmCommitment();
    const incomplete = await checklistDesk(deal.id, now, { complete: false });
    const r = await advanceDeal({ store, disclosures, now, checklist: incomplete.deps }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/item\(s\) outstanding/)]) });

    // A clean screening that has gone stale (outside the rescreen window) blocks closing too.
    const { deps: ready } = await checklistDesk(deal.id, now);
    const later = () => new Date(now().getTime() + 60 * 24 * 3600 * 1000);
    const stale = await advanceDeal({ store, disclosures, now: later, checklist: { ...ready, now: later } }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reasons.join(" ")).toMatch(/[Rr]escreen/);
  });

  it("without the checklist desk every event but the exits is refused (fail closed)", async () => {
    const { store, now, disclosures, deal } = await dealAtFirmCommitment();
    const r = await advanceDeal({ store, disclosures, now, checklist: null }, { dealId: deal.id, event: "closing_scheduled", actor: "a" });
    expect(r).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/not configured/)]) });
    expect((await advanceDeal({ store, disclosures, now, checklist: null }, { dealId: deal.id, event: "mark_lost", actor: "a" })).deal.status).toBe("lost");
  });

  it("a failing stage notification does not undo the advance", async () => {
    const { store, now } = setup();
    let deal = await newDeal(store, now);
    deal = await store.updateDeal(deal.id, deal.recordVersion, { engagementAgreementRef: "vault://e.pdf" }, "a", now());
    const { deps: checklist } = await checklistDesk(deal.id, now);
    const errors: unknown[] = [];
    const r = await advanceDeal(
      { store, disclosures: null, now, checklist, stageEvents: { stageChanged: async () => Promise.reject(new Error("notify down")) }, onStageEventError: (e) => errors.push(e) },
      { dealId: deal.id, event: "engagement_signed", actor: "a" },
    );
    expect(r.ok).toBe(true);
    expect(r.deal.stage).toBe("engaged");
    expect(errors).toHaveLength(1);
  });
});
