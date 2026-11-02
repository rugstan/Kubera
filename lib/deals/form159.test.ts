import { MemoryIdempotencyStore } from "@/lib/workflows/idempotency";
import { describe, expect, it } from "vitest";
import { FakeEsignProvider } from "@/lib/esign/fake";
import { MemoryDocumentStorage } from "@/lib/disclosures/store";
import { renderDisclosurePdf } from "@/lib/disclosures/pdf";
import {
  FORM159_TITLE,
  applyForm159EsignEvent,
  form159Document,
  form159FromLedger,
  form159PrefillFields,
  form159Satisfied,
  generateForm159,
  sendForm159,
  Form159BlockedError,
} from "./form159";
import { brokerFee, sbaLenderReferralFee, sbaPackagingFee } from "./ledger";
import { newDeal, setup } from "./test-fixtures";

const agent = {
  legalName: "Corin Commercial, Inc.",
  agentType: "BROKER" as const,
  address: "100 Market St, San Francisco, CA 94105",
  dreLicense: "02234567",
  signer: { name: "Neeli Khanna", email: "neeli@corincommercial.com", dreLicense: "01234567" },
};
const lender = { name: "Live Oak Bank", locationId: "123456", signer: { name: "Pat Officer", email: "pat@liveoak.example" } };
const applicant = { businessName: "Harbor Hotel Group LLC", signers: [{ name: "Ravi Shah", email: "ravi@harbor.example", title: "Managing member" }] };
const fakeRender = async (doc: { title: string; sections: unknown[] }) => new TextEncoder().encode(`%PDF-fake ${JSON.stringify(doc)}`);

async function sbaDeal() {
  const ctx = setup();
  const deal = await newDeal(ctx.store, ctx.now, { title: "Harbor Hotel 7(a)", program: "SBA_7A", loanAmountCents: 450_000_000 });
  return { ...ctx, deal };
}

describe("Form 159 from the ledger", () => {
  it("buckets Corin's compensation into packaging, other services and lender-paid referral", async () => {
    const { store, now, deal } = await sbaDeal();
    await store.insertFeeEntry(sbaPackagingFee({ dealId: deal.id, flatCents: 250_000 }), "broker:ana", now());
    await store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 450_000_000, pct: 1 }), "broker:ana", now());
    await store.insertFeeEntry(sbaLenderReferralFee({ dealId: deal.id, loanAmountCents: 450_000_000, pct: 0.5, lenderName: "Live Oak Bank" }), "broker:ana", now());
    // A void line and a co-broker share never reach the form.
    const voided = await store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 450_000_000, flatCents: 99_999, idempotencyKey: `${deal.id}:dup` }), "broker:ana", now());
    await store.updateFeeEntry(voided.id, { status: "void", voidReason: "duplicate" }, "broker:ana", now());

    const entries = await store.listFeeEntries(deal.id);
    const build = form159FromLedger({ deal, entries, lender, applicant, agent, sbaLoanNumber: "1234567890", preparedOn: "2026-11-03" });

    expect(build.required).toBe(true);
    expect(build.data.sbaProgram).toBe("7A");
    expect(build.data.applicantPaid).toEqual({ packagingCents: 250_000, otherServicesCents: 4_500_000, otherServicesDescription: "Broker fee 1% of loan", totalCents: 4_750_000 });
    expect(build.data.lenderPaid).toEqual({ referralCents: 2_250_000, totalCents: 2_250_000 });
    expect(build.data.totalCents).toBe(7_000_000);
    expect(build.ledgerEntryIds).toHaveLength(3);
    expect(build.ledgerEntryIds).not.toContain(voided.id);
    expect(build.flags).toEqual(expect.arrayContaining(["itemization_required", "dual_compensation_review"]));
    expect(build.flags).not.toContain("sba_loan_number_pending");
  });

  it("is not required without agent compensation or outside SBA programs", async () => {
    const { store, now, deal } = await sbaDeal();
    const empty = form159FromLedger({ deal, entries: [], lender, applicant, agent, preparedOn: "2026-11-03" });
    expect(empty.required).toBe(false);
    expect(empty.flags).toContain("no_agent_compensation");

    const hud = await newDeal(store, now, { program: "HUD_232" });
    const e = await store.insertFeeEntry(brokerFee({ dealId: hud.id, loanAmountCents: 1_000_000_00, pct: 1 }), "a", now());
    const build = form159FromLedger({ deal: hud, entries: [e], lender, applicant, agent, preparedOn: "2026-11-03" });
    expect(build.required).toBe(false);
    expect(build.flags).toContain("not_sba_program");
  });

  it("flags missing signers and an unconfigured agent license as blocking", async () => {
    const { store, now, deal } = await sbaDeal();
    const e = await store.insertFeeEntry(sbaPackagingFee({ dealId: deal.id, flatCents: 100_000 }), "a", now());
    const build = form159FromLedger({ deal, entries: [e], lender: { name: "Bank" }, applicant: { businessName: "X", signers: [] }, agent: { ...agent, dreLicense: "" }, preparedOn: "2026-11-03" });
    expect(build.flags).toEqual(expect.arrayContaining(["lender_signer_missing", "applicant_signer_missing", "agent_license_missing", "sba_loan_number_pending"]));
  });

  it("renders a data sheet and an e-sign field map with the same figures", async () => {
    const { store, now, deal } = await sbaDeal();
    const e = await store.insertFeeEntry(sbaPackagingFee({ dealId: deal.id, flatCents: 150_000 }), "a", now());
    const { data } = form159FromLedger({ deal, entries: [e], lender, applicant, agent, preparedOn: "2026-11-03" });
    const doc = form159Document(data, { draft: true });
    expect(doc.title).toBe(FORM159_TITLE);
    expect(doc.notice[0]).toMatch(/DRAFT — pending counsel review/);
    expect(JSON.stringify(doc.sections)).toContain("$1,500.00");
    expect(JSON.stringify(doc.sections)).toMatch(/not the lender/);
    expect(doc.signatureLines.map((s) => s.label)).toEqual(["Agent", "Applicant", "Lender"]);
    expect(form159PrefillFields(data, false)).toMatchObject({ applicant_paid_packaging: "$1,500.00", total_compensation: "$1,500.00", agent_dre_license: "02234567", draft_notice: "" });

    const pdf = await renderDisclosurePdf(doc);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  }, 30_000);
});

