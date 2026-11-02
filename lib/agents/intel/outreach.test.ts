import { describe, expect, it } from "vitest";
import { AutonomyPolicy, MemoryAutonomyStore } from "@/lib/agents/core/autonomy";
import { closedApprovalGate } from "@/lib/compliance/approval-gate";
import { EmailError } from "@/lib/notify/email/types";
import type { ConsentReader } from "@/lib/notify/consent";
import { OutreachError, approvalActionFor, buildMessage, cancelOutreach, draftOutreach, htmlFor, introFacts, lintOutreach, markMailed, mailingLine, monthYear, settleOutreach, settlePending, templateIntro, writeIntro } from "./outreach";
import { NOW, broker, identity, outreachSetup, seedProspect, testGateway } from "./testing";
import type { Prospect } from "./types";

async function drafted(opts: Parameters<typeof outreachSetup>[0] = {}, staff: Parameters<typeof seedProspect>[2] = { contactEmail: "pat@owner.example", contactName: "Pat Owner" }, channel: "email" | "letter" = "email") {
  const s = outreachSetup(opts);
  const prospect = await seedProspect(s.store, {}, staff);
  const res = await draftOutreach(s.deps, { prospectId: prospect.id, channel, actor: "staff:ana@corin.test" });
  if (res.status !== "drafted") throw new Error("expected a draft");
  return { ...s, prospect, outreach: res.outreach };
}

const approve = async (s: Awaited<ReturnType<typeof drafted>>, outreachId = s.outreach.id) => {
  const row = (await s.store.getOutreach(outreachId))!;
  const record = (await s.approvals.getByKey(row.idempotencyKey))!;
  return s.approvals.approve(record.id, broker);
};

describe("message copy", () => {
  it("carries the license line, postal address, opt-out and broker disclosure, and passes the compliance lint", async () => {
    const { outreach } = await drafted();
    expect(outreach.subject).toBe("Financing options for 100 Example Ave");
    expect(outreach.bodyText).toContain(identity.licenseLine);
    expect(outreach.bodyText).toContain(identity.address);
    expect(outreach.bodyText).toContain("do-not-contact");
    expect(outreach.bodyText).toContain("not the lender");
    expect(outreach.bodyText).toContain("Hello Pat,");
    expect(outreach.bodyText).toContain("48-unit multifamily properties like yours");
    expect(outreach.bodyText).toContain("around July 2027");
    expect(outreach.bodyText).toContain("HUD 223(f) refinance");
    expect(lintOutreach(outreach.bodyText, identity)).toEqual({ ok: true, problems: [] });
    // Global rule 4: none of the prohibited phrases, no timeline, no lender role.
    expect(outreach.bodyText).not.toMatch(/approved|qualif|guarantee|will call you today|fees protected|autonomous|\d+\s*(?:-|to)\s*\d+ days/i);
  });

  it("lint catches prohibited copy and missing disclosures", () => {
    const base = buildMessage({ addressLine1: "1 A St", city: "LA", propertyType: "retail", units: null, loanMaturityDate: "2027-03-01", recommendedProgram: null, contactName: null }, "email", identity, templateIntro({ addressLine1: "1 A St", city: "LA", propertyType: "retail", units: null, loanMaturityDate: "2027-03-01" })).bodyText;
    expect(lintOutreach(base, identity).ok).toBe(true);
    expect(lintOutreach(`${base}\nYou are pre-approved.`, identity).problems.join()).toMatch(/banned|guardrail/);
    expect(lintOutreach(`${base}\nWe guarantee the lowest rate.`, identity).ok).toBe(false);
    expect(lintOutreach(`${base}\nYour loan will close in 14 days.`, identity).ok).toBe(false);
    expect(lintOutreach(`${base}\nBefore you default, act now.`, identity).ok).toBe(false);
    expect(lintOutreach(base.replace(identity.licenseLine, ""), identity).problems).toContain("missing_license_line");
    expect(lintOutreach(base.replace(identity.address, ""), identity).problems).toContain("missing_postal_address");
    expect(lintOutreach(base.replace(/do-not-contact/g, "list").replace(/unsubscribe/g, "stop"), identity).problems).toContain("missing_opt_out");
    expect(lintOutreach(base.replace("not the lender", "the lender"), identity).problems).toContain("missing_broker_disclosure");
  });

  it("renders HTML with escaped text and a footer", () => {
    const html = htmlFor("Hello <b>x</b>,\n\nSecond.\n\n--\nFooter & more\nline 2");
    expect(html).toContain("<p>Hello &lt;b&gt;x&lt;/b&gt;,</p>");
    expect(html).toContain("Footer &amp; more<br>line 2");
  });

  it("formats mailing lines and months", () => {
    expect(mailingLine({ ownerName: "Pat", mailing: { line1: "1 A St", city: "LA", state: "CA", zip: "90001" } })).toBe("Pat, 1 A St, LA, CA 90001");
    expect(mailingLine({ ownerName: "Pat", mailing: null })).toBeNull();
    expect(monthYear("2027-03-09")).toBe("March 2027");
  });
});

