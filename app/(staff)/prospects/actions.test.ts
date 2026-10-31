// Staff server actions for prospecting: authentication and validation, run
// against the in-memory demo runtime (fake-auth mode).
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

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

const ctx = (email = "Ana@Kubera.test") => ({ ok: true as const, ctx: { principal: { userId: "u1", email, displayName: "Ana Ruiz", staffRoles: ["analyst"] }, accessToken: "t", services: { mode: "fake" } } });

let actions: typeof import("./actions");
let intelRuntime: typeof import("@/lib/agents/intel/runtime").intelRuntime;

beforeAll(async () => {
  process.env.AUTH_PROVIDER = "fake";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  actions = await import("./actions");
  ({ intelRuntime } = await import("@/lib/agents/intel/runtime"));
});

beforeEach(() => {
  staffForMutation.mockReset();
  staffForMutation.mockResolvedValue(ctx());
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** Runs an action and returns the redirect target as a URL. */
async function call(fn: () => Promise<never>): Promise<URL> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Redirect) return new URL(err.url, "http://localhost");
    throw err;
  }
  throw new Error("expected a redirect");
}

async function firstProspect(filter: Parameters<NonNullable<Awaited<ReturnType<typeof intelRuntime>>>["prospects"]["listProspects"]>[0] = {}) {
  const rt = (await intelRuntime())!;
  return { rt, prospect: (await rt.prospects.listProspects(filter))[0]! };
}

describe("authentication", () => {
  it("refuses everything when the session is gone or MFA is missing", async () => {
    staffForMutation.mockResolvedValue({ ok: false, status: 401, reason: "signed_out" });
    expect((await call(() => actions.scanAction(form({ zips: "90001" })))).searchParams.get("error")).toMatch(/Sign in/);
    staffForMutation.mockResolvedValue({ ok: false, status: 403, reason: "mfa_required" });
    expect((await call(() => actions.generateIntelAction(form({})))).searchParams.get("error")).toMatch(/two-step/);
    expect((await call(() => actions.settleAllAction())).searchParams.get("error")).toMatch(/two-step/);
  });
});

describe("demo runtime", () => {
  it("is seeded through the real scan and score code", async () => {
    const rt = (await intelRuntime())!;
    expect(rt.mode).toBe("demo");
    const rows = await rt.prospects.listProspects({ limit: 50 });
    expect(rows.length).toBe(6);
    expect(rows.every((p) => p.scoreFactors.length === 6)).toBe(true);
    expect(rows[0]!.score).toBeGreaterThanOrEqual(rows.at(-1)!.score);
  });
});

describe("scan", () => {
  it("runs a scan and reports counts", async () => {
    const url = await call(() => actions.scanAction(form({ zips: "90001 91201 92801 89501", fromMonths: "0", toMonths: "18" })));
    expect(url.pathname).toBe("/prospects");
    expect(url.searchParams.get("notice")).toMatch(/Scan complete: \d+ found, 0 new, \d+ refreshed/);
  });

  it("explains a bad query instead of failing", async () => {
    expect((await call(() => actions.scanAction(form({ zips: "9000" })))).searchParams.get("error")).toMatch(/five-digit/);
    expect((await call(() => actions.scanAction(form({ zips: "" })))).searchParams.get("error")).toMatch(/at least one ZIP/);
  });
});

