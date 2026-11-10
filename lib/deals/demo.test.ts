import { afterEach, describe, expect, it } from "vitest";
import { DEMO_PIPELINE } from "@/app/(staff)/pipeline/demo";
import { createDealChecklist, syncDealPrincipalItems } from "@/lib/checklists/service";
import { addPrincipal } from "@/lib/principals/service";
import { DEMO_PORTAL_SESSION_SECRET, portalSessionSecret } from "@/lib/principals/portal";
import { screenDeal } from "@/lib/screening/service";
import { dealStatusHoldSink } from "./holds";
import { DEMO_LENDER_ACCOUNT, DEMO_LENDER_IDS, DEMO_SANCTIONED_NAME, demoDesks, resetDemoDesks } from "./demo";
import { openLenderAccountNumber } from "./lender-accounts";
import { panelForDeal } from "./lenders";
import { deriveLenderLoanTypes } from "./loan-types";
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
    const moved = await advanceDeal(deps, { dealId, event: "packaging_started", actor: "staff:broker@corin.test" });
    expect(moved.ok).toBe(true);
    expect(moved.deal.stage).toBe("packaging");

    await createDealChecklist(checklist, { dealId, program: "CONSTRUCTION", createdBy: "broker@corin.test" });
    const pdeps = { principals: d.principals, keyring: d.keyring, now };
    const entity = await addPrincipal(pdeps, { dealId, kind: "entity", legalName: "Coastal Example Builders LLC", roles: ["borrower_entity"] });
    await addPrincipal(pdeps, { dealId, parentId: entity.principal.id, kind: "individual", legalName: DEMO_SANCTIONED_NAME, roles: ["managing_member"], ownershipPct: 100 });
    await syncDealPrincipalItems(checklist, dealId);
    const sink = dealStatusHoldSink({ store: d.deals, holds: d.holds, now });
    await screenDeal({ client: d.sanctions, screenings: d.screenings, holds: d.holds, principals: d.principals, keyring: d.keyring, sink, now }, { dealId, purpose: "initial", requestedBy: "broker@corin.test" });

    expect((await d.holds.active(dealId)).length).toBeGreaterThan(0);
    expect((await d.deals.getDeal(dealId))!.status).toBe("on_hold");
    const blocked = await advanceDeal(deps, { dealId, event: "package_sent", actor: "staff:broker@corin.test" });
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

  it("gives the demo bank a primary contact as its submission recipient, and a sealed broker ID", async () => {
    const d = demoDesks(FAKE)!;
    const bank = (await d.deals.getLender(DEMO_LENDER_IDS.bank))!;
    expect(bank).toMatchObject({ primaryContactName: "Demo Lender Contact", contactName: "Demo Lender Contact", contactEmail: "lending@bank.example", mainPhone: "+13105550100", submissionEmail: "submissions@bank.example" });
    expect((await d.deals.getLender(DEMO_LENDER_IDS.privateFund))!.contactEmail).toBe("deals@fund.example");
    const accounts = await d.deals.listLenderAccounts(DEMO_LENDER_IDS.bank);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: DEMO_LENDER_ACCOUNT.id, kind: "broker_id", label: "Broker ID", numberLast4: "0937" });
    for (const a of accounts) expect(Object.keys(a)).not.toContain("numberEnc");
    const secret = (await d.deals.getLenderAccountSecret(DEMO_LENDER_IDS.bank, DEMO_LENDER_ACCOUNT.id))!;
    expect(openLenderAccountNumber(secret, demoDesks(FAKE)!.keyring)).toBe("DEMO-BRK-48210937");
  });

  it("tags each demo lender with the loan types its own fields derive, and keeps the DSCR lender out of matching", async () => {
    const d = demoDesks(FAKE)!;
    const lenders = await d.deals.listLenders();
    expect(lenders.map((l) => l.name)).toContain("Sample DSCR Lender (demo)");
    for (const l of lenders) expect(l.loanTypes, l.name).toEqual(deriveLenderLoanTypes({ programs: l.programs, category: l.category, appetiteNotes: l.appetiteNotes, assetTypes: l.assetTypes, boxNotes: [] }));
    const dscr = (await d.deals.getLender(DEMO_LENDER_IDS.dscrFund))!;
    expect(dscr).toMatchObject({ active: false, programs: [], loanTypes: ["fix_flip", "dscr"], contactEmail: null, mainPhone: null });
    const now = new Date("2026-11-04T18:00:00.000Z");
    for (const deal of await d.deals.listDeals()) {
      expect(panelForDeal(lenders, deal, now).map((m) => m.lender.id), deal.title).not.toContain(DEMO_LENDER_IDS.dscrFund);
    }
  });
});