describe("draftOutreach: nothing is sent without broker approval", () => {
  it("queues the draft for approval, sends nothing and records the request", async () => {
    const s = await drafted();
    expect(s.outreach).toMatchObject({ status: "pending_approval", channel: "email", recipient: "pat@owner.example", version: 1, generatedBy: "template", reasonCode: "approval_pending" });
    expect(s.outreach.approvalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.email!.sent).toEqual([]);
    const record = (await s.approvals.getByKey(s.outreach.idempotencyKey))!;
    expect(record).toMatchObject({ status: "pending", kind: "email", requestedBy: "agent:prospecting" });
    // The broker sees the exact message that would be sent.
    expect(record.payload).toMatchObject({ channel: "email", subject: s.outreach.subject, body: s.outreach.bodyText, bodySha256: s.outreach.bodySha256, recipient: "pat@owner.example" });
    expect(record.summary).toContain("p***@owner.example");
    expect((await s.store.getProspect(s.prospect.id))!.status).toBe("drafted");
    const ev = s.events.all().find((e) => e.eventType === "prospect.outreach_drafted")!;
    expect(ev).toMatchObject({ agent: "prospecting", task: "prospecting.outreach_draft", outcome: "pending_approval", approvalId: s.outreach.approvalId });
    expect(JSON.stringify(ev.detail)).not.toMatch(/pat@owner|Example Ave/);
  });

  it("does not request the same message twice while one is waiting", async () => {
    const s = await drafted();
    const again = await draftOutreach(s.deps, { prospectId: s.prospect.id, channel: "email", actor: "staff" });
    expect(again).toMatchObject({ status: "drafted", reused: true });
    expect(await s.store.listOutreach(s.prospect.id)).toHaveLength(1);
    expect(s.approvalStore.all()).toHaveLength(1);
  });

  it("uses the closed gate when the approval queue is not configured: the draft waits, nothing sends", async () => {
    const s = outreachSetup();
    const prospect = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    const gate = closedApprovalGate;
    const res = await draftOutreach({ ...s.deps, gate }, { prospectId: prospect.id, channel: "email", actor: "x" });
    expect(res.status === "drafted" && res.outreach.status).toBe("pending_approval");
    const settled = await settleOutreach({ ...s.deps, gate }, res.status === "drafted" ? res.outreach.id : "");
    expect(settled.outreach.status).toBe("pending_approval");
    expect(s.email!.sent).toEqual([]);
  });

  it("in audit mode proposes the draft to the audit trail and stores nothing", async () => {
    const s = outreachSetup();
    const autonomy = new AutonomyPolicy(new MemoryAutonomyStore());
    await autonomy.set("prospecting.outreach_draft", "audit", { userId: null, label: "Pat Broker", dreLicense: "01234567" }, "shadow");
    const prospect = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    const res = await draftOutreach({ ...s.deps, autonomy }, { prospectId: prospect.id, channel: "email", actor: "x" });
    expect(res.status).toBe("audit_only");
    expect(await s.store.listOutreach(prospect.id)).toEqual([]);
    expect(s.approvalStore.all()).toEqual([]);
    expect(s.events.all().at(-1)).toMatchObject({ eventType: "prospect.outreach_proposed", outcome: "proposed", autonomy: "audit" });
  });
});

