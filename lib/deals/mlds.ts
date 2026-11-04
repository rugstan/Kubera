// MLDS (RE 882) on the deal desk: the deal-level wrapper around
// lib/disclosures/service.ts that the staff server actions, the borrower
// portal and the mlds_send approval executor call.
//
//   open      staff record when the completed written application arrived;
//             gate A decides whether an MLDS is required (or held for counsel)
//   generate  staff enter the RE 882 figures; the PDF is rendered and stored
//   consent   each borrower gives UETA e-sign consent in the borrower portal
//   send      through the approval gate (mlds_send: the approving broker
//             re-authenticates); the approval executor sends once approved
//   webhook   the signed copy arrives (app/api/webhooks/zoho-sign), and the
//             closing gate (lib/compliance/gates.ts) then lets the deal close
//
// Corin is the broker, never the lender: figures that name Corin as the
// lender or a lienholder / beneficiary hold the MLDS (and so the deal) for
// counsel instead of generating it, and nothing here touches funds.

import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { CORIN_NAME, type MldsFacts } from "@/lib/compliance/schemas";
import { namesCorin } from "@/lib/disclosures/broker-of-record";
import { zonedInstant } from "@/lib/disclosures/business-days";
import type { DealRecordSink } from "@/lib/disclosures/deal-record";
import type { MldsData, MldsInput } from "@/lib/disclosures/mlds";
import {
  DisclosureBlockedError,
  generateMlds,
  holdForCounsel,
  openMldsCase,
  recordUetaConsent,
  releaseFromCounsel,
  sendMlds,
  type OpenMldsResult,
  type Renderer,
  type SendResult,
} from "@/lib/disclosures/service";
import type { DisclosureRecord, DisclosureStore, DocumentStorage } from "@/lib/disclosures/store";
import { UETA_CONSENT_TEXTS } from "@/lib/disclosures/ueta";
import type { EsignProvider } from "@/lib/esign/types";
import type { IdempotencyStore } from "@/lib/workflows/idempotency";
import type { BrokerIdentity } from "./dre";
import type { DealDeskStore } from "./store";
import type { Clock, Deal } from "./types";

export class MldsDeskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MldsDeskError";
  }
}

export type MldsDeskDeps = {
  store: DealDeskStore;
  disclosures: DisclosureStore;
  storage: DocumentStorage;
  now: Clock;
  deal?: DealRecordSink;
};

/** Gate-A facts for a deal, from the deal record and its loan broker-of-record row. */
export async function dealMldsFacts(store: DealDeskStore, deal: Deal): Promise<MldsFacts> {
  if (deal.collateralRealProperty === null) throw new MldsDeskError("Record whether a lien on real property secures the loan first.");
  const loan = await store.getLoanBrokerOfRecord(deal.id);
  return {
    corinRole: "broker",
    program: deal.program,
    collateral: loan?.collateral ?? { realPropertyLien: deal.collateralRealProperty, equityPledgeOrUccOnly: false },
    tableFundedInCorinName: loan?.tableFundedInCorinName ?? false,
    // Beneficiary / originator as named on the loan documents (gate A: Corin named ⇒ held for counsel).
    ...namesCorin(loan ?? {}),
  };
}

/** The deal's current (not superseded) MLDS, if one was opened. */
export async function currentDealMlds(disclosures: DisclosureStore, deal: Pick<Deal, "id" | "leadId">): Promise<DisclosureRecord | null> {
  const rows = (await disclosures.listForDeal({ dealId: deal.id, ...(deal.leadId ? { leadId: deal.leadId } : {}) })).filter((r) => r.kind === "MLDS_RE882");
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows[0] ?? null;
}

async function dealOf(deps: Pick<MldsDeskDeps, "store">, dealId: string): Promise<Deal> {
  const deal = await deps.store.getDeal(dealId);
  if (!deal) throw new MldsDeskError(`Deal ${dealId} not found`);
  return deal;
}

/** The disclosure, checked to belong to `dealId` (a form can carry any id). */
async function dealDisclosure(deps: Pick<MldsDeskDeps, "store" | "disclosures">, dealId: string, disclosureId: string): Promise<{ deal: Deal; record: DisclosureRecord }> {
  const deal = await dealOf(deps, dealId);
  const record = await deps.disclosures.get(disclosureId);
  if (!record || record.kind !== "MLDS_RE882" || (record.dealId !== deal.id && !(deal.leadId && record.leadId === deal.leadId))) {
    throw new MldsDeskError("That MLDS does not belong to this deal.");
  }
  return { deal, record };
}

