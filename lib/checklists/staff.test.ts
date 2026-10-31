import { describe, expect, it } from "vitest";
import { formatScopeLines, formatTrackRecordLines, parseScopeLines, parseTrackRecordLines } from "@/app/(staff)/checklists/_lib/hm-lines";
import { canDecide } from "./staff";

describe("staff roles", () => {
  it("lets brokers and admins decide; analysts prepare", () => {
    const base = { id: "u9", email: "analyst@k.com", name: "A", role: "analyst" as const, dreLicense: null };
    expect(canDecide(base)).toBe(false);
    expect(canDecide({ ...base, role: "broker" })).toBe(true);
    expect(canDecide({ ...base, role: "admin" })).toBe(true);
  });
});

describe("hard money line formats", () => {
  it("round-trips scope of work and track record lines", () => {
    const scope = parseScopeLines("# category | description | cost | weeks | licensed\nKitchen/Bath | Two kitchens | $90,000 | 8 | yes\nroof | Re-roof | 30000 | 2 | no");
    expect(scope).toEqual([
      { category: "kitchen_bath", description: "Two kitchens", cost: 90_000, weeks: 8, licensedTrade: true },
      { category: "roof", description: "Re-roof", cost: 30_000, weeks: 2, licensedTrade: false },
    ]);
    expect(parseScopeLines(formatScopeLines(scope))).toEqual(scope);
    const track = parseTrackRecordLines("1 A St, Fresno | fix and flip | 2024-01-10 | 300000 | 60000 | 2024-08-01 | sold | 480000 | sponsor | yes");
    expect(track[0]).toMatchObject({ strategy: "fix_and_flip", exitType: "sold", verified: true, purchasePrice: 300_000 });
    expect(parseTrackRecordLines(formatTrackRecordLines(track))).toEqual(track);
    expect(() => parseScopeLines("spaceship | warp drive | 1 | 1 | no")).toThrow(/line 1/);
  });
});
