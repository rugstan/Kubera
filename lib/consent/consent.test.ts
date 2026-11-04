import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));

const { buildConsentEvent, MemoryConsentLedger, normalizePhone, recordConsent, setConsentLedger, sha256 } = await import("./ledger");
const { CONSENT_TEXTS, CURRENT_CONSENT, resolveConsentText } = await import("./texts");

// Published consent wording must never change in place. If one of these
// hashes fails, add a new version instead of editing the old text.
const PINNED: Record<string, string> = {
  "qualifier-contact-2026-10-31": sha256(
    "I agree that Corin Commercial may contact me about this financing request by phone, text, or email, including by automated means. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out.",
  ),
  "qualifier-contact-2026-11-01": sha256(
    "I agree that Corin Commercial may contact me about this financing request by phone, text, or email, including by automated means. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
  ),
  "partner-contact-2026-10-31": sha256("I agree that Corin Commercial may contact me about this registration by phone, text, or email."),
  "partner-contact-2026-11-01": sha256(
    "I agree that Corin Commercial may contact me about this registration by phone, text, or email. Consent is not a condition of any service. Message and data rates may apply; reply STOP to opt out or HELP for help.",
  ),
};

describe("consent texts", () => {
  it("pins every published version's wording", () => {
    for (const [id, text] of Object.entries(CONSENT_TEXTS)) {
      expect(PINNED[id], `add a pinned hash for ${id}`).toBeDefined();
      expect(sha256(text.text)).toBe(PINNED[id]);
      expect(text.id).toBe(id);
    }
  });

  it("current versions exist and belong to their form", () => {
    for (const [form, id] of Object.entries(CURRENT_CONSENT)) {
      expect(CONSENT_TEXTS[id].form).toBe(form);
    }
  });

  it("the current qualifier wording carries the HELP instruction and the old version stays resolvable", () => {
    expect(CURRENT_CONSENT.qualifier).toBe("qualifier-contact-2026-11-01");
    expect(CONSENT_TEXTS[CURRENT_CONSENT.qualifier].text).toMatch(/reply STOP to opt out or HELP for help/);
    expect(resolveConsentText("qualifier", "qualifier-contact-2026-10-31").id).toBe("qualifier-contact-2026-10-31");
  });

  it("accepts a known version for the same form only", () => {
    expect(resolveConsentText("qualifier", "qualifier-contact-2026-10-31").id).toBe("qualifier-contact-2026-10-31");
    expect(resolveConsentText("qualifier", "partner-contact-2026-10-31").id).toBe(CURRENT_CONSENT.qualifier);
    expect(resolveConsentText("partner", "made-up").id).toBe(CURRENT_CONSENT.partner);
    expect(resolveConsentText("partner", undefined).id).toBe(CURRENT_CONSENT.partner);
  });
});

describe("consent events", () => {
  it("records server-derived channels and a hash of the shown text", () => {
    const text = resolveConsentText("qualifier");
    const e = buildConsentEvent({
      text,
      email: "  Pat@Example.COM ",
      phone: "(415) 555-0100",
      ip: "203.0.113.9",
      userAgent: "UA",
      page: "/express",
      leadId: "lead-1",
      now: new Date("2026-11-01T00:00:00Z"),
    });
    expect(e).toMatchObject({
      eventType: "granted",
      form: "qualifier",
      textVersion: text.id,
      textSha256: sha256(text.text),
      channels: ["phone", "sms", "email", "autodialer"],
      email: "pat@example.com",
      phone: "+14155550100",
      ip: "203.0.113.9",
      page: "/express",
      leadId: "lead-1",
      occurredAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("normalizes phone numbers for STOP matching", () => {
    expect(normalizePhone("415.555.0100")).toBe("+14155550100");
    expect(normalizePhone("1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("recordConsent never throws when the ledger fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setConsentLedger({ record: async () => Promise.reject(new Error("db down")) });
    const out = await recordConsent(buildConsentEvent({ text: resolveConsentText("partner"), email: "a@b.co" }));
    expect(out).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    const mem = new MemoryConsentLedger();
    setConsentLedger(mem);
    await recordConsent(buildConsentEvent({ text: resolveConsentText("partner"), email: "a@b.co" }));
    expect(mem.events).toHaveLength(1);
    setConsentLedger(undefined);
  });
});
