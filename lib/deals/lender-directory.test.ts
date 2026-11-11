// The lender directory service (lib/deals/lender-directory.ts): contacts,
// contact info verification, sealed account numbers and the audited reveal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAuditSink } from "@/lib/auth/audit";
import { MemoryRateLimiter } from "@/lib/ratelimit";

vi.mock("@/lib/privacy/crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/privacy/crypto")>();
  return { ...real, decryptField: vi.fn(real.decryptField) };
});

const crypto = await import("@/lib/privacy/crypto");
const { createKeyring, isEncrypted, setPiiKeyring } = crypto;
const { openLenderAccountNumber } = await import("./lender-accounts");
const { LenderDirectoryError } = await import("./lender-contacts");
const { addLenderAccount, addLenderContact, editLenderAccount, lenderContactOp, revealLenderAccount, saveLenderContactInfo } = await import("./lender-directory");
const { MemoryDealDeskStore } = await import("./store");
const { T0, clockAt, lenderInput } = await import("./test-fixtures");
type StaffSession = import("./session").StaffSession;

const KEY = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
const NUMBER = "SVC-0099887766";

async function world() {
  const store = new MemoryDealDeskStore();
  const clock = clockAt(T0);
  const lender = await store.insertLender(lenderInput(), "broker:ana", T0);
  const other = await store.insertLender(lenderInput({ name: "Greystone" }), "broker:ana", T0);
  const deps = { store, now: clock.now, keyring: KEY };
  return { store, clock, lender, other, deps };
}

const staff = (over: Partial<StaffSession> = {}): StaffSession => ({ userId: "u1", email: "ana@corin.test", name: "Ana", role: "broker", dreLicense: null, designatedOfficer: false, actor: "staff:ana@corin.test", ...over });

beforeEach(() => {
  vi.mocked(crypto.decryptField).mockClear();
});
afterEach(() => setPiiKeyring(undefined));

describe("contacts", () => {
  it("adds a contact and makes it primary on request", async () => {
    const { deps, lender, store } = await world();
    const c = await addLenderContact(deps, lender.id, { fullName: "Dana Lee", email: "Dana@Lender.example" }, { makePrimary: true }, "staff:ana");
    expect(c).toMatchObject({ isPrimary: true, email: "dana@lender.example" });
    expect((await store.getLender(lender.id))!.primaryContactId).toBe(c.id);
    await expect(addLenderContact(deps, "33333333-3333-4333-8333-333333333333", { fullName: "Dana Lee" }, {}, "x")).rejects.toThrow(LenderDirectoryError);
  });

  it("runs the one-click ops", async () => {
    const { deps, lender, store, clock } = await world();
    const c = await addLenderContact(deps, lender.id, { fullName: "Dana Lee", email: "dana@lender.example" }, { makePrimary: true }, "staff:ana");
    clock.advance(60_000);
    const verified = await lenderContactOp(deps, { lenderId: lender.id, contactId: c.id, expectedVersion: c.recordVersion, op: "verify" }, "staff:lee");
    expect(verified).toMatchObject({ verifiedBy: "staff:lee", verifiedAt: clock.now().toISOString() });
    const left = await lenderContactOp(deps, { lenderId: lender.id, contactId: c.id, expectedVersion: verified!.recordVersion, op: "mark_left" }, "staff:lee");
    expect(left).toMatchObject({ status: "left", isPrimary: false });
    expect((await store.getLender(lender.id))!.contactEmail).toBe("dana@lender.example"); // the submission inbox
    const back = await lenderContactOp(deps, { lenderId: lender.id, contactId: c.id, expectedVersion: left!.recordVersion, op: "reactivate" }, "staff:lee");
    expect(back).toMatchObject({ status: "active", leftAt: null });
    await expect(lenderContactOp(deps, { lenderId: lender.id, contactId: c.id, expectedVersion: 1, op: "make_primary" }, "x")).rejects.toThrow(/concurrently/);
    expect(await lenderContactOp(deps, { lenderId: lender.id, contactId: c.id, expectedVersion: back!.recordVersion, op: "delete" }, "x")).toBeNull();
    expect(await store.getLenderContact(lender.id, c.id)).toBeNull();
  });
});

