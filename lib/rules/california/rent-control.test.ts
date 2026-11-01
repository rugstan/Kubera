import { describe, expect, it } from "vitest";
import { ab1482Region, AB1482_CAP_TABLE, LOCAL_ORDINANCES, matchLocalOrdinance } from "./rent-control-data";
import { ab1482CapPct, evaluateRentControl, newConstructionExemptionEnds, type RentControlInput } from "./rent-control";

const base: RentControlInput = { asOf: "2026-03-01", state: "CA", county: "Los Angeles", city: "Burbank", propertyType: "multifamily", units: 24, yearBuilt: 1985 };
const run = (over: Partial<RentControlInput>) => evaluateRentControl({ ...base, ...over });
const codes = (r: ReturnType<typeof run>) => r.flags.map((f) => f.code);

describe("AB 1482 cap by region and period", () => {
  it("is 5% plus regional CPI, capped at 10%", () => {
    const la = ab1482CapPct("Los Angeles", "2026-03-01");
    expect(la.capPct).toBe(8);
    expect(la.basis).toContain("5% + 3% CPI (Los Angeles area)");
    expect(ab1482CapPct("San Francisco County", "2026-03-01").capPct).toBe(7.6);
    expect(ab1482CapPct("Fresno", "2026-03-01").capPct).toBe(8); // statewide CPI
    expect(ab1482CapPct("San Diego", "2024-01-15").capPct).toBe(9.4);
  });

  it("never exceeds the 10% ceiling, including before the table starts", () => {
    const early = ab1482CapPct("Los Angeles", "2022-10-01");
    expect(early.capPct).toBe(10);
    expect(early.dataStatus).toBe("stale");
    for (const row of AB1482_CAP_TABLE) expect(Math.min(5 + row.cpiPct, 10)).toBeLessThanOrEqual(10);
  });

  it("resolves a current-date lookup to the Aug 2026 to Jul 2027 period", () => {
    const r = ab1482CapPct("Los Angeles", "2026-10-31");
    expect(r.capPct).toBe(8.1);
    expect(r.dataStatus).not.toBe("stale");
    expect(ab1482CapPct("Los Angeles", "2026-07-31").capPct).toBe(8);
    expect(ab1482CapPct("Los Angeles", "2026-08-01").capPct).toBe(8.1);
  });

  it("uses the most recent period and says so when the table is out of date", () => {
    const r = ab1482CapPct("Los Angeles", "2027-09-01");
    expect(r.capPct).toBe(8.1);
    expect(r.dataStatus).toBe("stale");
  });

  it("maps counties to BLS areas", () => {
    expect(ab1482Region("Orange County")).toBe("los_angeles");
    expect(ab1482Region("Alameda")).toBe("san_francisco");
    expect(ab1482Region("riverside")).toBe("inland_empire");
    expect(ab1482Region("Fresno")).toBe("california");
    expect(ab1482Region(undefined)).toBe("california");
  });

  it("has a row for every region in every loaded period", () => {
    const periods = new Set(AB1482_CAP_TABLE.map((r) => r.effectiveFrom));
    for (const p of periods) expect(AB1482_CAP_TABLE.filter((r) => r.effectiveFrom === p)).toHaveLength(5);
  });
});

describe("AB 1482 regime", () => {
  it("caps increases and applies just cause for a post-1978 building outside any local ordinance", () => {
    const r = run({ currentRent: 2000 });
    expect(r).toMatchObject({ regime: "ab1482", annualCapPct: 8, justCause: true, vacancyReset: "allowed", maxNextRent: 2160 });
    expect(r.authorities).toEqual(expect.arrayContaining(["Civ. Code §1947.12", "Civ. Code §1946.2", "Civ. Code §1954.53(a)"]));
    expect(codes(r)).toContain("cap_table_unverified");
  });

  it("flags a stale table when the as-of date is past the loaded periods", () => {
    const r = run({ asOf: "2027-09-01" });
    expect(r.dataStatus).toBe("stale");
    expect(codes(r)).toContain("cap_table_stale");
    expect(codes(run({ asOf: "2026-10-31" }))).not.toContain("cap_table_stale");
  });

  it("is silent about the sunset until the date arrives, then flags it", () => {
    expect(codes(run({ asOf: "2029-12-31" }))).not.toContain("ab1482_sunset");
    const r = run({ asOf: "2030-01-01" });
    expect(r).toMatchObject({ regime: "ab1482_sunset", annualCapPct: null });
    expect(codes(r)).toContain("ab1482_sunset");
  });
});

