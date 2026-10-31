// MLDS on the deal desk, end to end: open → generate → borrower consent in the
// portal → send through the approval queue (broker re-authenticates; the
// mlds_send executor sends with the fake provider) → signed webhook → the deal
// advances to closing.

import { describe, expect, it } from "vitest";
import { MemoryReauthStore, ReauthService } from "@/lib/agents/core/reauth";
import { executeApproved } from "@/lib/approvals/executors";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import type { DocumentSpec } from "@/lib/disclosures/mlds";
import { MemoryDisclosureStore, MemoryDocumentStorage } from "@/lib/disclosures/store";
import { UETA_CONSENT_VERSION } from "@/lib/disclosures/ueta";
import { FakeEsignProvider } from "@/lib/esign/fake";
import { handleEsignWebhook } from "@/lib/esign/webhook";
import { MemoryIdempotencyStore } from "@/lib/workflows/idempotency";
import {
  currentDealMlds,
  generateDealMlds,
  holdDealMlds,
  mldsAwaitingConsent,
  mldsInputFromForm,
  mldsSendExecutor,
  mldsSigners,
  officeDateTime,
  openDealMlds,
  parseBorrowers,
  recordPortalUetaConsent,
  releaseDealMlds,
  sendDealMlds,
} from "./mlds";
import { advanceDeal } from "./service";
import { checklistDesk, loanRecord, newDeal, setup } from "./test-fixtures";

const BROKER = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };
const render = async (doc: DocumentSpec) => new TextEncoder().encode(`%PDF-1.4 ${JSON.stringify(doc).slice(0, 200)}`);
const brokerIdentity = { legalName: "Kubera Commercial, Inc.", dreLicense: "02234567", address: "100 Market St, Suite 300, San Francisco, CA 94105", designatedOfficer: "Neeli Khanna", officerLicense: "02123456" };

const FORM: Record<string, string> = {
  borrowers: "Sunrise Care LLC <cfo@sunrise.example>\nPat Owner, pat@example.com",
  propertyAddress: "1200 Ocean View Blvd, Pacific Grove, CA 93950",
  apn: "006-123-045",
  county: "Monterey",
  lenderName: "Cambridge Realty Capital",
  principal: "$12,500,000",
  termMonths: "420",
  amortizationMonths: "420",
  ratePct: "6.2",
  rateType: "fixed",
  paymentAmount: "73,512.40",
  paymentFrequency: "monthly",
  paymentCount: "420",
  prepayment: "10-year declining prepayment schedule",
  lateCharge: "4% of the late installment after 15 days",
  costAppraisal: "7500",
  costEscrow: "6200",
  costTitle: "14800",
  costNotary: "350",
  costRecording: "600",
  commission: "125000",
  brokerFromLender: "0",
  existingLiens: "Coastal Bank | Deed of trust | 1 | 9,100,000",
  expectedLiens: "Cambridge Realty Capital | Deed of trust | 1 | 12,500,000",
  payoffs: "Payoff of Coastal Bank deed of trust | 9100000",
};

function world() {
  const { store, now } = setup();
  const disclosures = new MemoryDisclosureStore();
  const storage = new MemoryDocumentStorage();
  const provider = new FakeEsignProvider();
  const effects = new MemoryIdempotencyStore();
  const approvals = new MemoryApprovalStore();
  const proofs = new MemoryReauthStore();
  const service = new ApprovalService(approvals, now, {}, proofs);
  const gate = queueApprovalGate(service);
  const reauth = new ReauthService(proofs, now);
  const desk = { store, disclosures, storage, now };
  const send = { ...desk, provider, gate, effects, templateId: "fake_mlds_template", approvedTemplate: true };
  return { store, now, disclosures, storage, provider, effects, service, gate, reauth, desk, send };
}

const form = (over: Record<string, string> = {}) => (k: string) => ({ ...FORM, ...over })[k] ?? "";