describe("settleOutreach", () => {
  it("sends an approved email exactly once, even when settled twice at the same time", async () => {
    const s = await drafted();
    expect((await approve(s)).ok).toBe(true);
    const [a, b] = await Promise.all([settleOutreach(s.deps, s.outreach.id), settleOutreach(s.deps, s.outreach.id)]);
    expect(s.email!.sent).toHaveLength(1);
    expect([a.outreach.status, b.outreach.status].filter((x) => x === "sent")).toHaveLength(1);
    const sent = s.email!.sent[0]!;
    expect(sent).toMatchObject({ to: "pat@owner.example", subject: s.outreach.subject, text: s.outreach.bodyText, replyTo: identity.replyEmail });
    expect(sent.html).toContain("<p>Hello Pat,</p>");

    const row = (await s.store.getOutreach(s.outreach.id))!;
    expect(row).toMatchObject({ status: "sent", reasonCode: "sent", providerMessageId: sent.providerMessageId });
    expect(row.sentAt).toBeTruthy();
    expect(row.approvalId).toBeTruthy();
    expect((await s.store.getProspect(s.prospect.id))!.status).toBe("contacted");

    // Later settles change nothing and send nothing.
    expect((await settleOutreach(s.deps, s.outreach.id)).changed).toBe(false);
    expect(s.email!.sent).toHaveLength(1);
    const ev = s.events.all().find((e) => e.eventType === "prospect.outreach_sent")!;
    expect(ev).toMatchObject({ outcome: "executed", approvalId: row.approvalId, externalMessageIds: [sent.providerMessageId] });
    expect((await s.approvals.getByKey(row.idempotencyKey))!.executedAt).toBeTruthy();
  });

  it("sends nothing while the approval is pending", async () => {
    const s = await drafted();
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r).toMatchObject({ changed: false, note: "Waiting for broker approval." });
    expect(r.outreach.status).toBe("pending_approval");
    expect(s.email!.sent).toEqual([]);
  });

  it("sends nothing when the broker rejects", async () => {
    const s = await drafted();
    const row = (await s.store.getOutreach(s.outreach.id))!;
    const record = (await s.approvals.getByKey(row.idempotencyKey))!;
    await s.approvals.reject(record.id, broker, "Not this owner");
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "rejected", reasonCode: "approval_rejected" });
    expect(s.email!.sent).toEqual([]);
    expect(s.events.all().some((e) => e.eventType === "prospect.outreach_rejected" && e.outcome === "rejected")).toBe(true);
  });

  it("an approval that times out expires and never sends", async () => {
    const s = await drafted({ ttlMinutes: 30 });
    s.advance(31 * 60_000);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "expired", reasonCode: "approval_expired" });
    expect(s.email!.sent).toEqual([]);
    // It cannot be approved after it expired.
    const record = (await s.approvals.getByKey(s.outreach.idempotencyKey))!;
    expect((await s.approvals.approve(record.id, broker)).ok).toBe(false);
    expect((await settleOutreach(s.deps, s.outreach.id)).outreach.status).toBe("expired");
    expect(s.email!.sent).toEqual([]);
  });

  it("keeps the approval for later when email is not configured (it is not claimed)", async () => {
    const s = await drafted({ email: false });
    await approve(s);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r).toMatchObject({ changed: false });
    expect(r.note).toMatch(/not configured/);
    expect((await s.approvals.getByKey(s.outreach.idempotencyKey))!.executedAt).toBeNull();
    // Configure a mailer: the same approval now sends, once.
    const { FakeEmailClient } = await import("@/lib/notify/email/fake");
    const email = new FakeEmailClient();
    expect((await settleOutreach({ ...s.deps, email }, s.outreach.id)).outreach.status).toBe("sent");
    expect(email.sent).toHaveLength(1);
  });

  it("records a failed send and does not retry the used approval", async () => {
    const s = await drafted();
    await approve(s);
    s.email!.failNext = new EmailError("provider down", 503);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "failed", reasonCode: "send_failed", error: "provider down" });
    expect((await settleOutreach(s.deps, s.outreach.id)).changed).toBe(false);
    expect(s.email!.sent).toEqual([]);
  });

  it("re-checks the do-not-contact list when the approval arrives: an approved draft to a suppressed owner is blocked", async () => {
    const s = await drafted();
    await approve(s);
    await s.store.addSuppression({ kind: "email", valueHash: (await import("./suppression")).suppressionHash("email", "pat@owner.example"), label: "p***@owner.example", reason: "opt_out", createdBy: "system:unsubscribe" }, NOW);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "blocked", reasonCode: "suppressed" });
    expect(s.email!.sent).toEqual([]);
  });

  it("blocks when the contact changed after the draft", async () => {
    const s = await drafted();
    await approve(s);
    await s.store.updateStaff(s.prospect.id, { contactEmail: "other@owner.example" }, "staff", NOW);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "blocked", reasonCode: "no_contact" });
    expect(s.email!.sent).toEqual([]);
  });

  it("sends nothing if the stored message no longer matches the approved hash", async () => {
    const s = await drafted();
    await approve(s);
    const row = s.store.outreach.get(s.outreach.id)!;
    s.store.outreach.set(row.id, { ...row, bodyText: `${row.bodyText}\n\nTampered.` });
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach.status).toBe("failed");
    expect(s.email!.sent).toEqual([]);
  });

  it("settles every waiting draft in a sweep, once each", async () => {
    const s = outreachSetup();
    const ids: string[] = [];
    for (const [i, outcome] of ["approve", "reject", "wait"].entries()) {
      const p = await seedProspect(s.store, { apn: `apn-${i}`, address: { line1: `${i + 1} Example Ave` } }, { contactEmail: `o${i}@owner.example` });
      const res = await draftOutreach(s.deps, { prospectId: p.id, channel: "email", actor: "x" });
      if (res.status !== "drafted") throw new Error("expected draft");
      const record = (await s.approvals.getByKey(res.outreach.idempotencyKey))!;
      if (outcome === "approve") await s.approvals.approve(record.id, broker);
      if (outcome === "reject") await s.approvals.reject(record.id, broker, "no");
      ids.push(res.outreach.id);
    }
    expect(await settlePending(s.deps)).toMatchObject({ checked: 3, sent: 1, rejected: 1, waiting: 1, failed: 0 });
    expect(await settlePending(s.deps)).toMatchObject({ checked: 1, sent: 0, waiting: 1 });
    expect(s.email!.sent).toHaveLength(1);
  });
});

