// The /settings/ai server action: re-authentication, the administrator check,
// form validation and the redirect codes, against the fake-auth in-memory store.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const staffForMutation = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ staffForMutation: () => staffForMutation() }));

const who = (staffRoles: string[]) => ({
  ok: true as const,
  ctx: { principal: { userId: "00000000-0000-4000-8000-0000000000ad", email: "admin@corin.test", displayName: "Demo Admin", staffRoles }, accessToken: "t", services: { mode: "fake" } },
});

let actions: typeof import("./actions");
let settings: typeof import("@/lib/ai/model-settings");

beforeAll(async () => {
  vi.stubEnv("AUTH_PROVIDER", "fake");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  actions = await import("./actions");
  settings = await import("@/lib/ai/model-settings");
});

afterAll(() => {
  settings.memoryTaskModelStore().rows.length = 0;
  vi.unstubAllEnvs();
});

beforeEach(() => {
  settings.memoryTaskModelStore().rows.length = 0;
  settings.resetTaskModelCache();
  staffForMutation.mockReset();
  staffForMutation.mockResolvedValue(who(["admin"]));
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

async function call(fields: Record<string, string>): Promise<URLSearchParams> {
  try {
    await actions.saveTaskModelAction(form(fields));
  } catch (err) {
    if (err instanceof Redirect) return new URL(err.url, "http://localhost").searchParams;
    throw err;
  }
  throw new Error("expected a redirect");
}

describe("saveTaskModelAction", () => {
  it("saves an administrator's choice and the resolver uses it", async () => {
    const res = await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "Haiku misfiles lender replies" });
    expect(res.get("saved")).toBe("mail.triage");
    expect(settings.memoryTaskModelStore().rows).toMatchObject([{ task: "mail.triage", model: "claude-sonnet-5-5", previousModel: "claude-haiku-5-5", setByLabel: "Demo Admin" }]);
    expect(await settings.resolveTaskModel("mail.triage")).toBe("claude-sonnet-5-5");
    // "default" goes back to the task's default.
    expect((await call({ task: "mail.triage", model: "default", reason: "Back to normal" })).get("saved")).toBe("mail.triage");
    expect(await settings.resolveTaskModel("mail.triage")).toBe("claude-haiku-5-5");
  });

  it("refuses brokers and analysts, and signed-out or unverified sessions", async () => {
    for (const roles of [["broker"], ["analyst"]]) {
      staffForMutation.mockResolvedValue(who(roles));
      expect((await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "x" })).get("error")).toBe("forbidden");
    }
    staffForMutation.mockResolvedValue({ ok: false, status: 403, reason: "mfa_required" });
    expect((await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "x" })).get("error")).toBe("mfa");
    staffForMutation.mockResolvedValue({ ok: false, status: 401, reason: "signed_out" });
    expect((await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "x" })).get("error")).toBe("signed_out");
    expect(settings.memoryTaskModelStore().rows).toEqual([]);
  });

  it("requires a reason and an allowed model for a known task", async () => {
    expect(Object.fromEntries(await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "  " }))).toEqual({ error: "reason_required", task: "mail.triage" });
    expect(Object.fromEntries(await call({ task: "mail.triage", model: "grok-4", reason: "cheaper" }))).toEqual({ error: "model_not_allowed", task: "mail.triage" });
    expect(Object.fromEntries(await call({ task: "documents.extract_pdf", model: "claude-opus-5-5", reason: "same" }))).toEqual({ saved: "documents.extract_pdf" });
    expect(Object.fromEntries(await call({ task: "documents.extract_pdf", model: "claude-opus-5-5", reason: "again" }))).toEqual({ error: "no_change", task: "documents.extract_pdf" });
    expect((await call({ task: "nope", model: "claude-opus-5-5", reason: "x" })).get("error")).toBe("bad_request");
    expect((await call({ task: "mail.triage", model: "claude sonnet; drop", reason: "x" })).get("error")).toBe("bad_request");
    expect((await call({ task: "mail.triage", model: "claude-sonnet-5-5", reason: "r".repeat(501) })).get("error")).toBe("bad_request");
  });
});