describe("15-year rolling new-construction exemption", () => {
  it("exempts a building completed within 15 years of the as-of date", () => {
    const r = run({ yearBuilt: 2018 });
    expect(r).toMatchObject({ regime: "exempt", annualCapPct: null, justCause: false });
    expect(r.exemptions[0]).toMatchObject({ code: "new_construction_15yr", scope: "ab1482" });
  });

  it("rolls: the same building loses the exemption as time passes", () => {
    const cert = "2015-06-15";
    expect(run({ certificateOfOccupancyDate: cert, asOf: "2030-06-14" }).regime).toBe("ab1482_sunset"); // after sunset
    expect(run({ certificateOfOccupancyDate: cert, asOf: "2029-06-14" }).regime).toBe("exempt");
    expect(run({ certificateOfOccupancyDate: cert, asOf: "2029-06-15" }).regime).toBe("exempt");
    expect(newConstructionExemptionEnds(cert)).toBe("2030-06-15");
    expect(run({ certificateOfOccupancyDate: "2011-02-01", asOf: "2026-03-01" }).regime).toBe("ab1482");
    expect(run({ certificateOfOccupancyDate: "2011-06-15", asOf: "2026-03-01" }).regime).toBe("exempt");
    // The same building on either side of its 15th anniversary.
    expect(run({ certificateOfOccupancyDate: "2011-06-15", asOf: "2026-06-14" }).regime).toBe("exempt");
    expect(run({ certificateOfOccupancyDate: "2011-06-15", asOf: "2026-06-15" }).regime).toBe("ab1482");
  });

  it("treats a year-only date that straddles the line as not exempt and says why", () => {
    const r = run({ yearBuilt: 2011 });
    expect(r.regime).toBe("ab1482");
    expect(codes(r)).toContain("exemption_date_uncertain");
  });

  it("applies the cap, with a flag, when the year built is unknown", () => {
    const r = run({ yearBuilt: undefined });
    expect(r.regime).toBe("ab1482");
    expect(codes(r)).toContain("coverage_year_unknown");
  });
});

describe("single-family and condominium exemption", () => {
  const sfr = { propertyType: "single_family" as const, units: 1, yearBuilt: 1960 };

  it("exempts an individually owned home with the written notice", () => {
    const r = run({ ...sfr, owner: { type: "natural_person" }, exemptionNoticeGiven: true });
    expect(r).toMatchObject({ regime: "exempt", annualCapPct: null });
    expect(r.exemptions.map((e) => e.code)).toContain("sfr_condo");
  });

  it("keeps the cap without the notice, and flags the missing notice", () => {
    const r = run({ ...sfr, owner: { type: "trust" } });
    expect(r.regime).toBe("ab1482");
    expect(codes(r)).toContain("sfr_exemption_notice_required");
  });

  it.each(["reit", "corporation", "llc_with_corporate_member"] as const)("does not exempt a %s owner even with notice", (type) => {
    const r = run({ ...sfr, propertyType: "condominium", owner: { type }, exemptionNoticeGiven: true });
    expect(r.regime).toBe("ab1482");
    expect(codes(r)).not.toContain("sfr_exemption_notice_required");
  });

  it("flags an unknown owner type instead of guessing", () => {
    const r = run({ ...sfr, owner: { type: "unknown" }, exemptionNoticeGiven: true });
    expect(r.regime).toBe("ab1482");
    expect(codes(r)).toContain("owner_type_unknown");
  });

  it("does not exempt a home that is not separately alienable", () => {
    expect(run({ ...sfr, owner: { type: "natural_person" }, exemptionNoticeGiven: true, separatelyAlienable: false }).regime).toBe("ab1482");
  });
});

describe("other AB 1482 exemptions", () => {
  it("exempts an owner-occupied duplex", () => {
    expect(run({ propertyType: "duplex", units: 2, ownerOccupiedDuplex: true }).regime).toBe("exempt");
    expect(run({ propertyType: "duplex", units: 2, ownerOccupiedDuplex: false }).regime).toBe("ab1482");
  });

  it("defers to the regulatory agreement for deed-restricted affordable housing", () => {
    const r = run({ deedRestrictedAffordable: true });
    expect(r).toMatchObject({ regime: "regulatory_agreement", annualCapPct: null, vacancyReset: "not_allowed" });
  });

  it("exempts dormitories", () => {
    expect(run({ dormitory: true }).regime).toBe("exempt");
  });
});

