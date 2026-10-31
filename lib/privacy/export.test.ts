import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeyring, encryptField } from "./crypto";
import { buildSubjectExport, canonicalJson, exportSha256 } from "./export";
import { MemoryPrivacyDb } from "./fake";
import { exactIlikePattern } from "./supabase";

function seed() {
  const db = new MemoryPrivacyDb();
  const lead = db.insertRow("leads", {
    created_at: "2026-11-01T00:00:00Z",
    source: "express",
    contact: { firstName: "Pat", email: "Pat@Example.com" },
    intake: { assetType: "HOTEL", loanAmount: 5_000_000 },
    decision: { primaryProgramFit: "SBA_504" },
    rationale: ["Owner-occupied hotel"],
    crm_error: "timeout",
    crm_progress: { companyId: "c1" },
    twenty_person_id: "tp1",
  });
  db.insertRow("leads", { created_at: "2026-11-02T00:00:00Z", contact: { email: "someone@example.com" }, intake: {} });
  db.insertRow("documents", { created_at: "2026-11-01T00:00:00Z", lead_id: lead.id, kind: "T12", file_name: "t12.pdf", content_type: "application/pdf", storage_path: `${String(lead.id)}/T12/x.pdf` });
  db.insertRow("ai_conversations", { created_at: "2026-11-01T00:00:00Z", lead_id: lead.id, messages: [{ role: "user", content: "hi" }], ip_hash: "secret-hash" });
  db.insertRow("consent_events", { occurred_at: "2026-11-01T00:00:00Z", email: "pat@example.com", form: "qualifier", channels: ["sms"] });
  db.insertRow("partners", { created_at: "2026-11-01T00:00:00Z", email: "pat@example.com", partner_type: "REFERRAL", status: "APPROVED", profile: {}, crm_error: null });
  return { db, lead };
}

