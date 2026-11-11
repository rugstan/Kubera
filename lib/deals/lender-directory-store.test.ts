// The in-memory deal desk store's lender directory (contacts, contact info,
// sealed account numbers): the same semantics SupabaseDealDeskStore gets from
// the database checks, the partial unique index and the RPC.
import { describe, expect, it } from "vitest";
import { createKeyring } from "@/lib/privacy/crypto";
import { sealLenderAccountNumber } from "./lender-accounts";
import { ConcurrentUpdateError, GuardError, MemoryDealDeskStore } from "./store";
import { T0, addPrimaryContact, lenderInput } from "./test-fixtures";
import type { NewLenderContact } from "./types";

const KEY = createKeyring({ version: 1, key: Buffer.alloc(32, 7) });
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";

const contact = (lenderId: string, over: Partial<NewLenderContact> = {}): NewLenderContact => ({
  lenderId,
  fullName: "Kim Park",
  title: null,
  role: "underwriter",
  email: "kim@lender.example",
  phoneDirect: "+13105550100",
  phoneExt: null,
  phoneMobile: null,
  preferredChannel: null,
  territory: null,
  notes: null,
  source: "staff",
  ...over,
});

async function world() {
  const store = new MemoryDealDeskStore();
  const a = await store.insertLender(lenderInput(), "broker:ana", T0);
  const b = await store.insertLender(lenderInput({ name: "Greystone", submissionEmail: "desk@greystone.example" }), "broker:ana", T0);
  return { store, a, b };
}

const account = (lenderId: string, id = ACCOUNT_A, number = "SVC-0099887766", label = "Servicing account") => ({ id, lenderId, kind: "client_account" as const, label, notes: null, ...sealLenderAccountNumber(id, number, KEY) });

describe("lender rows", () => {
  it("fills contact info defaults on insert", async () => {
    const store = new MemoryDealDeskStore();
    const { submissionEmail: _s, ...noInbox } = lenderInput();
    void _s;
    const l = await store.insertLender(noInbox, "broker:ana", T0);
    expect(l).toMatchObject({ mainPhone: null, submissionEmail: null, websiteUrl: null, country: "US", contactInfoVersion: 1, contactEmail: null, contactName: null, primaryContactId: null, contactDomains: [] });
  });

  it("never writes the derived recipient", async () => {
    const { store, a } = await world();
    await store.updateLender(a.id, { contactEmail: "forged@x.example", contactName: "Forged" } as never, "broker:ana", T0);
    expect(await store.getLender(a.id)).toMatchObject({ contactEmail: "dana@lender.example", contactName: null });
    expect(Object.keys(store.lenders.get(a.id)!)).not.toContain("contactEmail");
  });
});

