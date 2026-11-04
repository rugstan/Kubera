import { describe, expect, it } from "vitest";
import { allTemplates, fingerprint, isPreApproved, OUTREACH_TEMPLATE_IDS, preApprovedFromEnv, templateById } from "./templates";

const BANNED = [/\bapproved\b/i, /qualified for/i, /fees? protected/i, /will call you today/i, /guarantee/i, /autonomous/i, /\bdraws?\b/i, /\bwire\b/i, /\bfunds?\b/i, /usury/i, /exempt/i];

function render(id: (typeof OUTREACH_TEMPLATE_IDS)[number]): string {
  const t = templateById(id);
  const built = t.build(t.sample);
  return built.channel === "sms" ? built.body : `${built.subject}\n${built.text}\n${built.html}`;
}

describe("chaser templates", () => {
  it("registers every id exactly once", () => {
    expect(allTemplates().map((t) => t.id).sort()).toEqual([...OUTREACH_TEMPLATE_IDS].sort());
  });

  it.each(OUTREACH_TEMPLATE_IDS)("%s renders its sample data without banned claims", (id) => {
    // "not guaranteed" is the required closing-timeline qualifier, not a promise.
    const text = render(id).replace(/not guaranteed/gi, "");
    for (const re of BANNED) expect(text, `${id} matches ${re}`).not.toMatch(re);
  });

  it("texts carry the opt-out line and fit two segments", () => {
    for (const t of allTemplates().filter((x) => x.channel === "sms")) {
      const built = t.build(t.sample);
      if (built.channel !== "sms") throw new Error("expected sms");
      expect(built.body, t.id).toContain("Reply STOP to opt out");
      expect(built.body.length, t.id).toBeLessThanOrEqual(320);
    }
  });

  it("only the speed-to-lead replies are pre-approved in code", () => {
    expect(allTemplates().filter((t) => t.preApproved).map((t) => t.id).sort()).toEqual(["speed_to_lead_email", "speed_to_lead_sms"]);
  });

  it("applies the texting window to borrower texts only", () => {
    expect(allTemplates().filter((t) => t.channel === "sms").every((t) => t.quietHours && t.audiences.every((a) => a === "borrower"))).toBe(true);
    expect(allTemplates().filter((t) => t.channel === "email").every((t) => !t.quietHours)).toBe(true);
  });

  it("requires text consent for every text and never skips the ledger for borrower email", () => {
    for (const t of allTemplates()) {
      if (t.channel === "sms") expect(t.consent, t.id).toBe("required");
      expect(t.consent, t.id).not.toBe("none");
    }
  });

  it("speed-to-lead text includes the booking link when given and a fallback when not", () => {
    const t = templateById("speed_to_lead_sms");
    const withLink = t.build({ firstName: "Pat", bookingUrl: "https://cal.com/corin/intro?utm_source=corin" });
    const without = t.build({ firstName: null, bookingUrl: null });
    if (withLink.channel !== "sms" || without.channel !== "sms") throw new Error("expected sms");
    expect(withLink.body).toContain("https://cal.com/corin/intro");
    expect(withLink.body).toContain("Pat");
    expect(without.body).toContain("email deals@");
    expect(without.body).not.toContain("null");
  });

  it("rejects links that are not https and unexpected data", () => {
    const t = templateById("speed_to_lead_sms");
    expect(() => t.build({ bookingUrl: "http://cal.com/x" })).toThrow();
    expect(() => t.build({ bookingUrl: "javascript:alert(1)" })).toThrow();
    expect(() => templateById("document_reminder_sms").build({ count: 0 })).toThrow();
  });

  it("escapes HTML in email data", () => {
    const t = templateById("document_reminder_email");
    const built = t.build({ firstName: "<b>Pat</b>", items: [{ title: "<script>x</script>", needsCorrection: false }], reminderNumber: 1 });
    if (built.channel !== "email") throw new Error("expected email");
    expect(built.html).not.toContain("<script>");
    expect(built.html).toContain("&lt;script&gt;");
  });

  it("marks rejected items as needing a corrected copy and softens later rounds", () => {
    const t = templateById("document_reminder_email");
    const first = t.build({ firstName: "Pat", items: [{ title: "Rent roll", needsCorrection: true, note: "Please include unit numbers" }], reminderNumber: 1 });
    const later = t.build({ firstName: "Pat", items: [{ title: "Rent roll", needsCorrection: false }], reminderNumber: 3 });
    if (first.channel !== "email" || later.channel !== "email") throw new Error("expected email");
    expect(first.text).toContain("needs a corrected copy: Please include unit numbers");
    expect(later.subject).toMatch(/reminder/i);
    expect(first.subject).not.toMatch(/reminder/i);
  });

  it("vendor nudges say who Corin is and ask for a status, nothing about fees", () => {
    const text = render("vendor_nudge_email");
    expect(text).toContain("loan broker");
    expect(text).toMatch(/status update|on track/);
    expect(text).not.toMatch(/invoice|payment|fee/i);
  });

  it("closing nudges never promise a closing date", () => {
    const text = render("closing_nudge_email");
    expect(text).toContain("not guaranteed");
    expect(text).not.toMatch(/within \d+ days|by (monday|friday|tomorrow)/i);
  });

  it("fingerprints change with the wording or version, and are stable otherwise", () => {
    const a = fingerprint(templateById("document_reminder_email"));
    expect(fingerprint(templateById("document_reminder_email"))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(templateById("closing_nudge_email"))).not.toBe(a);
    expect(new Set(allTemplates().map(fingerprint)).size).toBe(allTemplates().length);
  });

  it("reads broker pre-approvals from the environment, tied to the version", () => {
    const set = preApprovedFromEnv({ OUTREACH_PREAPPROVED_TEMPLATES: " Document_Reminder_Email@1 ,closing_nudge_sms@1" });
    expect(isPreApproved(templateById("document_reminder_email"), set)).toBe(true);
    expect(isPreApproved(templateById("closing_nudge_sms"), set)).toBe(true);
    expect(isPreApproved(templateById("vendor_nudge_email"), set)).toBe(false);
    expect(isPreApproved({ ...templateById("document_reminder_email"), version: 2 }, set)).toBe(false);
    expect(preApprovedFromEnv({}).size).toBe(0);
  });
});
