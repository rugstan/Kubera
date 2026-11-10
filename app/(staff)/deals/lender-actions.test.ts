// Lender panel server actions (contact info, contacts, account numbers and the
// reveal) against the in-memory demo desks in fake-auth mode: permissions,
// UUID checks, fixed messages, and no account number in any URL or log.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryAuditSink } from "@/lib/auth/audit";
import type { PiiKeyring } from "@/lib/privacy/crypto";

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
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9" }),
}));

type Principal = { userId: string; email: string; displayName: string; staffRoles: string[]; profile: { dreLicenseNumber: string | null; dreLicenseType: string | null } };
const signedIn = vi.fn<() => Promise<Principal | null>>();
vi.mock("@/lib/auth/staff", () => ({
  signedInStaff: () => signedIn(),
  primaryStaffRole: (p: Principal) => p.staffRoles[0],
  staffDreLicense: (p: Principal) => p.profile.dreLicenseNumber,
}));

const who = {
  analyst: { userId: "u-analyst", email: "analyst@corin.test", displayName: "Analyst", staffRoles: ["analyst"], profile: { dreLicenseNumber: null, dreLicenseType: null } },
  broker: { userId: "u-broker", email: "broker@corin.test", displayName: "Broker", staffRoles: ["broker"], profile: { dreLicenseNumber: "01234567", dreLicenseType: "broker" } },
  officer: { userId: "u-officer", email: "officer@corin.test", displayName: "Officer", staffRoles: ["broker"], profile: { dreLicenseNumber: "07654321", dreLicenseType: "broker_officer" } },
  admin: { userId: "u-admin", email: "admin@corin.test", displayName: "Admin", staffRoles: ["admin"], profile: { dreLicenseNumber: null, dreLicenseType: null } },
} satisfies Record<string, Principal>;

let actions: typeof import("./actions");
let demo: typeof import("@/lib/deals/demo");
let auth: typeof import("@/lib/auth/server");
let ratelimit: typeof import("@/lib/ratelimit");
let crypto: typeof import("@/lib/privacy/crypto");
let clock = Date.parse("2026-11-10T18:00:00.000Z");

beforeAll(async () => {
  process.env.AUTH_PROVIDER = "fake";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  actions = await import("./actions");
  demo = await import("@/lib/deals/demo");
  auth = await import("@/lib/auth/server");
  ratelimit = await import("@/lib/ratelimit");
  crypto = await import("@/lib/privacy/crypto");
});

beforeEach(() => {
  signedIn.mockReset();
  signedIn.mockResolvedValue(who.broker);
  clock += 86_400_000; // a fresh rate-limit window per test
  ratelimit.setRateLimiter(new ratelimit.MemoryRateLimiter(() => clock));
  audit().events.length = 0;
});

afterEach(() => {
  demo.resetDemoDesks();
  crypto.setPiiKeyring(undefined);
  ratelimit.setRateLimiter(undefined);
});

const BANK = "20000000-0000-4000-8000-000000000001";
const FUND = "20000000-0000-4000-8000-000000000002";
const ACCOUNT = "30000000-0000-4000-8000-000000000001";
const store = () => demo.demoDesks()!.deals;
const audit = () => auth.authServices()!.audit as MemoryAuditSink;

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

const as = (p: Principal) => signedIn.mockResolvedValue(p);

