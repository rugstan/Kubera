import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPrivacyDb } from "./fake";
import { RECORD_RETENTION } from "@/components/legal/legal";
import { applyLegalHold, LEGAL_HOLD_TABLES, legalHoldSchema } from "./legal-hold";
import { submitPrivacyRequest, markVerified } from "./requests";
import {
  cutoffFor,
  DEAL_DOCUMENTS_BUCKET,
  DOCUMENT_QUARANTINE_BUCKET,
  eraseSubject,
  LEAD_POLICY,
  processDeletionRequests,
  purgeRow,
  RETENTION_POLICIES,
  runRetention,
} from "./retention";
import { MemoryObjectStorage } from "./storage";

vi.mock("server-only", () => ({}));

const NOW = new Date("2030-06-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const OLD = daysAgo(4 * 365);
const RECENT = daysAgo(30);

let db: MemoryPrivacyDb;
let storage: MemoryObjectStorage;

function lead(createdAt: string, email = "pat@example.com", extra: Record<string, unknown> = {}) {
  return db.insertRow("leads", { created_at: createdAt, contact: { firstName: "Pat", email }, intake: { assetType: "HOTEL" }, ...extra });
}

function doc(leadId: unknown, name: string, extra: Record<string, unknown> = {}) {
  const path = `${String(leadId)}/T12/${name}`;
  storage.put(DEAL_DOCUMENTS_BUCKET, path);
  return db.insertRow("documents", { created_at: OLD, lead_id: leadId, kind: "T12", storage_path: path, file_name: name, content_type: "application/pdf", ...extra });
}

beforeEach(() => {
  db = new MemoryPrivacyDb();
  storage = new MemoryObjectStorage();
});

describe("policies", () => {
  it("cover every table holding personal data with periods matching the published schedule", () => {
    const byId = Object.fromEntries(RETENTION_POLICIES.map((p) => [p.id, p]));
    expect(byId.leads!.retainDays).toBeGreaterThanOrEqual(3 * 365);
    expect(byId.ai_conversations!.retainDays).toBe(365);
    expect(byId.consent_events!.retainDays).toBeGreaterThanOrEqual(5 * 365);
    expect(byId.crm_events!.retainDays).toBe(90);
    expect(byId.privacy_requests!.retainDays).toBeGreaterThanOrEqual(730);
    expect(cutoffFor(LEAD_POLICY, NOW)).toBe(daysAgo(3 * 365 + 1));
  });

  it("uses the same bucket as the document vault", async () => {
    const { DOCUMENT_BUCKET } = await import("@/lib/supabase/server");
    expect(DEAL_DOCUMENTS_BUCKET).toBe(DOCUMENT_BUCKET);
    const { QUARANTINE_BUCKET, VAULT_BUCKET } = await import("@/lib/documents/types");
    const mail = await import("@/lib/mail/attachments");
    expect(DEAL_DOCUMENTS_BUCKET).toBe(VAULT_BUCKET);
    expect(DOCUMENT_QUARANTINE_BUCKET).toBe(QUARANTINE_BUCKET);
    expect(DOCUMENT_QUARANTINE_BUCKET).toBe(mail.QUARANTINE_BUCKET);
  });

  it("covers inbound mail, texts, the notification log and newsletter signups, with legal hold", () => {
    const byId = Object.fromEntries(RETENTION_POLICIES.map((p) => [p.id, p]));
    for (const id of ["mail_messages", "mail_messages_ignored", "sms_messages", "notifications", "newsletter_pending", "newsletter_unsubscribed"]) {
      expect(byId[id], id).toBeDefined();
      expect(byId[id]!.hasLegalHold, id).toBe(true);
      expect((LEGAL_HOLD_TABLES as readonly string[]).includes(byId[id]!.table), id).toBe(true);
    }
    expect(byId.mail_messages!.retainDays).toBeGreaterThanOrEqual(3 * 365);
    expect(byId.sms_messages!.retainDays).toBeGreaterThanOrEqual(3 * 365);
    expect(byId.notifications!.retainDays).toBeGreaterThanOrEqual(3 * 365);
    expect(byId.mail_messages!.storage).toBeDefined();
    const children = LEAD_POLICY.children!.map((c) => c.table);
    expect(children).toEqual(expect.arrayContaining(["documents", "ai_conversations", "mail_messages", "sms_messages", "notifications"]));
    expect(LEAD_POLICY.storagePrefixes!.map((p) => p.bucket).sort()).toEqual([DEAL_DOCUMENTS_BUCKET, DOCUMENT_QUARANTINE_BUCKET].sort());
  });

  it("publishes every record-level period the engine enforces", () => {
    const ids = new Set(RETENTION_POLICIES.map((p) => p.id));
    for (const r of RECORD_RETENTION) for (const p of r.policies) expect(ids.has(p), `${r.record}: ${p}`).toBe(true);
    const published = new Set(RECORD_RETENTION.flatMap((r) => r.policies));
    for (const id of ["mail_messages", "mail_messages_ignored", "sms_messages", "notifications", "newsletter_pending", "newsletter_unsubscribed"]) expect(published.has(id), id).toBe(true);
  });
});

describe("document files in the quarantine bucket", () => {
  /** A document row whose file sits in the quarantine bucket (every upload starts there). */
  function quarantinedDoc(leadId: unknown, name: string, status: string) {
    const path = `${String(leadId)}/T12/${name}`;
    storage.put(DOCUMENT_QUARANTINE_BUCKET, path);
    return db.insertRow("documents", { created_at: OLD, lead_id: leadId, kind: "T12", storage_path: path, file_name: name, content_type: "application/pdf", status, bucket: DOCUMENT_QUARANTINE_BUCKET });
  }

  it("removes quarantined and infected files with the expired lead", async () => {
    const l = lead(OLD);
    const quarantined = quarantinedDoc(l.id, "t12.pdf", "quarantined");
    const infected = quarantinedDoc(l.id, "rentroll.pdf", "infected");
    const clean = doc(l.id, "clean.pdf", { status: "clean", bucket: DEAL_DOCUMENTS_BUCKET });
    // An upload that was minted but never finalized: an object with no row, under the lead's prefix.
    storage.put(DOCUMENT_QUARANTINE_BUCKET, `${String(l.id)}/PFS/never-finalized.pdf`);
    // Another lead's quarantined file is untouched.
    const other = lead(RECENT, "other@example.com");
    const otherDoc = quarantinedDoc(other.id, "keep.pdf", "quarantined");

    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 1, failed: 0, objectsRemoved: 4 });
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, String(quarantined.storage_path))).toBe(false);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, String(infected.storage_path))).toBe(false);
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(clean.storage_path))).toBe(false);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, `${String(l.id)}/PFS/never-finalized.pdf`)).toBe(false);
    expect(db.rows("documents").map((d) => d.id)).toEqual([otherDoc.id]);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, String(otherDoc.storage_path))).toBe(true);
  });

  it("removes a file an interrupted scan move left in the other bucket", async () => {
    const l = lead(OLD);
    const d = doc(l.id, "moved.pdf", { status: "clean", bucket: DEAL_DOCUMENTS_BUCKET });
    storage.put(DOCUMENT_QUARANTINE_BUCKET, String(d.storage_path));
    await runRetention({ db, storage, now: () => NOW });
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d.storage_path))).toBe(false);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, String(d.storage_path))).toBe(false);
  });

  it("erasure removes a quarantined upload too", async () => {
    const l = lead(RECENT, "q@example.com");
    const d = quarantinedDoc(l.id, "pfs.pdf", "rejected");
    const r = await eraseSubject("q@example.com", { db, storage }, NOW);
    expect(r.deleted).toEqual([expect.objectContaining({ table: "leads", id: l.id, objectsRemoved: 1 })]);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, String(d.storage_path))).toBe(false);
  });
});

