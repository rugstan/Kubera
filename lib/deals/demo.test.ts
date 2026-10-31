import { afterEach, describe, expect, it } from "vitest";
import { DEMO_PIPELINE } from "@/app/(staff)/pipeline/demo";
import { createDealChecklist, syncDealPrincipalItems } from "@/lib/checklists/service";
import { addPrincipal } from "@/lib/principals/service";
import { DEMO_PORTAL_SESSION_SECRET, portalSessionSecret } from "@/lib/principals/portal";
import { screenDeal } from "@/lib/screening/service";
import { dealStatusHoldSink } from "./holds";
import { DEMO_SANCTIONED_NAME, demoDesks, resetDemoDesks } from "./demo";
import { advanceDeal } from "./service";
import { availableEvents, stageTemplate } from "./stages";

const FAKE = { AUTH_PROVIDER: "fake" };

afterEach(() => resetDemoDesks());

describe("demo desks", () => {
  it("exist only in fake-auth mode, never with the service role or in production", () => {
    expect(demoDesks({})).toBeNull();
    expect(demoDesks({ AUTH_PROVIDER: "supabase" })).toBeNull();
    expect(demoDesks({ ...FAKE, SUPABASE_SERVICE_ROLE_KEY: "service-role" })).toBeNull();
    expect(demoDesks({ ...FAKE, VERCEL_ENV: "production" })).toBeNull();
    expect(demoDesks(FAKE)).not.toBeNull();
  });

  it("is one shared bundle per process", () => {
    expect(demoDesks(FAKE)).toBe(demoDesks(FAKE));
  });

  it("seeds a deal for every demo pipeline row, on a stage its program's template has", async () => {
    const { deals } = demoDesks(FAKE)!;
    for (const row of DEMO_PIPELINE) {
      const deal = await deals.getDeal(row.id);
      expect(deal, row.name).not.toBeNull();
      expect(deal!.title).toBe(row.name);
      expect(stageTemplate(deal!.program).stages.map((s) => s.key)).toContain(deal!.stage);
      expect(deal!.status).toBe(row.status);
    }
    expect((await deals.listLenders({ activeOnly: true })).length).toBeGreaterThan(0);
  });

  it("advances a demo deal and pauses it when a principal matches the demo sanctions list", async () => {
    const d = demoDesks(FAKE)!;
    const now = () => new Date("2026-11-04T18:00:00.000Z");
    const dealId = DEMO_PIPELINE.find((r) => r.stage === "engaged")!.id;
    const checklist = { checklists: d.checklists, principals: d.principals, screenings: d.screenings, holds: d.holds, vault: null, now };
    const deps = { store: d.deals, disclosures: d.disclosures, now, checklist };

    const deal = (await d.deals.getDeal(dealId))!;
    expect(availableEvents(stageTemplate(deal.program), deal.stage).map((e) => e.key)).toContain("packaging_started");
    const moved = await advanceDeal(deps, { dealId, event: "packaging_started", actor: "staff:broker@kubera.test" });
    expect(moved.ok).toBe(true);
    expect(moved.deal.stage).toBe("packaging");

    await createDealChecklist(checklist, { dealId, program: "CONSTRUCTION", createdBy: "broker@kubera.test" });
    const pdeps = { principals: d.principals, keyring: d.keyring, now };
    const entity = await addPrincipal(pdeps, { dealId, kind: "entity", legalName: "Coastal Example Builders LLC", roles: ["borrower_entity"] });
    await addPrincipal(pdeps, { dealId, parentId: entity.principal.id, kind: "individual", legalName: DEMO_SANCTIONED_NAME, roles: ["managing_member"], ownershipPct: 100 });
    await syncDealPrincipalItems(checklist, dealId);
    const sink = dealStatusHoldSink({ store: d.deals, holds: d.holds, now });
    await screenDeal({ client: d.sanctions, screenings: d.screenings, holds: d.holds, principals: d.principals, keyring: d.keyring, sink, now }, { dealId, purpose: "initial", requestedBy: "broker@kubera.test" });

    expect((await d.holds.active(dealId)).length).toBeGreaterThan(0);
    expect((await d.deals.getDeal(dealId))!.status).toBe("on_hold");
    const blocked = await advanceDeal(deps, { dealId, event: "package_sent", actor: "staff:broker@kubera.test" });
    expect(blocked.ok).toBe(false);
  });
});

describe("portal session secret", () => {
  it("prefers PORTAL_SESSION_SECRET, falls back to the public demo secret only in fake-auth mode", () => {
    const real = "x".repeat(40);
    expect(portalSessionSecret({ PORTAL_SESSION_SECRET: real, ...FAKE })).toBe(real);
    expect(portalSessionSecret(FAKE)).toBe(DEMO_PORTAL_SESSION_SECRET);
    expect(portalSessionSecret({})).toBeNull();
    expect(portalSessionSecret({ ...FAKE, VERCEL_ENV: "production" })).toBeNull();
    expect(portalSessionSecret({ PORTAL_SESSION_SECRET: "short" })).toBeNull();
  });
});
