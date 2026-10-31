import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { HUD_FACTS_AS_OF, PROGRAM_PRIMER, retrieve } = await import("./knowledge");
const { ASSUMPTIONS_REVIEWED } = await import("@/lib/sizing/assumptions");

const line = (needle: string) => PROGRAM_PRIMER.split("\n").find((l) => l.includes(needle)) ?? "";

describe("advisor program primer — HUD facts", () => {
  it("dates the HUD figures with the assumptions review date", () => {
    expect(HUD_FACTS_AS_OF).toBe(ASSUMPTIONS_REVIEWED);
    expect(HUD_FACTS_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("states the 2025 HUD 223(f) boxes with an as-of date and source", () => {
    const l = line("HUD 223(f) (as of");
    expect(l).toContain(`as of ${HUD_FACTS_AS_OF}`);
    expect(l).toContain("Mortgagee Letter 2025-03");
    expect(l).toContain("87% LTV at 1.15x");
    expect(l).toContain("90% LTV at 1.11x");
    expect(l).toContain("rental-assistance");
  });

  it("states the 2025 HUD 221(d)(4) boxes and keeps the middle-income tier unquoted", () => {
    const l = line("HUD 221(d)(4) (as of");
    expect(l).toContain(`as of ${HUD_FACTS_AS_OF}`);
    expect(l).toContain("87% LTC at 1.15x");
    expect(l).toContain("90% LTC at 1.11x");
    expect(l).toMatch(/middle-income .*do not quote it/);
  });

  it("states the flat 0.25% multifamily MIP with its effective date", () => {
    const l = line("HUD multifamily MIP (as of");
    expect(l).toContain(`as of ${HUD_FACTS_AS_OF}`);
    expect(l).toContain("Federal Register, Sept 23, 2025");
    expect(l).toContain("flat 0.25% annual MIP");
    expect(l).toContain("on or after Oct 1, 2025");
  });

  it("keeps Section 232 on its unchanged values", () => {
    expect(PROGRAM_PRIMER).toContain("Typical max 80% LTV (for-profit), 1.45x minimum DSCR");
    expect(PROGRAM_PRIMER).toContain("~0.65% for 223(f)");
    expect(PROGRAM_PRIMER).toContain("not changed by HUD Mortgagee Letter 2025-03");
  });

  it("drops the retired values and the green MIP incentive", () => {
    expect(PROGRAM_PRIMER).not.toContain("1.176");
    expect(PROGRAM_PRIMER).not.toMatch(/0\.60[–-]0\.65%/);
    expect(PROGRAM_PRIMER).not.toMatch(/0\.25% Green/i);
    expect(PROGRAM_PRIMER).not.toMatch(/Green MIP/i);
    expect(PROGRAM_PRIMER).toContain("Green certification does not lower HUD MIP");
  });
});

describe("retrieve", () => {
  it("returns no chunks when Supabase is not configured", async () => {
    await expect(retrieve("HUD 223(f) leverage")).resolves.toEqual([]);
  });
});