describe("write actions", () => {
  it("refuse an analyst and change nothing", async () => {
    as(who.analyst);
    const before = JSON.stringify({ l: [...store().lenders.values()], c: [...store().lenderContacts.values()], a: [...store().lenderAccounts.values()] });
    const contact = [...store().lenderContacts.values()].find((c) => c.lenderId === BANK)!;
    const urls = [
      await call(() => actions.saveLenderContactInfoAction(form({ lenderId: BANK, contactInfoVersion: "1", mainPhone: "(310) 555-0142" }))),
      await call(() => actions.addLenderContactAction(form({ lenderId: BANK, fullName: "Riley Chen" }))),
      await call(() => actions.lenderContactOpAction(form({ lenderId: BANK, contactId: contact.id, recordVersion: "1", op: "mark_left" }))),
      await call(() => actions.addLenderAccountAction(form({ lenderId: BANK, kind: "broker_id", accountNumber: "BRK-12345678" }))),
      await call(() => actions.updateLenderAccountAction(form({ lenderId: BANK, accountId: ACCOUNT, recordVersion: "1", label: "Changed" }))),
      await call(() => actions.deleteLenderAccountAction(form({ lenderId: BANK, accountId: ACCOUNT }))),
    ];
    for (const u of urls) {
      expect(u.pathname).toBe(`/deals/lenders/${BANK}`);
      expect(u.searchParams.get("error")).toMatch(/needs write access/);
    }
    expect(JSON.stringify({ l: [...store().lenders.values()], c: [...store().lenderContacts.values()], a: [...store().lenderAccounts.values()] })).toBe(before);
  });
});

describe("revealLenderAccountAction", () => {
  const reveal = (fields: Record<string, string> = { lenderId: BANK, accountId: ACCOUNT }) => actions.revealLenderAccountAction({}, form(fields));

  it("refuses a broker who is not the designated officer and audits the denial", async () => {
    as(who.broker);
    const r = await reveal();
    expect(r).toEqual({ error: "Only an administrator or the designated officer can reveal account numbers." });
    expect(audit().events).toHaveLength(1);
    expect(audit().events[0]).toMatchObject({ action: "lender.account_reveal_denied", actorId: "u-broker", targetId: ACCOUNT, detail: { reason: "permission" } });
  });

  it("reveals to an admin and to the designated officer after recording the reveal", async () => {
    for (const p of [who.admin, who.officer]) {
      as(p);
      audit().events.length = 0;
      const r = await reveal();
      expect(r.value).toBe("DEMO-BRK-48210937");
      expect(r.label).toBe("Broker ID");
      expect(typeof r.nonce).toBe("number");
      expect(audit().events).toHaveLength(1);
      expect(audit().events[0]).toMatchObject({ action: "lender.account_reveal", actorId: p.userId, targetType: "lender_account", targetId: ACCOUNT, userAgent: "vitest", detail: { lenderId: BANK, kind: "broker_id" } });
      expect(audit().events[0]!.ipHash).toMatch(/^[0-9a-f]+$/);
      expect(JSON.stringify(audit().events)).not.toContain("48210937");
    }
  });

  it("finds nothing for a non-UUID id or an account under another lender", async () => {
    as(who.admin);
    for (const fields of [{ lenderId: "bank", accountId: ACCOUNT }, { lenderId: BANK, accountId: "1" }, { lenderId: FUND, accountId: ACCOUNT }]) {
      const r = await reveal(fields);
      expect(r).toEqual({ error: "Account number not found." });
    }
  });

  it("stops the 11th reveal within 10 minutes", async () => {
    as(who.admin);
    for (let i = 0; i < 10; i++) expect((await reveal()).value).toBe("DEMO-BRK-48210937");
    expect(await reveal()).toEqual({ error: "Too many reveals. Wait a few minutes and try again." });
  });

  it("reveals nothing when the audit trail fails", async () => {
    as(who.admin);
    audit().failNext = true;
    expect(await reveal()).toEqual({ error: "The audit trail is unavailable, so nothing was revealed. Try again." });
  });

  it("asks a signed-out user to sign in", async () => {
    signedIn.mockResolvedValue(null);
    expect(await reveal()).toEqual({ error: "Sign in again to reveal account numbers." });
  });
});

