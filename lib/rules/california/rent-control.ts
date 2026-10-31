import { addYears, latestRowBefore, round2, rowFor, toIsoDate, type DateInput } from "./dates";
import {
  AB1482,
  AB1482_CAP_TABLE,
  COSTA_HAWKINS_NEW_CONSTRUCTION_DATE,
  ab1482Region,
  isUnmodeledRentControlCity,
  matchLocalOrdinance,
  type Ab1482Region,
  type LocalOrdinance,
} from "./rent-control-data";

// California residential rent-control engine: AB 1482 (Civ. Code §1947.12),
// Costa-Hawkins (Civ. Code §1954.50 et seq.), the City of Los Angeles RSO and
// the LA County RSTPO. Pure: facts and an `asOf` date in, a decision out.
//
// This is underwriting guidance, not legal advice. It never concludes that a
// specific tenancy is lawfully priced; it reports which regime most likely
// governs, the annual cap that follows, and what to confirm.

export type RentControlPropertyType = "single_family" | "condominium" | "duplex" | "multifamily";

export type OwnerType = "natural_person" | "trust" | "partnership" | "llc" | "llc_with_corporate_member" | "corporation" | "reit" | "unknown";

export type RentControlInput = {
  asOf: DateInput;
  /** Two-letter state; anything but CA returns `not_california`. */
  state?: string;
  county?: string;
  city?: string;
  /** True for unincorporated county land (relevant to the LA County ordinance). Defaults to true when no city is given. */
  unincorporated?: boolean;
  propertyType: RentControlPropertyType;
  units?: number;
  yearBuilt?: number;
  /** Exact certificate-of-occupancy date, when known; beats yearBuilt. */
  certificateOfOccupancyDate?: DateInput;
  owner?: { type: OwnerType };
  /** A SFR/condo is separately alienable from any other dwelling (default true). */
  separatelyAlienable?: boolean;
  /** Tenants received the written exemption notice required for the SFR/condo exemption. */
  exemptionNoticeGiven?: boolean;
  /** Owner lives in one unit of a duplex as principal residence. */
  ownerOccupiedDuplex?: boolean;
  /** Rents restricted by a recorded covenant or regulatory agreement (LIHTC, HUD, density bonus). */
  deedRestrictedAffordable?: boolean;
  dormitory?: boolean;
  currentRent?: number;
};

export type RentControlRegime = "not_california" | "local_ordinance" | "local_unmodeled" | "ab1482" | "ab1482_sunset" | "exempt" | "regulatory_agreement";

export type RentControlFlagCode =
  | "cap_table_stale"
  | "cap_table_unverified"
  | "coverage_year_unknown"
  | "coverage_date_uncertain"
  | "exemption_date_uncertain"
  | "sfr_exemption_notice_required"
  | "owner_type_unknown"
  | "local_ordinance_unmodeled"
  | "local_cap_is_minimum"
  | "ab1482_sunset";

export type RentControlFlag = { code: RentControlFlagCode; message: string };

/** `scope` says what the exemption lifts: local control, or the AB 1482 cap. */
export type Exemption = { code: string; reason: string; authority: string; scope: "local" | "ab1482" };

export type RentControlResult = {
  regime: RentControlRegime;
  /** Maximum annual rent increase, percent. Null when no cap applies. For `local_unmodeled` it is an upper bound. */
  annualCapPct: number | null;
  capIsUpperBound: boolean;
  /** What the cap is: "AB 1482: 5% + 3.0% CPI (Los Angeles area)" and so on. */
  capBasis: string;
  maxNextRent?: number;
  /** May rent reset to market when a tenant voluntarily vacates (Costa-Hawkins, Civ. Code §1954.53)? */
  vacancyReset: "allowed" | "not_allowed" | "not_applicable";
  /** Just-cause eviction protections apply (Civ. Code §1946.2). */
  justCause: boolean;
  exemptions: Exemption[];
  flags: RentControlFlag[];
  reasons: string[];
  authorities: string[];
  dataStatus: "verified" | "unverified" | "stale";
  localOrdinance?: { id: LocalOrdinance["id"]; label: string };
};

