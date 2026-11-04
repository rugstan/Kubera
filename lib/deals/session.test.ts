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