describe("contacts", () => {
  it("inserts contacts as non-primary; setPrimaryLenderContact switches the one primary", async () => {
    const { store, a } = await world();
    const kim = await store.insertLenderContact(contact(a.id), "broker:ana", T0);
    expect(kim).toMatchObject({ isPrimary: false, status: "active", recordVersion: 1, createdBy: "broker:ana" });
    const dana = await addPrimaryContact(store, a.id, { fullName: "Dana Lee", email: "dana.lee@lender.example" });
    expect(dana).toMatchObject({ isPrimary: true, recordVersion: 2 });
    const switched = await store.setPrimaryLenderContact(a.id, kim.id, "broker:lee", T0);
    expect(switched).toMatchObject({ isPrimary: true, recordVersion: 2, updatedBy: "broker:lee" });
    const all = await store.listLenderContacts(a.id);
    expect(all.filter((c) => c.isPrimary).map((c) => c.id)).toEqual([kim.id]);
    expect(all.find((c) => c.id === dana.id)).toMatchObject({ isPrimary: false, recordVersion: 3 });
    // Already primary: unchanged.
    expect((await store.setPrimaryLenderContact(a.id, kim.id, "broker:lee", T0)).recordVersion).toBe(2);
  });

  it("refuses to make another lender's contact primary and changes neither lender", async () => {
    const { store, a, b } = await world();
    const onB = await store.insertLenderContact(contact(b.id), "broker:ana", T0);
    const onA = await addPrimaryContact(store, a.id, { fullName: "Dana Lee", email: "dana.lee@lender.example" });
    await expect(store.setPrimaryLenderContact(a.id, onB.id, "x", T0)).rejects.toThrow(GuardError);
    expect(await store.getLenderContact(b.id, onB.id)).toMatchObject({ isPrimary: false, recordVersion: 1 });
    expect(await store.getLenderContact(a.id, onA.id)).toMatchObject({ isPrimary: true });
    expect(await store.getLenderContact(a.id, onB.id)).toBeNull();
  });

  it("refuses a stale version or another lender's id with ConcurrentUpdateError", async () => {
    const { store, a, b } = await world();
    const kim = await store.insertLenderContact(contact(a.id), "broker:ana", T0);
    await expect(store.updateLenderContact(a.id, kim.id, 7, { title: "VP" }, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
    await expect(store.updateLenderContact(b.id, kim.id, 1, { title: "VP" }, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
    expect(await store.updateLenderContact(a.id, kim.id, 1, { title: "VP" }, "broker:lee", T0)).toMatchObject({ title: "VP", recordVersion: 2, updatedBy: "broker:lee" });
  });

  it("enforces the mark-left rules", async () => {
    const { store, a } = await world();
    const dana = await addPrimaryContact(store, a.id, { fullName: "Dana Lee", email: "dana.lee@lender.example" });
    const left = T0.toISOString();
    await expect(store.updateLenderContact(a.id, dana.id, dana.recordVersion, { status: "left", leftAt: left }, "x", T0)).rejects.toThrow(GuardError);
    await expect(store.updateLenderContact(a.id, dana.id, dana.recordVersion, { status: "left", isPrimary: false }, "x", T0)).rejects.toThrow(GuardError);
    await expect(store.updateLenderContact(a.id, dana.id, dana.recordVersion, { isPrimary: true } as never, "x", T0)).rejects.toThrow(GuardError);
    const gone = await store.updateLenderContact(a.id, dana.id, dana.recordVersion, { status: "left", leftAt: left, isPrimary: false }, "x", T0);
    expect(gone).toMatchObject({ status: "left", isPrimary: false, leftAt: left });
    await expect(store.updateLenderContact(a.id, dana.id, gone.recordVersion, { status: "active" }, "x", T0)).rejects.toThrow(GuardError);
    expect(await store.updateLenderContact(a.id, dana.id, gone.recordVersion, { status: "active", leftAt: null }, "x", T0)).toMatchObject({ status: "active", leftAt: null });
    await expect(store.setPrimaryLenderContact(a.id, (await store.updateLenderContact(a.id, dana.id, gone.recordVersion + 1, { status: "left", leftAt: left, isPrimary: false }, "x", T0)).id, "x", T0)).rejects.toThrow(GuardError);
  });

  it("lists primary first, then active by name, then those who left (latest first)", async () => {
    const { store, a } = await world();
    const zed = await store.insertLenderContact(contact(a.id, { fullName: "Zed" }), "x", T0);
    await store.insertLenderContact(contact(a.id, { fullName: "amy" }), "x", T0);
    const early = await store.insertLenderContact(contact(a.id, { fullName: "Early Leaver" }), "x", T0);
    const late = await store.insertLenderContact(contact(a.id, { fullName: "Late Leaver" }), "x", T0);
    await store.updateLenderContact(a.id, early.id, 1, { status: "left", leftAt: "2026-01-01T00:00:00.000Z", isPrimary: false }, "x", T0);
    await store.updateLenderContact(a.id, late.id, 1, { status: "left", leftAt: "2026-06-01T00:00:00.000Z", isPrimary: false }, "x", T0);
    await store.setPrimaryLenderContact(a.id, zed.id, "x", T0);
    expect((await store.listLenderContacts(a.id, { includeLeft: true })).map((c) => c.fullName)).toEqual(["Zed", "amy", "Late Leaver", "Early Leaver"]);
    expect((await store.listLenderContacts(a.id)).map((c) => c.fullName)).toEqual(["Zed", "amy"]);
  });

  it("deletes only within the lender", async () => {
    const { store, a, b } = await world();
    const kim = await store.insertLenderContact(contact(a.id), "x", T0);
    await expect(store.deleteLenderContact(b.id, kim.id)).rejects.toThrow(GuardError);
    expect(await store.getLenderContact(a.id, kim.id)).not.toBeNull();
    await store.deleteLenderContact(a.id, kim.id);
    expect(await store.getLenderContact(a.id, kim.id)).toBeNull();
  });

  it("refuses a contact for a lender that does not exist", async () => {
    const store = new MemoryDealDeskStore();
    await expect(store.insertLenderContact(contact("33333333-3333-4333-8333-333333333333"), "x", T0)).rejects.toThrow(/lender_panel .* not found/);
  });
});

describe("derived recipient on lender reads", () => {
  it("follows the primary contact and the submission inbox", async () => {
    const { store, a } = await world();
    expect(await store.getLender(a.id)).toMatchObject({ contactEmail: "dana@lender.example", contactName: null, contactDomains: ["lender.example"] });
    const kim = await store.insertLenderContact(contact(a.id, { email: "kim@kim-lending.example" }), "x", T0);
    await store.setPrimaryLenderContact(a.id, kim.id, "x", T0);
    expect((await store.listLenders()).find((l) => l.id === a.id)).toMatchObject({ contactEmail: "kim@kim-lending.example", contactName: "Kim Park", primaryContactName: "Kim Park", contactDomains: ["kim-lending.example", "lender.example"] });
    await store.updateLender(a.id, { submissionEmail: "new@inbox.example" }, "x", T0);
    await store.updateLenderContact(a.id, kim.id, 2, { isPrimary: false }, "x", T0);
    expect(await store.getLender(a.id)).toMatchObject({ contactEmail: "new@inbox.example", contactName: null, primaryContactId: null });
  });
});

describe("accounts", () => {
  it("needs the caller's UUID and a sealed value", async () => {
    const { store, a } = await world();
    await expect(store.insertLenderAccount({ ...account(a.id), id: "not-a-uuid" }, "x", T0)).rejects.toThrow(GuardError);
    await expect(store.insertLenderAccount({ ...account(a.id), numberEnc: "SVC-0099887766" }, "x", T0)).rejects.toThrow(/not encrypted/);
    const saved = await store.insertLenderAccount(account(a.id), "x", T0);
    expect(saved.id).toBe(ACCOUNT_A);
    expect(saved.numberLast4).toBe("7766");
  });

  it("refuses a duplicate (lender, kind, label)", async () => {
    const { store, a, b } = await world();
    await store.insertLenderAccount(account(a.id), "x", T0);
    await expect(store.insertLenderAccount(account(a.id, ACCOUNT_B), "x", T0)).rejects.toThrow("This lender already has an account number of that type with that label.");
    await expect(store.insertLenderAccount(account(b.id, ACCOUNT_B), "x", T0)).resolves.toBeTruthy();
  });

  it("never returns numberEnc from list, insert or update", async () => {
    const { store, a } = await world();
    const inserted = await store.insertLenderAccount(account(a.id), "x", T0);
    const listed = await store.listLenderAccounts(a.id);
    const updated = await store.updateLenderAccount(a.id, ACCOUNT_A, 1, { label: "Servicing" }, "x", T0);
    for (const x of [inserted, ...listed, updated]) expect(Object.keys(x)).not.toContain("numberEnc");
  });

  it("returns the secret only under the right lender", async () => {
    const { store, a, b } = await world();
    await store.insertLenderAccount(account(a.id), "x", T0);
    expect(await store.getLenderAccountSecret(b.id, ACCOUNT_A)).toBeNull();
    expect(await store.getLenderAccountSecret(a.id, ACCOUNT_A)).toMatchObject({ id: ACCOUNT_A, lenderId: a.id, kind: "client_account" });
  });

  it("checks the version, and a replacement needs its new hint", async () => {
    const { store, a, b } = await world();
    await store.insertLenderAccount(account(a.id), "x", T0);
    await expect(store.updateLenderAccount(a.id, ACCOUNT_A, 5, { label: "x" }, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
    await expect(store.updateLenderAccount(b.id, ACCOUNT_A, 1, { label: "x" }, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
    const next = sealLenderAccountNumber(ACCOUNT_A, "SVC-1122334455", KEY);
    await expect(store.updateLenderAccount(a.id, ACCOUNT_A, 1, { numberEnc: next.numberEnc }, "x", T0)).rejects.toThrow(GuardError);
    await expect(store.updateLenderAccount(a.id, ACCOUNT_A, 1, { numberEnc: "plain", numberLast4: "4455" }, "x", T0)).rejects.toThrow(/not encrypted/);
    expect(await store.updateLenderAccount(a.id, ACCOUNT_A, 1, next, "broker:lee", T0)).toMatchObject({ numberLast4: "4455", recordVersion: 2, updatedBy: "broker:lee" });
  });

  it("deletes only within the lender", async () => {
    const { store, a, b } = await world();
    await store.insertLenderAccount(account(a.id), "x", T0);
    await expect(store.deleteLenderAccount(b.id, ACCOUNT_A)).rejects.toThrow(GuardError);
    await store.deleteLenderAccount(a.id, ACCOUNT_A);
    expect(await store.listLenderAccounts(a.id)).toEqual([]);
  });
});

describe("contact info", () => {
  it("bumps contactInfoVersion and refuses a stale version", async () => {
    const { store, a } = await world();
    const saved = await store.updateLenderContactInfo(a.id, 1, { mainPhone: "+13105550100", websiteUrl: "https://lender.example/" }, "broker:lee", T0);
    expect(saved).toMatchObject({ mainPhone: "+13105550100", contactInfoVersion: 2, updatedBy: "broker:lee" });
    await expect(store.updateLenderContactInfo(a.id, 1, { mainPhone: null }, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
    await expect(store.updateLenderContactInfo("33333333-3333-4333-8333-333333333333", 1, {}, "x", T0)).rejects.toThrow(ConcurrentUpdateError);
  });
});

describe("audit", () => {
  it("logs changed keys only, never contact values", async () => {
    const { store, a } = await world();
    const kim = await store.insertLenderContact(contact(a.id, { email: "kim.secret@lender.example", phoneDirect: "+13105550177" }), "x", T0);
    await store.updateLenderContact(a.id, kim.id, 1, { email: "kim.other@lender.example", notes: "met at conference" }, "x", T0);
    await store.insertLenderAccount(account(a.id), "x", T0);
    await store.deleteLenderContact(a.id, kim.id);
    const json = JSON.stringify(store.audit);
    for (const v of ["kim.secret@lender.example", "kim.other@lender.example", "+13105550177", "met at conference", "pii1.", "7766"]) expect(json).not.toContain(v);
    expect(store.audit.find((e) => e.tableName === "lender_contacts" && e.action === "UPDATE")!.changed).toEqual(["email", "notes", "recordVersion", "updatedBy"]);
  });
});
