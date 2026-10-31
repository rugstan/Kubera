// Server-renders the deal desk sections and the portal profile form with
// fixture data, so markup problems (labels, ids, restricted data leaking into
// HTML) show up in unit tests rather than only against a live database.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), redirect: () => {} }));
vi.mock("../actions", () => {
  const fn = async () => {};
  return { moveItemAction: fn, recordCslbAction: fn, addConditionAction: fn, moveConditionAction: fn, addPrincipalAction: fn, removePrincipalAction: fn, runScreeningAction: fn, dispositionAction: fn, saveHmAction: fn, issueInviteAction: fn, signIn: fn };
});

import { memoryDesk } from "@/lib/checklists/fakes";
import { checklistDeps, screeningDeps } from "@/lib/checklists/desk";
import { addCondition, createDealChecklist, dealClosingGate, saveHmUnderwriting, syncDealPrincipalItems } from "@/lib/checklists/service";
import { buildOrgChart } from "@/lib/principals/org-chart";
import { principalObligations } from "@/lib/principals/requirements";
import { addPrincipal, toPublicPrincipal } from "@/lib/principals/service";
import { DEAL_ID } from "@/lib/principals/test-fixtures";
import { screenDeal } from "@/lib/screening/service";
import { ProfileForm } from "@/app/(portal)/portal/_components/ProfileForm";
import { portalPrincipalView } from "@/app/(portal)/portal/_lib/profile";
import { FORM_1919_QUESTIONS } from "@/lib/principals/types";
import { buildForm1919Prefill } from "@/lib/principals/form1919";
import { ConditionsSection } from "./ConditionsSection";
import { Form1919Section } from "./Form1919Section";
import { HardMoneySection } from "./HardMoneySection";
import { ItemsSection } from "./ItemsSection";
import { PrincipalsSection, type PrincipalView } from "./PrincipalsSection";
import { ScreeningSection } from "./ScreeningSection";

const NOW = new Date("2026-11-03T12:00:00Z");

async function fixture() {
  const desk = memoryDesk({ sanctions: [{ entryId: "SDN-1", name: "Ivan Petrov", kind: "individual" }], now: () => NOW });
  const deps = checklistDeps(desk);
  const pdeps = { principals: desk.principals, keyring: desk.keyring, now: () => NOW };
  await createDealChecklist(deps, { dealId: DEAL_ID, program: "HARD_MONEY", createdBy: "broker@k.com" });
  const b = await addPrincipal(pdeps, { dealId: DEAL_ID, kind: "entity", legalName: "Flip Co LLC", roles: ["borrower_entity"] });
  const ivan = await addPrincipal(pdeps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ivan Petrov", roles: ["managing_member"], ownershipPct: 100, email: "ivan@example.com" }, { ssn: "123-45-6789", dob: "1970-04-01" });
  await syncDealPrincipalItems(deps, DEAL_ID);
  await screenDeal(screeningDeps(desk), { dealId: DEAL_ID, purpose: "initial", requestedBy: "broker@k.com" });
  await addCondition(deps, { dealId: DEAL_ID, source: "lender", lenderName: "Rehab Capital", timing: "prior_to_closing", description: "Signed scope of work", responsible: "borrower" }, "broker@k.com");
  await saveHmUnderwriting(deps, { dealId: DEAL_ID, strategy: "FIX_AND_FLIP", purpose: "PURCHASE", purchasePrice: 400_000, asIsValue: 400_000, arv: 650_000, arvSource: "bpo", requestedLoanAmount: 420_000, contingencyPct: 10, scopeOfWork: [{ category: "roof", description: "Re-roof", cost: 30_000, weeks: 2, licensedTrade: true }], trackRecord: [], exitPlan: { type: "sale", targetMonths: 9 } }, "broker@k.com", null);
  return { desk, deps, ivan: ivan.principal };
}

describe("deal desk sections", () => {
  it("render every section with labelled controls and no restricted values", async () => {
    const { desk, deps } = await fixture();
    const gate = await dealClosingGate(deps, DEAL_ID);
    const [checklist] = await desk.checklists.checklistsForDeal(DEAL_ID);
    const items = await desk.checklists.itemsForDeal(DEAL_ID);
    const principals = (await desk.principals.forDeal(DEAL_ID)).map(toPublicPrincipal);
    const chart = buildOrgChart(principals);
    const views = new Map<string, PrincipalView>(principals.map((p) => [p.id, { principal: p, pfs: null, reo: null, flags: [] }]));
    const html = [
      renderToStaticMarkup(createElement(ItemsSection, { checklist: checklist!, readiness: gate.checklists[0]!.readiness, items, files: [], now: NOW })),
      renderToStaticMarkup(createElement(ConditionsSection, { dealId: DEAL_ID, conditions: await desk.checklists.conditionsForDeal(DEAL_ID), items })),
      renderToStaticMarkup(createElement(PrincipalsSection, { dealId: DEAL_ID, chart, views, obligations: principalObligations(["HARD_MONEY"], principals, chart), canEdit: true })),
      renderToStaticMarkup(createElement(ScreeningSection, { dealId: DEAL_ID, gate: gate.screening, screenings: await desk.screenings.forDeal(DEAL_ID), holds: await desk.holds.active(DEAL_ID), configured: true })),
      renderToStaticMarkup(createElement(HardMoneySection, { dealId: DEAL_ID, file: await desk.checklists.getHmUnderwriting(DEAL_ID) })),
    ].join("\n");

    expect(html).toContain("Hard money document checklist");
    expect(html).toContain("This deal is on hold.");
    expect(html).toContain("Review: Ivan Petrov");
    expect(html).toContain("Tax id on file (encrypted)");
    expect(html).toContain("Signed scope of work");
    expect(html).toContain("roof | Re-roof | 30000 | 2 | yes");
    expect(html).not.toContain("123456789");
    expect(html).not.toContain("1970-04-01");
    // Every input, select and textarea has a matching <label for>.
    const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
    const labels = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]!));
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.filter((id) => !labels.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Form 1919 prefill section", () => {
  it("lists owners with presence-only tax id and birth date", async () => {
    const { desk } = await fixture();
    const principals = (await desk.principals.forDeal(DEAL_ID)).map(toPublicPrincipal);
    const html = renderToStaticMarkup(createElement(Form1919Section, { prefill: buildForm1919Prefill({ principals, deal: { loanAmount: 500_000 }, answers: new Map() }) }));
    expect(html).toContain("Ivan Petrov");
    expect(html).toContain("on file / on file");
    expect(html).toContain("Eligibility questions");
    expect(html).not.toContain("123456789");
  });
});

describe("portal profile form", () => {
  it("renders the owed sections and shows only presence for restricted data", async () => {
    const { ivan } = await fixture();
    const html = renderToStaticMarkup(
      createElement(ProfileForm, { initial: portalPrincipalView(ivan), sections: { pfs: true, reo: true, hud2530: true, form1919: true, credit: true }, questions: { ...FORM_1919_QUESTIONS }, creditText: "I authorize…", creditVersion: "credit-auth-2026-11-01" }),
    );
    expect(html).toContain("Notice at collection.");
    expect(html).toContain("Your tax id and date of birth are on file (encrypted).");
    expect(html).toContain("Personal financial statement");
    expect(html).toContain("Previous participation (HUD-2530)");
    expect(html).toContain("SBA eligibility questions (Form 1919)");
    expect(html).toContain("Sign authorization");
    expect(html).not.toContain("6789");
    const ids = [...html.matchAll(/<(?:input|select|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
