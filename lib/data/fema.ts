import { asArray, asRecord, firstStr, getJson, num, outcomeFromFailure, stripUndefined, type FetchLike } from "./http";
import { failed, notFound, ok, type Coordinates, type FloodClient, type FloodZoneRecord, type SourceOutcome } from "./types";

// FEMA National Flood Hazard Layer, public ArcGIS REST service (no key needed).
// Layer 28 is "Flood Hazard Zones". VERIFY the layer id if FEMA republishes the service.

export const NFHL_FLOOD_ZONES_URL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

/** Zone codes that make up the Special Flood Hazard Area. */
const SFHA_ZONE = /^(A|AE|AH|AO|AR|A99|V|VE)$/;

export function isSpecialFloodHazardArea(zone: string, sfhaFlag?: string): boolean {
  if (sfhaFlag === "T") return true;
  if (sfhaFlag === "F") return false;
  return SFHA_ZONE.test(zone.toUpperCase());
}

export function parseFloodFeature(feature: unknown): FloodZoneRecord | undefined {
  const a = asRecord(asRecord(feature)?.attributes);
  if (!a) return undefined;
  const zone = firstStr(a.FLD_ZONE);
  if (!zone) return undefined;
  const bfe = num(a.STATIC_BFE);
  return stripUndefined<FloodZoneRecord>({
    zone,
    zoneSubtype: firstStr(a.ZONE_SUBTY),
    specialFloodHazardArea: isSpecialFloodHazardArea(zone, firstStr(a.SFHA_TF)),
    // ArcGIS reports -9999 when there is no base flood elevation.
    baseFloodElevationFt: bfe !== undefined && bfe > -9000 ? bfe : undefined,
    firmPanel: firstStr(a.DFIRM_ID),
  });
}

/** Zones are ranked so an overlapping polygon in the SFHA wins over zone X. */
function severity(z: FloodZoneRecord): number {
  return z.specialFloodHazardArea ? 2 : z.zone.toUpperCase() === "X" && /0\.2/.test(z.zoneSubtype ?? "") ? 1 : 0;
}

export class FemaNfhlClient implements FloodClient {
  constructor(
    private readonly fetchImpl?: FetchLike,
    private readonly queryUrl: string = NFHL_FLOOD_ZONES_URL,
  ) {}

  async lookup(point: Coordinates): Promise<SourceOutcome<FloodZoneRecord>> {
    const params = new URLSearchParams({
      geometry: `${point.lon},${point.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID",
      returnGeometry: "false",
      f: "json",
    });
    const res = await getJson(`${this.queryUrl}?${params.toString()}`, { fetchImpl: this.fetchImpl, timeoutMs: 12_000 });
    if (!res.ok) return outcomeFromFailure(res);
    const body = asRecord(res.data);
    // ArcGIS reports service errors with HTTP 200 and an `error` object.
    if (body?.error) return failed("arcgis-error");
    const zones = asArray(body?.features)
      .map(parseFloodFeature)
      .filter((z): z is FloodZoneRecord => z !== undefined);
    if (zones.length === 0) return notFound();
    zones.sort((a, b) => severity(b) - severity(a));
    return ok(zones[0]!);
  }
}
