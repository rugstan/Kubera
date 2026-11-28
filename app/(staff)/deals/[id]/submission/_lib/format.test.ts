import { describe, expect, it } from "vitest";
import { centsToInput, date, formatMetricInput, metricValue, needsLine, sourceLabel, usd } from "./format";

describe("submission formatting", () => {
  it("formats money without a nine-digit run and dates as written", () => {
    expect(usd(840_000_000)).toBe("$8,400,000");
    expect(usd(11_850)).toBe("$118.50");
    expect(centsToInput(-4_500_050)).toBe("-45000.50");
    expect(date("2026-09-30")).toBe("Sep 30, 2026");
    expect(date(null)).toBe("");
  });

  it("formats a metric in its fixed unit, and never invents a value", () => {
    expect(metricValue({ key: "ltv_as_is", value: 68.04 })).toBe("68.0%");
    expect(metricValue({ key: "dscr_in_place", value: 1.254 })).toBe("1.25x");
    expect(metricValue({ key: "loan_per_unit", value: 20_000_000 })).toBe("$200,000");
    expect(metricValue({ key: "ltv_as_is", value: null })).toBeNull();
    expect(needsLine({ missing: ["as-is value"] })).toBe("Needs: as-is value");
    expect(formatMetricInput({ field: "asIsValueCents", value: 1_235_000_000 })).toBe("$12,350,000");
    expect(formatMetricInput({ field: "assumedRatePct", value: 8.75 })).toBe("8.75%");
  });

  it("names every source", () => {
    expect(sourceLabel(null)).toBe("Entered");
    expect(sourceLabel({ source: "borrower", by: "x", at: "2026-10-01T00:00:00Z" })).toBe("Per borrower");
    expect(sourceLabel({ source: "document", ref: "d", asOf: "2026-09-30", at: "x" })).toBe("From document (Sep 30, 2026)");
    expect(sourceLabel({ source: "spread", ref: "s", at: "x" })).toBe("From spread");
    expect(sourceLabel({ source: "record", record: "hm_underwriting", ref: "r", at: "x" })).toBe("From the hard money file");
    expect(sourceLabel({ source: "public_record", ref: "p", at: "x" })).toBe("Public record");
  });
});
