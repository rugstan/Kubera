import { describe, expect, it } from "vitest";
import { FakeDeedClient, FakeEntityClient, FakeFloodClient, FakeParcelClient, FakeRentCompClient } from "./fakes";
import { ADDRESS, DEED, FLOOD_X, PARCEL, RENT_COMPS } from "./fixtures";
import { getPropertyFacts } from "./property-facts";
import { evaluateRentControlForFacts, inferOwnerType, inferPropertyType, prop13InputFromFacts, rentControlInputFromFacts } from "./rules-bridge";
import { NO_CLIENTS } from "./clients";
import { estimateReassessment } from "@/lib/rules/california/prop13";

const now = () => new Date("2026-03-01T12:00:00Z");

async function facts(parcel = PARCEL, deed = DEED) {
  return getPropertyFacts(ADDRESS, {
    now,
    clients: {
      ...NO_CLIENTS,
      regrid: new FakeParcelClient().set(ADDRESS, parcel),
      attom: new FakeDeedClient().set(ADDRESS, deed),
      opencorporates: new FakeEntityClient(),
      fema: new FakeFloodClient().set(PARCEL.coordinates!, FLOOD_X),
      hellodata: new FakeRentCompClient().set(ADDRESS, RENT_COMPS),
    },
  });
}

describe("inference helpers", () => {
  it("infers property type from units and use", async () => {
    expect(inferPropertyType(await facts())).toBe("multifamily");
    expect(inferPropertyType(await facts({ ...PARCEL, units: 1, useDescription: "Single family residence" }, { ...DEED, units: undefined }))).toBe("single_family");
    expect(inferPropertyType(await facts({ ...PARCEL, units: 2 }, { ...DEED, units: undefined }))).toBe("duplex");
    expect(inferPropertyType(await facts({ ...PARCEL, units: 1, useDescription: "Condominium" }, { ...DEED, units: undefined }))).toBe("condominium");
  });

  it("maps owner names to owner types, leaving LLCs unknown on purpose", () => {
    expect(inferOwnerType("Wilshire Holdings LLC")).toBe("unknown");
    expect(inferOwnerType("Acme Realty Inc")).toBe("corporation");
    expect(inferOwnerType("Pacific Apartment REIT")).toBe("reit");
    expect(inferOwnerType("Smith Family Trust")).toBe("trust");
    expect(inferOwnerType("Olive Partners LP")).toBe("partnership");
    expect(inferOwnerType("John Q Smith")).toBe("natural_person");
    expect(inferOwnerType(undefined)).toBe("unknown");
  });
});

describe("property facts to California rules", () => {
  it("evaluates rent control straight from a property lookup", async () => {
    const f = await facts();
    const input = rentControlInputFromFacts(f, "2026-03-01");
    expect(input).toMatchObject({ county: "Los Angeles", city: "Los Angeles", yearBuilt: 1972, units: 24, propertyType: "multifamily", state: "CA" });
    const r = evaluateRentControlForFacts(f, "2026-03-01");
    expect(r.regime).toBe("local_ordinance"); // pre-1978 City of LA building; the 2026-27 RSO row starts July 1
    expect(r.localOrdinance?.id).toBe("la_rso");
  });

  it("lets lease and rent-roll facts override inferred ones", async () => {
    const f = await facts();
    const r = evaluateRentControlForFacts(f, "2026-08-01", { certificateOfOccupancyDate: "2020-05-01" });
    expect(r.regime).toBe("exempt");
  });

  it("does not apply California rules to an out-of-state property", async () => {
    const reno = { line1: "10 Virginia St", city: "Reno", state: "NV", zip: "89501" };
    const f = await getPropertyFacts(reno, { now, clients: { ...NO_CLIENTS, regrid: new FakeParcelClient().set(reno, { ...PARCEL, state: "NV", coordinates: { lat: 39.5, lon: -119.8 } }) } });
    expect(evaluateRentControlForFacts(f, "2026-03-01").regime).toBe("not_california");
  });

  it("feeds the assessed value into the Prop 13 estimator", async () => {
    const f = await facts();
    const input = prop13InputFromFacts(f, { purchasePrice: 5_000_000, eventDate: "2026-10-15", totalLevyRatePct: 1.2 });
    expect(input?.currentAssessedValue).toBe(2_450_000);
    expect(estimateReassessment(input!).annualTaxAfter).toBe(60_000);
    const noAssessment = await getPropertyFacts(ADDRESS, { now, clients: NO_CLIENTS });
    expect(prop13InputFromFacts(noAssessment, { purchasePrice: 1, eventDate: "2026-10-15" })).toBeNull();
  });
});
