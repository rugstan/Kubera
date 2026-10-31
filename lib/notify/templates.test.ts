import { describe, expect, it } from "vitest";
import { allTemplates, findBannedCopy, templateById, type TemplateId } from "./templates";

// Representative data for each template, used to render and lint every message.
const SAMPLE: Record<TemplateId, unknown> = {
  lead_confirmation: { firstName: "Pat", reference: "3F9A12BC", bookingUrl: "https://cal.com/kubera/intro?name=Pat" },
  document_request: { firstName: "Pat", items: ["Trailing 12-month operating statement", "Current rent roll"], uploadUrl: "https://kuberacommercial.com/upload/abc" },
  milestone_update: { firstName: "Pat", label: "Lender terms received", message: "Lender terms are in. Terms are indicative until a lender issues a commitment." },
  portal_invite: { firstName: "Pat", portalUrl: "https://kuberacommercial.com/portal/access?token=abc", expiresLabel: "on Thu, 05 Nov 2026 17:00 UTC" },
  staff_alert: { title: "Tier-1 lead 3F9A12BC", lines: ["Phone and text consent is on file."], link: { href: "https://kuberacommercial.com/pipeline", label: "Open the pipeline" } },
  document_request_sms: { count: 2 },
  milestone_update_sms: { label: "Lender outreach" },
  staff_tier1_sms: { reference: "3F9A12BC", summary: "$12.0M assisted living HUD 232", contactOk: true },
  staff_alert_sms: { text: "Inbound text from a borrower" },
  sms_stop_reply: {},
  sms_help_reply: {},
  sms_start_reply: {},
};

describe("template registry", () => {
  it("has sample data for every template", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual(allTemplates().map((t) => t.id).sort());
  });

  it("only pre-approves staff alerts, the lead confirmation and the keyword replies", () => {
    const pre = allTemplates().filter((t) => t.preApproved).map((t) => t.id).sort();
    expect(pre).toEqual(["lead_confirmation", "sms_help_reply", "sms_start_reply", "sms_stop_reply", "staff_alert", "staff_alert_sms", "staff_tier1_sms"]);
  });

  it("requires explicit consent for every borrower-facing text and for milestone emails", () => {
    for (const t of allTemplates()) {
      if (t.channel === "sms" && t.audiences.length === 1 && t.audiences[0] !== "staff") expect(t.consent).toBe("required");
    }
    expect(templateById("milestone_update").consent).toBe("required");
    expect(templateById("milestone_update_sms").consent).toBe("required");
    expect(templateById("sms_stop_reply").consent).toBe("none");
  });

  it("applies quiet hours to borrower texts only", () => {
    expect(templateById("milestone_update_sms").quietHours).toBe(true);
    expect(templateById("document_request_sms").quietHours).toBe(true);
    for (const id of ["staff_tier1_sms", "staff_alert_sms", "sms_stop_reply", "sms_help_reply", "sms_start_reply"] as const) expect(templateById(id).quietHours).toBe(false);
  });
});

describe("rendered messages", () => {
  it.each(allTemplates().map((t) => [t.id] as const))("%s renders and passes the legal copy lint", async (id) => {
    const built = await templateById(id).build(SAMPLE[id]);
    const text = built.channel === "email" ? `${built.subject}\n${built.text}` : built.body;
    expect(text.length).toBeGreaterThan(10);
    expect(findBannedCopy(text)).toEqual([]);
  });

  it("emails carry the licensing line, the broker statement and an HTML and text body", async () => {
    for (const id of ["lead_confirmation", "document_request", "milestone_update", "staff_alert"] as const) {
      const built = await templateById(id).build(SAMPLE[id]);
      if (built.channel !== "email") throw new Error("expected email");
      expect(built.html).toContain("<html");
      expect(built.html).toContain("Real estate broker, California Department of Real Estate");
      expect(built.html).toContain("not a lender");
      expect(built.text).toContain("Real estate broker, California Department of Real Estate");
      expect(built.text).not.toContain("<");
    }
  });

  it("escapes recipient-supplied text in HTML", async () => {
    const built = await templateById("lead_confirmation").build({ firstName: "<script>alert(1)</script>" });
    if (built.channel !== "email") throw new Error("expected email");
    expect(built.html).not.toContain("<script>alert(1)</script>");
  });

  it("lists the requested documents and tells the borrower not to email sensitive numbers", async () => {
    const built = await templateById("document_request").build(SAMPLE.document_request);
    if (built.channel !== "email") throw new Error("expected email");
    expect(built.text).toContain("Current rent roll");
    expect(built.text).toContain("Social Security");
  });

  it("includes opt-out and rate language in every borrower text", async () => {
    for (const id of ["document_request_sms", "milestone_update_sms"] as const) {
      const built = await templateById(id).build(SAMPLE[id]);
      if (built.channel !== "sms") throw new Error("expected sms");
      expect(built.body).toContain("Reply STOP to opt out");
      expect(built.body).toContain("Msg&data rates may apply");
      expect(built.body.length).toBeLessThanOrEqual(320);
    }
  });

  it("rejects non-https links and malformed data", async () => {
    await expect(templateById("lead_confirmation").build({ firstName: "Pat", bookingUrl: "javascript:alert(1)" })).rejects.toThrow();
    await expect(templateById("document_request").build({ firstName: "Pat", items: [] })).rejects.toThrow();
    await expect(templateById("staff_tier1_sms").build({ reference: "x" })).rejects.toThrow();
  });
});

describe("copy lint", () => {
  it.each([
    "You are approved for a loan",
    "You are pre-approved",
    "You have qualified for the 504 program",
    "Your fees protected",
    "An advisor will call you today",
    "Our autonomous agent will follow up",
    "Most deals close in 10-21 days",
    "This loan is usury-exempt",
    "We guarantee the best rate",
  ])('flags "%s"', (text) => expect(findBannedCopy(text).length).toBeGreaterThan(0));

  it.each(["Closing dates are not guaranteed", "Your advisor is reviewing your request", "Terms are indicative until a lender issues a commitment"])('allows "%s"', (text) =>
    expect(findBannedCopy(text)).toEqual([]),
  );
});