// --- Open ----------------------------------------------------------------------------------

/** A `datetime-local` value ("2026-11-03T09:30") read in office time (Pacific), as the business-day clock is. */
export function officeDateTime(local: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) throw new MldsDeskError("Enter a valid date and time");
  return zonedInstant(m[1]!, { h: Number(m[2]), m: Number(m[3]), s: 0, ms: 0 });
}

/** Step 1: the completed written loan application was received; gate A opens the MLDS (3-business-day clock). */
export async function openDealMlds(
  deps: MldsDeskDeps,
  input: { dealId: string; applicationCompletedAt: Date; borrowerObligatedAt?: Date; actor: string },
): Promise<OpenMldsResult> {
  const deal = await dealOf(deps, input.dealId);
  if (Number.isNaN(input.applicationCompletedAt.getTime())) throw new MldsDeskError("Enter when the completed application was received.");
  if (input.applicationCompletedAt.getTime() > deps.now().getTime() + 5 * 60_000) throw new MldsDeskError("The application date cannot be in the future.");
  const facts = await dealMldsFacts(deps.store, deal);
  const result = await openMldsCase(
    { store: deps.disclosures, now: deps.now },
    {
      dealId: deal.id,
      ...(deal.leadId ? { leadId: deal.leadId } : {}),
      ...(deal.twentyOpportunityId ? { twentyOpportunityId: deal.twentyOpportunityId } : {}),
      facts,
      applicationCompletedAt: input.applicationCompletedAt,
      ...(input.borrowerObligatedAt ? { borrowerObligatedAt: input.borrowerObligatedAt } : {}),
      actor: input.actor,
    },
  );
  if (result.record?.status === "held_for_counsel") await deps.deal?.disclosureChanged(result.record, { from: "none", to: "held_for_counsel", at: deps.now() });
  return result;
}

// --- Generate ------------------------------------------------------------------------------

export type FormReader = (key: string) => string;

const money = (raw: string, label: string): number => {
  const v = Number(raw.replace(/[$,\s]/g, ""));
  if (!raw.trim() || !Number.isFinite(v)) throw new MldsDeskError(`${label} must be a dollar amount`);
  return v;
};
const decimal = (raw: string, label: string): number => {
  const v = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(v)) throw new MldsDeskError(`${label} must be a number`);
  return v;
};
const optMoney = (raw: string, label: string): number | undefined => (raw.trim() ? money(raw, label) : undefined);
const int = (raw: string, label: string): number => {
  const v = Number(raw.trim());
  if (!raw.trim() || !Number.isInteger(v)) throw new MldsDeskError(`${label} must be a whole number`);
  return v;
};
const rows = (raw: string) =>
  raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("|").map((c) => c.trim()));

/** "Name <email>" or "Name, email", one borrower per line. */
export function parseBorrowers(raw: string): { name: string; email: string }[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*?)[\s,]*<?([^\s<>,]+@[^\s<>,]+)>?$/.exec(line);
      if (!m || !m[1]!.trim()) throw new MldsDeskError(`Borrower line "${line.slice(0, 80)}" needs a name and an email, e.g. "Pat Lee <pat@example.com>"`);
      return { name: m[1]!.trim(), email: m[2]!.toLowerCase() };
    });
}

/**
 * RE 882 input from the deal-desk form. Corin's identity comes from
 * configuration and the signing licensee from the staff session; the schema
 * (mldsInputSchema) validates the rest when the MLDS is generated.
 */