describe("saveLenderContactInfo", () => {
  it("clears the verification when the main phone changes, sets it on verifiedNow, keeps it for an address change", async () => {
    const { deps, lender, clock } = await world();
    const v1 = await saveLenderContactInfo(deps, lender.id, 1, { mainPhone: "(310) 555-0100", submissionEmail: "dana@lender.example" }, { verifiedNow: true }, "staff:ana");
    expect(v1).toMatchObject({ mainPhone: "+13105550100", contactVerifiedAt: T0.toISOString(), contactVerifiedBy: "staff:ana", contactInfoVersion: 2 });
    clock.advance(60_000);
    const v2 = await saveLenderContactInfo(deps, lender.id, 2, { mainPhone: "(310) 555-0100", submissionEmail: "dana@lender.example", addressLine1: "1 Main St", city: "Irvine", addressState: "ca", postalCode: "92618" }, {}, "staff:lee");
    expect(v2).toMatchObject({ addressLine1: "1 Main St", addressState: "CA", contactVerifiedAt: T0.toISOString(), contactVerifiedBy: "staff:ana" });
    const v3 = await saveLenderContactInfo(deps, lender.id, 3, { mainPhone: "(310) 555-0199", submissionEmail: "dana@lender.example" }, {}, "staff:lee");
    expect(v3).toMatchObject({ mainPhone: "+13105550199", contactVerifiedAt: null, contactVerifiedBy: null });
    await expect(saveLenderContactInfo(deps, lender.id, 3, {}, {}, "x")).rejects.toThrow(/concurrently/);
  });

  it("keeps a stored inbox whose case differs only, so the approval recipient does not change", async () => {
    const { deps, store } = await world();
    const legacy = await store.insertLender(lenderInput({ name: "PCCP", submissionEmail: "Inquiry@pccpllc.com" }), "x", T0);
    const saved = await saveLenderContactInfo(deps, legacy.id, 1, { submissionEmail: "inquiry@pccpllc.com", city: "Los Angeles" }, {}, "x");
    expect(saved.submissionEmail).toBe("Inquiry@pccpllc.com");
    expect(saved.contactEmail).toBe("Inquiry@pccpllc.com");
  });

  it("keeps a backfilled website with a query string when the form sends it back unchanged", async () => {
    const { deps, store } = await world();
    // As the contacts backfill stores it from the directory notes.
    const legacy = await store.insertLender(lenderInput({ name: "Byline", websiteUrl: "https://www.bylinebank.com/?p=12061" }), "x", T0);
    const v1 = await saveLenderContactInfo(deps, legacy.id, 1, { websiteUrl: "https://www.bylinebank.com/?p=12061", mainPhone: "(310) 555-0100" }, {}, "x");
    expect(v1).toMatchObject({ websiteUrl: "https://www.bylinebank.com/?p=12061", mainPhone: "+13105550100" });
    // A new address still loses its query and fragment; clearing the field clears it.
    const v2 = await saveLenderContactInfo(deps, legacy.id, 2, { websiteUrl: "https://www.bylinebank.com/cre?utm_source=x#top" }, {}, "x");
    expect(v2.websiteUrl).toBe("https://www.bylinebank.com/cre");
    const v3 = await saveLenderContactInfo(deps, legacy.id, 3, { websiteUrl: "" }, {}, "x");
    expect(v3.websiteUrl).toBeNull();
  });
});