describe("MLDS on the deal desk", () => {
  it("runs open → generate → portal consent → approved send → signed webhook, and only then lets the deal close", async () => {
    const w = world();
    let deal = await newDeal(w.store, w.now);
    deal = await w.store.updateDeal(deal.id, deal.recordVersion, { stage: "firm_commitment" }, "a", w.now());
    w.store.seedLoanBrokerOfRecord(loanRecord(deal.id, { lender: { name: "Cambridge", category: "STATE_BANK", evidenceRef: "DFPI 1" }, noteRatePct: 6.2 }));
    const { deps: checklist } = await checklistDesk(deal.id, w.now, { complete: true });
    const desk = { store: w.store, disclosures: w.disclosures, now: w.now, checklist };

    // Without an MLDS the closing gate refuses.
    const blocked = await advanceDeal(desk, { dealId: deal.id, event: "closing_scheduled", actor: "staff:ana" });
    expect(blocked).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/signed MLDS/)]) });

    // 1. Open when the completed application is recorded (starts the 3-business-day clock).
    const opened = await openDealMlds(w.desk, { dealId: deal.id, applicationCompletedAt: new Date(w.now().getTime() - 3_600_000), actor: "staff:ana" });
    expect(opened.requirement.required).toBe(true);
    expect(opened.record).toMatchObject({ status: "required", dealId: deal.id });
    expect(opened.record!.dueAt).toBeTruthy();
    const id = opened.record!.id;

    // 2. Generate from the deal-desk form.
    const input = mldsInputFromForm(form(), { broker: brokerIdentity, representative: { name: "Ana Broker", dreLicense: "01234567" }, today: "2026-11-03" });
    const generated = await generateDealMlds({ ...w.desk, render, approvedTemplate: true }, { dealId: deal.id, disclosureId: id, mlds: input, actor: "staff:ana" });
    expect(generated.status).toBe("generated");
    expect(mldsSigners(generated).map((s) => s.email)).toEqual(["cfo@sunrise.example", "pat@example.com"]);

    // Sending before consent is refused.
    await expect(sendDealMlds(w.send, { dealId: deal.id, disclosureId: id, brokerSigner: { name: "Ana Broker", email: "ana@kuberacommercial.com" }, actor: "staff:ana" })).rejects.toMatchObject({ reason: "ueta_consent_missing" });

    // 3. Each borrower consents in the portal (session = their deal and email).
    for (const email of ["cfo@sunrise.example", "pat@example.com"]) {
      const session = { dealId: deal.id, email };
      expect((await mldsAwaitingConsent(w.disclosures, session)).map((r) => r.id)).toEqual([id]);
      await recordPortalUetaConsent({ disclosures: w.disclosures, now: w.now }, session, { disclosureId: id, textVersion: UETA_CONSENT_VERSION, agreed: true, ip: "203.0.113.7", userAgent: "vitest" });
      expect(await mldsAwaitingConsent(w.disclosures, session)).toEqual([]);
    }
    // Someone else's session cannot consent for the deal.
    await expect(
      recordPortalUetaConsent({ disclosures: w.disclosures, now: w.now }, { dealId: deal.id, email: "intruder@example.com" }, { disclosureId: id, textVersion: UETA_CONSENT_VERSION, agreed: true }),
    ).rejects.toThrow(/could not find/);

    // 4. Send: the approval queue holds it until a broker approves with step-up re-authentication.
    const first = await sendDealMlds(w.send, { dealId: deal.id, disclosureId: id, brokerSigner: { name: "Ana Broker", email: "ana@kuberacommercial.com" }, actor: "staff:ana" });
    expect(first.sent).toBe(false);
    expect(w.provider.requests.size).toBe(0);
    const [approval] = await w.service.list({ status: "pending" });
    expect(approval).toMatchObject({ kind: "mlds_send" });
    expect(await w.service.approve(approval!.id, BROKER)).toMatchObject({ ok: false, reason: "reauth_required" });
    await w.reauth.record({ approval: approval!, user: { userId: BROKER.userId, dreLicense: BROKER.dreLicense }, factor: { method: "totp", verifiedAt: w.now() } });
    const decided = await w.service.approve(approval!.id, BROKER);
    expect(decided).toMatchObject({ ok: true });

    // The mlds_send executor sends it once the broker approves.
    const executed = await executeApproved(w.service, [(decided as { record: typeof approval }).record!], [
      { name: "mlds_send", matches: (r) => r.kind === "mlds_send", run: mldsSendExecutor(w.send) },
    ]);
    expect(executed).toEqual([expect.objectContaining({ executor: "mlds_send", status: "executed" })]);
    expect(w.provider.requests.size).toBe(1);
    const sent = (await currentDealMlds(w.disclosures, deal))!;
    expect(sent).toMatchObject({ status: "sent", provider: "fake" });
    // Pressing Send again does not create a second envelope.
    const again = await sendDealMlds(w.send, { dealId: deal.id, disclosureId: id, brokerSigner: { name: "Ana Broker", email: "ana@kuberacommercial.com" }, actor: "staff:ana" });
    expect(again.sent).toBe(true);
    expect(w.provider.requests.size).toBe(1);

    // Still not signed: closing stays blocked.
    expect((await advanceDeal(desk, { dealId: deal.id, event: "closing_scheduled", actor: "staff:ana" })).ok).toBe(false);

    // 5. The provider's signed webhook stores the signed copy.
    const hook = w.provider.webhook(sent.providerRequestId!, "completed");
    const res = await handleEsignWebhook(new Request("https://kuberacommercial.com/api/webhooks/zoho-sign", { method: "POST", body: hook.body, headers: hook.headers }), {
      provider: w.provider,
      secretConfigured: true,
      backends: { store: w.disclosures, storage: w.storage },
      now: w.now,
    });
    expect(await res.json()).toEqual({ ok: true, outcome: "transitioned" });
    expect((await currentDealMlds(w.disclosures, deal))!).toMatchObject({ status: "signed", retainUntil: expect.any(String) });

    // 6. Now the deal advances to closing.
    const closing = await advanceDeal(desk, { dealId: deal.id, event: "closing_scheduled", actor: "staff:ana" });
    expect(closing.ok).toBe(true);
    expect(closing.deal.stage).toBe("closing");
  });

  it("holds for counsel and releases back to required", async () => {
    const w = world();
    const deal = await newDeal(w.store, w.now);
    const { record } = await openDealMlds(w.desk, { dealId: deal.id, applicationCompletedAt: w.now(), actor: "staff:ana" });
    const held = await holdDealMlds(w.desk, { dealId: deal.id, disclosureId: record!.id, reason: "Lender may be an affiliate", actor: "staff:ana" });
    expect(held.status).toBe("held_for_counsel");
    await expect(releaseDealMlds(w.desk, { dealId: deal.id, disclosureId: record!.id, counsel: "", note: "" })).rejects.toThrow(/counsel/);
    const released = await releaseDealMlds(w.desk, { dealId: deal.id, disclosureId: record!.id, counsel: "J. Doe", note: "Affiliate is a separately licensed CFL lender" });
    expect(released.status).toBe("required");
  });

  it("refuses an MLDS id from another deal and a deal without the collateral answer", async () => {
    const w = world();
    const a = await newDeal(w.store, w.now);
    const b = await newDeal(w.store, w.now);
    const { record } = await openDealMlds(w.desk, { dealId: a.id, applicationCompletedAt: w.now(), actor: "x" });
    await expect(holdDealMlds(w.desk, { dealId: b.id, disclosureId: record!.id, reason: "Not my deal at all", actor: "x" })).rejects.toThrow(/does not belong/);
    const unknown = await newDeal(w.store, w.now, { collateralRealProperty: null });
    await expect(openDealMlds(w.desk, { dealId: unknown.id, applicationCompletedAt: w.now(), actor: "x" })).rejects.toThrow(/lien on real property/);
  });

  it("reads the application time in office (Pacific) time", () => {
    expect(officeDateTime("2026-11-03T09:30").toISOString()).toBe("2026-11-03T17:30:00.000Z");
    expect(officeDateTime("2026-07-01T09:30").toISOString()).toBe("2026-07-01T16:30:00.000Z");
    expect(() => officeDateTime("yesterday")).toThrow(/valid date/);
  });

  it("parses borrower lines and rejects Kubera as lender", async () => {
    expect(parseBorrowers("Pat Lee <Pat@Example.com>\nSam Roe, sam@example.com")).toEqual([
      { name: "Pat Lee", email: "pat@example.com" },
      { name: "Sam Roe", email: "sam@example.com" },
    ]);
    expect(() => parseBorrowers("no email here")).toThrow(/needs a name and an email/);
    const w = world();
    const deal = await newDeal(w.store, w.now);
    const { record } = await openDealMlds(w.desk, { dealId: deal.id, applicationCompletedAt: w.now(), actor: "x" });
    const input = mldsInputFromForm(form({ lenderName: "Kubera Commercial" }), { broker: brokerIdentity, representative: { name: "Ana", dreLicense: "01234567" }, today: "2026-11-03" });
    await expect(generateDealMlds({ ...w.desk, render, approvedTemplate: true }, { dealId: deal.id, disclosureId: record!.id, mlds: input, actor: "x" })).rejects.toThrow(/never the lender/);
  });
});
