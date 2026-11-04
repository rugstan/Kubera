import { describe, expect, it } from "vitest";
import { fromRow, isoTimestamp, normalizeTimestamps, numberOrNull, toCamel, toRow, toSnake } from "./rows";

describe("row mapping", () => {
  it("converts keys both ways", () => {
    expect(toSnake("hudCostCertSubmittedAt")).toBe("hud_cost_cert_submitted_at");
    expect(toSnake("noiT3Annualized")).toBe("noi_t3_annualized");
    expect(toCamel("hud_cost_cert_submitted_at")).toBe("hudCostCertSubmittedAt");
    expect(toCamel("noi_t3_annualized")).toBe("noiT3Annualized");
  });

  it("round-trips every domain key used by the store", () => {
    for (const key of ["projectId", "reportType", "orderAttempt", "generalContractorLicense", "unitsLeased", "avgMonthlyRent", "suggestedPrograms", "newDealId", "resolvedBy", "extensionDeadline"]) {
      expect(toCamel(toSnake(key))).toBe(key);
    }
  });

  it("leaves undefined fields out and keeps null and jsonb values as given", () => {
    expect(toRow({ projectId: "p", vendorName: undefined, notes: null, snapshot: { classifications: ["B"], bondOnFile: true } })).toEqual({
      project_id: "p",
      notes: null,
      snapshot: { classifications: ["B"], bondOnFile: true },
    });
  });

  it("maps rows back to camelCase at the top level only", () => {
    expect(fromRow({ project_id: "p", snapshot: { bond_on_file: true } })).toEqual({ projectId: "p", snapshot: { bond_on_file: true } });
  });

  it("normalizes timestamps and numeric strings", () => {
    expect(isoTimestamp("2026-11-04 18:00:00+00")).toBe("2026-11-04T18:00:00.000Z");
    expect(isoTimestamp(null)).toBeNull();
    expect(normalizeTimestamps({ createdAt: "2026-11-04 18:00:00+00", dueAt: "2026-11-30" })).toEqual({ createdAt: "2026-11-04T18:00:00.000Z", dueAt: "2026-11-30" });
    expect(numberOrNull("1250.50")).toBe(1250.5);
    expect(numberOrNull(null)).toBeNull();
  });
});