describe("account numbers", () => {
  it("seals under the generated id, and editing keeps or reseals under the same id", async () => {
    const { deps, lender, store } = await world();
    const a = await addLenderAccount(deps, lender.id, { kind: "client_account", label: "Servicing account", number: NUMBER }, "staff:ana");
    expect(a).toMatchObject({ numberLast4: "7766", label: "Servicing account" });
    const secret = (await store.getLenderAccountSecret(lender.id, a.id))!;
    expect(isEncrypted(secret.numberEnc)).toBe(true);
    expect(openLenderAccountNumber(secret, KEY)).toBe(NUMBER);

    const kept = await editLenderAccount(deps, lender.id, a.id, 1, { label: "Servicing", number: "", notes: "Renewed" }, "staff:ana");
    expect(kept).toMatchObject({ label: "Servicing", notes: "Renewed", numberLast4: "7766", recordVersion: 2 });
    expect((await store.getLenderAccountSecret(lender.id, a.id))!.numberEnc).toBe(secret.numberEnc);

    const replaced = await editLenderAccount(deps, lender.id, a.id, 2, { label: "Servicing", number: "SVC-1122334455" }, "staff:ana");
    expect(replaced.numberLast4).toBe("4455");
    const next = (await store.getLenderAccountSecret(lender.id, a.id))!;
    expect(next.numberEnc).not.toBe(secret.numberEnc);
    expect(openLenderAccountNumber(next, KEY)).toBe("SVC-1122334455");
  });

  it("stores nothing without a key", async () => {
    const { store, lender, clock } = await world();
    setPiiKeyring(null);
    await expect(addLenderAccount({ store, now: clock.now, keyring: null }, lender.id, { kind: "broker_id", number: "BRK-1234567" }, "x")).rejects.toThrow(crypto.PiiKeyError);
    expect(await store.listLenderAccounts(lender.id)).toEqual([]);
  });
});

