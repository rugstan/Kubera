// Every staff desk (deal desk, checklists, construction) takes its session only
// from lib/auth (active profile, staff role, MFA). With lib/auth disabled, or
// with only a leftover interim cookie or a raw Supabase Auth cookie, each one
// fails closed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const signedIn = vi.fn();
const jar = [
  { name: "kubera_staff", value: "interim-cookie" },
  { name: "sb-abcd1234-auth-token", value: JSON.stringify({ access_token: "a.b.c" }) },
];

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => jar, get: (n: string) => jar.find((c) => c.name === n) }),
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth/staff", () => ({
  signedInStaff: () => signedIn(),
  primaryStaffRole: () => "broker",
  staffDreLicense: () => "01234567",
}));

const principal = { userId: "u1", email: "Ana@KuberaCommercial.com", displayName: "Ana Ruiz", staffRoles: ["broker"], profile: { dreLicenseNumber: "01234567", dreLicenseType: "broker_officer" } };

describe("staff desks use lib/auth only", () => {
  beforeEach(() => {
    signedIn.mockReset();
    vi.stubEnv("STAFF_ACCESS_TOKEN", "t".repeat(40));
    vi.stubEnv("SUPABASE_URL", "https://abcd1234.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when lib/auth has no session, whatever other cookies are present", async () => {
    signedIn.mockResolvedValue(null);
    const deals = await import("@/lib/deals/runtime");
    const checklists = await import("@/app/(staff)/checklists/_lib/session");
    const construction = await import("@/lib/construction/server");
    expect(await deals.currentStaff()).toBeNull();
    expect(await checklists.currentStaff()).toBeNull();
    await expect(checklists.requireStaff()).rejects.toThrow(/Sign in/);
    expect(await construction.currentStaff()).toBeNull();
  });

  it("maps the lib/auth principal on each desk", async () => {
    signedIn.mockResolvedValue(principal);
    const deals = await import("@/lib/deals/runtime");
    const checklists = await import("@/app/(staff)/checklists/_lib/session");
    const construction = await import("@/lib/construction/server");
    expect(await deals.currentStaff()).toMatchObject({ userId: "u1", email: "ana@kuberacommercial.com", role: "broker", designatedOfficer: true, actor: "staff:ana@kuberacommercial.com" });
    expect(await checklists.currentStaff()).toMatchObject({ id: "u1", email: "ana@kuberacommercial.com", role: "broker" });
    expect(await construction.currentStaff()).toMatchObject({ id: "u1", role: "broker" });
  });

  it("no longer exposes the interim sign-in actions", async () => {
    const actions = (await import("@/app/(staff)/checklists/actions")) as Record<string, unknown>;
    expect(actions.signIn).toBeUndefined();
    expect(actions.signOut).toBeUndefined();
  });
});