describe("account numbers", () => {
  it("cannot be saved without a key, while contacts still save", async () => {
    as(who.broker);
    (demo.demoDesks()! as { keyring: PiiKeyring | null }).keyring = null;
    crypto.setPiiKeyring(null);
    const before = store().lenderAccounts.size;
    const u = await call(() => actions.addLenderAccountAction(form({ lenderId: BANK, kind: "client_account", label: "Servicing account", accountNumber: "SVC-0099887766" })));
    expect(u.searchParams.get("error")).toBe("Account numbers cannot be saved: encryption (PII_ENCRYPTION_KEY) is not configured on this server. Contacts and contact info still save.");
    expect(store().lenderAccounts.size).toBe(before);
    const c = await call(() => actions.addLenderContactAction(form({ lenderId: BANK, fullName: "Riley Chen (demo)", email: "riley@bank.example" })));
    expect(c.searchParams.get("notice")).toBe("Contact added.");
  });

  it("never put the number in the redirect URL or a log, and store it sealed", async () => {
    as(who.broker);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      const u = await call(() => actions.addLenderAccountAction(form({ lenderId: BANK, kind: "client_account", label: "Servicing account", accountNumber: "SVC-0099887766" })));
      expect(u.searchParams.get("notice")).toBe("Account number saved.");
      expect(u.href).not.toContain("0099887766");
      expect(u.href).not.toContain("SVC");
      for (const s of spies) for (const args of s.mock.calls) expect(JSON.stringify(args)).not.toMatch(/0099887766|SVC-/);
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const saved = [...store().lenderAccounts.values()].find((a) => a.label === "Servicing account")!;
    expect(crypto.isEncrypted(saved.numberEnc)).toBe(true);
    expect(saved.numberLast4).toBe("7766");
  });
});

describe("contacts", () => {
  it("refuse a password in the notes with the fixed message and keep the value out of the URL", async () => {
    as(who.broker);
    const u = await call(() => actions.addLenderContactAction(form({ lenderId: BANK, fullName: "Riley Chen", notes: "password: x" })));
    expect(u.searchParams.get("error")).toBe("Notes: remove account numbers, passwords and bank details. Put lender account numbers under Account numbers; keep passwords in the password manager.");
    expect(u.href).not.toContain("x");
    const v = await call(() => actions.addLenderContactAction(form({ lenderId: BANK, fullName: "Riley Chen", notes: "portal password: hunter2" })));
    expect(v.href).not.toContain("hunter2");
  });

  it("refuse making another lender's contact primary", async () => {
    as(who.broker);
    const fundContact = [...store().lenderContacts.values()].find((c) => c.lenderId === FUND)!;
    const before = JSON.stringify([...store().lenderContacts.values()]);
    const u = await call(() => actions.lenderContactOpAction(form({ lenderId: BANK, contactId: fundContact.id, recordVersion: String(fundContact.recordVersion), op: "make_primary" })));
    expect(u.searchParams.get("error")).toBeTruthy();
    expect(JSON.stringify([...store().lenderContacts.values()])).toBe(before);
    expect((await store().getLender(BANK))!.contactEmail).toBe("lending@bank.example");
    expect((await store().getLender(FUND))!.contactEmail).toBe("deals@fund.example");
  });

  it("refuse a stale record version", async () => {
    as(who.broker);
    const c = [...store().lenderContacts.values()].find((x) => x.lenderId === BANK && x.isPrimary)!;
    const u = await call(() => actions.updateLenderContactAction(form({ lenderId: BANK, contactId: c.id, recordVersion: String(c.recordVersion + 3), fullName: "Changed", email: c.email ?? "" })));
    expect(u.searchParams.get("error")).toMatch(/modified concurrently; reload/);
    expect(store().lenderContacts.get(c.id)!.fullName).toBe(c.fullName);
  });

  it("save the contact info, then the contact op notices are fixed strings", async () => {
    as(who.broker);
    const u = await call(() => actions.saveLenderContactInfoAction(form({ lenderId: BANK, contactInfoVersion: "1", mainPhone: "(310) 555-0142", websiteUrl: "https://bank.example/lending", submissionEmail: "submissions@bank.example" })));
    expect(u.searchParams.get("notice")).toBe("Contact info saved.");
    expect((await store().getLender(BANK))!).toMatchObject({ mainPhone: "+13105550142", websiteUrl: "https://bank.example/lending", contactInfoVersion: 2 });
    const underwriter = [...store().lenderContacts.values()].find((c) => c.lenderId === BANK && !c.isPrimary)!;
    const p = await call(() => actions.lenderContactOpAction(form({ lenderId: BANK, contactId: underwriter.id, recordVersion: "1", op: "make_primary" })));
    expect(p.searchParams.get("notice")).toBe("Primary contact set.");
    expect((await store().getLender(BANK))!.contactEmail).toBe("underwriting@bank.example");
    const bogus = await call(() => actions.lenderContactOpAction(form({ lenderId: BANK, contactId: underwriter.id, recordVersion: "2", op: "promote" })));
    expect(bogus.searchParams.get("error")).toBe("Unknown contact action");
  });
});

