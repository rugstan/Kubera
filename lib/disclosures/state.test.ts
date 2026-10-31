import { describe, expect, it } from "vitest";
import { InvalidTransitionError, canTransition, disclosureStatuses, isTerminal, nextStatus, type DisclosureTransition } from "./state";

describe("disclosure state machine", () => {
  it("follows required → generated → sent → signed", () => {
    expect(nextStatus("required", "generate")).toBe("generated");
    expect(nextStatus("generated", "send")).toBe("sent");
    expect(nextStatus("sent", "complete")).toBe("signed");
  });

  it("returns to generated when the provider voids a sent request", () => {
    expect(nextStatus("sent", "void")).toBe("generated");
  });

  it("allows a counsel hold from any unsigned state and releases to required", () => {
    for (const s of ["required", "generated", "sent"] as const) expect(nextStatus(s, "hold")).toBe("held_for_counsel");
    expect(nextStatus("held_for_counsel", "release")).toBe("required");
    expect(canTransition("signed", "hold")).toBe(false);
  });

  it("never skips signature or reopens a signed disclosure", () => {
    const bad: [Parameters<typeof nextStatus>[0], DisclosureTransition][] = [
      ["required", "send"],
      ["required", "complete"],
      ["generated", "complete"],
      ["signed", "generate"],
      ["signed", "void"],
      ["held_for_counsel", "send"],
      ["held_for_counsel", "generate"],
      ["superseded", "release"],
    ];
    for (const [from, t] of bad) expect(() => nextStatus(from, t)).toThrow(InvalidTransitionError);
  });

  it("supersedes signed disclosures, and superseded is terminal", () => {
    expect(nextStatus("signed", "supersede")).toBe("superseded");
    expect(isTerminal("superseded")).toBe(true);
    expect(disclosureStatuses.filter(isTerminal)).toEqual(["superseded"]);
  });
});
