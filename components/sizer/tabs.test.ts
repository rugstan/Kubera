import { describe, expect, it } from "vitest";
import { sizerLinkFor } from "@/components/site/nav";
import { PROGRAM_FAMILIES } from "@/content/programs/types";
import { DEFAULT_SIZER_TAB, SIZER_TABS, sizerTabFromParam } from "./tabs";

describe("sizer tabs", () => {
  it("follow the menu's family order and names, with Construction before Hard money", () => {
    expect(SIZER_TABS.map((t) => t.label)).toEqual(["Senior living", "Hotels", "Multifamily", "Construction", "Hard money"]);
    expect(SIZER_TABS.map((t) => t.id)).toEqual(["senior", "hospitality", "multifamily", "construction", "hardMoney"]);
    expect(DEFAULT_SIZER_TAB).toBe("senior");
  });

  it("opens every family's tab from the ?sizer= link a program page sends", () => {
    for (const family of PROGRAM_FAMILIES) {
      const href = sizerLinkFor(family).href;
      const param = new URL(href, "https://example.test").searchParams.get("sizer");
      expect(sizerTabFromParam(param), family).toBe(SIZER_TABS[PROGRAM_FAMILIES.indexOf(family)]!.id);
    }
    expect(sizerTabFromParam("hard-money")).toBe("hardMoney");
    expect(sizerTabFromParam(" construction ")).toBe("construction");
  });

  it("ignores missing and unknown values", () => {
    for (const raw of [null, undefined, "", "hardMoney", "crypto"]) expect(sizerTabFromParam(raw)).toBeUndefined();
  });
});