describe("City of Los Angeles RSO", () => {
  const la = { city: "Los Angeles", yearBuilt: 1972, asOf: "2026-10-31" };

  it("applies the 3% cap to a pre-October-1978 building and lets rent reset on vacancy", () => {
    const r = run({ ...la, currentRent: 2000 });
    expect(r).toMatchObject({ regime: "local_ordinance", annualCapPct: 3, vacancyReset: "allowed", justCause: true, maxNextRent: 2060 });
    expect(r.localOrdinance?.id).toBe("la_rso");
    expect(r.authorities).toEqual(expect.arrayContaining(["LAMC §151.00 et seq.", "Civ. Code §1954.53(a)"]));
    expect(r.dataStatus).toBe("unverified");
  });

  it("treats the cutoff date exactly: on or before Oct 1, 1978 is covered", () => {
    expect(run({ ...la, yearBuilt: undefined, certificateOfOccupancyDate: "1978-10-01" }).regime).toBe("local_ordinance");
    expect(run({ ...la, yearBuilt: undefined, certificateOfOccupancyDate: "1978-10-02" }).regime).toBe("ab1482");
  });

  it("treats the cutoff year as covered but flags the uncertainty", () => {
    const r = run({ ...la, yearBuilt: 1978 });
    expect(r.regime).toBe("local_ordinance");
    expect(codes(r)).toContain("coverage_date_uncertain");
  });

  it("falls back to AB 1482 for a building after the cutoff", () => {
    const r = run({ ...la, yearBuilt: 1985 });
    expect(r.regime).toBe("ab1482");
    expect(r.exemptions).toEqual([expect.objectContaining({ code: "local_cutoff", scope: "local" })]);
    expect(r.annualCapPct).toBe(8.1);
  });

  it("applies the 15-year exemption on top for a new LA building", () => {
    const r = run({ ...la, yearBuilt: 2020 });
    expect(r.regime).toBe("exempt");
    expect(r.exemptions.map((e) => e.code)).toEqual(["local_cutoff", "new_construction_15yr"]);
  });

  it("exempts an LA single-family home from the RSO (Costa-Hawkins) but not from AB 1482 without notice", () => {
    const r = run({ ...la, propertyType: "single_family", owner: { type: "natural_person" } });
    expect(r.regime).toBe("ab1482");
    expect(r.exemptions.map((e) => e.code)).toEqual(["costa_hawkins_sfr_condo"]);
    expect(run({ ...la, propertyType: "condominium", owner: { type: "natural_person" }, exemptionNoticeGiven: true }).regime).toBe("exempt");
  });

  it("covers an unknown build year conservatively and says so", () => {
    const r = run({ ...la, yearBuilt: undefined });
    expect(r.regime).toBe("local_ordinance");
    expect(codes(r)).toContain("coverage_year_unknown");
  });

  it("reports a missing cap period instead of inventing a number", () => {
    const r = run({ ...la, asOf: "2025-01-01" });
    expect(r).toMatchObject({ regime: "local_ordinance", annualCapPct: null, dataStatus: "stale" });
  });
});

describe("Los Angeles County RSTPO", () => {
  const county = { city: undefined, county: "Los Angeles County", unincorporated: true, yearBuilt: 1990 };

  it("applies to unincorporated buildings with a certificate of occupancy by Feb 1, 1995 and shows the floor", () => {
    const r = run(county);
    expect(r).toMatchObject({ regime: "local_ordinance", annualCapPct: 3 });
    expect(r.localOrdinance?.id).toBe("la_county_rstpo");
    expect(codes(r)).toContain("local_cap_is_minimum");
  });

  it("does not apply to newer buildings (Costa-Hawkins) or to incorporated cities", () => {
    expect(run({ ...county, yearBuilt: 2000 }).regime).toBe("ab1482");
    expect(run({ ...county, city: "Burbank", unincorporated: false }).regime).toBe("ab1482");
  });

  it("matches ordinances by jurisdiction", () => {
    expect(matchLocalOrdinance({ city: "Los Angeles" })?.id).toBe("la_rso");
    expect(matchLocalOrdinance({ county: "Los Angeles", unincorporated: true })?.id).toBe("la_county_rstpo");
    expect(matchLocalOrdinance({ county: "Los Angeles", city: "Burbank" })).toBeUndefined();
    expect(LOCAL_ORDINANCES.every((o) => o.capRows.length > 0)).toBe(true);
  });
});

describe("cities with an ordinance this engine does not model", () => {
  it("returns the AB 1482 figure as an upper bound with a manual-review flag", () => {
    const r = run({ city: "San Francisco", county: "San Francisco", yearBuilt: 1960 });
    expect(r).toMatchObject({ regime: "local_unmodeled", annualCapPct: 7.6, capIsUpperBound: true });
    expect(codes(r)).toContain("local_ordinance_unmodeled");
    expect(r.capBasis).toContain("upper bound");
  });

  it("does not flag a single-family home there as covered", () => {
    const r = run({ city: "Oakland", county: "Alameda", propertyType: "single_family", owner: { type: "natural_person" } });
    expect(r.regime).toBe("ab1482");
  });
});

describe("scope and input checks", () => {
  it("does not apply California rules elsewhere", () => {
    expect(run({ state: "NV" })).toMatchObject({ regime: "not_california", annualCapPct: null });
  });

  it("rejects malformed dates", () => {
    expect(() => run({ asOf: "03/01/2026" })).toThrow(RangeError);
    expect(() => run({ asOf: "2026-02-30" })).toThrow(RangeError);
    expect(run({ asOf: new Date("2026-03-01T00:00:00Z") }).regime).toBe("ab1482");
  });

  it("is deterministic", () => {
    expect(run({ currentRent: 1500 })).toEqual(run({ currentRent: 1500 }));
  });
});
