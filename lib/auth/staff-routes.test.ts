import { describe, expect, it } from "vitest";
import { staffRouteFolders } from "./staff-route-folders";
import { STAFF_NAV, STAFF_ROUTE_PREFIXES } from "./staff-routes";

describe("staff routes", () => {
  it("lists every top-level folder under app/(staff)/, and nothing else", () => {
    const folders = staffRouteFolders();
    expect(folders).toEqual(expect.arrayContaining(["pipeline", "lenders", "reports", "ai-review", "prospects", "settings"]));
    expect([...STAFF_ROUTE_PREFIXES].sort()).toEqual(folders.map((f) => `/${f}`));
  });

  it("derives the prefixes from the nav, in nav order", () => {
    expect(STAFF_ROUTE_PREFIXES).toEqual(STAFF_NAV.map((n) => n.href));
    expect(new Set(STAFF_ROUTE_PREFIXES).size).toBe(STAFF_ROUTE_PREFIXES.length);
  });
});