describe("communications records", () => {
  const PHONE = "+13105550100";

  function mail(extra: Record<string, unknown> = {}, attachments: Record<string, unknown>[] = []) {
    for (const a of attachments) if (a.storagePath) storage.put(String(a.bucket ?? DOCUMENT_QUARANTINE_BUCKET), String(a.storagePath));
    return db.insertRow("mail_messages", {
      received_at: OLD,
      mailbox: "docs",
      from_address: "Pat@Example.com",
      subject: "Docs",
      body_text: "Attached",
      status: "processed",
      lead_id: null,
      deal_id: null,
      attachments,
      ...extra,
    });
  }
  const att = (name: string, status = "stored") => ({ fileName: name, status, bucket: DOCUMENT_QUARANTINE_BUCKET, storagePath: `inbound-mail/docs/2026/11/m1/abc-${name}` });

  it("deletes a lead's mail (with attachments), texts and notification log with the lead", async () => {
    const l = lead(OLD);
    const a1 = att("t12.pdf");
    const m = mail({ lead_id: l.id }, [a1]);
    const sms = db.insertRow("sms_messages", { created_at: RECENT, direction: "outbound", from_number: "+14155550000", to_number: PHONE, body: "Hi", lead_id: l.id });
    const n = db.insertRow("notifications", { created_at: RECENT, channel: "email", recipient: "pat@example.com", template_id: "lead_confirmation", lead_id: l.id, audience: "borrower" });

    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 1, failed: 0 });
    expect(db.find("mail_messages", m.id)).toBeUndefined();
    expect(db.find("sms_messages", sms.id)).toBeUndefined();
    expect(db.find("notifications", n.id)).toBeUndefined();
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, a1.storagePath)).toBe(false);
  });

  it("keeps the lead (and its mail) when a message tied to it is under legal hold", async () => {
    const l = lead(OLD);
    const m = mail({ lead_id: l.id, legal_hold: true, legal_hold_reason: "Subpoena", legal_hold_set_at: OLD });
    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 0, held: 1 });
    expect(db.find("leads", l.id)).toBeDefined();
    expect(db.find("mail_messages", m.id)).toBeDefined();
  });

  it("expires unlinked mail with its stored attachments, but never a file a vault document owns", async () => {
    const stored = att("orphan.pdf");
    const registered = att("t12.pdf", "registered");
    const old = mail({}, [stored, registered]);
    const fresh = mail({ received_at: RECENT });
    const ignored = mail({ received_at: daysAgo(100), status: "ignored", from_address: "news@vendor.example" });
    const linked = mail({ deal_id: "deal-1" });

    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "mail_messages")).toMatchObject({ deleted: 1, objectsRemoved: 1 });
    expect(summary.policies.find((p) => p.policy === "mail_messages_ignored")).toMatchObject({ deleted: 1 });
    expect(db.find("mail_messages", old.id)).toBeUndefined();
    expect(db.find("mail_messages", ignored.id)).toBeUndefined();
    expect(db.find("mail_messages", fresh.id)).toBeDefined();
    expect(db.find("mail_messages", linked.id)).toBeDefined();
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, stored.storagePath)).toBe(false);
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, registered.storagePath)).toBe(true);
  });

  it("expires texts, the notification log and newsletter rows on their own schedules", async () => {
    const oldSms = db.insertRow("sms_messages", { created_at: OLD, direction: "inbound", from_number: PHONE, to_number: "+14155550000", body: "STOP", lead_id: null });
    const newSms = db.insertRow("sms_messages", { created_at: RECENT, direction: "inbound", from_number: PHONE, to_number: "+14155550000", body: "HELP", lead_id: null });
    const oldN = db.insertRow("notifications", { created_at: OLD, channel: "sms", recipient: PHONE, lead_id: null });
    const pending = db.insertRow("newsletter_subscribers", { created_at: daysAgo(31), email: "a@example.com", status: "pending" });
    const confirmed = db.insertRow("newsletter_subscribers", { created_at: OLD, email: "b@example.com", status: "confirmed", confirmed_at: OLD });
    const gone = db.insertRow("newsletter_subscribers", { created_at: OLD, email: "c@example.com", status: "unsubscribed", unsubscribed_at: daysAgo(31), audience_error: null });
    const unsynced = db.insertRow("newsletter_subscribers", { created_at: OLD, email: "d@example.com", status: "unsubscribed", unsubscribed_at: daysAgo(31), audience_error: "Resend 500" });

    await runRetention({ db, storage, now: () => NOW });
    expect(db.find("sms_messages", oldSms.id)).toBeUndefined();
    expect(db.find("sms_messages", newSms.id)).toBeDefined();
    expect(db.find("notifications", oldN.id)).toBeUndefined();
    expect(db.find("newsletter_subscribers", pending.id)).toBeUndefined();
    expect(db.find("newsletter_subscribers", confirmed.id)).toBeDefined();
    expect(db.find("newsletter_subscribers", gone.id)).toBeUndefined();
    expect(db.find("newsletter_subscribers", unsynced.id)).toBeDefined();
  });

  it("erasure removes the person's mail, texts, notification log and newsletter signup found by email and phone", async () => {
    const l = lead(RECENT, "pat@example.com", { contact: { firstName: "Pat", email: "pat@example.com", phone: "(310) 555-0100" } });
    const a1 = att("pfs.pdf");
    const unrouted = mail({ received_at: RECENT }, [a1]);
    const stranger = mail({ received_at: RECENT, from_address: "someone@example.com" });
    const stop = db.insertRow("sms_messages", { created_at: RECENT, direction: "inbound", from_number: PHONE, to_number: "+14155550000", body: "STOP", lead_id: null });
    const reply = db.insertRow("sms_messages", { created_at: RECENT, direction: "outbound", from_number: "+14155550000", to_number: PHONE, body: "You are unsubscribed", lead_id: null });
    const heldSms = db.insertRow("sms_messages", { created_at: RECENT, direction: "inbound", from_number: PHONE, to_number: "+14155550000", body: "x", lead_id: null, legal_hold: true, legal_hold_reason: "TCPA claim", legal_hold_set_at: RECENT });
    const n = db.insertRow("notifications", { created_at: RECENT, channel: "email", recipient: "PAT@example.com", lead_id: null });
    const nl = db.insertRow("newsletter_subscribers", { created_at: RECENT, email: "pat@example.com", status: "unsubscribed", unsubscribed_at: RECENT, audience_error: null });
    const sync = db.insertRow("crm_optout_sync", { phone: PHONE, opt_out: true, status: "pending" });

    const r = await eraseSubject("pat@example.com", { db, storage }, NOW);
    expect(db.find("leads", l.id)).toBeUndefined();
    expect(db.find("mail_messages", unrouted.id)).toBeUndefined();
    expect(storage.has(DOCUMENT_QUARANTINE_BUCKET, a1.storagePath)).toBe(false);
    expect(db.find("mail_messages", stranger.id)).toBeDefined();
    expect(db.find("sms_messages", stop.id)).toBeUndefined();
    expect(db.find("sms_messages", reply.id)).toBeUndefined();
    expect(db.find("notifications", n.id)).toBeUndefined();
    expect(db.find("newsletter_subscribers", nl.id)).toBeUndefined();
    // Held rows and an opt-out still syncing to the CRM are kept, with the reason recorded.
    expect(db.find("sms_messages", heldSms.id)).toBeDefined();
    expect(db.find("crm_optout_sync", sync.id)).toBeDefined();
    expect(r.retained).toEqual(
      expect.arrayContaining([
        { table: "sms_messages", id: heldSms.id, reason: "legal hold" },
        { table: "crm_optout_sync", id: sync.id, reason: expect.stringMatching(/opt-out/) },
      ]),
    );
    expect(r.contactRecords).toEqual(
      expect.arrayContaining([
        { table: "mail_messages", deleted: 1, objectsRemoved: 1 },
        { table: "sms_messages", deleted: 2, objectsRemoved: 0 },
        { table: "notifications", deleted: 1, objectsRemoved: 0 },
        { table: "newsletter_subscribers", deleted: 1, objectsRemoved: 0 },
      ]),
    );
  });

  it("erasure keeps mail tied to a loan file the law makes us keep, and a live newsletter subscription", async () => {
    const kept = lead(RECENT, "kim@example.com");
    db.insertRow("disclosures", { lead_id: kept.id, kind: "MLDS_RE882" });
    const m = mail({ received_at: RECENT, from_address: "kim@example.com", lead_id: kept.id });
    const deal = mail({ received_at: RECENT, from_address: "kim@example.com", deal_id: "deal-9" });
    const nl = db.insertRow("newsletter_subscribers", { created_at: RECENT, email: "kim@example.com", status: "confirmed", confirmed_at: RECENT });

    const r = await eraseSubject("kim@example.com", { db, storage }, NOW, { phones: ["310 555 0199"] });
    expect(db.find("mail_messages", m.id)).toBeDefined();
    expect(db.find("mail_messages", deal.id)).toBeDefined();
    expect(db.find("newsletter_subscribers", nl.id)).toBeDefined();
    expect(r.retained).toEqual(
      expect.arrayContaining([
        { table: "mail_messages", id: m.id, reason: expect.stringMatching(/§10148/) },
        { table: "mail_messages", id: deal.id, reason: expect.stringMatching(/loan file/) },
        { table: "newsletter_subscribers", id: nl.id, reason: expect.stringMatching(/unsubscribe/) },
      ]),
    );
  });
});