const REIT_OR_CORPORATE: ReadonlySet<OwnerType> = new Set(["reit", "corporation", "llc_with_corporate_member"]);

type CoverageTest = "covered" | "not_covered" | "uncertain" | "unknown";

/**
 * Is the building's certificate of occupancy on or before `cutoff`?
 * With only a year built, the answer can be uncertain inside the cutoff year.
 */
function coOnOrBefore(input: RentControlInput, cutoff: string): CoverageTest {
  if (input.certificateOfOccupancyDate) return toIsoDate(input.certificateOfOccupancyDate) <= cutoff ? "covered" : "not_covered";
  if (input.yearBuilt === undefined) return "unknown";
  const y = input.yearBuilt;
  if (`${y}-12-31` <= cutoff) return "covered";
  if (`${y}-01-01` > cutoff) return "not_covered";
  return "uncertain";
}

/** Is the certificate of occupancy within the last `years` years of `asOf` (the AB 1482 rolling exemption)? */
function withinRollingWindow(input: RentControlInput, asOf: string, years: number): CoverageTest {
  const windowStart = addYears(asOf, -years); // CO strictly after this date qualifies
  if (input.certificateOfOccupancyDate) return toIsoDate(input.certificateOfOccupancyDate) > windowStart ? "covered" : "not_covered";
  if (input.yearBuilt === undefined) return "unknown";
  const y = input.yearBuilt;
  if (`${y}-01-01` > windowStart) return "covered";
  if (`${y}-12-31` <= windowStart) return "not_covered";
  return "uncertain";
}

function pctText(n: number): string {
  return `${round2(n)}%`;
}

type CapLookup = { cpiPct: number; verified: boolean; stale: boolean; periodMissing: boolean };

function ab1482Cpi(region: Ab1482Region, asOf: string): CapLookup {
  const rows = AB1482_CAP_TABLE.filter((r) => r.region === region);
  const exact = rowFor(rows, asOf);
  if (exact) return { cpiPct: exact.cpiPct, verified: exact.verified, stale: false, periodMissing: false };
  const prior = latestRowBefore(rows, asOf);
  if (prior) return { cpiPct: prior.cpiPct, verified: prior.verified, stale: true, periodMissing: false };
  // Before the first loaded period: assume the statutory ceiling (conservative for cap-growth underwriting).
  return { cpiPct: AB1482.maxPct - AB1482.basePct, verified: false, stale: true, periodMissing: true };
}

const REGION_LABEL: Record<Ab1482Region, string> = {
  los_angeles: "Los Angeles area",
  san_francisco: "San Francisco Bay area",
  san_diego: "San Diego area",
  inland_empire: "Inland Empire",
  california: "California statewide",
};

export function ab1482CapPct(county: string | undefined, asOfInput: DateInput): { capPct: number; basis: string; dataStatus: RentControlResult["dataStatus"] } {
  const asOf = toIsoDate(asOfInput);
  const region = ab1482Region(county);
  const lookup = ab1482Cpi(region, asOf);
  const capPct = Math.min(AB1482.basePct + lookup.cpiPct, AB1482.maxPct);
  const basis = lookup.periodMissing
    ? `AB 1482: statutory ceiling ${pctText(AB1482.maxPct)} (no CPI period loaded for ${asOf})`
    : `AB 1482: ${pctText(AB1482.basePct)} + ${pctText(lookup.cpiPct)} CPI (${REGION_LABEL[region]}), capped at ${pctText(AB1482.maxPct)}`;
  return { capPct: round2(capPct), basis, dataStatus: lookup.stale ? "stale" : lookup.verified ? "verified" : "unverified" };
}