describe("buildSubjectExport", () => {
  it("collects every record about the person and leaves internal plumbing out", async () => {
    const { db, lead } = seed();
    const doc = await buildSubjectExport(db, "PAT@example.com", { now: new Date("2026-11-20T00:00:00Z"), requestId: "req-1" });
    expect(doc.subject.email).toBe("pat@example.com");
    expect(doc.records.leads).toHaveLength(1);
    expect(doc.records.leads[0]).toMatchObject({ id: lead.id, decision: { primaryProgramFit: "SBA_504" }, rationale: ["Owner-occupied hotel"] });
    expect(doc.records.leads[0]).not.toHaveProperty("crm_error");
    expect(doc.records.leads[0]).not.toHaveProperty("twenty_person_id");
    expect(doc.records.documents[0]).toMatchObject({ file_name: "t12.pdf", kind: "T12" });
    expect(doc.records.documents[0]).not.toHaveProperty("storage_path");
    expect(doc.records.aiConversations[0]).not.toHaveProperty("ip_hash");
    expect(doc.records.consentRecords).toHaveLength(1);
    expect(doc.records.partnerRegistrations).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("someone@example.com");
    expect(doc.about.categories.length).toBeGreaterThan(5);
    expect(doc.about.recipients.some((r) => r.name === "Anthropic")).toBe(true);
    expect(doc.about.sale).toMatch(/do not sell/);
  });

  it("decrypts encrypted fields with their row context, or lists them as withheld", async () => {
    const db = new MemoryPrivacyDb();
    const keyring = createKeyring({ version: 1, key: randomBytes(32) });
    const id = "11111111-1111-4111-8111-111111111111";
    db.insertRow("leads", { id, created_at: "2026-11-01T00:00:00Z", contact: { email: "a@b.co" }, intake: encryptField("secret intake", { context: `leads.intake:${id}`, keyring }) });
    expect((await buildSubjectExport(db, "a@b.co", { keyring })).records.leads[0]?.intake).toBe("secret intake");
    const withheld = await buildSubjectExport(db, "a@b.co", { keyring: createKeyring({ version: 1, key: randomBytes(32) }) });
    expect(withheld.withheld).toEqual([expect.objectContaining({ table: "leads", field: "intake" })]);
    expect(withheld.records.leads[0]).not.toHaveProperty("intake");
  });

  it("includes the person's emails, texts, notification log and newsletter signup, keyed by email and phone", async () => {
    const db = new MemoryPrivacyDb();
    const lead = db.insertRow("leads", { created_at: "2026-11-01T00:00:00Z", contact: { email: "pat@example.com", phone: "(310) 555-0100" }, intake: {} });
    db.insertRow("mail_messages", {
      received_at: "2026-11-02T00:00:00Z",
      mailbox: "docs",
      from_address: "Pat@Example.com",
      subject: "My PFS",
      body_text: "SSN [REDACTED]",
      body_encrypted: "pii1.v1.sealed",
      attachments: [{ fileName: "pfs.pdf", size: 10, contentType: "application/pdf", storagePath: "inbound-mail/docs/x/pfs.pdf", bucket: "deal-documents-quarantine", status: "stored" }],
      classification: { flags: [] },
      provider_message_id: "zoho-1",
    });
    db.insertRow("mail_messages", { received_at: "2026-11-02T00:00:00Z", from_address: "other@example.com", subject: "Not Pat" });
    db.insertRow("sms_messages", { created_at: "2026-11-03T00:00:00Z", direction: "inbound", from_number: "+13105550100", to_number: "+14155550000", body: "STOP", keyword: "stop", provider_message_id: "tx-1" });
    db.insertRow("sms_messages", { created_at: "2026-11-03T00:00:00Z", direction: "inbound", from_number: "+19995550100", to_number: "+14155550000", body: "Someone else" });
    db.insertRow("notifications", { created_at: "2026-11-01T00:00:00Z", channel: "email", recipient: "pat@example.com", template_id: "lead_confirmation", audience: "borrower", idempotency_key: "k1" });
    db.insertRow("notifications", { created_at: "2026-11-01T00:00:00Z", channel: "email", recipient: "deals@kuberacommercial.com", template_id: "staff_alert", audience: "staff", lead_id: lead.id });
    db.insertRow("newsletter_subscribers", { created_at: "2026-11-01T00:00:00Z", email: "pat@example.com", status: "confirmed", resend_contact_id: "rc_1" });

    const doc = await buildSubjectExport(db, "pat@example.com");
    expect(doc.subject.phones).toEqual(["+13105550100"]);
    expect(doc.records.emails).toHaveLength(1);
    expect(doc.records.emails[0]).toMatchObject({ subject: "My PFS", body_text: "SSN [REDACTED]", attachments: [{ fileName: "pfs.pdf", size: 10, contentType: "application/pdf" }] });
    expect(doc.records.emails[0]).not.toHaveProperty("body_encrypted");
    expect(doc.records.emails[0]).not.toHaveProperty("provider_message_id");
    expect(JSON.stringify(doc)).not.toContain("inbound-mail/");
    expect(doc.withheld).toEqual([expect.objectContaining({ table: "mail_messages", field: "body_encrypted" })]);
    expect(doc.records.textMessages).toEqual([expect.objectContaining({ body: "STOP", keyword: "stop" })]);
    expect(doc.records.textMessages[0]).not.toHaveProperty("provider_message_id");
    expect(doc.records.notificationsSent).toEqual([expect.objectContaining({ template_id: "lead_confirmation" })]);
    expect(doc.records.newsletter).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect(doc.records.newsletter[0]).not.toHaveProperty("resend_contact_id");
    expect(JSON.stringify(doc)).not.toContain("Someone else");
  });

  it("uses the phone number given on the request form", async () => {
    const db = new MemoryPrivacyDb();
    db.insertRow("sms_messages", { created_at: "2026-11-03T00:00:00Z", direction: "inbound", from_number: "+13105550177", to_number: "+14155550000", body: "HELP" });
    const doc = await buildSubjectExport(db, "nolead@example.com", { phones: ["310-555-0177"] });
    expect(doc.records.textMessages).toHaveLength(1);
  });

  it("hashes reproducibly regardless of key order", async () => {
    const { db } = seed();
    const now = new Date("2026-11-20T00:00:00Z");
    const a = await buildSubjectExport(db, "pat@example.com", { now });
    const b = await buildSubjectExport(db, "pat@example.com", { now });
    expect(exportSha256(a)).toBe(exportSha256(b));
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("exactIlikePattern", () => {
  it("escapes LIKE wildcards so an email matches only itself", () => {
    expect(exactIlikePattern("a_b%c@x.co")).toBe("a\\_b\\%c@x.co");
    expect(exactIlikePattern("a*b@x.co")).toBe("a_b@x.co");
  });
});