export function mldsInputFromForm(get: FormReader, ctx: { broker: BrokerIdentity; representative: { name: string; dreLicense: string | null }; today: string }): MldsInput {
  const lienRows = (key: string) =>
    rows(get(key)).map(([lienholder = "", nature = "", priority = "", amount = ""]) => ({
      lienholder,
      nature,
      priority: int(priority, `Lien priority for ${lienholder || "a lien"}`),
      amountUsd: money(amount, `Lien amount for ${lienholder || "a lien"}`),
    }));
  const rateType = get("rateType") || "fixed";
  return {
    preparedOn: get("preparedOn") || ctx.today,
    borrowers: parseBorrowers(get("borrowers")),
    property: {
      address: get("propertyAddress"),
      ...(get("apn") ? { apn: get("apn") } : {}),
      ...(get("county") ? { county: get("county") } : {}),
    },
    broker: {
      legalName: ctx.broker.legalName,
      dreLicense: ctx.broker.dreLicense,
      licensedAddress: ctx.broker.address,
      representativeName: ctx.representative.name,
      representativeLicense: ctx.representative.dreLicense ?? "",
    },
    loan: {
      ...(get("lenderName") ? { lenderName: get("lenderName") } : {}),
      principalUsd: money(get("principal"), "Principal"),
      termMonths: int(get("termMonths"), "Term (months)"),
      ...(get("amortizationMonths") ? { amortizationMonths: int(get("amortizationMonths"), "Amortization (months)") } : {}),
      ratePct: decimal(get("ratePct"), "Interest rate (%)"),
      rateType: rateType as MldsData["loan"]["rateType"],
      ...(get("adjustableTerms") ? { adjustableTerms: get("adjustableTerms") } : {}),
      payment: {
        amountUsd: money(get("paymentAmount"), "Payment amount"),
        frequency: (get("paymentFrequency") || "monthly") as MldsData["loan"]["payment"]["frequency"],
        count: int(get("paymentCount"), "Number of payments"),
        interestOnly: get("interestOnly") === "on",
      },
      balloon:
        get("balloon") === "on"
          ? { present: true, amountUsd: optMoney(get("balloonAmount"), "Balloon amount"), ...(get("balloonDue") ? { dueOn: get("balloonDue") } : {}) }
          : { present: false },
      prepayment: get("prepayment") ? { present: true, description: get("prepayment") } : { present: false },
      lateCharge: get("lateCharge") ? { present: true, description: get("lateCharge") } : { present: false },
      impoundsRequired: get("impounds") === "on",
    },
    costs: {
      appraisal: { amountUsd: money(get("costAppraisal") || "0", "Appraisal") },
      escrow: { amountUsd: money(get("costEscrow") || "0", "Escrow") },
      title: { amountUsd: money(get("costTitle") || "0", "Title") },
      notary: { amountUsd: money(get("costNotary") || "0", "Notary") },
      recording: { amountUsd: money(get("costRecording") || "0", "Recording") },
      ...(get("costCredit") ? { creditInvestigation: { amountUsd: money(get("costCredit"), "Credit investigation"), paidTo: get("costCreditToBroker") === "on" ? "broker" : "others" } } : {}),
      other: rows(get("costOther")).map(([label = "", amount = "", paidTo = ""]) => ({ label, amountUsd: money(amount, `Cost "${label}"`), paidTo: paidTo.toLowerCase() === "broker" ? "broker" : "others" })),
    },
    compensation: {
      brokerFromBorrower: {
        commissionUsd: money(get("commission") || "0", "Broker commission"),
        processingUsd: money(get("processing") || "0", "Processing fee"),
        otherUsd: money(get("otherBrokerFee") || "0", "Other broker fee"),
      },
      brokerFromLender: { amountUsd: money(get("brokerFromLender") || "0", "Lender-paid compensation"), ...(get("brokerFromLenderDescription") ? { description: get("brokerFromLenderDescription") } : {}) },
      lenderFees: { originationUsd: money(get("lenderOrigination") || "0", "Lender origination"), discountUsd: money(get("lenderDiscount") || "0", "Lender discount") },
    },
    payoffs: rows(get("payoffs")).map(([label = "", amount = ""]) => ({ label, amountUsd: money(amount, `Payoff "${label}"`) })),
    existingLiens: lienRows("existingLiens"),
    expectedLiens: lienRows("expectedLiens"),
  };
}

/** Why the entered RE 882 figures name Corin as lender or lienholder, if they do (gate A: held for counsel). */
export function mldsNamesCorin(input: MldsInput): string | null {
  const reasons: string[] = [];
  if (input.loan.lenderName && CORIN_NAME.test(input.loan.lenderName)) reasons.push("The MLDS figures name Corin as the lender of record; Corin is a broker only.");
  const liens = [...(input.existingLiens ?? []), ...(input.expectedLiens ?? [])];
  if (liens.some((l) => CORIN_NAME.test(l.lienholder))) reasons.push("The MLDS figures name Corin as a lienholder or trust-deed beneficiary; Corin is a broker only.");
  return reasons.length ? `${reasons.join(" ")} (B&P §10234)` : null;
}

