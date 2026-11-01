// Rent-control data tables (WS-Z). Rules change by statute and by ordinance, so
// the numbers live here as dated rows rather than inside the engine. Every row
// says whether it has been checked against its source.
//
// VERIFY: every `verified: false` row is a planning default taken from the
// build plan or from published BLS/ordinance figures that have not been
// re-checked by compliance. The engine reports `dataStatus: "unverified"` for
// them, and "stale" when no row covers the date being evaluated. Refresh the
// AB 1482 rows each August after BLS publishes April-over-April CPI.

export const AB1482 = {
  /** Civ. Code §1947.12: 5% plus regional CPI change, capped at 10%. */
  basePct: 5,
  maxPct: 10,
  /** Rolling new-construction exemption: certificate of occupancy within the last 15 years (§1947.12(d)(2)). */
  newConstructionYears: 15,
  /** The statute sunsets on this date unless extended (§1947.12(m)). */
  sunsetDate: "2030-01-01",
  /** Just cause (Civ. Code §1946.2) applies after 12 months of tenancy. */
  justCauseAfterMonths: 12,
} as const;

export const AB1482_REGIONS = ["los_angeles", "san_francisco", "san_diego", "inland_empire", "california"] as const;
export type Ab1482Region = (typeof AB1482_REGIONS)[number];

/**
 * BLS CPI-U area used for the statute's "regional" CPI. Areas BLS does not
 * publish a CPI for fall back to the statewide figure.
 * VERIFY: county to BLS area mapping with compliance before relying on it.
 */
const COUNTY_REGION: Record<string, Ab1482Region> = {
  "los angeles": "los_angeles",
  orange: "los_angeles",
  "san francisco": "san_francisco",
  alameda: "san_francisco",
  "contra costa": "san_francisco",
  marin: "san_francisco",
  "san mateo": "san_francisco",
  "san diego": "san_diego",
  riverside: "inland_empire",
  "san bernardino": "inland_empire",
};

export function ab1482Region(county: string | undefined): Ab1482Region {
  if (!county) return "california";
  return COUNTY_REGION[county.toLowerCase().replace(/\s+county$/, "").trim()] ?? "california";
}

export type Ab1482CapRow = {
  region: Ab1482Region;
  /** Period the cap applies to, inclusive (August 1 to July 31). */
  effectiveFrom: string;
  effectiveTo: string;
  /** April-over-April CPI-U percent change. */
  cpiPct: number;
  verified: boolean;
  source: string;
};

const BLS = "BLS CPI-U, April-over-April, all items; VERIFY against the published series";

function periodRows(from: string, to: string, cpi: Record<Ab1482Region, number>): Ab1482CapRow[] {
  return AB1482_REGIONS.map((region) => ({ region, effectiveFrom: from, effectiveTo: to, cpiPct: cpi[region], verified: false, source: BLS }));
}

export const AB1482_CAP_TABLE: readonly Ab1482CapRow[] = [
  ...periodRows("2023-08-01", "2024-07-31", { los_angeles: 3.8, san_francisco: 3.3, san_diego: 4.4, inland_empire: 4.0, california: 3.7 }),
  ...periodRows("2024-08-01", "2025-07-31", { los_angeles: 3.9, san_francisco: 3.1, san_diego: 3.7, inland_empire: 3.4, california: 3.5 }),
  ...periodRows("2025-08-01", "2026-07-31", { los_angeles: 3.0, san_francisco: 2.6, san_diego: 3.3, inland_empire: 3.0, california: 3.0 }),
  // April 2026 over April 2025. VERIFY: entered as planning figures; re-check against the BLS release before relying on them.
  ...periodRows("2026-08-01", "2027-07-31", { los_angeles: 3.1, san_francisco: 2.7, san_diego: 3.2, inland_empire: 3.0, california: 3.0 }),
];

// --- Local ordinances ----------------------------------------------------------------

export type LocalCapRow = {
  effectiveFrom: string;
  effectiveTo: string;
  capPct: number;
  /** The figure is a floor of a formula (for example the greater of 3% or 80% of CPI). */
  capIsMinimum?: boolean;
  verified: boolean;
  source: string;
};

export type LocalOrdinance = {
  id: "la_rso" | "la_county_rstpo";
  label: string;
  citation: string;
  /** Matches an incorporated city (lower-case), or the unincorporated area of a county. */
  city?: string;
  unincorporatedCounty?: string;
  /** Covered when the certificate of occupancy was issued on or before this date. */
  coveredIfCertificateOfOccupancyOnOrBefore: string;
  capRows: readonly LocalCapRow[];
};

export const LOCAL_ORDINANCES: readonly LocalOrdinance[] = [
  {
    id: "la_rso",
    label: "City of Los Angeles Rent Stabilization Ordinance",
    citation: "LAMC §151.00 et seq.",
    city: "los angeles",
    coveredIfCertificateOfOccupancyOnOrBefore: "1978-10-01",
    capRows: [
      {
        effectiveFrom: "2026-07-01",
        effectiveTo: "2027-06-30",
        capPct: 3,
        verified: false,
        source: "Build plan reference (Jul 2026 to Jun 2027 allowable annual increase); VERIFY with LAHD",
      },
    ],
  },
  {
    id: "la_county_rstpo",
    label: "Los Angeles County Rent Stabilization and Tenant Protections Ordinance (unincorporated areas)",
    citation: "LA County Code ch. 8.52",
    unincorporatedCounty: "los angeles",
    coveredIfCertificateOfOccupancyOnOrBefore: "1995-02-01",
    capRows: [
      {
        effectiveFrom: "2020-03-04",
        effectiveTo: "2099-12-31",
        capPct: 3,
        capIsMinimum: true,
        verified: false,
        source: "Formula: greater of 3% or 80% of CPI, up to 8%; the 3% floor is shown. VERIFY the current CPI-based figure",
      },
    ],
  },
];

/**
 * Cities with their own rent ordinance that this build does not model. A
 * property here gets the AB 1482 cap as an upper-bound hint and a manual-review
 * flag; the local cap is usually lower.
 * VERIFY: the list is incomplete by design; add cities as counsel confirms them.
 */
export const UNMODELED_LOCAL_RENT_CONTROL_CITIES: readonly string[] = [
  "alameda",
  "beverly hills",
  "berkeley",
  "culver city",
  "east palo alto",
  "hayward",
  "inglewood",
  "long beach",
  "los gatos",
  "mountain view",
  "oakland",
  "oxnard",
  "palm springs",
  "pasadena",
  "richmond",
  "sacramento",
  "san francisco",
  "san jose",
  "santa ana",
  "santa monica",
  "west hollywood",
];

export function matchLocalOrdinance(loc: { city?: string; county?: string; unincorporated?: boolean }): LocalOrdinance | undefined {
  const city = loc.city?.toLowerCase().trim();
  const county = loc.county?.toLowerCase().replace(/\s+county$/, "").trim();
  return LOCAL_ORDINANCES.find((o) => (o.city && city === o.city) || (o.unincorporatedCounty && county === o.unincorporatedCounty && (loc.unincorporated ?? !city)));
}

export function isUnmodeledRentControlCity(city: string | undefined): boolean {
  return !!city && UNMODELED_LOCAL_RENT_CONTROL_CITIES.includes(city.toLowerCase().trim());
}

/** Costa-Hawkins (Civ. Code §1954.52): units with a certificate of occupancy after this date are exempt from local control. */
export const COSTA_HAWKINS_NEW_CONSTRUCTION_DATE = "1995-02-01";
