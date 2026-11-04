import { asArray, asRecord, dig, firstNum, firstStr, getJson, isoDate, outcomeFromFailure, positive, stripUndefined, type FetchLike } from "./http";
import { notFound, ok, type ParcelClient, type ParcelRecord, type PropertyAddress, type SourceOutcome } from "./types";

// Regrid parcel API v2 (address search). Field names follow Regrid's standard
// parcel schema (parcelnumb, owner, yearbuilt, numunits, ll_gisacre, ...).
// VERIFY against the account's schema: counties differ in which fields they fill.

const BASE_URL = "https://app.regrid.com/api/v2";

export function addressQuery(a: PropertyAddress): string {
  return [a.line1, a.city, a.state ?? "CA", a.zip].filter(Boolean).join(", ");
}

/** Parse a Regrid parcel feature (`properties.fields`) into a ParcelRecord. */
export function parseRegridFeature(feature: unknown): ParcelRecord | undefined {
  const f = asRecord(dig(feature, "properties", "fields"));
  if (!f) return undefined;
  const lat = firstNum(f.lat, dig(feature, "properties", "ll_lat"));
  const lon = firstNum(f.lon, dig(feature, "properties", "ll_lon"));
  const rec: ParcelRecord = {
    apn: firstStr(f.parcelnumb, f.parcelnumb_no_formatting),
    owner: firstStr(f.owner),
    county: firstStr(f.county),
    city: firstStr(f.scity, f.city),
    state: firstStr(f.state2)?.toUpperCase(),
    zip: firstStr(f.szip5, f.szip),
    yearBuilt: positive(f.yearbuilt),
    units: positive(f.numunits),
    stories: positive(f.numstories),
    // Regrid carries the building footprint; gross area is approximated as footprint x stories.
    buildingSqft: grossSqft(positive(f.ll_bldg_footprint_sqft), positive(f.numstories)),
    lotAcres: positive(f.ll_gisacre) ?? positive(f.gisacre),
    useDescription: firstStr(f.usedesc, f.usecode),
    zoning: firstStr(f.zoning, f.zoning_description),
    assessedTotal: positive(f.parval),
    assessedLand: positive(f.landval),
    assessedImprovements: positive(f.improvval),
    lastSalePrice: positive(f.saleprice),
    lastSaleDate: isoDate(f.saledate),
    asOf: isoDate(f.ll_last_refresh) ?? isoDate(f.ll_updated_at),
  };
  if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) rec.coordinates = { lat, lon };
  return stripUndefined(rec);
}

function grossSqft(footprint: number | undefined, stories: number | undefined): number | undefined {
  if (footprint === undefined) return undefined;
  return Math.round(footprint * (stories ?? 1));
}

export class RegridClient implements ParcelClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  async lookupByAddress(address: PropertyAddress): Promise<SourceOutcome<ParcelRecord>> {
    const url = `${this.baseUrl}/parcels/address?query=${encodeURIComponent(addressQuery(address))}&limit=1&token=${encodeURIComponent(this.token)}`;
    const res = await getJson(url, { fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    const features = asArray(dig(res.data, "parcels", "features"));
    for (const feature of features) {
      const parsed = parseRegridFeature(feature);
      if (parsed && Object.keys(parsed).length > 0) return ok(parsed);
    }
    return notFound();
  }
}
