import { describe, expect, it } from "vitest";
import { californiaDate, can, evaluateStaffAccess, licenseStatus, requiresMfa, type AccessInput } from "./policy";
import type { Profile, StaffPrincipal } from "./types";

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: "u1",
  email: "pat@corin.test",
  fullName: "Pat Broker",
  title: null,
  active: true,
  dreLicenseNumber: "01234567",
  dreLicenseType: "broker",
  dreLicenseExpiresOn: "2028-01-31",
  dreLicenseVerifiedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const input = (over: Partial<AccessInput> = {}): AccessInput => ({
  session: { userId: "u1", email: "pat@corin.test", aal: "aal2" },
  profile: profile(),
  roles: ["broker"],
  ...over,
});

const principal = (roles: StaffPrincipal["staffRoles"], p: Partial<Profile> = {}): StaffPrincipal => {
  const d = evaluateStaffAccess(input({ roles, profile: profile(p) }));
  if (d.kind !== "allow") throw new Error(`expected allow, got ${d.kind}`);
  return d.principal;
};

describe("evaluateStaffAccess", () => {
  it("allows an active staff member with an MFA session", () => {
    const d = evaluateStaffAccess(input({ roles: ["broker", "analyst", "broker"] }));
    expect(d.kind).toBe("allow");
    if (d.kind === "allow") {
      expect(d.principal.staffRoles).toEqual(["analyst", "broker"]);
      expect(d.principal.displayName).toBe("Pat Broker");
    }
  });

  it("requires sign-in, then MFA, for staff", () => {
    expect(evaluateStaffAccess(input({ session: null }))).toEqual({ kind: "sign_in" });
    expect(evaluateStaffAccess(input({ session: { userId: "u1", email: "pat@corin.test", aal: "aal1" } }))).toEqual({ kind: "mfa" });
  });

  it("refuses portal users, missing or deactivated profiles and mismatched ids", () => {
    expect(evaluateStaffAccess(input({ roles: ["borrower"] }))).toEqual({ kind: "forbidden", reason: "not_staff" });
    expect(evaluateStaffAccess(input({ roles: [] }))).toEqual({ kind: "forbidden", reason: "not_staff" });
    expect(evaluateStaffAccess(input({ profile: null }))).toEqual({ kind: "forbidden", reason: "inactive" });
    expect(evaluateStaffAccess(input({ profile: profile({ active: false }) }))).toEqual({ kind: "forbidden", reason: "inactive" });
    expect(evaluateStaffAccess(input({ profile: profile({ id: "someone-else" }) }))).toEqual({ kind: "forbidden", reason: "inactive" });
  });

  it("checks MFA only after the role check (portal users never see the MFA step)", () => {
    expect(evaluateStaffAccess(input({ roles: ["partner"], session: { userId: "u1", email: "x", aal: "aal1" } }))).toEqual({ kind: "forbidden", reason: "not_staff" });
    expect(requiresMfa(["partner"])).toBe(false);
    expect(requiresMfa(["borrower", "analyst"])).toBe(true);
  });
});

describe("licenseStatus", () => {
  const today = "2026-10-31";
  it("grades the DRE license on file", () => {
    expect(licenseStatus(profile(), today)).toEqual({ status: "current", daysToExpiry: 457 });
    expect(licenseStatus(profile({ dreLicenseExpiresOn: "2026-12-01" }), today)).toEqual({ status: "expiring", daysToExpiry: 31 });
    expect(licenseStatus(profile({ dreLicenseExpiresOn: "2026-10-31" }), today)).toEqual({ status: "expiring", daysToExpiry: 0 });
    expect(licenseStatus(profile({ dreLicenseExpiresOn: "2026-10-30" }), today)).toEqual({ status: "expired" });
    expect(licenseStatus(profile({ dreLicenseNumber: null }), today)).toEqual({ status: "missing" });
    expect(licenseStatus(profile({ dreLicenseNumber: "1234" }), today)).toEqual({ status: "invalid" });
    expect(licenseStatus(profile({ dreLicenseVerifiedAt: null }), today)).toEqual({ status: "unverified" });
  });
});

describe("can", () => {
  const today = "2026-10-31";
  it("lets only a currently licensed, verified broker approve", () => {
    expect(can(principal(["broker"]), "approve", today)).toEqual({ ok: true });
    expect(can(principal(["admin"]), "approve", today)).toMatchObject({ ok: false, reason: expect.stringContaining("broker") });
    expect(can(principal(["analyst"]), "approve", today).ok).toBe(false);
    expect(can(principal(["broker"], { dreLicenseNumber: null, dreLicenseType: null, dreLicenseExpiresOn: null }), "approve", today)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Add your DRE license"),
    });
    expect(can(principal(["broker"], { dreLicenseExpiresOn: "2026-01-01" }), "approve", today)).toMatchObject({ ok: false, reason: expect.stringContaining("expired") });
    expect(can(principal(["broker"], { dreLicenseVerifiedAt: null }), "approve", today)).toMatchObject({ ok: false, reason: expect.stringContaining("verified") });
  });

  it("lets brokers and admins stop a send; analysts only view", () => {
    expect(can(principal(["admin"]), "reject", today).ok).toBe(true);
    expect(can(principal(["broker"], { dreLicenseNumber: null, dreLicenseType: null, dreLicenseExpiresOn: null }), "reject", today).ok).toBe(true);
    expect(can(principal(["analyst"]), "reject", today).ok).toBe(false);
    expect(can(principal(["analyst"]), "view_pipeline", today).ok).toBe(true);
    expect(can(principal(["analyst"]), "view_documents", today).ok).toBe(true);
    expect(can(principal(["broker"]), "view_audit", today).ok).toBe(false);
    expect(can(principal(["admin"]), "view_audit", today).ok).toBe(true);
  });

  it("lets only administrators choose which model a task uses", () => {
    expect(can(principal(["admin"]), "manage_ai_settings", today)).toEqual({ ok: true });
    expect(can(principal(["admin", "analyst"]), "manage_ai_settings", today).ok).toBe(true);
    // A licensed broker is not enough, and neither is an analyst.
    expect(can(principal(["broker"]), "manage_ai_settings", today)).toMatchObject({ ok: false, reason: expect.stringContaining("administrators") });
    expect(can(principal(["analyst"]), "manage_ai_settings", today).ok).toBe(false);
  });
});

describe("californiaDate", () => {
  it("uses the Pacific calendar date", () => {
    expect(californiaDate(new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-31");
    expect(californiaDate(new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
  });
});
