import { describe, expect, it } from "vitest";
import { buildOrgChart, flattenChart, individualOwnership } from "./org-chart";
import { principalObligations, principalsOwing } from "./requirements";
import { principal, sampleChart } from "./test-fixtures";

describe("ownership chart", () => {
  it("multiplies ownership down the chain and passes control through the managing member", () => {
    const s = sampleChart();
    const chart = buildOrgChart(s.all);
    expect(chart.issues).toEqual([]);
    expect(chart.root?.principal.id).toBe(s.borrower.id);
    expect(chart.nodes.get(s.sponsor.id)?.effectivePct).toBe(60);
    expect(chart.nodes.get(s.ana.id)?.effectivePct).toBe(30);
    expect(chart.nodes.get(s.ben.id)?.effectivePct).toBe(30);
    expect(chart.nodes.get(s.ana.id)?.controlling).toBe(true);
    expect(chart.nodes.get(s.ben.id)?.controlling).toBe(false);
    expect(flattenChart(chart).map((n) => n.principal.legalName)).toEqual(["Harbor View Senior Living LLC", "Sponsor Holdings LLC", "Ana Ruiz", "Ben Ode", "Cal Pine", "Dee Lowe"]);
    expect(individualOwnership(chart).get(s.cal.id)).toBe(25);
  });

  it("reports over-100% ownership, broken links, owners under an individual and missing borrowers", () => {
    const s = sampleChart();
    const extra = principal({ legalName: "Eve Extra", parentId: s.borrower.id, ownershipPct: 10 });
    const orphan = principal({ legalName: "Olly Orphan", parentId: "99999999-0000-4000-8000-000000000000", ownershipPct: 5 });
    const underPerson = principal({ legalName: "Sub Person", parentId: s.cal.id, ownershipPct: 100 });
    const chart = buildOrgChart([...s.all, extra, orphan, underPerson]);
    expect(chart.issues.join("\n")).toMatch(/Harbor View Senior Living LLC: owners add up to 110%/);
    expect(chart.issues.join("\n")).toMatch(/Olly Orphan: its parent entity is not on this deal/);
    expect(chart.issues.join("\n")).toMatch(/Cal Pine is an individual and cannot have owners/);
    expect(buildOrgChart([s.ana]).issues[0]).toMatch(/No borrowing entity/);
  });

  it("detects ownership loops", () => {
    const b = principal({ legalName: "Borrower LLC", kind: "entity", roles: ["borrower_entity"] });
    const x = principal({ legalName: "X LLC", kind: "entity", parentId: b.id, ownershipPct: 50 });
    const y = principal({ legalName: "Y LLC", kind: "entity", parentId: x.id, ownershipPct: 50 });
    const xAgain = { ...x, parentId: y.id };
    const chart = buildOrgChart([b, xAgain, y]);
    expect(chart.issues.some((i) => /not connected|loops/.test(i))).toBe(true);
  });
});

describe("principal obligations", () => {
  it("SBA: 20%+ owners guarantee and complete Form 1919; controlling persons complete 1919", () => {
    const s = sampleChart();
    const ob = principalObligations(["SBA_7A"], s.all);
    expect([...ob.get(s.ana.id)!.requirements].sort()).toEqual(["credit_authorization", "form_1919", "government_id", "guaranty", "pfs", "reo_schedule", "resume"]);
    expect(ob.get(s.ben.id)!.requirements.has("guaranty")).toBe(true);
    expect(ob.get(s.cal.id)!.requirements.has("form_1919")).toBe(true);
    // 15% owner without a control role owes nothing beyond screening.
    expect(ob.get(s.dee.id)!.requirements.size).toBe(0);
    expect(ob.get(s.dee.id)!.screening).toBe(true);
    // The upper-tier entity is a managing member: it completes 1919 as a controlling person but gives no personal guaranty.
    expect(ob.get(s.sponsor.id)!.requirements.has("form_1919")).toBe(true);
    expect(ob.get(s.sponsor.id)!.requirements.has("pfs")).toBe(false);
    expect(principalsOwing("guaranty", ob).map((o) => o.legalName).sort()).toEqual(["Ana Ruiz", "Ben Ode", "Cal Pine"]);
  });

  it("HUD: non-recourse, 2530 for 25%+ and controlling participants and operators", () => {
    const s = sampleChart();
    const operator = principal({ legalName: "Care Ops Inc", kind: "entity", roles: ["operator"], parentId: s.borrower.id, ownershipPct: 0 });
    const ob = principalObligations(["HUD_232_223F"], [...s.all, operator]);
    expect(principalsOwing("guaranty", ob)).toEqual([]);
    expect(principalsOwing("hud_2530", ob).map((o) => o.legalName).sort()).toEqual(["Ana Ruiz", "Ben Ode", "Cal Pine", "Care Ops Inc", "Sponsor Holdings LLC"]);
    expect(ob.get(s.dee.id)!.requirements.has("pfs")).toBe(false);
  });

  it("a named guarantor owes the guaranty and financials whatever their share", () => {
    const s = sampleChart();
    const dee = { ...s.dee, isGuarantor: true };
    const ob = principalObligations(["BRIDGE"], [...s.all.filter((p) => p.id !== s.dee.id), dee]);
    expect(ob.get(dee.id)!.requirements.has("guaranty")).toBe(true);
    expect(ob.get(dee.id)!.requirements.has("pfs")).toBe(true);
    expect(ob.get(dee.id)!.reasons[0]).toMatch(/Named guarantor/);
  });

  it("unions requirements across a 7(a)+504 stack", () => {
    const s = sampleChart();
    const ob = principalObligations(["SBA_504", "SBA_7A"], s.all);
    expect(ob.get(s.cal.id)!.requirements.has("guaranty")).toBe(true);
  });
});