describe("runRetention", () => {
  it("deletes expired leads with their documents' storage objects, rows and linked conversations", async () => {
    const old = lead(OLD);
    const d1 = doc(old.id, "t12.pdf");
    const d2 = doc(old.id, "rentroll.xlsx");
    // An upload that never got a documents row still lives under the lead's prefix.
    storage.put(DEAL_DOCUMENTS_BUCKET, `${String(old.id)}/OTHER/orphan.pdf`);
    db.insertRow("ai_conversations", { created_at: RECENT, lead_id: old.id, messages: [] });
    const consent = db.insertRow("consent_events", { occurred_at: OLD, email: "pat@example.com", lead_id: old.id });

    const fresh = lead(RECENT, "sam@example.com");
    const freshDoc = doc(fresh.id, "fresh.pdf");

    const summary = await runRetention({ db, storage, now: () => NOW });
    const leads = summary.policies.find((p) => p.policy === "leads")!;
    expect(leads).toMatchObject({ candidates: 1, deleted: 1, failed: 0, objectsRemoved: 3 });
    expect(summary.ok).toBe(true);

    expect(db.find("leads", old.id)).toBeUndefined();
    expect(db.find("documents", d1.id)).toBeUndefined();
    expect(db.find("documents", d2.id)).toBeUndefined();
    expect(db.rows("ai_conversations")).toHaveLength(0);
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d1.storage_path))).toBe(false);
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d2.storage_path))).toBe(false);
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, `${String(old.id)}/OTHER/orphan.pdf`)).toBe(false);
    // Consent evidence survives (five-year policy) with the lead link nulled.
    expect(db.find("consent_events", consent.id)?.lead_id).toBeNull();

    // Recent data is untouched.
    expect(db.find("leads", fresh.id)).toBeDefined();
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(freshDoc.storage_path))).toBe(true);
  });

  it("never deletes a lead under legal hold, or one whose document is held", async () => {
    const held = lead(OLD, "a@example.com", { legal_hold: true, legal_hold_reason: "Litigation hold, matter 2030-04", legal_hold_set_at: OLD });
    const heldDoc = doc(held.id, "held.pdf");
    const parent = lead(OLD, "b@example.com");
    const childHeld = doc(parent.id, "child.pdf", { legal_hold: true, legal_hold_reason: "Subpoena", legal_hold_set_at: OLD });

    const summary = await runRetention({ db, storage, now: () => NOW });
    const leads = summary.policies.find((p) => p.policy === "leads")!;
    // The held lead is excluded from candidates; the parent of a held document is skipped.
    expect(leads).toMatchObject({ candidates: 1, deleted: 0, held: 1 });
    expect(db.find("leads", held.id)).toBeDefined();
    expect(db.find("leads", parent.id)).toBeDefined();
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(heldDoc.storage_path))).toBe(true);
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(childHeld.storage_path))).toBe(true);
    expect(storage.removed).toEqual([]);
  });

  it("keeps leads with MLDS or broker-of-record files (B&P §10148)", async () => {
    const withMlds = lead(OLD);
    const d = doc(withMlds.id, "t12.pdf");
    db.insertRow("disclosures", { lead_id: withMlds.id, kind: "MLDS_RE882" });
    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 0, blocked: 1 });
    expect(db.find("leads", withMlds.id)).toBeDefined();
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d.storage_path))).toBe(true);
  });

  it("leaves the rows in place when storage deletion fails, so the next run retries", async () => {
    const l = lead(OLD);
    const d = doc(l.id, "stuck.pdf");
    storage.failOn.add(String(d.storage_path));
    const first = await runRetention({ db, storage, now: () => NOW });
    expect(first.ok).toBe(false);
    expect(first.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 0, failed: 1 });
    expect(db.find("leads", l.id)).toBeDefined();
    expect(db.find("documents", d.id)).toBeDefined();

    storage.failOn.clear();
    const second = await runRetention({ db, storage, now: () => NOW });
    expect(second.policies.find((p) => p.policy === "leads")).toMatchObject({ deleted: 1 });
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d.storage_path))).toBe(false);
  });

  it("applies the simple policies with their filters", async () => {
    const loose = db.insertRow("ai_conversations", { created_at: daysAgo(400), lead_id: null, messages: [] });
    const young = db.insertRow("ai_conversations", { created_at: daysAgo(100), lead_id: null, messages: [] });
    const approved = db.insertRow("partners", { created_at: OLD, email: "lender@example.com", status: "APPROVED" });
    const rejected = db.insertRow("partners", { created_at: OLD, email: "x@example.com", status: "REJECTED" });
    const crmOld = db.insertRow("crm_events", { received_at: daysAgo(91), payload: {} });
    const crmNew = db.insertRow("crm_events", { received_at: daysAgo(10), payload: {} });
    const openReq = db.insertRow("privacy_requests", { created_at: OLD, completed_at: null, subject_email: "a@b.co" });
    const closedReq = db.insertRow("privacy_requests", { created_at: OLD, completed_at: daysAgo(800), subject_email: "c@d.co" });
    const consentOld = db.insertRow("consent_events", { occurred_at: daysAgo(6 * 365), email: "a@b.co", lead_id: null, partner_id: null });
    const consentLinked = db.insertRow("consent_events", { occurred_at: daysAgo(6 * 365), email: "a@b.co", lead_id: "still-linked", partner_id: null });

    await runRetention({ db, storage, now: () => NOW });
    expect(db.find("ai_conversations", loose.id)).toBeUndefined();
    expect(db.find("ai_conversations", young.id)).toBeDefined();
    expect(db.find("partners", approved.id)).toBeDefined();
    expect(db.find("partners", rejected.id)).toBeUndefined();
    expect(db.find("crm_events", crmOld.id)).toBeUndefined();
    expect(db.find("crm_events", crmNew.id)).toBeDefined();
    expect(db.find("privacy_requests", openReq.id)).toBeDefined();
    expect(db.find("privacy_requests", closedReq.id)).toBeUndefined();
    expect(db.find("consent_events", consentOld.id)).toBeUndefined();
    expect(db.find("consent_events", consentLinked.id)).toBeDefined();
  });

  it("reports and continues when one row in a batch is refused", async () => {
    db.insertRow("ai_conversations", { created_at: daysAgo(400), lead_id: null, messages: [] });
    // Held rows are filtered out of candidates, so simulate a database refusal instead.
    const spy = vi.spyOn(db, "deleteRows").mockResolvedValueOnce({ deleted: [], failed: [{ id: "x", error: "boom" }] });
    const summary = await runRetention({ db, storage, now: () => NOW, policies: RETENTION_POLICIES.filter((p) => p.id === "ai_conversations") });
    expect(summary.policies[0]).toMatchObject({ failed: 1, errors: ["x: boom"] });
    spy.mockRestore();
  });

  it("deletes nothing in a dry run", async () => {
    const l = lead(OLD);
    const d = doc(l.id, "t12.pdf");
    const summary = await runRetention({ db, storage, now: () => NOW, dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ candidates: 1, deleted: 0 });
    expect(db.find("leads", l.id)).toBeDefined();
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d.storage_path))).toBe(true);
  });

  it("refuses a storage prefix that could match the whole bucket", async () => {
    storage.put(DEAL_DOCUMENTS_BUCKET, "other-lead/T12/keep.pdf");
    db.insertRow("leads", { id: "", created_at: OLD, contact: { email: "x@example.com" } });
    const r = await purgeRow(LEAD_POLICY, "", { db, storage });
    expect(r).toMatchObject({ status: "failed", detail: expect.stringMatching(/unsafe storage prefix/) });
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, "other-lead/T12/keep.pdf")).toBe(true);
  });

  it("respects the per-policy limit", async () => {
    for (let i = 0; i < 5; i++) lead(daysAgo(4 * 365 + i), `p${i}@example.com`);
    const summary = await runRetention({ db, storage, now: () => NOW, limitPerPolicy: 2 });
    expect(summary.policies.find((p) => p.policy === "leads")).toMatchObject({ candidates: 2, deleted: 2 });
    expect(db.rows("leads")).toHaveLength(3);
  });
});

