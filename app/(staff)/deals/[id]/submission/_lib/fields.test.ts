import { describe, expect, it } from "vitest";
import { emptyProfileContext, submissionFixture } from "@/lib/deals/submission/test-fixtures";
import { metricKeys, type SubmissionProfilePatch } from "@/lib/deals/submission/types";
import { SECTION_FIELDS, fieldsOf, inputDefault, parseSectionForm, readValue, sourceKeyFor, visibleEntries, type ParseContext } from "./fields";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

const AT = "2026-11-21T18:00:00.000Z";
function ctxFor(pb: Parameters<typeof submissionFixture>[0], empty = false): ParseContext {
  const c = empty ? emptyProfileContext(pb) : submissionFixture(pb);
  return { playbook: pb, allowedPlaybooks: [pb], profile: c.profile, sponsor: c.sponsor, actor: "staff:ana@corin.test", at: AT };
}
const profilePatch = (r: ReturnType<typeof parseSectionForm>): SubmissionProfilePatch => {
  if (r.values?.target !== "profile") throw new Error(`expected a profile patch, got ${JSON.stringify(r)}`);
  return r.values.patch;
};

describe("field definitions", () => {
  it("never offer a ratio as an input", () => {
    const names = Object.values(SECTION_FIELDS).flatMap((entries) => fieldsOf(entries ?? []).map((d) => d.name.toLowerCase()));
    for (const banned of ["ltv", "ltc", "dscr", "debtyield", "caprate", "yieldoncost", ...metricKeys]) expect(names.some((n) => n.split(".").at(-1) === banned.toLowerCase())).toBe(false);
    expect(names.length).toBeGreaterThan(100);
  });

  it("use labels that pass the summary copy rules", () => {
    const labels = Object.values(SECTION_FIELDS).flatMap((entries) => (entries ?? []).flatMap((e) => (e.kind === "group" ? [e.legend, ...e.fields.map((d) => d.label)] : [e.label])));
    expect(labels.filter((l) => /\bapproved\b|qualif|guarantee[ds]?\b/i.test(l))).toEqual([]);
  });

  it("hide program fields a playbook does not use", () => {
    expect(fieldsOf(visibleEntries("sba", "sba_7a")).map((d) => d.name)).not.toContain("programDetails.sba.cdcName");
    expect(fieldsOf(visibleEntries("sba", "sba_504")).map((d) => d.name)).toContain("programDetails.sba.cdcName");
  });

  it("read stored values and their source keys", () => {
    const c = submissionFixture("hotel_pip_bridge");
    expect(readValue("programDetails.hotel.pip.budgetCents", c.profile, c.sponsor)).toBe(245_000_000);
    expect(readValue("sponsor.yearsExperience", c.profile, c.sponsor)).toBe(12);
    expect(sourceKeyFor("programDetails.hotel.pip.budgetCents")).toBe("programDetails.hotel.pip");
    expect(sourceKeyFor("sponsor.creditBand")).toBeNull();
    expect(inputDefault({ kind: "money", name: "x", label: "x" }, 76_500_050)).toBe("765000.50");
    expect(inputDefault({ kind: "signed_money", name: "x", label: "x" }, -4_500_000)).toBe("-45000");
    expect(inputDefault({ kind: "bool", name: "x", label: "x" }, false)).toBe("no");
  });
});

