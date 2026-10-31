import { describe, expect, it } from "vitest";
import { TEAM, isPlaceholderBio, isValidLicenseId, licenseDisplay, teamCards, type TeamMember } from "./team";

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  slug: "a-person",
  name: "A Person",
  title: "Senior advisor",
  role: "salesperson",
  licenseId: "01234567",
  bio: "Twelve years arranging senior housing debt.",
  focus: ["HUD 232"],
  ...over,
});

describe("license ids", () => {
  it.each([
    ["01234567", true],
    [" 01234567 ", true],
    ["1234567", false],
    ["123456789", false],
    ["abcdefgh", false],
    ["00000000", false],
    ["", false],
  ])("%j valid=%s", (id, ok) => expect(isValidLicenseId(id)).toBe(ok));
});

describe("licenseDisplay", () => {
  it("links a valid number to the DRE lookup", () => {
    const d = licenseDisplay({ role: "broker", licenseId: "01234567" });
    expect(d).toEqual({ kind: "verified", id: "01234567", lookupUrl: expect.stringContaining("License_id=01234567") });
  });

  it("marks a licensed role without a usable number as pending", () => {
    expect(licenseDisplay({ role: "broker", licenseId: "" })).toEqual({ kind: "pending" });
    expect(licenseDisplay({ role: "salesperson", licenseId: "123" })).toEqual({ kind: "pending" });
  });

  it("does not ask unlicensed roles for a number", () => {
    expect(licenseDisplay({ role: "analyst", licenseId: "" })).toEqual({ kind: "none" });
    expect(licenseDisplay({ role: "operations", licenseId: "" })).toEqual({ kind: "none" });
  });
});

describe("placeholder bios", () => {
  it.each([
    ["TODO: bio pending", true],
    ["todo: bio pending. Replace with a bio", true],
    ["   ", true],
    ["", true],
    ["Twelve years in senior housing finance.", false],
  ])("%j placeholder=%s", (bio, expected) => expect(isPlaceholderBio(bio)).toBe(expected));
});

describe("teamCards", () => {
  const complete = member();
  const placeholder = member({ slug: "p", bio: "TODO: bio pending" });
  const noLicense = member({ slug: "n", licenseId: "" });
  const analyst = member({ slug: "an", role: "analyst", licenseId: "" });

  it("shows everything outside production, flagging what is missing", () => {
    const cards = teamCards([complete, placeholder, noLicense, analyst], { production: false });
    expect(cards.map((c) => c.member.slug)).toEqual(["a-person", "p", "n", "an"]);
    expect(cards.find((c) => c.member.slug === "p")?.placeholder).toBe(true);
    expect(cards.find((c) => c.member.slug === "n")?.license.kind).toBe("pending");
  });

  it("hides placeholders and licensed advisors without a number in production", () => {
    const cards = teamCards([complete, placeholder, noLicense, analyst], { production: true });
    expect(cards.map((c) => c.member.slug)).toEqual(["a-person", "an"]);
  });

  it("is empty in production when every entry is a placeholder", () => {
    expect(teamCards([placeholder, noLicense], { production: true })).toEqual([]);
  });
});

describe("shipped roster", () => {
  it("names the designated officer and keeps the unwritten bio a placeholder", () => {
    expect(TEAM.length).toBeGreaterThan(0);
    for (const m of TEAM) {
      expect(m.name.length).toBeGreaterThan(0);
      // No fabricated bios: anything shipped without real text must be flagged.
      if (isPlaceholderBio(m.bio)) expect(m.bio.toLowerCase()).toContain("todo: bio pending");
    }
  });

  it("is hidden from production while the bio is pending", () => {
    expect(teamCards(TEAM, { production: true }).filter((c) => c.placeholder)).toEqual([]);
  });
});
