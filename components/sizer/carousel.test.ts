import { describe, expect, it } from "vitest";
import { bestSummary, clampIndex, nearestIndex } from "./carousel";

describe("nearestIndex", () => {
  const offsets = [0, 300, 600, 900];
  it("picks the slide whose edge is closest to the scroll position", () => {
    expect(nearestIndex(offsets, 0)).toBe(0);
    expect(nearestIndex(offsets, 140)).toBe(0);
    expect(nearestIndex(offsets, 160)).toBe(1);
    expect(nearestIndex(offsets, 905)).toBe(3);
    expect(nearestIndex(offsets, 5000)).toBe(3);
  });
  it("returns 0 for an empty list", () => {
    expect(nearestIndex([], 100)).toBe(0);
  });
});

describe("clampIndex", () => {
  it("keeps the index inside the list", () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(7, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe("bestSummary", () => {
  it("summarises the best-fit structure", () => {
    expect(bestSummary({ name: "HUD 232/223(f)", loanAmount: 2_500_000, ratePct: 6.153, eligible: true })).toEqual({ label: "HUD 232/223(f)", detail: "$2,500,000 at about 6.15%" });
  });
  it("says so when nothing fits", () => {
    expect(bestSummary(undefined).label).toBe("No structure fits yet");
    expect(bestSummary({ name: "x", loanAmount: 0, ratePct: 0, eligible: false }).label).toBe("No structure fits yet");
  });
});