/**
 * Step 2: render the RE 882 from the entered figures (regenerates until it is
 * sent). Figures that name Corin as lender or lienholder are not a typo to
 * fix: the deal is held for counsel (the MLDS is held, so borrower documents
 * and closing stop) and nothing is rendered.
 */
export async function generateDealMlds(
  deps: MldsDeskDeps & { render: Renderer; approvedTemplate?: boolean },
  input: { dealId: string; disclosureId: string; mlds: MldsInput; actor: string },
): Promise<DisclosureRecord> {
  const { record: current } = await dealDisclosure(deps, input.dealId, input.disclosureId);
  const namesCorinReason = mldsNamesCorin(input.mlds);
  if (namesCorinReason) {
    if (current.status === "held_for_counsel") return current;
    return holdForCounsel({ store: deps.disclosures, now: deps.now, ...(deps.deal ? { deal: deps.deal } : {}) }, input.disclosureId, namesCorinReason, input.actor);
  }
  const { record } = await generateMlds(
    { store: deps.disclosures, storage: deps.storage, render: deps.render, now: deps.now, ...(deps.approvedTemplate !== undefined ? { approvedTemplate: deps.approvedTemplate } : {}) },
    input.disclosureId,
    input.mlds,
    input.actor,
  );
  return record;
}

/** Borrowers named on the generated MLDS, with whether each has given UETA consent. */
export function mldsSigners(record: DisclosureRecord): { name: string; email: string; consentedAt: string | null }[] {
  const data = (record.payload as { data?: MldsData } | null)?.data;
  if (!data) return [];
  return data.borrowers.map((b) => ({
    name: b.name,
    email: b.email.toLowerCase(),
    consentedAt: record.uetaConsent.find((c) => c.email.toLowerCase() === b.email.toLowerCase())?.consentedAt ?? null,
  }));
}

// --- Consent (borrower portal) ---------------------------------------------------------------

/** MLDS forms on the borrower's deal still waiting for this borrower's e-sign consent. */
export async function mldsAwaitingConsent(disclosures: DisclosureStore, session: { dealId: string; email: string }): Promise<DisclosureRecord[]> {
  const email = session.email.toLowerCase();
  const rows = (await disclosures.listForDeal({ dealId: session.dealId })).filter((r) => r.kind === "MLDS_RE882" && r.dealId === session.dealId && r.status === "generated");
  return rows.filter((r) => mldsSigners(r).some((s) => s.email === email && !s.consentedAt));
}

/** Step 3: the signed-in borrower consents to sign electronically (UETA). Only for themselves, on their own deal. */
export async function recordPortalUetaConsent(
  deps: { disclosures: DisclosureStore; now: Clock },
  session: { dealId: string; email: string },
  input: { disclosureId: string; textVersion: string; agreed: boolean; ip?: string | null; userAgent?: string | null },
): Promise<DisclosureRecord> {
  if (!input.agreed) throw new MldsDeskError("Tick the box to agree to sign electronically, or ask your advisor for paper documents.");
  if (!UETA_CONSENT_TEXTS[input.textVersion]) throw new MldsDeskError("This consent text is out of date. Reload the page and read the current version.");
  const record = await deps.disclosures.get(input.disclosureId);
  const email = session.email.toLowerCase();
  if (!record || record.kind !== "MLDS_RE882" || record.dealId !== session.dealId || !mldsSigners(record).some((s) => s.email === email)) {
    throw new MldsDeskError("We could not find a disclosure for you to sign. Ask your advisor.");
  }
  if (record.status !== "generated") throw new MldsDeskError("This disclosure is not waiting for consent any more.");
  return recordUetaConsent({ store: deps.disclosures, now: deps.now }, record.id, {
    textVersion: input.textVersion,
    consentedAt: deps.now().toISOString(),
    email,
    ...(input.ip ? { ip: input.ip } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 400) } : {}),
  });
}


// --- Send ----------------------------------------------------------------------------------

export type MldsSendDeps = MldsDeskDeps & {
  provider: EsignProvider | null;
  gate: ApprovalGate;
  effects: IdempotencyStore;
  templateId: string | null;
  approvedTemplate?: boolean;
  embedded?: boolean;
};

/**
 * Step 4: request the send through the approval gate. Until a broker approves
 * (with step-up re-authentication) nothing is sent; the mlds_send approval
 * executor then sends it, or staff press Send again.
 */