describe("legal hold", () => {
  it("requires a reason to place a hold and blocks purge until released", async () => {
    const l = lead(OLD);
    expect(legalHoldSchema.safeParse({ table: "leads", id: l.id, hold: true, actor: "J. Rivera, compliance" }).success).toBe(false);
    const input = legalHoldSchema.parse({ table: "leads", id: l.id, hold: true, reason: "Litigation hold: Smith v. Kubera", actor: "J. Rivera, compliance" });
    expect((await applyLegalHold(db, input, NOW)).found).toBe(true);
    expect(db.find("leads", l.id)).toMatchObject({ legal_hold: true, legal_hold_reason: "Litigation hold: Smith v. Kubera", legal_hold_set_by: "J. Rivera, compliance" });

    // Even a direct purge (erasure path) refuses.
    expect((await purgeRow(LEAD_POLICY, l.id, { db, storage }, { checkParentHold: true })).status).toBe("held");
    expect((await db.deleteRows("leads", [l.id])).failed[0]?.error).toMatch(/legal hold/);

    await applyLegalHold(db, legalHoldSchema.parse({ table: "leads", id: l.id, hold: false, actor: "J. Rivera, compliance" }), NOW);
    expect(db.find("leads", l.id)?.legal_hold_reason).toBe("Litigation hold: Smith v. Kubera");
    const summary = await runRetention({ db, storage, now: () => NOW });
    expect(summary.policies.find((p) => p.policy === "leads")?.deleted).toBe(1);
  });

  it("reports a missing record", async () => {
    const input = legalHoldSchema.parse({ table: "partners", id: "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10", hold: true, reason: "Demand letter", actor: "Counsel" });
    expect((await applyLegalHold(db, input)).found).toBe(false);
  });
});

