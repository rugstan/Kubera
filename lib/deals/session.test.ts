import { describe, expect, it } from "vitest";
import { can, requirePermission, StaffAccessError, type StaffSession } from "./session";

describe("staff session", () => {
  it("maps roles to permissions", () => {
    const base: StaffSession = { userId: "u", email: "a@k", name: "A", role: "analyst", dreLicense: null, designatedOfficer: false, actor: "staff:a@k" };
    expect(can(base, "read")).toBe(true);
    expect(can(base, "write")).toBe(false);
    expect(can({ ...base, role: "broker" }, "write")).toBe(true);
    expect(can({ ...base, role: "admin", designatedOfficer: true }, "officer")).toBe(false);
    expect(can({ ...base, designatedOfficer: true, dreLicense: "01234567" }, "officer")).toBe(true);
    expect(() => requirePermission(null, "read")).toThrow(StaffAccessError);
    expect(() => requirePermission(base, "write")).toThrow(/write access/);
  });
});

describe("reveal_account", () => {
  const base: StaffSession = { userId: "u", email: "a@k", name: "A", role: "analyst", dreLicense: null, designatedOfficer: false, actor: "staff:a@k" };

  it("is for an admin or the designated officer only", () => {
    expect(can(base, "reveal_account")).toBe(false);
    expect(can({ ...base, role: "broker", dreLicense: "01234567" }, "reveal_account")).toBe(false);
    expect(can({ ...base, role: "broker", designatedOfficer: true, dreLicense: "01234567" }, "reveal_account")).toBe(true);
    expect(can({ ...base, role: "broker", designatedOfficer: true, dreLicense: null }, "reveal_account")).toBe(false);
    expect(can({ ...base, role: "admin" }, "reveal_account")).toBe(true);
    // Writers can still add and replace numbers without reading them.
    expect(can({ ...base, role: "broker" }, "write")).toBe(true);
  });

  it("explains the refusal", () => {
    expect(() => requirePermission(base, "reveal_account")).toThrow("Only an administrator or the designated officer can reveal account numbers");
  });
});
