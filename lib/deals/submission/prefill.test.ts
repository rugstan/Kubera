import { describe, expect, it } from "vitest";
import { intakeSchema } from "@/lib/validation";
import { spreadIdFor } from "./metrics";
import { buildPrefill, isFinancingPageLead } from "./prefill";
import { submissionProfilePatchSchema, sponsorSchema } from "./schema";
import { MemorySubmissionStore } from "./store";
import { allSubmissionFixtures, emptySubmissionContext, FIXTURE_STAFF, SUBMISSION_FIXTURE_NOW, submissionFixture } from "./test-fixtures";
import type { SubmissionContext, SubmissionPlaybook } from "./types";

const actor = FIXTURE_STAFF;
const at = SUBMISSION_FIXTURE_NOW.toISOString();

/** A fixture deal before anyone opened the editor: no profile yet. */
function fresh(pb: SubmissionPlaybook, edit: (ctx: SubmissionContext) => void = () => {}) {
  const ctx = submissionFixture(pb);
  ctx.profile = null;
  ctx.sponsor = null;
  edit(ctx);
  return { ctx, prefill: buildPrefill(ctx, { actor, playbook: pb }) };
}
const suggestion = (p: ReturnType<typeof buildPrefill>, field: string) => p.suggestions.find((s) => s.field === field);

describe("from the lead intake (per borrower)", () => {
  it("maps the intake to its fields with a borrower source naming the lead", () => {
    const { ctx, prefill } = fresh("bridge", (c) => {
      c.spreads = null;
      c.spreadBundleKinds = [];
      c.propertyFacts = null;
    });
    const borrower = { source: "borrower", by: actor, at, ref: ctx.deal.leadId };
    expect(prefill.profile).toMatchObject({
      playbook: "bridge",
      assetType: "MULTIFAMILY",
      purpose: "acquisition",
      noiInPlaceCents: 75_000_000,
      noiBasis: "borrower_stated",
      purchasePriceCents: 1_200_000_000,
      sizeCount: 42,
      sizeUnit: "units",
      occupancyPct: 88,
      recourse: "non_recourse",
      // Lead received 2026-09-08 + 120 days.
      targetCloseDate: "2027-01-06",
    });
    for (const f of ["assetType", "purpose", "noiInPlaceCents", "purchasePriceCents", "sizeCount", "occupancyPct", "recourse", "targetCloseDate"] as const) expect(prefill.profile.fieldSources![f], f).toEqual(borrower);
    expect(prefill.profile.asIsValueCents).toBeUndefined();
    expect(prefill.sponsor).toEqual({ creditBand: "740_PLUS" });
    expect(suggestion(prefill, "sponsor.creditBand")).toMatchObject({ value: "740_PLUS", source: null, origin: "intake" });
    expect(suggestion(prefill, "playbook")).toMatchObject({ value: "bridge", origin: "deal_program" });
  });

  it("reads `value` as the estimated value on a refinance, and `noi` as stabilized NOI on a build", () => {
    const refi = fresh("life_company", (c) => (c.spreads = null)).prefill.profile;
    expect(refi).toMatchObject({ purpose: "refinance", asIsValueCents: 2_200_000_000, asIsValueSource: "sponsor_estimate", noiInPlaceCents: 130_000_000 });
    expect(refi.purchasePriceCents).toBeUndefined();
    const build = fresh("construction", (c) => (c.intake = intakeSchema.parse({ ...c.intake, noi: 1_395_000 }))).prefill.profile;
    expect(build).toMatchObject({ noiStabilizedCents: 139_500_000 });
    expect(build.noiInPlaceCents).toBeUndefined();
    expect(build.occupancyPct).toBeUndefined();
    expect(build.asIsValueCents).toBeUndefined();
  });

  it("does not copy a financing-page lead's default occupancy or its zero NOI", () => {
    const { ctx, prefill } = fresh("bank", (c) => {
      c.spreads = null;
      c.spreadBundleKinds = [];
    });
    expect(isFinancingPageLead(ctx.intake!)).toBe(true);
    expect(ctx.intake).toMatchObject({ occupancyPct: 85, noi: 0 });
    expect(prefill.profile.occupancyPct).toBeUndefined();
    expect(prefill.profile.noiInPlaceCents).toBeUndefined();
    expect(prefill.profile).toMatchObject({ assetType: "OFFICE", purpose: "acquisition" });
    expect(prefill.notes.join(" ")).toMatch(/financing page/);
  });

  it("does not copy defaults it cannot tell from an answer, or a combined figure it cannot split", () => {
    const { prefill } = fresh("dscr_rental", (c) => (c.propertyFacts = null));
    // nonRecourseOnly false is the form default, not a request for recourse.
    expect(prefill.profile.recourse).toBeUndefined();
    expect(prefill.profile.programDetails).toEqual({ rental: { monthlyRentCents: 610_000 } });
    expect(prefill.profile.fieldSources!["programDetails.rental.monthlyRentCents"]).toMatchObject({ source: "borrower" });
    expect(prefill.notes.join(" ")).toMatch(/taxes, insurance and HOA together \(\$1,393 a month\)/);
  });

  it("leaves out a purpose for a financing-page lead that chose \"Other\"", () => {
    const { prefill } = fresh("bank", (c) => {
      c.spreads = null;
      c.intake = intakeSchema.parse({ ...c.intake, transaction: "REFINANCE", origin: { ...c.intake!.origin!, transaction: "OTHER" } });
    });
    expect(prefill.profile.purpose).toBeUndefined();
  });

  it("maps hotel ADR and the PIP budget, construction months, contract and uses, and hard money ARV and payoff", () => {
    const hotel = fresh("hotel_pip_bridge", (c) => {
      c.spreads = null;
      c.spreadFigures.hotelStr = null;
    }).prefill.profile;
    expect(hotel.programDetails!.hotel).toEqual({ adrCents: 11_800, pip: { required: true, budgetCents: 245_000_000 } });

    const build = fresh("construction", (c) => (c.construction = null)).prefill.profile;
    expect(build.programDetails!.construction).toMatchObject({ constructionMonths: 20, leaseUpMonths: 10, contractType: "gmp", groundUpProjectsCompleted: 6 });
    expect(build.stabilizedValueCents).toBe(2_650_000_000);
    expect(build.uses!.map((u) => [u.kind, u.amountCents])).toEqual([
      ["land", 240_000_000],
      ["hard_costs", 1_460_000_000],
      ["soft_costs", 220_000_000],
      ["contingency", 73_000_000],
      ["developer_fee", 58_800_000],
    ]);

    const bridge = fresh("bridge", (c) => {
      c.spreads = null;
      c.intake = intakeSchema.parse({ ...c.intake, transaction: "HARD_MONEY", hardMoney: { strategy: "BRIDGE", purpose: "REFINANCE", rehabBudget: 1_260_000, arv: 16_000_000, existingPayoff: 9_000_000, holdMonths: 24 } });
    }).prefill.profile;
    expect(bridge).toMatchObject({ purpose: "refinance", stabilizedValueCents: 1_600_000_000, stabilizedValueSource: "sponsor_estimate", existingDebtCents: 900_000_000, exitMonths: 24, programDetails: { rehab: { budgetCents: 126_000_000 } } });
  });
});