describe("deletion requests", () => {
  const verifyLeadToken = () => false;
  const base = { name: "Pat Lee", email: "Pat@Example.com", phone: "", relationship: "self" as const, attest: true as const };

  it("erases the subject's leads, files and partner rows, and records what was kept", async () => {
    const l1 = lead(RECENT, "pat@example.com");
    const d1 = doc(l1.id, "t12.pdf");
    const l2 = lead(RECENT, "PAT@example.com");
    db.insertRow("disclosures", { lead_id: l2.id, kind: "MLDS_RE882" });
    const held = lead(RECENT, "pat@example.com", { legal_hold: true, legal_hold_reason: "Hold", legal_hold_set_at: RECENT });
    const p = db.insertRow("partners", { created_at: RECENT, email: "pat@example.com", status: "APPROVED" });
    const other = lead(RECENT, "someone@example.com");

    const submitted = await submitPrivacyRequest({ ...base, type: "deletion" }, { store: db, verifyLeadToken, now: () => NOW });
    expect(submitted.status).toBe("pending_verification");

    // Unverified requests are not processed.
    expect((await processDeletionRequests({ db, storage, requests: db, now: () => NOW })).processed).toBe(0);
    expect(db.find("leads", l1.id)).toBeDefined();

    await markVerified(db, submitted.id, "J. Rivera, compliance", NOW);
    const summary = await processDeletionRequests({ db, storage, requests: db, now: () => NOW });
    expect(summary).toMatchObject({ processed: 1, partial: 1, errors: [] });

    expect(db.find("leads", l1.id)).toBeUndefined();
    expect(storage.has(DEAL_DOCUMENTS_BUCKET, String(d1.storage_path))).toBe(false);
    expect(db.find("partners", p.id)).toBeUndefined();
    expect(db.find("leads", l2.id)).toBeDefined();
    expect(db.find("leads", held.id)).toBeDefined();
    expect(db.find("leads", other.id)).toBeDefined();

    const req = await db.get(submitted.id);
    expect(req?.status).toBe("partially_completed");
    expect(req?.completed_at).toBe(NOW.toISOString());
    const resolution = req?.resolution as { deleted: unknown[]; retained: { id: unknown; reason: string }[] };
    expect(resolution.deleted).toHaveLength(2);
    expect(resolution.retained).toEqual(
      expect.arrayContaining([
        { table: "leads", id: l2.id, reason: expect.stringMatching(/§10148/) },
        { table: "leads", id: held.id, reason: "legal hold" },
      ]),
    );
  });

  it("completes cleanly when nothing needs to be kept", async () => {
    lead(RECENT, "solo@example.com");
    const r = await eraseSubject("solo@example.com", { db, storage }, NOW);
    expect(r.deleted).toHaveLength(1);
    expect(r.retained).toEqual([]);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