describe("parseSectionForm", () => {
  it("turns a loan request form into a patch, blanks into nulls, and marks changed values entered", () => {
    const ctx = ctxFor("bridge");
    const r = parseSectionForm("loan_request", form({ purpose: "refinance", requestedTermMonths: "36", requestedIoMonths: "12", existingDebtCents: "6,250,000", existingRatePct: "7.125", targetCloseDate: "2027-02-01", assumedRatePct: "", rateType: "floating" }), ctx);
    expect(r.errors).toEqual([]);
    const p = profilePatch(r);
    expect(p).toMatchObject({ purpose: "refinance", requestedTermMonths: 36, requestedIoMonths: 12, existingDebtCents: 625_000_000, existingRatePct: 7.125, targetCloseDate: "2027-02-01", assumedRatePct: null, rateType: "floating", recourse: null });
    // Changed: entered by the actor. Unchanged (rate type was floating): no new source. Cleared: its source is removed only if it had one.
    expect(p.fieldSources?.purpose).toEqual({ source: "entered", by: "staff:ana@corin.test", at: AT });
    expect(p.fieldSources).not.toHaveProperty("rateType");
    expect(p.playbook).toBeUndefined();
  });

  it("names every problem by its visible label and saves nothing", () => {
    const r = parseSectionForm("loan_request", form({ requestedTermMonths: "12", requestedIoMonths: "24", existingDebtCents: "lots", targetCloseDate: "2027-02-30", purpose: "casino" }), ctxFor("bridge"));
    expect(r.values).toBeNull();
    expect(r.errors.map((e) => e.label)).toEqual(expect.arrayContaining(["Existing debt balance (USD)", "Target closing date", "Loan purpose", "Interest-only period (months)"]));
    expect(r.errors.find((e) => e.name === "requestedIoMonths")?.message).toMatch(/longer than the requested term/);
  });

  it("refuses identifiers in free text", () => {
    const r = parseSectionForm("plan_exit", form({ businessPlan: "Guarantor SSN 123-45-6789 on file", exitDetail: "Wire to account 123456789012" }), ctxFor("bridge"));
    expect(r.values).toBeNull();
    expect(r.errors.map((e) => e.label)).toEqual(["Business plan", "Exit detail"]);
    expect(parseSectionForm("plan_exit", form({ businessPlan: "Buy at $12,000,000 and renovate 30 units over 18 months." }), ctxFor("bridge")).errors).toEqual([]);
  });

  it("starts a new profile with the playbook", () => {
    const ctx = { ...ctxFor("hotel_pip_bridge", true), profile: null, sponsor: null };
    const p = profilePatch(parseSectionForm("value", form({ purchasePriceCents: "9,800,000" }), ctx));
    expect(p).toMatchObject({ playbook: "hotel_pip_bridge", purchasePriceCents: 980_000_000, asIsValueCents: null });
    expect(p.fieldSources?.purchasePriceCents?.source).toBe("entered");
  });

  it("keeps program fields hidden for the playbook and replaces the visible ones", () => {
    const ctx = ctxFor("sba_7a");
    ctx.profile!.programDetails.sba = { ...ctx.profile!.programDetails.sba, cdcName: "Kept CDC" };
    const p = profilePatch(parseSectionForm("sba", form({ "programDetails.sba.businessName": "New Name Bakery LLC", "programDetails.sba.naics": "311811", "programDetails.sba.franchise": "no" }), ctx));
    expect(p.programDetails?.sba).toMatchObject({ businessName: "New Name Bakery LLC", naics: "311811", franchise: false, cdcName: "Kept CDC" });
    expect(p.programDetails?.sba).not.toHaveProperty("yearsInBusiness");
    expect(p.fieldSources?.["programDetails.sba.businessName"]?.source).toBe("entered");
  });

  it("builds nested objects: a zero-filled budget, and a PIP only once it is answered", () => {
    const budget = profilePatch(parseSectionForm("construction", form({ "programDetails.construction.budget.landCents": "2,400,000", "programDetails.construction.budget.hardCents": "14,600,000" }), ctxFor("construction")));
    expect(budget.programDetails?.construction?.budget).toEqual({ landCents: 240_000_000, hardCents: 1_460_000_000, softCents: 0, contingencyCents: 0, developerFeeCents: 0, financingCents: 0, reservesCents: 0 });
    const pip = parseSectionForm("hotel", form({ "programDetails.hotel.pip.budgetCents": "2,450,000" }), ctxFor("hotel_pip_bridge"));
    expect(pip.errors.map((e) => [e.label, e.message])).toEqual([["The brand requires a PIP", "answer yes or no before adding the other details"]]);
    const ok = profilePatch(parseSectionForm("hotel", form({ "programDetails.hotel.pip.required": "no" }), ctxFor("hotel_pip_bridge")));
    expect(ok.programDetails?.hotel?.pip).toEqual({ required: false });
  });

  it("parses sources and uses lines, and names an unnamed Other line", () => {
    const ctx = ctxFor("bridge");
    const p = profilePatch(parseSectionForm("sources_uses", form({ "sources.0.kind": "senior_loan", "sources.0.amount": "8,400,000", "sources.1.kind": "sponsor_equity", "sources.1.amount": "5,688,000", "uses.0.kind": "purchase_price", "uses.0.amount": "12,000,000", "uses.1.kind": "renovation", "uses.1.amount": "2,088,000", "uses.1.note": "30 units" }), ctx));
    expect(p.sources).toEqual([{ kind: "senior_loan", amountCents: 840_000_000 }, { kind: "sponsor_equity", amountCents: 568_800_000 }]);
    expect(p.uses).toEqual([{ kind: "purchase_price", amountCents: 1_200_000_000 }, { kind: "renovation", amountCents: 208_800_000, note: "30 units" }]);
    expect(p.fieldSources?.sources?.source).toBe("entered");
    const bad = parseSectionForm("sources_uses", form({ "uses.0.kind": "other", "uses.0.amount": "10,000", "sources.0.kind": "", "sources.0.amount": "5" }), ctx);
    expect(bad.errors.map((e) => e.label)).toEqual(["Sources line 1", "Uses line 1 note"]);
  });

  it("saves the sponsor section to the sponsor row, with dated stated figures and explained credit events", () => {
    const ctx = ctxFor("bridge");
    const r = parseSectionForm("sponsor", form({ "sponsor.statedNetWorthCents": "18,500,000", "sponsor.creditEvents.bankruptcy": "yes", "sponsor.creditEvents.foreclosure": "no", "sponsor.emailFinancialsMode": "rounded" }), ctx);
    expect(r.errors.map((e) => e.label)).toEqual(["Bankruptcy", "Stated as of"]);
    const ok = parseSectionForm("sponsor", form({ "sponsor.statedNetWorthCents": "18,500,000", "sponsor.statedAsOf": "2026-09-30", "sponsor.creditEvents.bankruptcy": "yes", "sponsor.creditEvents.bankruptcy.explanation": "Business chapter 11 in 2011, discharged 2013", "sponsor.emailFinancialsMode": "rounded" }), ctx);
    expect(ok.values?.target).toBe("sponsor");
    expect(ok.values?.patch).toMatchObject({ statedNetWorthCents: 1_850_000_000, statedAsOf: "2026-09-30", emailFinancialsMode: "rounded", experienceSummary: null, creditEvents: { bankruptcy: { occurred: true, explanation: "Business chapter 11 in 2011, discharged 2013" } } });
  });

  it("accepts a playbook only from the program's allowed set", () => {
    const ctx = { ...ctxFor("bank"), allowedPlaybooks: ["bank", "life_company", "cmbs", "dscr_rental", "mezz_pref", "c_pace"] as ParseContext["allowedPlaybooks"] };
    expect(profilePatch(parseSectionForm("loan_request", form({ playbook: "cmbs" }), ctx)).playbook).toBe("cmbs");
    expect(parseSectionForm("loan_request", form({ playbook: "hud_232" }), ctx).errors.map((e) => e.label)).toEqual(["Playbook"]);
  });
});