describe("from saved spreads, records and the public record", () => {
  it("documents beat the borrower: the T-12 spread's NOI, occupancy and size replace the intake's", () => {
    const { ctx, prefill } = fresh("bridge");
    const spread = { source: "spread", ref: spreadIdFor(ctx, "operating_statement"), asOf: ctx.spreads!.asOf, at, by: actor };
    expect(prefill.profile).toMatchObject({ noiInPlaceCents: 76_500_000, noiBasis: "t12", occupancyPct: 88, sizeCount: 42, sizeUnit: "units" });
    expect(prefill.profile.fieldSources!.noiInPlaceCents).toEqual(spread);
    expect(prefill.profile.fieldSources!.noiBasis).toEqual(spread);
    expect(prefill.profile.fieldSources!.occupancyPct).toMatchObject({ source: "spread", ref: spreadIdFor(ctx, "rent_roll") });
    expect(suggestion(prefill, "noiInPlaceCents")!.origin).toBe("spread");
  });

  it("never pairs the spread's underwritten revenue and expenses with a reported NOI", () => {
    const { prefill } = fresh("bridge");
    expect(prefill.profile.revenueCents).toBeUndefined();
    expect(prefill.profile.expensesCents).toBeUndefined();
    expect(prefill.notes.join(" ")).toMatch(/underwritten figures/);
  });

  it("takes hotel ADR, RevPAR and index from the STR spread over the intake", () => {
    const { ctx, prefill } = fresh("hotel_pip_bridge");
    expect(prefill.profile.programDetails!.hotel).toMatchObject({ adrCents: 11_850, revparCents: 7_252, revparIndex: 82 });
    expect(prefill.profile.fieldSources!["programDetails.hotel.adrCents"]).toMatchObject({ source: "spread", ref: ctx.spreadFigures.hotelStr!.spreadId });
    expect(prefill.profile.fieldSources!["programDetails.hotel.pip"]).toMatchObject({ source: "borrower" });
  });

  it("takes the construction budget from its spread, and units and seismic zone from the project record", () => {
    const { ctx, prefill } = fresh("construction");
    expect(prefill.profile.programDetails!.construction!.budget).toEqual(ctx.spreadFigures.constructionBudget!.budget);
    expect(prefill.profile.fieldSources!["programDetails.construction.budget"]).toMatchObject({ source: "spread", ref: ctx.spreadFigures.constructionBudget!.spreadId });
    const record = { source: "record", record: "construction_projects", ref: ctx.construction!.project.id, at, by: actor };
    expect(prefill.profile).toMatchObject({ sizeCount: 64, sizeUnit: "units", seismicZone: true });
    expect(prefill.profile.fieldSources!.sizeCount).toEqual(record);
    expect(prefill.profile.fieldSources!.seismicZone).toEqual(record);
  });

  it("records beat the borrower: the hard money file's price, values and exit", () => {
    const { ctx, prefill } = fresh("hard_money");
    const record = { source: "record", record: "hm_underwriting", ref: ctx.hardMoney!.id, at, by: actor };
    expect(ctx.intake!.value).toBe(2_200_000);
    expect(prefill.profile).toMatchObject({ purpose: "acquisition", purchasePriceCents: 215_000_000, asIsValueCents: 220_000_000, stabilizedValueCents: 290_000_000, stabilizedValueSource: "bpo", exitStrategy: "refinance", exitMonths: 14 });
    for (const f of ["purchasePriceCents", "asIsValueCents", "stabilizedValueCents", "stabilizedValueSource", "exitStrategy", "exitMonths"] as const) expect(prefill.profile.fieldSources![f], f).toEqual(record);
    expect(prefill.notes.join(" ")).toMatch(/hard money file's scope of work/);
  });

  it("takes paired fields from one source: a record's value is never labelled with the borrower's source", () => {
    const { prefill } = fresh("hard_money", (c) => {
      c.intake = intakeSchema.parse({ ...c.intake, hardMoney: { ...c.intake!.hardMoney!, purpose: "REFINANCE" } });
      c.hardMoney = { ...c.hardMoney!, purpose: "REFINANCE" };
    });
    expect(prefill.profile.asIsValueCents).toBe(220_000_000);
    expect(prefill.profile.fieldSources!.asIsValueCents).toMatchObject({ source: "record" });
    expect(prefill.profile.asIsValueSource).toBeUndefined();
  });

  it("tags APN, county, flood zone and year built as public record", () => {
    const { ctx, prefill } = fresh("agency");
    const pub = { source: "public_record", ref: ctx.propertyFacts!.id, at, by: actor };
    expect(prefill.profile).toMatchObject({ apn: ctx.propertyFacts!.apn, county: ctx.propertyFacts!.county, floodZone: "X", yearBuilt: ctx.propertyFacts!.yearBuilt });
    for (const f of ["apn", "county", "floodZone", "yearBuilt"] as const) expect(prefill.profile.fieldSources![f], f).toEqual(pub);
  });

  it("drops a value that fails its field's checks, with a note", () => {
    const { prefill } = fresh("agency", (c) => (c.propertyFacts = { ...c.propertyFacts!, yearBuilt: 1650 }));
    expect(prefill.profile.yearBuilt).toBeUndefined();
    expect(prefill.profile.fieldSources!.yearBuilt).toBeUndefined();
    expect(prefill.notes.join(" ")).toMatch(/Year built from Public record is not suggested/);
  });
});

describe("the result", () => {
  it.each(allSubmissionFixtures())("%s: saves as a new profile and sponsor exactly as suggested", async (pb) => {
    const { ctx, prefill } = fresh(pb);
    expect(submissionProfilePatchSchema.safeParse(prefill.profile).success).toBe(true);
    expect(sponsorSchema.safeParse(prefill.sponsor).success).toBe(true);
    const store = new MemorySubmissionStore();
    const saved = await store.upsertProfile(ctx.deal.id, null, prefill.profile, actor, SUBMISSION_FIXTURE_NOW);
    expect(saved.playbook).toBe(pb);
    expect(Object.keys(saved.fieldSources).sort()).toEqual(prefill.suggestions.filter((s) => s.field !== "playbook" && !s.field.startsWith("sponsor.")).map((s) => s.field).sort());
    await store.upsertSponsor(ctx.deal.id, null, prefill.sponsor, actor, SUBMISSION_FIXTURE_NOW);
  });

  it("suggests only the playbook when there is nothing to read", () => {
    const p = buildPrefill(emptySubmissionContext("SBA_7A"), { actor });
    expect(p.profile).toEqual({ playbook: "sba_7a", fieldSources: {} });
    expect(p.suggestions).toEqual([{ field: "playbook", label: "Playbook", value: "sba_7a", source: null, origin: "deal_program" }]);
    expect(p.sponsor).toEqual({});
  });

  it("uses a requested playbook only when the deal's program allows it", () => {
    const ctx = submissionFixture("bank");
    ctx.profile = null;
    expect(buildPrefill(ctx, { actor, playbook: "dscr_rental" }).playbook).toBe("dscr_rental");
    expect(buildPrefill(ctx, { actor, playbook: "construction" }).playbook).toBe("bank");
  });

  it("suggests no in-place NOI where the operating-financials section is hidden", () => {
    const { prefill } = fresh("sba_7a", (c) => (c.intake = intakeSchema.parse({ ...c.intake, noi: 400_000 })));
    expect(prefill.profile.noiInPlaceCents).toBeUndefined();
  });
});