describe("lenderAction", () => {
  it("accepts only verify and toggle, and only UUID lender ids", async () => {
    as(who.broker);
    const u = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "bogus" })));
    expect(u.searchParams.get("error")).toBe("Unknown lender action");
    expect((await store().getLender(BANK))!.active).toBe(true);
    const missing = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "" })));
    expect(missing.searchParams.get("error")).toBe("Unknown lender action");
    const bad = await call(() => actions.lenderAction(form({ lenderId: "not-a-uuid", op: "toggle" })));
    expect(bad.pathname).toBe("/deals/lenders");
    expect(bad.searchParams.get("error")).toBeTruthy();
    const back = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "verify", back: "detail" })));
    expect(back.pathname).toBe(`/deals/lenders/${BANK}`);
    expect(back.searchParams.get("notice")).toBe("Verification date updated.");
  });
});

describe("saveLenderAction", () => {
  const lenderForm = (extra: Record<string, string>) => {
    const f = form({ name: "Harbor Bridge Capital", category: "CFL_LICENSEE", feeSplitKind: "none", ...extra });
    f.append("programs", "PRIVATE_BRIDGE");
    return f;
  };

  it("adds the lender with its primary contact and lands on the new lender's page", async () => {
    as(who.broker);
    const u = await call(() => actions.saveLenderAction(lenderForm({ contactName: "Jordan Park", contactEmail: "Jordan@Harbor.example" })));
    expect(u.pathname).toMatch(/^\/deals\/lenders\/[0-9a-f-]{36}$/);
    expect(u.searchParams.get("notice")).toMatch(/^Lender added\./);
    const l = (await store().getLender(u.pathname.split("/").pop()!))!;
    expect(l).toMatchObject({ primaryContactName: "Jordan Park", contactEmail: "jordan@harbor.example", contactName: "Jordan Park", submissionEmail: null });
  });

  it("files an email without a name as the submission inbox, and validates before inserting", async () => {
    as(who.broker);
    const u = await call(() => actions.saveLenderAction(lenderForm({ contactEmail: "deals@harbor.example" })));
    const l = (await store().getLender(u.pathname.split("/").pop()!))!;
    expect(l).toMatchObject({ submissionEmail: "deals@harbor.example", primaryContactId: null, contactEmail: "deals@harbor.example" });
    const count = store().lenders.size;
    const bad = await call(() => actions.saveLenderAction(lenderForm({ contactName: "Jordan Park", contactEmail: "not an email" })));
    expect(bad.pathname).toBe("/deals/lenders");
    expect(bad.searchParams.get("error")).toMatch(/email/i);
    expect(store().lenders.size).toBe(count);
  });
});

