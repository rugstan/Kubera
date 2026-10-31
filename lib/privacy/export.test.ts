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
