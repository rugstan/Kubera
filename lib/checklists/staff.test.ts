import { afterEach, describe, expect, it } from "vitest";
import { formatScopeLines, formatTrackRecordLines, parseScopeLines, parseTrackRecordLines } from "@/app/(staff)/checklists/_lib/hm-lines";
import { canDecide, interimStaffConfigured, resolveStaff, setStaffResolver, STAFF_COOKIE, staffCookieValue, verifyStaffToken } from "./staff";

const TOKEN = "t".repeat(40);

afterEach(() => {
  setStaffResolver(null);
  delete process.env.STAFF_ACCESS_TOKEN;
});

describe("interim staff access", () => {
  it("is closed without a strong token", async () => {
    expect(interimStaffConfigured({})).toBe(false);
    expect(interimStaffConfigured({ STAFF_ACCESS_TOKEN: "short" })).toBe(false);
    expect(verifyStaffToken("short", { STAFF_ACCESS_TOKEN: "short" })).toBe(false);
    expect(await resolveStaff(() => staffCookieValue("anything"))).toBeNull();
  });

  it("accepts only the HMAC cookie of the configured token", async () => {
    process.env.STAFF_ACCESS_TOKEN = TOKEN;
    expect(verifyStaffToken(TOKEN)).toBe(true);
    expect(verifyStaffToken(`${TOKEN}x`)).toBe(false);
    expect(staffCookieValue(TOKEN)).not.toContain(TOKEN);
    const staff = await resolveStaff((n) => (n === STAFF_COOKIE ? staffCookieValue(TOKEN) : undefined));
    expect(staff).toMatchObject({ id: "staff:interim", role: "broker" });
    expect(canDecide(staff!)).toBe(true);
    expect(await resolveStaff(() => staffCookieValue("y".repeat(40)))).toBeNull();
  });

  it("lets staff auth plug in its own resolver", async () => {
    setStaffResolver(async () => ({ id: "u9", email: "analyst@k.com", name: "A", role: "analyst", dreLicense: null }));
    const s = await resolveStaff(() => undefined);
    expect(s?.role).toBe("analyst");
    expect(canDecide(s!)).toBe(false);
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
