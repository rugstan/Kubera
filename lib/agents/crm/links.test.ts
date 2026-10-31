import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { MemoryCrmLinks, supabaseCrmLinks } from "./links";

/** A chainable stand-in for the Supabase query builder that answers per table. */
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    let result = rows;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, v: unknown) => {
        result = result.filter((r) => (r as Record<string, unknown>)[col] === v);
        return b;
      },
      not: () => b,
      in: () => b,
      order: () => b,
      limit: () => Promise.resolve({ data: result, error: null }),
      maybeSingle: () => Promise.resolve({ data: result[0] ?? null, error: null }),
    };
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? []) } as unknown as SupabaseClient;
}

const DEAL = "10000000-0000-4000-8000-000000000003";
const LEAD = "20000000-0000-4000-8000-000000000003";

describe("supabaseCrmLinks", () => {
  const db = fakeDb({
    deals: [{ id: DEAL, lead_id: LEAD, twenty_opportunity_id: null, stage: "term_sheet", owner_id: "u1" }],
    leads: [{ id: LEAD, twenty_person_id: "person-1", twenty_opportunity_id: "opp-9" }],
    profiles: [{ id: "u1", email: "pat@kuberacommercial.com" }],
  });
  const links = supabaseCrmLinks(db, async () => [
    { id: "m-other", email: "lee@kuberacommercial.com" },
    { id: "m-pat", email: "Pat@KuberaCommercial.com" },
  ]);

  it("takes the opportunity from the lead when the deal row has none", async () => {
    expect(await links.forDeal(DEAL)).toEqual({ dealId: DEAL, leadId: LEAD, opportunityId: "opp-9", personId: "person-1", dealStage: "term_sheet", ownerUserId: "u1" });
    expect(await links.forDeal("missing")).toBeNull();
  });

  it("reads a lead's records", async () => {
    expect(await links.forLead(LEAD)).toMatchObject({ opportunityId: "opp-9", personId: "person-1", dealId: null });
  });

  it("matches a staff user to a Twenty member by email", async () => {
    expect(await links.memberIdForUser("u1")).toBe("m-pat");
    expect(await links.memberIdForUser("nobody")).toBeNull();
  });

  it("lists open deals that have an opportunity", async () => {
    const open = supabaseCrmLinks(fakeDb({ deals: [{ id: DEAL, lead_id: null, twenty_opportunity_id: "opp-1", stage: "closing" }] }), async () => []);
    expect(await open.openDeals(10)).toEqual([{ dealId: DEAL, leadId: null, opportunityId: "opp-1", stage: "closing" }]);
  });
});

describe("MemoryCrmLinks", () => {
  it("only lists deals with an opportunity and a stage", async () => {
    const m = new MemoryCrmLinks();
    m.deals.set("a", { dealId: "a", leadId: null, opportunityId: null, personId: null, dealStage: "intake", ownerUserId: null });
    m.deals.set("b", { dealId: "b", leadId: null, opportunityId: "o", personId: null, dealStage: "intake", ownerUserId: null });
    expect((await m.openDeals(10)).map((d) => d.dealId)).toEqual(["b"]);
  });
});
