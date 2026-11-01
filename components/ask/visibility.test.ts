import { describe, expect, it } from "vitest";
import { staffRouteFolders } from "@/lib/auth/staff-route-folders";
import { DESKTOP_REVEAL_SCROLL_PX, isAskButtonRouteHidden, isPastDesktopThreshold } from "./visibility";

describe("isAskButtonRouteHidden", () => {
  it("hides the floating button on the express funnel and partner portal", () => {
    expect(isAskButtonRouteHidden("/express")).toBe(true);
    expect(isAskButtonRouteHidden("/partners")).toBe(true);
    expect(isAskButtonRouteHidden("/partners/lenders")).toBe(true);
  });

  it("hides it on staff, portal and sign-in routes", () => {
    for (const p of ["/pipeline", "/approvals", "/documents/abc", "/deals/123", "/checklists", "/construction", "/portal/profile", "/login", "/mfa", "/auth/confirm", "/access-denied"]) {
      expect(isAskButtonRouteHidden(p)).toBe(true);
    }
    expect(isAskButtonRouteHidden("/accessibility")).toBe(false);
  });

  it("hides it on every staff desk, read from the folders under app/(staff)/", () => {
    const folders = staffRouteFolders();
    expect(folders).toEqual(expect.arrayContaining(["lenders", "reports", "ai-review", "prospects"]));
    for (const f of folders) {
      expect(isAskButtonRouteHidden(`/${f}`), `/${f}`).toBe(true);
      expect(isAskButtonRouteHidden(`/${f}/sub`), `/${f}/sub`).toBe(true);
    }
    for (const p of ["/lenders/boxes/new", "/prospects/intel", "/prospects/suppressions"]) {
      expect(isAskButtonRouteHidden(p), p).toBe(true);
    }
  });

  it("shows it elsewhere", () => {
    expect(isAskButtonRouteHidden("/")).toBe(false);
    expect(isAskButtonRouteHidden("/privacy")).toBe(false);
    expect(isAskButtonRouteHidden("/expressway")).toBe(false);
    expect(isAskButtonRouteHidden(null)).toBe(false);
  });
});

describe("isPastDesktopThreshold", () => {
  it("reveals only after the threshold", () => {
    expect(isPastDesktopThreshold(0)).toBe(false);
    expect(isPastDesktopThreshold(DESKTOP_REVEAL_SCROLL_PX)).toBe(false);
    expect(isPastDesktopThreshold(DESKTOP_REVEAL_SCROLL_PX + 1)).toBe(true);
  });
});