describe("letters", () => {
  it("an approved letter becomes ready to mail (not sent), then mailed by staff", async () => {
    const s = await drafted({}, { contactName: "Pat Owner" }, "letter");
    expect(s.outreach).toMatchObject({ channel: "letter", recipient: "Example Court Partners LLC, 200 Sample Plaza, Pasadena, CA 91101" });
    expect((await s.approvals.getByKey(s.outreach.idempotencyKey))!.kind).toBe("prospect_letter");
    expect((await settleOutreach(s.deps, s.outreach.id)).outreach.status).toBe("pending_approval");
    await approve(s);
    const r = await settleOutreach(s.deps, s.outreach.id);
    expect(r.outreach).toMatchObject({ status: "ready_to_mail", reasonCode: "ready_to_mail" });
    expect(s.email!.sent).toEqual([]);
    await expect(markMailed(s.deps, s.outreach.id, "staff:ana")).resolves.toMatchObject({ status: "mailed", mailedBy: "staff:ana" });
    expect((await s.store.getProspect(s.prospect.id))!.status).toBe("contacted");
    await expect(markMailed(s.deps, s.outreach.id, "staff:ana")).rejects.toThrow(OutreachError);
  });

  it("an unapproved letter cannot be marked mailed", async () => {
    const s = await drafted({}, {}, "letter");
    await expect(markMailed(s.deps, s.outreach.id, "staff:ana")).rejects.toThrow(/approved letter/);
  });

  it("a pending or ready letter can be cancelled; a cancelled one is never released", async () => {
    const s = await drafted({}, {}, "letter");
    const c = await cancelOutreach(s.deps, s.outreach.id, "staff:ana");
    expect(c).toMatchObject({ status: "cancelled", reasonCode: "cancelled" });
    await approve(s);
    expect((await settleOutreach(s.deps, s.outreach.id)).outreach.status).toBe("cancelled");
    await expect(cancelOutreach(s.deps, s.outreach.id, "staff:ana")).rejects.toThrow(OutreachError);
  });
});