describe("loan types", () => {
  const lenderForm = (extra: Record<string, string>, loanTypes: string[] = [], programs: string[] = ["PRIVATE_BRIDGE", "HARD_MONEY"]) => {
    const f = form({ name: "Harbor Bridge Capital", category: "CFL_LICENSEE", feeSplitKind: "none", ...extra });
    for (const p of programs) f.append("programs", p);
    for (const t of loanTypes) f.append("loanTypes", t);
    return f;
  };
  const typesForm = (fields: Record<string, string>, loanTypes: string[] = []) => {
    const f = form(fields);
    for (const t of loanTypes) f.append("loanTypes", t);
    return f;
  };

  it("fills in the loan types of a new lender when none are ticked", async () => {
    as(who.broker);
    const u = await call(() => actions.saveLenderAction(lenderForm({ appetiteNotes: "DSCR rental take-outs" })));
    expect(u.searchParams.get("notice")).toContain("filled in from its programs and notes");
    expect((await store().getLender(u.pathname.split("/").pop()!))!.loanTypes).toEqual(["bridge", "private_money", "dscr"]);
  });

  it("stores ticked loan types, and refuses unknown ones without inserting", async () => {
    as(who.broker);
    const u = await call(() => actions.saveLenderAction(lenderForm({}, ["hotel"])));
    expect(u.searchParams.get("notice")).toBe("Lender added. Add contact info, contacts and account numbers below.");
    expect((await store().getLender(u.pathname.split("/").pop()!))!.loanTypes).toEqual(["hotel"]);
    const count = store().lenders.size;
    const bad = await call(() => actions.saveLenderAction(lenderForm({}, ["bogus"])));
    expect(bad.pathname).toBe("/deals/lenders");
    expect(bad.searchParams.get("error")).toMatch(/loanTypes/);
    expect(store().lenders.size).toBe(count);
  });

  it("saves, refuses stale and unknown edits, and applies the suggestions", async () => {
    const was = (await store().getLender(FUND))!.loanTypes.join(",");
    as(who.analyst);
    const denied = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: FUND, op: "save", loanTypesWas: was }, ["dscr"])));
    expect(denied.searchParams.get("error")).toMatch(/write access/);
    expect((await store().getLender(FUND))!.loanTypes.join(",")).toBe(was);

    as(who.broker);
    const saved = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: FUND, op: "save", loanTypesWas: was }, ["dscr", "bridge"])));
    expect(saved.pathname).toBe(`/deals/lenders/${FUND}`);
    expect(saved.searchParams.get("notice")).toBe("Loan types saved.");
    expect((await store().getLender(FUND))!.loanTypes).toEqual(["bridge", "dscr"]);

    const stale = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: FUND, op: "save", loanTypesWas: was }, ["hotel"])));
    expect(stale.searchParams.get("error")).toMatch(/modified concurrently; reload/);

    await store().updateLender(BANK, { loanTypes: ["hotel"] }, "x", new Date());
    const suggest = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: BANK, op: "suggest", loanTypesWas: "hotel" })));
    expect(suggest.searchParams.get("notice")).toBe("Loan types set from the suggestions.");
    expect((await store().getLender(BANK))!.loanTypes).toEqual(["construction", "sba", "hud_fha", "agency", "bank"]);

    const unknown = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: BANK, op: "delete", loanTypesWas: "" })));
    expect(unknown.searchParams.get("error")).toBe("Unknown loan type action");
    const badId = await call(() => actions.saveLenderLoanTypesAction(typesForm({ lenderId: "bank", op: "save", loanTypesWas: "" })));
    expect(badId.searchParams.get("error")).toBeTruthy();
  });

  it("returns a row action to the same filtered view, whitelisting the query", async () => {
    as(who.broker);
    const u = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "verify", listQuery: "type=dscr&type=nope&evil=https://x.example&sort=added" })));
    expect(`${u.pathname}${u.search}`).toMatch(/^\/deals\/lenders\?type=dscr&sort=added&notice=/);
    expect(u.href).not.toContain("evil");
    expect(u.href).not.toContain("x.example");
    const back = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "verify", back: "detail", listQuery: "type=dscr" })));
    expect(`${back.pathname}`).toBe(`/deals/lenders/${BANK}`);
    const abs = await call(() => actions.lenderAction(form({ lenderId: BANK, op: "verify", listQuery: "//evil.example/x" })));
    expect(abs.pathname).toBe("/deals/lenders");
    expect(abs.host).toBe("localhost");
  });
});
