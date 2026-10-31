import { describe, expect, it } from "vitest";
import { DESKTOP_REVEAL_SCROLL_PX, isAskButtonRouteHidden, isPastDesktopThreshold } from "./visibility";

describe("isAskButtonRouteHidden", () => {
  it("hides the floating button on the express funnel and partner portal", () => {
    expect(isAskButtonRouteHidden("/express")).toBe(true);
    expect(isAskButtonRouteHidden("/partners")).toBe(true);
    expect(isAskButtonRouteHidden("/partners/lenders")).toBe(true);
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