describe("gates before a draft exists", () => {
  const expectBlocked = async (s: ReturnType<typeof outreachSetup>, prospect: Prospect, code: OutreachError["code"], channel: "email" | "letter" = "email") => {
    const err = await draftOutreach(s.deps, { prospectId: prospect.id, channel, actor: "x" }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect((err as OutreachError).code).toBe(code);
    expect(s.approvalStore.all()).toEqual([]);
    expect(await s.store.listOutreach(prospect.id)).toEqual([]);
    expect(s.events.all().some((e) => e.eventType === "prospect.outreach_blocked" && e.outcome === "blocked")).toBe(true);
  };

  it("needs a contact email (public records have none) or a mailing address", async () => {
    const s = outreachSetup();
    await expectBlocked(s, await seedProspect(s.store), "no_contact");
    const s2 = outreachSetup();
    await expectBlocked(s2, await seedProspect(s2.store, { mailing: null }), "no_contact", "letter");
  });

  it("refuses a do-not-contact prospect and a prospect whose owner is on the list", async () => {
    const s = outreachSetup();
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    await s.store.updateStaff(p.id, { status: "do_not_contact" }, "staff", NOW);
    await expectBlocked(s, (await s.store.getProspect(p.id))!, "suppressed");

    const s2 = outreachSetup();
    const q = await seedProspect(s2.store, {}, { contactEmail: "pat@owner.example" });
    await s2.store.addSuppression({ kind: "owner", valueHash: (await import("./suppression")).suppressionHash("owner", "example court partners llc"), label: "Example C*** P*** L***", reason: "opt_out", createdBy: "staff" }, NOW);
    await expectBlocked(s2, q, "suppressed");
    expect((await s2.store.getProspect(q.id))!.status).toBe("do_not_contact");
  });

  it("refuses an address that revoked email consent, and fails closed when the ledger cannot be read", async () => {
    const revoked: ConsentReader = { history: async () => [{ eventType: "revoked", form: "contact", channels: ["email"], occurredAt: "2026-10-01T00:00:00Z" }] };
    const s = outreachSetup();
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    await expect(draftOutreach({ ...s.deps, consent: revoked }, { prospectId: p.id, channel: "email", actor: "x" })).rejects.toMatchObject({ code: "consent_revoked" });
    const broken: ConsentReader = { history: async () => Promise.reject(new Error("db down")) };
    await expect(draftOutreach({ ...s.deps, consent: broken }, { prospectId: p.id, channel: "email", actor: "x" })).rejects.toMatchObject({ code: "consent_revoked" });
    expect(s.approvalStore.all()).toEqual([]);
  });

  it("refuses properties outside California", async () => {
    const s = outreachSetup();
    await expectBlocked(s, await seedProspect(s.store, { address: { state: "NV", zip: "89501" } }, { contactEmail: "pat@owner.example" }), "out_of_state");
  });

  it("refuses when the licensed office address is not configured", async () => {
    const s = outreachSetup();
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    await expect(draftOutreach({ ...s.deps, identity: { ...identity, address: "" } }, { prospectId: p.id, channel: "email", actor: "x" })).rejects.toMatchObject({ code: "identity" });
  });

  it("refuses a prospect marked not a fit and an unknown prospect", async () => {
    const s = outreachSetup();
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    await s.store.updateStaff(p.id, { status: "not_a_fit" }, "staff", NOW);
    await expect(draftOutreach(s.deps, { prospectId: p.id, channel: "email", actor: "x" })).rejects.toMatchObject({ code: "status" });
    await expect(draftOutreach(s.deps, { prospectId: "00000000-0000-4000-8000-000000000000", channel: "email", actor: "x" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("versions", () => {
  it("a new draft after a rejection is a new version with its own approval", async () => {
    const s = await drafted();
    const record = (await s.approvals.getByKey(s.outreach.idempotencyKey))!;
    await s.approvals.reject(record.id, broker, "Reword");
    await settleOutreach(s.deps, s.outreach.id);
    const second = await draftOutreach(s.deps, { prospectId: s.prospect.id, channel: "email", actor: "x" });
    if (second.status !== "drafted") throw new Error("expected draft");
    expect(second.reused).toBe(false);
    expect(second.outreach.version).toBe(2);
    expect(second.outreach.idempotencyKey).not.toBe(s.outreach.idempotencyKey);
    expect(s.approvalStore.all()).toHaveLength(2);
  });

  it("builds the approval action only from the stored row (a stable payload hash)", async () => {
    const s = await drafted();
    const row = (await s.store.getOutreach(s.outreach.id))!;
    expect(approvalActionFor(row)).toEqual(approvalActionFor(row));
    expect(approvalActionFor(row).payload.body).toBe(row.bodyText);
  });
});

describe("model-written opening", () => {
  const prospect = async () => seedProspect(outreachSetup().store, {}, {});

  it("shows the model only property type, city and maturity month", async () => {
    const p = await prospect();
    const facts = introFacts(p);
    expect(facts).toContain("48-unit multifamily property in Los Angeles, CA");
    expect(facts).not.toMatch(/Example|Partners|Ave|Sample|\$|%/);
    expect(templateIntro(p)).toContain("Public county records show a loan recorded against 100 Example Ave");
  });

  it("uses a clean model opening and records which model wrote it", async () => {
    const p = await prospect();
    const { gateway, claude } = testGateway();
    claude.reply({ text: "Public records suggest the loan on your multifamily property in Los Angeles may mature around July 2027. We would be glad to share how lenders are looking at properties like it today." });
    const r = await writeIntro(gateway, p);
    expect(r.generatedBy).toBe("model");
    expect(claude.requests[0]!.model).toBe("claude-sonnet-5-5");
    expect(claude.requests[0]!.messages[0]!.content).not.toMatch(/Example|Partners/);
  });

  it.each([
    ["a guaranteed claim", "We guarantee you the lowest rate on your loan."],
    ["an invented number", "Your loan of 9 million dollars matures around July 2027 and we can help with 7 options."],
    ["a link", "See https://example.com for how lenders view properties like yours around July 2027."],
    ["an approval claim", "You are pre-approved for a refinance around July 2027."],
    ["too long", "x ".repeat(400)],
    ["empty", ""],
  ])("falls back to the template for %s", async (_name, text) => {
    const p = await prospect();
    const { gateway, claude } = testGateway();
    claude.reply({ text });
    const r = await writeIntro(gateway, p);
    expect(r).toMatchObject({ generatedBy: "template", reason: "output_rejected" });
    expect(r.text).toBe(templateIntro(p));
  });

  it("falls back when the model refuses, is missing, or the gateway is absent", async () => {
    const p = await prospect();
    const { gateway, claude } = testGateway();
    claude.reply({ text: "", stopReason: "refusal" });
    expect(await writeIntro(gateway, p)).toMatchObject({ generatedBy: "template", reason: "model_refusal" });
    expect(await writeIntro(testGateway({ claude: false }).gateway, p)).toMatchObject({ generatedBy: "template", reason: "provider_unconfigured" });
    expect(await writeIntro(null, p)).toMatchObject({ generatedBy: "template" });
  });

  it("drafts with a personalized opening only when asked, and the lint still applies", async () => {
    const s = outreachSetup();
    const { gateway, claude } = testGateway();
    claude.reply({ text: "Public records suggest the loan on your multifamily property in Los Angeles may mature around July 2027. We would be glad to share how lenders are looking at properties like it today." });
    const p = await seedProspect(s.store, {}, { contactEmail: "pat@owner.example" });
    const res = await draftOutreach({ ...s.deps, gateway }, { prospectId: p.id, channel: "email", actor: "x", personalize: true });
    expect(res.status === "drafted" && res.outreach).toMatchObject({ generatedBy: "model", model: "claude-sonnet-5-5" });
    const plain = await seedProspect(s.store, { apn: "other", address: { line1: "9 Example Ave" } }, { contactEmail: "q@owner.example" });
    await draftOutreach({ ...s.deps, gateway }, { prospectId: plain.id, channel: "email", actor: "x" });
    expect(claude.requests).toHaveLength(1);
  });
});
