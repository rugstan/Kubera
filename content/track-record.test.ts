import { describe, expect, it } from "vitest";
import { TRACK_RECORD, isPublishable, publishableRecords, type TrackRecordEntry } from "./track-record";

const entry = (over: Partial<TrackRecordEntry> = {}): TrackRecordEntry => ({
  id: "x",
  closedYear: 2026,
  assetType: "Assisted living",
  program: "HUD 223(f)",
  loanAmountUsd: 10_000_000,
  location: "Fresno, CA",
  summary: "Refinance of a 90-bed community.",
  clientPermission: true,
  verifiedOn: "2026-11-02",
  ...over,
});

describe("track record", () => {
  it("ships empty: no fabricated closings", () => {
    expect(TRACK_RECORD).toEqual([]);
    expect(publishableRecords()).toEqual([]);
  });

  it("requires written client permission", () => {
    expect(isPublishable(entry({ clientPermission: false }))).toBe(false);
  });

  it("requires a verification date and sane figures", () => {
    expect(isPublishable(entry({ verifiedOn: "" }))).toBe(false);
    expect(isPublishable(entry({ verifiedOn: "11/02/2026" }))).toBe(false);
    expect(isPublishable(entry({ loanAmountUsd: 0 }))).toBe(false);
    expect(isPublishable(entry({ loanAmountUsd: Number.NaN }))).toBe(false);
    expect(isPublishable(entry({ closedYear: 2026.5 }))).toBe(false);
    expect(isPublishable(entry({ summary: "  " }))).toBe(false);
    expect(isPublishable(entry())).toBe(true);
  });

  it("lists newest first, then largest", () => {
    const list = publishableRecords([
      entry({ id: "old", closedYear: 2025 }),
      entry({ id: "small", closedYear: 2026, loanAmountUsd: 1_000_000 }),
      entry({ id: "big", closedYear: 2026, loanAmountUsd: 9_000_000 }),
      entry({ id: "hidden", clientPermission: false }),
    ]);
    expect(list.map((e) => e.id)).toEqual(["big", "small", "old"]);
  });
});