export async function sendDealMlds(
  deps: MldsSendDeps,
  input: { dealId: string; disclosureId: string; brokerSigner: { name: string; email: string }; actor: string },
): Promise<SendResult> {
  await dealDisclosure(deps, input.dealId, input.disclosureId);
  if (!deps.provider) throw new DisclosureBlockedError("provider_unavailable", "No e-sign provider is configured");
  if (!deps.templateId) throw new DisclosureBlockedError("provider_unavailable", `No MLDS template is configured for ${deps.provider.name}`);
  return sendMlds(
    {
      store: deps.disclosures,
      provider: deps.provider,
      gate: deps.gate,
      effects: deps.effects,
      now: deps.now,
      templateId: deps.templateId,
      brokerSigner: input.brokerSigner,
      ...(deps.approvedTemplate !== undefined ? { approvedTemplate: deps.approvedTemplate } : {}),
      ...(deps.embedded !== undefined ? { embedded: deps.embedded } : {}),
      ...(deps.deal ? { deal: deps.deal } : {}),
    },
    input.disclosureId,
    input.actor,
  );
}

/** The approval's payload, as sendMlds wrote it. */
type MldsSendPayload = { disclosureId?: unknown; recipients?: { role?: unknown; name?: unknown; email?: unknown }[] };

/**
 * Executor for approved `mlds_send` approvals: sends with the same broker
 * signer the request named (so the approval payload matches), exactly once.
 */
export function mldsSendExecutor(deps: Omit<MldsSendDeps, "store">) {
  return async (approval: { id: string; kind: string; payload: Record<string, unknown>; requestedBy: string }): Promise<string> => {
    const payload = approval.payload as MldsSendPayload;
    const disclosureId = typeof payload.disclosureId === "string" ? payload.disclosureId : "";
    const broker = (payload.recipients ?? []).find((r) => r.role === "Broker");
    if (!disclosureId || typeof broker?.name !== "string" || typeof broker.email !== "string") throw new MldsDeskError(`Approval ${approval.id} has no disclosure or broker signer`);
    if (!deps.provider || !deps.templateId) throw new DisclosureBlockedError("provider_unavailable", "No e-sign provider or MLDS template is configured");
    const result = await sendMlds(
      {
        store: deps.disclosures,
        provider: deps.provider,
        gate: deps.gate,
        effects: deps.effects,
        now: deps.now,
        templateId: deps.templateId,
        brokerSigner: { name: broker.name, email: broker.email },
        ...(deps.approvedTemplate !== undefined ? { approvedTemplate: deps.approvedTemplate } : {}),
        ...(deps.embedded !== undefined ? { embedded: deps.embedded } : {}),
        ...(deps.deal ? { deal: deps.deal } : {}),
      },
      disclosureId,
      approval.requestedBy,
    );
    if (!result.sent) throw new MldsDeskError(`MLDS ${disclosureId} was not sent (${result.decision.status})`);
    return result.record.providerRequestId ?? disclosureId;
  };
}

// --- Counsel hold ----------------------------------------------------------------------------

/** Step 5: hold the MLDS (and so the deal's borrower documents and closing) for counsel review. */
export async function holdDealMlds(deps: MldsDeskDeps, input: { dealId: string; disclosureId: string; reason: string; actor: string }): Promise<DisclosureRecord> {
  if (input.reason.trim().length < 5) throw new MldsDeskError("Say why the MLDS is held for counsel.");
  await dealDisclosure(deps, input.dealId, input.disclosureId);
  return holdForCounsel({ store: deps.disclosures, now: deps.now, ...(deps.deal ? { deal: deps.deal } : {}) }, input.disclosureId, input.reason.trim(), input.actor);
}

/** Counsel cleared the hold: the MLDS goes back to required and is generated again. */
export async function releaseDealMlds(deps: MldsDeskDeps, input: { dealId: string; disclosureId: string; counsel: string; note: string }): Promise<DisclosureRecord> {
  if (input.counsel.trim().length < 2 || input.note.trim().length < 5) throw new MldsDeskError("Name the counsel who cleared the hold and record their note.");
  const { record } = await dealDisclosure(deps, input.dealId, input.disclosureId);
  if (record.status !== "held_for_counsel") throw new MldsDeskError("This MLDS is not held for counsel.");
  const released = await releaseFromCounsel({ store: deps.disclosures, now: deps.now }, input.disclosureId, input.counsel.trim(), input.note.trim());
  await deps.deal?.disclosureChanged(released, { from: record.status, to: released.status, at: deps.now() });
  return released;
}
