import { describe, expect, it } from "vitest";
import { BRIDGE, SBA } from "@/lib/sizing/assumptions";
import { coarseTimeline } from "./timeline";

const DAY_RANGE = /\b\d+\s*[–-]\s*\d+\s+(?:days|business days|weeks)\b/i;

describe("coarseTimeline", () => {
  it.each([
    ["120–180 days (LEAN) after a complete file; not guaranteed", "about 4–6 months after a complete file; not guaranteed"],
    ["45–75 days after a complete file; not guaranteed", "about 2–3 months after a complete file; not guaranteed"],
    ["60–90 days after a complete file; not guaranteed", "about 2–3 months after a complete file; not guaranteed"],
    ["45–60 days after a complete file; not guaranteed", "about 2 months after a complete file; not guaranteed"],
    ["21–45 days after a complete file; not guaranteed", "a few weeks after a complete file; not guaranteed"],
    ["Often 3–5 weeks after a complete file; not guaranteed", "Often a few weeks after a complete file; not guaranteed"],
    ["9–12 months after a complete file; not guaranteed", "9–12 months after a complete file; not guaranteed"],
  ])("%s", (input, expected) => {
    expect(coarseTimeline(input)).toBe(expected);
  });

  it("leaves no day or week range in the shared assumption text and keeps the qualifier", () => {
    for (const text of [SBA.typicalCloseDays, BRIDGE.closeDays]) {
      const out = coarseTimeline(text);
      expect(out).not.toMatch(DAY_RANGE);
      expect(out).toMatch(/not guaranteed/);
    }
  });
});