describe("Form 159 workflow", () => {
  async function generated(approvedTemplate = true) {
    const ctx = await sbaDeal();
    await ctx.store.insertFeeEntry(sbaPackagingFee({ dealId: ctx.deal.id, flatCents: 200_000 }), "a", ctx.now());
    const storage = new MemoryDocumentStorage();
    const g = await generateForm159({ store: ctx.store, render: fakeRender, storage, now: ctx.now, approvedTemplate }, { dealId: ctx.deal.id, lender, applicant, agent, sbaLoanNumber: "9988776655" }, "broker:ana");
    return { ...ctx, storage, g };
  }

  it("stores a version, reuses it while the ledger is unchanged, and supersedes it when the ledger changes", async () => {
    const { store, now, deal, storage, g } = await generated();
    expect(g.record.version).toBe(1);
    expect(g.record.status).toBe("generated");
    expect(storage.objects.has(g.record.documentPath!)).toBe(true);

    const again = await generateForm159({ store, render: fakeRender, storage, now, approvedTemplate: true }, { dealId: deal.id, lender, applicant, agent, sbaLoanNumber: "9988776655" }, "broker:ana");
    expect(again.reused).toBe(true);
    expect(again.record.id).toBe(g.record.id);

    await store.insertFeeEntry(sbaLenderReferralFee({ dealId: deal.id, loanAmountCents: 450_000_000, pct: 0.25, lenderName: "Live Oak Bank" }), "a", now());
    const v2 = await generateForm159({ store, render: fakeRender, storage, now, approvedTemplate: true }, { dealId: deal.id, lender, applicant, agent, sbaLoanNumber: "9988776655" }, "broker:ana");
    expect(v2.record.version).toBe(2);
    expect(v2.record.data.totalCents).toBe(200_000 + 1_125_000);
    expect((await store.getForm159(g.record.id))!.status).toBe("superseded");
  });

  it("sends only after broker approval, then a completed signature satisfies the SBA closing requirement", async () => {
    const { store, now, deal, gate, g } = await generated();
    const provider = new FakeEsignProvider();
    gate.decide(`esign_send:form159:${g.record.id}:${g.record.documentSha256}`, { status: "pending", approvalId: "appr_9" });
    const pending = await sendForm159({ effects: new MemoryIdempotencyStore(), store, provider, gate, now, templateId: "tpl_159" }, g.record.id, "broker:ana");
    expect(pending.sent).toBe(false);
    expect(pending.record.status).toBe("pending_approval");
    expect(provider.requests.size).toBe(0);
    // A sensitive kind: the broker re-authenticates before it is approved or sent.
    expect(gate.requests[0]).toMatchObject({ kind: "form159_send" });

    gate.decide(`esign_send:form159:${g.record.id}:${g.record.documentSha256}`, { status: "approved", approvalId: "appr_9", decidedBy: "broker:lee", decidedAt: now() });
    const sent = await sendForm159({ effects: new MemoryIdempotencyStore(), store, provider, gate, now, templateId: "tpl_159" }, g.record.id, "broker:ana");
    expect(sent.sent).toBe(true);
    expect(sent.record.status).toBe("sent");
    const req = provider.requests.get(sent.record.providerRequestId!)!;
    expect(req.input.recipients.map((r) => r.role)).toEqual(["Agent", "Applicant 1", "Lender"]);
    expect(req.input.fields.applicant_paid_packaging).toBe("$2,000.00");

    const entries = await store.listFeeEntries(deal.id);
    expect(form159Satisfied(deal, entries, await store.listForm159(deal.id))).toBe(false);

    const hook = provider.webhook(sent.record.providerRequestId!, "completed");
    const event = provider.parseWebhook(hook.body)!;
    const signed = await applyForm159EsignEvent({ store, now }, event);
    expect(signed!.status).toBe("signed");
    expect(form159Satisfied(deal, entries, await store.listForm159(deal.id))).toBe(true);

    // A new compensation line after signature means the signed form no longer matches.
    await store.insertFeeEntry(brokerFee({ dealId: deal.id, loanAmountCents: 450_000_000, flatCents: 50_000 }), "a", now());
    expect(form159Satisfied(deal, await store.listFeeEntries(deal.id), await store.listForm159(deal.id))).toBe(false);
  });

  it("refuses to send a draft template, an incomplete form, or without a provider", async () => {
    const draft = await generated(false);
    await expect(sendForm159({ effects: new MemoryIdempotencyStore(), store: draft.store, provider: new FakeEsignProvider(), gate: draft.gate, now: draft.now, templateId: "t" }, draft.g.record.id, "a")).rejects.toMatchObject({ reason: "template_not_approved" });

    const ok = await generated(true);
    await expect(sendForm159({ effects: new MemoryIdempotencyStore(), store: ok.store, provider: null, gate: ok.gate, now: ok.now, templateId: "t" }, ok.g.record.id, "a")).rejects.toBeInstanceOf(Form159BlockedError);
    expect(ok.gate.requests).toHaveLength(0);

    const ctx = await sbaDeal();
    await ctx.store.insertFeeEntry(sbaPackagingFee({ dealId: ctx.deal.id, flatCents: 100_000 }), "a", ctx.now());
    const g = await generateForm159({ store: ctx.store, render: fakeRender, now: ctx.now, approvedTemplate: true }, { dealId: ctx.deal.id, lender: { name: "Bank" }, applicant, agent }, "a");
    await expect(sendForm159({ effects: new MemoryIdempotencyStore(), store: ctx.store, provider: new FakeEsignProvider(), gate: ctx.gate, now: ctx.now, templateId: "t" }, g.record.id, "a")).rejects.toMatchObject({ reason: "incomplete" });
  });

  it("creates one envelope when a send is retried after the provider accepted it but the update failed", async () => {
    const { store, now, gate, g } = await generated();
    const provider = new FakeEsignProvider();
    const effects = new MemoryIdempotencyStore();
    const realUpdate = store.updateForm159.bind(store);
    let fail = true;
    store.updateForm159 = async (...args: Parameters<typeof store.updateForm159>) => {
      if (fail && args[1].status === "sent") {
        fail = false;
        throw new Error("db timeout");
      }
      return realUpdate(...args);
    };
    await expect(sendForm159({ effects, store, provider, gate, now, templateId: "tpl" }, g.record.id, "a")).rejects.toThrow(/db timeout/);
    // The queue gate answers already_executed for a claimed approval: the retry resumes the claimed effect.
    gate.decide(`esign_send:form159:${g.record.id}:${g.record.documentSha256}`, { status: "rejected", approvalId: "appr_1", decidedBy: "system", reason: "already_executed" });
    const retry = await sendForm159({ effects, store, provider, gate, now, templateId: "tpl" }, g.record.id, "a");
    expect(retry.sent).toBe(true);
    expect(provider.requests.size).toBe(1);
    expect(retry.record.providerRequestId).toBe([...provider.requests.keys()][0]);
  });

  it("an ambiguous provider failure is reconciled by reference instead of re-created", async () => {
    const { store, now, gate, g } = await generated();
    const provider = new FakeEsignProvider();
    const effects = new MemoryIdempotencyStore();
    provider.failAfterCreate = 1;
    await expect(sendForm159({ effects, store, provider, gate, now, templateId: "tpl" }, g.record.id, "a")).rejects.toThrow(/timed out/);
    const retry = await sendForm159({ effects, store, provider, gate, now, templateId: "tpl" }, g.record.id, "a");
    expect(retry.sent).toBe(true);
    expect(provider.requests.size).toBe(1);
  });

  it("retires a declined request so a resend needs a new version and a new approval", async () => {
    const { store, now, gate, g, deal } = await generated();
    const provider = new FakeEsignProvider();
    const sent = await sendForm159({ effects: new MemoryIdempotencyStore(), store, provider, gate, now, templateId: "tpl" }, g.record.id, "a");
    const event = provider.parseWebhook(provider.webhook(sent.record.providerRequestId!, "declined").body)!;
    expect((await applyForm159EsignEvent({ store, now }, event))!.status).toBe("superseded");
    const v2 = await generateForm159({ store, render: fakeRender, now, approvedTemplate: true }, { dealId: deal.id, lender, applicant, agent, sbaLoanNumber: "9988776655" }, "a");
    expect(v2.record.version).toBe(2);
    await sendForm159({ effects: new MemoryIdempotencyStore(), store, provider, gate, now, templateId: "tpl" }, v2.record.id, "a");
    expect(new Set(gate.requests.map((r) => r.idempotencyKey)).size).toBe(2);
  });
});
