import { describe, expect, it } from "vitest";
import { accessTokenFromCookies, can, projectRef, requirePermission, resolveStaffSession, sessionFromUser, StaffAccessError, type StaffSession } from "./session";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
const user = (meta: Record<string, unknown>, email = "Ana@KuberaCommercial.com") => ({ id: "u1", email, app_metadata: meta, user_metadata: { full_name: "Ana Ruiz" } });

describe("staff session", () => {
  it("reads the access token from plain, base64 and chunked Supabase cookies", () => {
    const token = jwt({ sub: "u1", aal: "aal2" });
    const session = JSON.stringify({ access_token: token, refresh_token: "r" });
    expect(projectRef("https://abcd1234.supabase.co")).toBe("abcd1234");
    expect(accessTokenFromCookies([{ name: "sb-abcd1234-auth-token", value: encodeURIComponent(session) }], "abcd1234")).toBe(token);
    const encoded = `base64-${Buffer.from(session).toString("base64url")}`;
    expect(accessTokenFromCookies([{ name: "sb-abcd1234-auth-token", value: encoded }], "abcd1234")).toBe(token);
    const half = Math.floor(encoded.length / 2);
    expect(accessTokenFromCookies([{ name: "sb-abcd1234-auth-token.1", value: encoded.slice(half) }, { name: "sb-abcd1234-auth-token.0", value: encoded.slice(0, half) }], "abcd1234")).toBe(token);
    expect(accessTokenFromCookies([{ name: "sb-other-auth-token", value: session }], "abcd1234")).toBeNull();
    expect(accessTokenFromCookies([{ name: "sb-abcd1234-auth-token", value: "garbage" }], "abcd1234")).toBeNull();
  });

  it("requires a staff role from app_metadata and an MFA (aal2) session", () => {
    expect(sessionFromUser(user({ role: "broker" }), { aal: "aal1" })).toBeNull();
    expect(sessionFromUser(user({ role: "borrower" }), { aal: "aal2" })).toBeNull();
    expect(sessionFromUser({ ...user({}), user_metadata: { role: "admin" } }, { aal: "aal2" })).toBeNull();
    const s = sessionFromUser(user({ role: "broker", dre_license: "01234567", designated_officer: true }), { aal: "aal2" })!;
    expect(s).toMatchObject({ role: "broker", email: "ana@kuberacommercial.com", name: "Ana Ruiz", dreLicense: "01234567", designatedOfficer: true, actor: "staff:ana@kuberacommercial.com" });
  });

  it("verifies the token with Supabase Auth and fails closed", async () => {
    const token = jwt({ sub: "u1", aal: "aal2" });
    const cookies = [{ name: "sb-ref-auth-token", value: JSON.stringify({ access_token: token }) }];
    const ok = { auth: { getUser: async (t: string) => (t === token ? { data: { user: user({ role: "analyst" }) }, error: null } : { data: { user: null }, error: new Error("bad") }) } };
    expect(await resolveStaffSession({ cookies, supabase: ok as never, supabaseUrl: "https://ref.supabase.co" })).toMatchObject({ role: "analyst" });
    const rejected = { auth: { getUser: async () => ({ data: { user: null }, error: new Error("expired") }) } };
    expect(await resolveStaffSession({ cookies, supabase: rejected as never, supabaseUrl: "https://ref.supabase.co" })).toBeNull();
    expect(await resolveStaffSession({ cookies, supabase: null, supabaseUrl: "https://ref.supabase.co" })).toBeNull();
    expect(await resolveStaffSession({ cookies: [], supabase: ok as never, supabaseUrl: "https://ref.supabase.co" })).toBeNull();
  });

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