describe("outreach", () => {
  it("drafts an email only with a contact, queues it for approval and sends nothing", async () => {
    const { rt, prospect } = await firstProspect({ q: "100 Example" });
    const path = `/prospects/${prospect.id}`;
    const noContact = await call(() => actions.draftOutreachAction(form({ prospectId: prospect.id, channel: "email" })));
    expect(noContact.pathname).toBe(path);
    expect(noContact.searchParams.get("error")).toMatch(/contact email/);

    await call(() => actions.updateProspectAction(form({ prospectId: prospect.id, contactName: "Pat Owner", contactEmail: "pat@owner.example", status: "reviewing" })));
    expect((await rt.prospects.getProspect(prospect.id))!.contactEmail).toBe("pat@owner.example");

    const ok = await call(() => actions.draftOutreachAction(form({ prospectId: prospect.id, channel: "email" })));
    expect(ok.searchParams.get("error")).toBeNull();
    expect(ok.searchParams.get("notice")).toMatch(/approvals queue/);
    const [draft] = await rt.prospects.listOutreach(prospect.id);
    expect(draft).toMatchObject({ status: "pending_approval", channel: "email", draftedBy: "staff:ana@kubera.test" });

    // Repeating the request does not create a second approval.
    const again = await call(() => actions.draftOutreachAction(form({ prospectId: prospect.id, channel: "email" })));
    expect(again.searchParams.get("notice")).toMatch(/already waiting/);
    expect(await rt.prospects.listOutreach(prospect.id)).toHaveLength(1);

    // Checking before a broker decides changes nothing.
    const check = await call(() => actions.settleOutreachAction(form({ prospectId: prospect.id, outreachId: draft!.id })));
    expect(check.searchParams.get("notice")).toMatch(/Waiting for broker approval|not configured/);
    expect((await rt.prospects.getOutreach(draft!.id))!.status).toBe("pending_approval");

    const cancelled = await call(() => actions.cancelOutreachAction(form({ prospectId: prospect.id, outreachId: draft!.id })));
    expect(cancelled.searchParams.get("notice")).toBe("Draft cancelled.");
  });

  it("refuses an out-of-state property and a malformed id", async () => {
    const { prospect } = await firstProspect({ q: "Mock Parkway" });
    expect(prospect.state).toBe("NV");
    const rt = (await intelRuntime())!;
    await rt.prospects.updateStaff(prospect.id, { contactEmail: "x@owner.example" }, "staff", new Date());
    expect((await call(() => actions.draftOutreachAction(form({ prospectId: prospect.id, channel: "email" })))).searchParams.get("error")).toMatch(/outside California/);
    expect((await call(() => actions.draftOutreachAction(form({ prospectId: "nope", channel: "email" })))).searchParams.get("error")).toMatch(/could not be found/);
  });

  it("adds a prospect to the do-not-contact list and blocks further drafts", async () => {
    const { rt, prospect } = await firstProspect({ q: "Fictional" });
    await rt.prospects.updateStaff(prospect.id, { contactEmail: "alex@sample.example" }, "staff", new Date());
    const url = await call(() => actions.suppressProspectAction(form({ prospectId: prospect.id, reason: "opt_out" })));
    expect(url.searchParams.get("notice")).toMatch(/do-not-contact list/);
    expect((await rt.prospects.getProspect(prospect.id))!.status).toBe("do_not_contact");
    expect((await call(() => actions.draftOutreachAction(form({ prospectId: prospect.id, channel: "email" })))).searchParams.get("error")).toMatch(/do-not-contact/);
  });

  it("adds a value to the list from the suppressions page", async () => {
    const url = await call(() => actions.addSuppressionAction(form({ kind: "email", value: "stop@owner.example", reason: "opt_out" })));
    expect(url.pathname).toBe("/prospects/suppressions");
    expect(url.searchParams.get("notice")).toMatch(/s\*\*\*@owner\.example/);
    expect((await call(() => actions.addSuppressionAction(form({ kind: "email", value: "not-an-email", reason: "opt_out" })))).searchParams.get("error")).toMatch(/email address/);
    expect((await call(() => actions.addSuppressionAction(form({ kind: "phone", value: "x", reason: "opt_out" })))).searchParams.get("error")).toBeTruthy();
  });

  it("checks every waiting draft in one call", async () => {
    const url = await call(() => actions.settleAllAction());
    expect(url.searchParams.get("notice")).toMatch(/Checked \d+ waiting drafts/);
  });
});

describe("market intel", () => {
  it("generates a rules digest without an xAI key, then edits and approves it", async () => {
    delete process.env.XAI_API_KEY;
    const gen = await call(() => actions.generateIntelAction(form({ focus: "hotel debt" })));
    expect(gen.pathname).toBe("/prospects/intel");
    expect(gen.searchParams.get("notice")).toMatch(/Draft ready for review \(rules digest/);
    const rt = (await intelRuntime())!;
    const [draft] = await rt.intel.listDrafts({ status: "pending_review" });
    expect(draft).toMatchObject({ generatedBy: "rules", createdBy: "staff:ana@kubera.test" });
    expect(draft!.signals.length).toBeGreaterThan(0);

    const edited = await call(() => actions.editIntelAction(form({ id: draft!.id, headline: "Edited headline", summary: "Edited summary", "bullet-0-0": "Edited bullet" })));
    expect(edited.searchParams.get("notice")).toBe("Edits saved.");
    expect((await rt.intel.getDraft(draft!.id))!).toMatchObject({ headline: "Edited headline", editedBy: "staff:ana@kubera.test" });

    expect((await call(() => actions.reviewIntelAction(form({ id: draft!.id, decision: "rejected" })))).searchParams.get("error")).toMatch(/why/);
    const approved = await call(() => actions.reviewIntelAction(form({ id: draft!.id, decision: "approved" })));
    expect(approved.searchParams.get("notice")).toMatch(/Nothing was published or sent/);
    expect((await rt.intel.getDraft(draft!.id))!.status).toBe("approved");
    expect((await call(() => actions.reviewIntelAction(form({ id: draft!.id, decision: "approved" })))).searchParams.get("error")).toMatch(/already decided/);
    expect((await call(() => actions.editIntelAction(form({ id: draft!.id, headline: "x", summary: "y", "bullet-0-0": "z" })))).searchParams.get("error")).toMatch(/waiting for review/);
  });
});
