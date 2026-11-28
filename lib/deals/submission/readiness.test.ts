import { describe, expect, it } from "vitest";
import { CHECKLIST_REQUIREMENT_PREFIX, defaultTargetStage, evaluateAllStages, evaluateReadiness, lenderSafeMissingLabels, notReadyMessage, readinessHeadline } from "./readiness";
import { stubSubmissionMetrics } from "./test-metrics";
import { submissionFixture } from "./test-fixtures";

const ready = (ctx = submissionFixture("bridge"), stage: "screen" | "term_sheet" | "underwrite" = "screen") => evaluateReadiness(ctx, stubSubmissionMetrics(ctx), stage);

describe("evaluateReadiness", () => {
  it("scores met required items as a whole-number percent and is ready only when all are met", () => {
    const ctx = submissionFixture("bridge");
    const full = ready(ctx);
    const n = full.required.length;
    expect(full).toMatchObject({ playbook: "bridge", stage: "screen", score: 100, ready: true, missing: [], hardStops: [] });
    ctx.deal.loanAmountCents = null;
    ctx.profile!.purpose = null;
    const r = ready(ctx);
    expect(r.missing).toEqual(expect.arrayContaining(["request.amount", "request.purpose"]));
    expect(r.ready).toBe(false);
    expect(r.score).toBe(Math.floor(((r.required.length - r.missing.length) / r.required.length) * 100));
    expect(Number.isInteger(r.score)).toBe(true);
    // An unset purpose drops the "required at Screen on an acquisition" rule for sources and uses, so the required set can shrink.
    expect(r.required.length).toBeLessThanOrEqual(n);
  });

  it("lists recommended items separately and never counts them in the score", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.risks = [];
    ctx.profile!.targetCloseDate = null;
    const r = ready(ctx);
    expect(r.ready).toBe(true);
    expect(r.score).toBe(100);
    expect(r.recommended.filter((i) => !i.met).map((i) => i.id).sort()).toEqual(["plan.risks", "request.close_date"]);
    // The same items are required for a term sheet.
    expect(ready(ctx, "term_sheet").missing.sort()).toEqual(["plan.risks", "request.close_date"]);
  });

  it("surfaces holds and deal status as hard stops without touching ready or missing", () => {
    const ctx = submissionFixture("bridge");
    ctx.openHolds = ["Possible OFAC match for a principal"];
    const held = ready(ctx);
    expect(held.hardStops).toEqual(["On hold: Possible OFAC match for a principal"]);
    expect(held).toMatchObject({ ready: true, missing: [], score: 100 });

    ctx.openHolds = [];
    ctx.deal.status = "held_for_counsel";
    expect(ready(ctx).hardStops[0]).toMatch(/held for counsel/);
    ctx.deal.status = "withdrawn";
    expect(ready(ctx).hardStops[0]).toMatch(/withdrawn; it cannot go to lenders/);
    ctx.deal.status = "active";
    ctx.deal.stage = "closed";
    expect(ready(ctx).hardStops).toHaveLength(1);
  });

  it("checks PFS freshness only at Term sheet", () => {
    const ctx = submissionFixture("bridge");
    ctx.principals[2]!.pfsAsOf = "2026-06-30";
    expect(ready(ctx, "screen").missing).toEqual([]);
    expect(ready(ctx, "term_sheet").missing).toEqual(["sponsor.strength"]);
    // With no PFS at all, stated figures with a date carry Screen and read as per borrower.
    for (const p of ctx.principals) p.hasPfs = false;
    ctx.guarantorTotals = null;
    const screen = ready(ctx, "screen");
    expect(screen.missing).toEqual([]);
    expect(screen.required.find((i) => i.id === "sponsor.strength")).toMatchObject({ met: true, perBorrower: true });
    ctx.sponsor!.statedAsOf = null;
    expect(ready(ctx, "screen").missing).toEqual(["sponsor.strength"]);
  });

  it("checks HUD-2530 for every principal that owes it only at Term sheet", () => {
    const ctx = submissionFixture("hud_232");
    ctx.principals.find((p) => p.roles.includes("operator"))!.hasHud2530 = false;
    expect(ready(ctx, "screen").missing).toEqual([]);
    expect(ready(ctx, "term_sheet").missing).toEqual(["hud.prior_participation"]);
  });

  it("marks an item met only through borrower-sourced values as per borrower", () => {
    const ctx = submissionFixture("bridge");
    const at = "2026-10-02T18:00:00.000Z";
    ctx.profile!.fieldSources.purpose = { source: "borrower", by: "broker:ana", at };
    const r = ready(ctx);
    expect(r.required.find((i) => i.id === "request.purpose")!.perBorrower).toBe(true);
    // A borrower value next to an entered value is not "per borrower" as a whole.
    ctx.profile!.fieldSources.recourse = { source: "borrower", by: "broker:ana", at };
    expect(ready(ctx).required.find((i) => i.id === "request.recourse_lien")!.perBorrower).toBe(false);
    ctx.profile!.fieldSources.lienPosition = { source: "borrower", by: "broker:ana", at };
    expect(ready(ctx).required.find((i) => i.id === "request.recourse_lien")!.perBorrower).toBe(true);
    expect(ready(ctx).required.find((i) => i.id === "financials.noi_in_place")!.perBorrower).toBe(false);
    // Sponsor facts are stated by the sponsor.
    expect(r.required.find((i) => i.id === "sponsor.experience")!.perBorrower).toBe(true);
    expect(r.required.find((i) => i.id === "value.basis")!.perBorrower).toBe(false);
  });

  it("links each item to its field, checklist item or project", () => {
    const ctx = submissionFixture("construction");
    ctx.construction!.licenseCheck = null;
    ctx.vaultDocuments = [];
    const r = ready(ctx, "term_sheet");
    const gc = r.required.find((i) => i.id === "construction.gc")!;
    expect(gc).toMatchObject({ met: false, fix: { href: `/construction/project?id=${ctx.construction!.project.id}` } });
    expect(r.required.find((i) => i.id === "request.purpose")!.fix.href).toBe(`/deals/${ctx.deal.id}/submission?section=loan_request#field-purpose`);
    expect(r.required.find((i) => i.id === "request.amount")!.fix.href).toBe(`/deals/${ctx.deal.id}#details`);

    const bridge = submissionFixture("bridge");
    bridge.vaultDocuments = bridge.vaultDocuments.filter((d) => d.kind !== "T12");
    for (const i of bridge.checklistItems) if (i.templateKey === "t12") i.status = "requested";
    const t12 = ready(bridge, "term_sheet").required.find((i) => i.id === "docs.t12")!;
    const item = bridge.checklistItems.find((i) => i.templateKey === "t12")!;
    expect(t12).toMatchObject({ met: false, fix: { href: `/checklists/deal?id=${bridge.deal.id}#item-${item.id}` } });
  });

  it("adds the checklist's required application and underwriting items at Underwrite", () => {
    const ctx = submissionFixture("bridge");
    const r = ready(ctx, "underwrite");
    const docs = r.required.filter((i) => i.id.startsWith(CHECKLIST_REQUIREMENT_PREFIX));
    const expected = ctx.checklistItems.filter((i) => i.required && (i.stage === "application" || i.stage === "underwriting") && i.status !== "not_applicable");
    expect(docs.map((i) => i.id).sort()).toEqual(expected.map((i) => `checklist.${i.itemKey}`).sort());
    expect(docs.every((i) => i.section === "documents")).toBe(true);
    // Third-party items (appraisal, Phase I) are still requested in the fixture.
    expect(r.ready).toBe(false);
    expect(r.missing.every((id) => id.startsWith(CHECKLIST_REQUIREMENT_PREFIX))).toBe(true);
    expect(r.missing.length).toBe(expected.filter((i) => i.status === "requested").length);
    // Pre-closing items are not underwriting items.
    expect(r.required.some((i) => ctx.checklistItems.find((c) => `checklist.${c.itemKey}` === i.id)?.stage === "pre_closing")).toBe(false);
  });

  it("picks the highest ready stage by default and never says approved or qualified", () => {
    const ctx = submissionFixture("bridge");
    const all = evaluateAllStages(ctx, stubSubmissionMetrics(ctx));
    expect(defaultTargetStage(all)).toBe("term_sheet");
    expect(readinessHeadline(all.term_sheet)).toBe("Lender-ready for a term sheet");
    expect(readinessHeadline(all.underwrite)).toMatch(/^Underwrite: \d+ of \d+ required items in hand$/);
    ctx.profile!.purpose = null;
    expect(defaultTargetStage(evaluateAllStages(ctx, stubSubmissionMetrics(ctx)))).toBe("screen");
    for (const r of Object.values(all)) expect(readinessHeadline(r)).not.toMatch(/approv|qualif/i);
  });

  it("gives the email unmet items without the principals' names", () => {
    const ctx = submissionFixture("bridge");
    const pfs = ctx.checklistItems.filter((i) => i.templateKey === "pfs" && i.principalId);
    expect(pfs.length).toBe(2);
    for (const i of pfs) {
      const who = ctx.principals.find((p) => p.id === i.principalId)!;
      i.title = `${i.title} — ${who.legalName}`;
      i.status = "requested";
    }
    const r = ready(ctx, "underwrite");
    expect(r.required.filter((i) => !i.met).map((i) => i.label)).toEqual(expect.arrayContaining([pfs[0]!.title, pfs[1]!.title]));
    const labels = lenderSafeMissingLabels(r, ctx);
    const base = pfs[0]!.title.split(" — ")[0]!;
    expect(labels).toContain(`${base} (2 principals)`);
    for (const p of ctx.principals) expect(labels.join(" ")).not.toContain(p.legalName);
    expect(labels.length).toBe(r.missing.length - 1);
  });

  it("words the refusal as the spec does", () => {
    expect(notReadyMessage("term_sheet", ["Loan purpose", "T-12 operating statement", "Rent roll, census or STR report"])).toBe(
      "3 required items are missing for a term-sheet request: Loan purpose; T-12 operating statement; Rent roll, census or STR report. Add them or give a reason to send anyway.",
    );
    expect(notReadyMessage("screen", ["Loan amount"])).toBe("1 required item is missing for a soft-quote request: Loan amount. Add it or give a reason to send anyway.");
  });
});