function finish(result: Omit<RentControlResult, "maxNextRent">, currentRent: number | undefined): RentControlResult {
  const out: RentControlResult = { ...result };
  if (currentRent !== undefined && currentRent > 0 && result.annualCapPct !== null) out.maxNextRent = round2(currentRent * (1 + result.annualCapPct / 100));
  if (result.dataStatus === "stale") {
    out.flags.push({ code: "cap_table_stale", message: "No loaded cap row covers the as-of date; the most recent period is shown. Refresh the cap table." });
  } else if (result.dataStatus === "unverified" && result.annualCapPct !== null) {
    out.flags.push({ code: "cap_table_unverified", message: "The cap figure is a planning default that compliance has not verified against its source (VERIFY)." });
  }
  return out;
}

export function evaluateRentControl(input: RentControlInput): RentControlResult {
  const asOf = toIsoDate(input.asOf);
  const flags: RentControlFlag[] = [];
  const reasons: string[] = [];
  const authorities: string[] = [];
  const exemptions: Exemption[] = [];
  const state = (input.state ?? "CA").toUpperCase();

  const base = {
    capIsUpperBound: false,
    vacancyReset: "not_applicable" as RentControlResult["vacancyReset"],
    justCause: false,
    exemptions,
    flags,
    reasons,
    authorities,
    dataStatus: "verified" as RentControlResult["dataStatus"],
  };

  if (state !== "CA") {
    reasons.push("The property is outside California; California rent-control rules do not apply.");
    return { ...base, regime: "not_california", annualCapPct: null, capBasis: "Not applicable (outside California)" };
  }

  // Rents set by a recorded regulatory agreement are governed by that agreement, not by AB 1482 or local control.
  if (input.deedRestrictedAffordable) {
    exemptions.push({ code: "deed_restricted", reason: "Rents are restricted by a recorded covenant or regulatory agreement.", authority: "Civ. Code §1947.12(d)(1)", scope: "ab1482" });
    authorities.push("Civ. Code §1947.12(d)(1)");
    reasons.push("Deed-restricted affordable housing: the regulatory agreement controls rent increases; confirm its annual limit.");
    return { ...base, regime: "regulatory_agreement", annualCapPct: null, capBasis: "Set by the regulatory agreement", vacancyReset: "not_allowed" };
  }
  if (input.dormitory) {
    exemptions.push({ code: "dormitory", reason: "Dormitory constructed and maintained in connection with an institution of higher education or K-12.", authority: "Civ. Code §1947.12(d)(3)", scope: "ab1482" });
    authorities.push("Civ. Code §1947.12(d)(3)");
    return { ...base, regime: "exempt", annualCapPct: null, capBasis: "Exempt (dormitory)", vacancyReset: "allowed" };
  }

  const separatelyAlienable = input.separatelyAlienable ?? true;
  const isSfrOrCondo = (input.propertyType === "single_family" || input.propertyType === "condominium") && separatelyAlienable;

  // --- Local ordinance ---------------------------------------------------------------
  const ordinance = matchLocalOrdinance({ city: input.city, county: input.county, unincorporated: input.unincorporated });
  if (ordinance) {
    authorities.push(ordinance.citation);
    // Costa-Hawkins removes a separately alienable SFR or condo from local control (Civ. Code §1954.52(a)(3)).
    if (isSfrOrCondo) {
      exemptions.push({
        code: "costa_hawkins_sfr_condo",
        reason: "Separately alienable single-family home or condominium is exempt from local rent control.",
        authority: "Civ. Code §1954.52(a)(3)(A)",
        scope: "local",
      });
      authorities.push("Civ. Code §1954.52(a)(3)");
    } else {
      // The earlier of the ordinance's own cutoff and Costa-Hawkins' Feb 1, 1995 new-construction line.
      const cutoff = ordinance.coveredIfCertificateOfOccupancyOnOrBefore < COSTA_HAWKINS_NEW_CONSTRUCTION_DATE ? ordinance.coveredIfCertificateOfOccupancyOnOrBefore : COSTA_HAWKINS_NEW_CONSTRUCTION_DATE;
      const coverage = coOnOrBefore(input, cutoff);
      if (coverage === "not_covered") {
        exemptions.push({
          code: "local_cutoff",
          reason: `Certificate of occupancy is after ${cutoff}, outside ${ordinance.label}.`,
          authority: ordinance.id === "la_rso" ? "LAMC §151.02; Civ. Code §1954.52(a)(1)" : "Civ. Code §1954.52(a)(1)",
          scope: "local",
        });
        authorities.push("Civ. Code §1954.52(a)(1)");
      } else {
        if (coverage === "unknown") {
          flags.push({ code: "coverage_year_unknown", message: "Year built is unknown; treated as covered by the local ordinance until a certificate of occupancy date is confirmed." });
        } else if (coverage === "uncertain") {
          flags.push({ code: "coverage_date_uncertain", message: `Only the year built (${input.yearBuilt}) is known and the ordinance cutoff (${cutoff}) falls within it; treated as covered. Confirm the certificate of occupancy date.` });
        }
        const row = rowFor(ordinance.capRows, asOf);
        const fallback = row ?? latestRowBefore(ordinance.capRows, asOf);
        reasons.push(`${ordinance.label} applies; the local cap governs because it is lower than the AB 1482 cap.`);
        if (!fallback) {
          // No row at all: report the regime without a number rather than invent one.
          flags.push({ code: "cap_table_stale", message: "No local cap row is loaded for this period; look up the current allowable increase." });
          return { ...base, regime: "local_ordinance", annualCapPct: null, capBasis: `${ordinance.label} (cap not loaded)`, vacancyReset: "allowed", justCause: true, dataStatus: "stale", localOrdinance: { id: ordinance.id, label: ordinance.label } };
        }
        if (fallback.capIsMinimum) flags.push({ code: "local_cap_is_minimum", message: "The allowable increase is formula-based; the figure shown is its floor and the actual cap may be higher." });
        authorities.push("Civ. Code §1954.53(a)");
        return finish(
          {
            ...base,
            regime: "local_ordinance",
            annualCapPct: fallback.capPct,
            capBasis: `${ordinance.label}: ${pctText(fallback.capPct)}${fallback.capIsMinimum ? " (floor)" : ""} for ${fallback.effectiveFrom} to ${fallback.effectiveTo}`,
            vacancyReset: "allowed",
            justCause: true,
            dataStatus: row ? (fallback.verified ? "verified" : "unverified") : "stale",
            localOrdinance: { id: ordinance.id, label: ordinance.label },
          },
          input.currentRent,
        );
      }
    }
  } else if (isUnmodeledRentControlCity(input.city) && !isSfrOrCondo) {
    const cap = ab1482CapPct(input.county, asOf);
    flags.push({
      code: "local_ordinance_unmodeled",
      message: `${input.city} has its own rent ordinance that is not modeled here. The AB 1482 figure is shown as an upper bound; the local cap is usually lower. Review manually.`,
    });
    reasons.push(`${input.city} has a local rent ordinance outside this engine's data.`);
    return finish(
      { ...base, regime: "local_unmodeled", annualCapPct: cap.capPct, capIsUpperBound: true, capBasis: `${cap.basis} (upper bound)`, vacancyReset: "allowed", justCause: true, dataStatus: cap.dataStatus },
      input.currentRent,
    );
  }

  // --- AB 1482 -----------------------------------------------------------------------
  authorities.push("Civ. Code §1947.12");
  if (asOf >= AB1482.sunsetDate) {
    flags.push({ code: "ab1482_sunset", message: `AB 1482 is scheduled to sunset on ${AB1482.sunsetDate}; confirm whether it has been extended.` });
    return { ...base, regime: "ab1482_sunset", annualCapPct: null, capBasis: "AB 1482 sunset date has passed", vacancyReset: "allowed" };
  }

  // 15-year rolling new-construction exemption.
  const rolling = withinRollingWindow(input, asOf, AB1482.newConstructionYears);
  if (rolling === "covered") {
    exemptions.push({
      code: "new_construction_15yr",
      reason: `Certificate of occupancy issued within the last ${AB1482.newConstructionYears} years.`,
      authority: "Civ. Code §1947.12(d)(2)",
      scope: "ab1482",
    });
    const exits = input.certificateOfOccupancyDate
      ? addYears(toIsoDate(input.certificateOfOccupancyDate), AB1482.newConstructionYears)
      : input.yearBuilt !== undefined
        ? `${input.yearBuilt + AB1482.newConstructionYears}`
        : undefined;
    if (exits) reasons.push(`The 15-year exemption runs out around ${exits}; underwrite the cap from then.`);
  } else if (rolling === "uncertain") {
    flags.push({
      code: "exemption_date_uncertain",
      message: `Year built ${input.yearBuilt} straddles the 15-year exemption line; treated as NOT exempt. Confirm the certificate of occupancy date.`,
    });
  } else if (rolling === "unknown") {
    flags.push({ code: "coverage_year_unknown", message: "Year built is unknown; the 15-year new-construction exemption cannot be tested, so the cap is applied." });
  }

  // Single-family / condominium exemption (§1947.12(d)(5)).
  if (isSfrOrCondo) {
    const ownerType = input.owner?.type ?? "unknown";
    if (ownerType === "unknown") flags.push({ code: "owner_type_unknown", message: "Owner type is unknown; the single-family/condo exemption needs a non-corporate, non-REIT owner." });
    const ownerOk = ownerType !== "unknown" && !REIT_OR_CORPORATE.has(ownerType);
    if (ownerOk && input.exemptionNoticeGiven) {
      exemptions.push({
        code: "sfr_condo",
        reason: "Separately alienable single-family home or condominium not owned by a REIT, corporation or LLC with a corporate member, with written exemption notice to the tenant.",
        authority: "Civ. Code §1947.12(d)(5)",
        scope: "ab1482",
      });
    } else if (ownerOk) {
      flags.push({ code: "sfr_exemption_notice_required", message: "The single-family/condo exemption applies only if the lease or an addendum gives the tenant the statutory exemption notice; without it the cap applies." });
    }
  }

  // Owner-occupied duplex (§1947.12(d)(4)).
  if (input.propertyType === "duplex" && input.ownerOccupiedDuplex) {
    exemptions.push({ code: "owner_occupied_duplex", reason: "Owner occupies one unit of the duplex as a principal residence.", authority: "Civ. Code §1947.12(d)(4)", scope: "ab1482" });
  }

  const ab1482Exemptions = exemptions.filter((e) => e.scope === "ab1482");
  if (ab1482Exemptions.length > 0) {
    for (const e of ab1482Exemptions) authorities.push(e.authority);
    reasons.push("An AB 1482 exemption applies, so no statutory cap limits annual increases (lease terms still govern).");
    return { ...base, regime: "exempt", annualCapPct: null, capBasis: `Exempt: ${ab1482Exemptions.map((e) => e.code).join(", ")}`, vacancyReset: "allowed", justCause: false };
  }

  const cap = ab1482CapPct(input.county, asOf);
  authorities.push("Civ. Code §1946.2");
  reasons.push("AB 1482 applies: increases are limited to the cap above within any 12-month period, and just-cause eviction rules apply after 12 months of tenancy.");
  reasons.push("Costa-Hawkins lets rent reset to market when a tenant voluntarily vacates; AB 1482 does not limit the initial rent of a new tenancy.");
  authorities.push("Civ. Code §1954.53(a)");
  return finish({ ...base, regime: "ab1482", annualCapPct: cap.capPct, capBasis: cap.basis, vacancyReset: "allowed", justCause: true, dataStatus: cap.dataStatus }, input.currentRent);
}

/** Date the AB 1482 15-year new-construction exemption ends for a certificate-of-occupancy date. */
export function newConstructionExemptionEnds(certificateOfOccupancyDate: DateInput): string {
  return addYears(toIsoDate(certificateOfOccupancyDate), AB1482.newConstructionYears);
}