describe("revealLenderAccount", () => {
  async function revealWorld(opts: { allow?: (k: string, l: number, w: number) => Promise<boolean> } = {}) {
    const w = await world();
    const account = await addLenderAccount(w.deps, w.lender.id, { kind: "client_account", label: "Servicing account", number: NUMBER }, "staff:ana");
    const audit = new MemoryAuditSink();
    const deps = { ...w.deps, audit, allow: opts.allow ?? (async () => true), fingerprint: async () => ({ ipHash: "iphash", userAgent: "vitest" }) };
    return { ...w, account, audit, deps, ids: { lenderId: w.lender.id, accountId: account.id } };
  }

  it("refuses analysts and brokers who are not the officer, and audits the denial", async () => {
    for (const s of [staff({ role: "analyst" }), staff({ role: "broker" }), staff({ role: "broker", designatedOfficer: true, dreLicense: null })]) {
      const { deps, ids, audit } = await revealWorld();
      const r = await revealLenderAccount(deps, s, ids);
      expect(r).toEqual({ ok: false, reason: "forbidden" });
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({ action: "lender.account_reveal_denied", targetId: ids.accountId, detail: { lenderId: ids.lenderId, reason: "permission" } });
      expect(crypto.decryptField).not.toHaveBeenCalled();
    }
  });

  it("reveals to an admin and to the designated officer, auditing before decrypting", async () => {
    for (const s of [staff({ role: "admin" }), staff({ role: "broker", designatedOfficer: true, dreLicense: "01234567" })]) {
      const { deps, ids, audit, account } = await revealWorld();
      vi.mocked(crypto.decryptField).mockClear();
      let eventsAtDecrypt = -1;
      const real = (await vi.importActual<typeof import("@/lib/privacy/crypto")>("@/lib/privacy/crypto")).decryptField;
      vi.mocked(crypto.decryptField).mockImplementationOnce((env, o) => {
        eventsAtDecrypt = audit.events.filter((e) => e.action === "lender.account_reveal").length;
        return real(env, o);
      });
      const r = await revealLenderAccount(deps, s, ids);
      expect(r).toEqual({ ok: true, value: NUMBER, label: "Servicing account" });
      expect(eventsAtDecrypt).toBe(1);
      expect(audit.events).toHaveLength(1);
      expect(audit.events[0]).toMatchObject({ action: "lender.account_reveal", actorId: "u1", actorLabel: "ana@corin.test", targetType: "lender_account", targetId: account.id, ipHash: "iphash", userAgent: "vitest" });
      expect(audit.events[0]!.detail).toEqual({ lenderId: ids.lenderId, kind: "client_account" });
      const json = JSON.stringify(audit.events);
      for (const v of [NUMBER, "0099887766", "7766", "Servicing account"]) expect(json).not.toContain(v);
    }
  });

  it("returns nothing when the audit write fails", async () => {
    const { deps, ids, audit } = await revealWorld();
    audit.failNext = true;
    expect(await revealLenderAccount(deps, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "audit_unavailable" });
    expect(crypto.decryptField).not.toHaveBeenCalled();
    expect(await revealLenderAccount({ ...deps, audit: null }, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "audit_unavailable" });
  });

  it("rate limits at 10 reveals per 10 minutes", async () => {
    let t = Date.parse("2026-11-03T17:00:00.000Z");
    const limiter = new MemoryRateLimiter(() => t);
    const allow = async (key: string, limit: number, windowMs: number) => (await limiter.limit(key, { limit, windowMs })).success;
    const { deps, ids, audit } = await revealWorld({ allow });
    for (let i = 0; i < 10; i++) expect((await revealLenderAccount(deps, staff({ role: "admin" }), ids)).ok).toBe(true);
    expect(await revealLenderAccount(deps, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "rate_limited" });
    expect(audit.events.at(-1)).toMatchObject({ action: "lender.account_reveal_denied", detail: { reason: "rate_limited" } });
    t += 21 * 60_000;
    expect((await revealLenderAccount(deps, staff({ role: "admin" }), ids)).ok).toBe(true);
  });

  it("rate limits at 100 reveals per day, even when spread out under the 10-minute limit", async () => {
    let t = Date.parse("2026-11-03T01:00:00.000Z");
    const limiter = new MemoryRateLimiter(() => t);
    const refusedBy: string[] = [];
    const allow = async (key: string, limit: number, windowMs: number) => {
      const ok = (await limiter.limit(key, { limit, windowMs })).success;
      if (!ok) refusedBy.push(key.split(":")[1]!);
      return ok;
    };
    const { deps, ids, audit } = await revealWorld({ allow });
    // 90 seconds apart: about 7 in any 10 minutes, so only the daily cap can stop them.
    for (let i = 0; i < 100; i++) {
      expect((await revealLenderAccount(deps, staff({ role: "admin" }), ids)).ok, `reveal ${i + 1}`).toBe(true);
      t += 90_000;
    }
    expect(refusedBy).toEqual([]);
    expect(await revealLenderAccount(deps, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "rate_limited" });
    expect(refusedBy).toEqual(["1d"]);
    expect(audit.events.filter((e) => e.action === "lender.account_reveal")).toHaveLength(100);
    expect(audit.events.at(-1)).toMatchObject({ action: "lender.account_reveal_denied", detail: { reason: "rate_limited" } });
    // Two days later the daily window has slid past every earlier reveal.
    t += 2 * 86_400_000;
    expect((await revealLenderAccount(deps, staff({ role: "admin" }), ids)).ok).toBe(true);
  });

  it("does not find an account under another lender", async () => {
    const { deps, ids, other, audit } = await revealWorld();
    expect(await revealLenderAccount(deps, staff({ role: "admin" }), { lenderId: other.id, accountId: ids.accountId })).toEqual({ ok: false, reason: "not_found" });
    expect(audit.events[0]).toMatchObject({ action: "lender.account_reveal_denied", detail: { reason: "not_found" } });
  });

  it("writes no reveal event without a key", async () => {
    const { deps, ids, audit } = await revealWorld();
    setPiiKeyring(null);
    expect(await revealLenderAccount({ ...deps, keyring: null }, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "no_key" });
    expect(audit.events.filter((e) => e.action === "lender.account_reveal")).toEqual([]);
  });

  it("reports a tampered envelope as cannot_open and logs only the error name", async () => {
    const { deps, ids, store } = await revealWorld();
    const row = store.lenderAccounts.get(ids.accountId)!;
    const parts = row.numberEnc.split(".");
    parts[3] = parts[3]!.startsWith("A") ? `B${parts[3]!.slice(1)}` : `A${parts[3]!.slice(1)}`;
    row.numberEnc = parts.join(".");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await revealLenderAccount(deps, staff({ role: "admin" }), ids)).toEqual({ ok: false, reason: "cannot_open" });
      expect(spy).toHaveBeenCalledWith("[deals] lender account reveal failed", "PiiDecryptError");
    } finally {
      spy.mockRestore();
    }
  });
});
