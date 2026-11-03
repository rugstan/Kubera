// Invoices for Corin's own broker compensation, built from earned ledger
// entries. Corin does not collect payment through the site: an invoice is
// settled when the lender's closing statement shows the compensation paid
// through escrow / title (recorded with the closing statement reference).
// Issuing (emailing) an invoice is an outbound action and goes through the
// broker approval gate.

import { createHash } from "node:crypto";
import { isApproved, type ApprovalDecision, type ApprovalGate } from "@/lib/compliance/approval-gate";
import { assertFeeTransition } from "./ledger";
import { formatCents, sumCents } from "./money";
import type { DealDeskStore } from "./store";
import type { Clock, Invoice } from "./types";

export const INVOICE_TEMPLATE_ID = "broker_compensation_invoice_v1";
export const INVOICE_TERMS = "Payable at closing through the escrow or title company as shown on the lender's closing statement. Corin Commercial, Inc. does not accept payment of loan funds and never holds borrower or lender funds.";

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceError";
  }
}

export async function createInvoice(
  deps: { store: DealDeskStore; now: Clock },
  input: { dealId: string; feeEntryIds: string[]; billTo: { kind: "borrower" | "lender"; name: string; email?: string | null }; dueOn?: string | null; actor: string },
): Promise<Invoice> {
  if (!input.feeEntryIds.length) throw new InvoiceError("Pick at least one earned ledger entry");
  const entries = (await deps.store.listFeeEntries(input.dealId)).filter((e) => input.feeEntryIds.includes(e.id));
  if (entries.length !== new Set(input.feeEntryIds).size) throw new InvoiceError("Every entry must belong to this deal");
  for (const e of entries) {
    if (e.payee !== "corin") throw new InvoiceError(`${e.description}: Corin invoices only compensation it receives`);
    if (e.status !== "earned") throw new InvoiceError(`${e.description} is ${e.status}; only earned entries can be invoiced`);
    if (e.payer !== input.billTo.kind) throw new InvoiceError(`${e.description} is paid by the ${e.payer}, not the ${input.billTo.kind}`);
  }
  const now = deps.now();
  const number = await deps.store.nextInvoiceNumber(now.getUTCFullYear());
  const lines = entries.map((e) => ({ feeEntryId: e.id, description: e.description, amountCents: e.amountCents }));
  const invoice = await deps.store.insertInvoice(
    {
      dealId: input.dealId,
      number,
      billToKind: input.billTo.kind,
      billToName: input.billTo.name,
      billToEmail: input.billTo.email ?? null,
      status: "draft",
      lines,
      totalCents: sumCents(lines.map((l) => l.amountCents)),
      issuedAt: null,
      dueOn: input.dueOn ?? null,
      settledOn: null,
      closingStatementRef: null,
      approvalKey: null,
      approvalId: null,
      documentSha256: createHash("sha256").update(JSON.stringify({ number, lines })).digest("hex"),
      voidReason: null,
    },
    input.actor,
    now,
  );
  for (const e of entries) {
    assertFeeTransition(e.status, "invoiced");
    await deps.store.updateFeeEntry(e.id, { status: "invoiced", invoiceId: invoice.id }, input.actor, now);
  }
  return invoice;
}

export function invoiceText(inv: Invoice, dealTitle: string): string {
  return [
    `Invoice ${inv.number} — ${dealTitle}`,
    `Bill to: ${inv.billToName}`,
    "",
    ...inv.lines.map((l) => `${l.description}: ${formatCents(l.amountCents)}`),
    "",
    `Total: ${formatCents(inv.totalCents)}`,
    inv.dueOn ? `Due: ${inv.dueOn}` : "",
    "",
    INVOICE_TERMS,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export type InvoiceMailer = { send(msg: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }> };

export type IssueInvoiceResult = { issued: boolean; invoice: Invoice; decision?: ApprovalDecision };

/**
 * Email the invoice once a broker approves it. The approval is claimed only
 * when the email goes out in the same call, so a missing mailer is refused up
 * front (nothing is requested, nothing is used up) and an approval is never
 * recorded as executed without a send.
 */
export async function issueInvoice(
  deps: { store: DealDeskStore; gate: ApprovalGate; now: Clock; mailer?: InvoiceMailer | null },
  id: string,
  actor: string,
): Promise<IssueInvoiceResult> {
  const inv = await deps.store.getInvoice(id);
  if (!inv) throw new InvoiceError(`Invoice ${id} not found`);
  if (inv.status === "issued" || inv.status === "settled") return { issued: true, invoice: inv };
  if (inv.status === "void") throw new InvoiceError("Invoice is void");
  if (!inv.billToEmail) throw new InvoiceError("Add the bill-to email before issuing");
  if (!deps.mailer) throw new InvoiceError("Invoice email is not configured (CLOUDFLARE_EMAIL_ACCOUNT_ID + CLOUDFLARE_EMAIL_TOKEN, or RESEND_API_KEY); nothing was requested or sent. Send the invoice from your mailbox, then record it as settled against the closing statement.");
  const deal = await deps.store.getDeal(inv.dealId);
  const key = `email:invoice:${inv.id}:${inv.documentSha256}`;
  const text = invoiceText(inv, deal?.title ?? inv.dealId);
  // A mailer is present: an "approved" answer is claimed here and sent immediately below.
  const decision = await deps.gate.request({
    kind: "email",
    idempotencyKey: key,
    summary: `Email invoice ${inv.number} (${formatCents(inv.totalCents)}) to ${inv.billToName}`,
    templateId: INVOICE_TEMPLATE_ID,
    payload: { invoiceId: inv.id, to: inv.billToEmail, text },
    requestedBy: actor,
  });
  const now = deps.now();
  if (!isApproved(decision)) {
    const approvalId = "approvalId" in decision ? (decision.approvalId ?? null) : null;
    // Only a pending approval keeps the invoice waiting; a rejected / expired / used-up one returns it to draft.
    const status = decision.status === "pending" ? "pending_approval" : "draft";
    const invoice = await deps.store.updateInvoice(inv.id, { status, approvalKey: key, approvalId }, actor, now);
    return { issued: false, invoice, decision };
  }
  await deps.mailer.send({ to: inv.billToEmail, subject: `Corin Commercial invoice ${inv.number}`, text, idempotencyKey: key });
  const invoice = await deps.store.updateInvoice(inv.id, { status: "issued", issuedAt: now.toISOString(), approvalKey: key, approvalId: decision.approvalId }, actor, now);
  return { issued: true, invoice, decision };
}

/** One line for staff describing what issueInvoice did. */
export function issueInvoiceMessage(r: IssueInvoiceResult): string {
  if (r.issued) return `Invoice ${r.invoice.number} emailed.`;
  const d = r.decision;
  if (!d || d.status === "pending") return `Invoice ${r.invoice.number} is waiting for broker approval in the approvals queue; nothing was sent. Click Email again once it is approved.`;
  if (d.status === "expired") return `The approval for invoice ${r.invoice.number} expired; nothing was sent. Void and re-draft the invoice to request a new approval.`;
  if (d.status === "rejected" && d.reason === "already_executed") return `The approval for invoice ${r.invoice.number} was already used; nothing more was sent. Void and re-draft the invoice to request a new approval.`;
  return `A broker rejected emailing invoice ${r.invoice.number}${d.status === "rejected" && d.reason ? ` (${d.reason})` : ""}; nothing was sent.`;
}

/** The closing statement shows the compensation paid through escrow / title. */
export async function settleInvoice(deps: { store: DealDeskStore; now: Clock }, id: string, input: { settledOn: string; closingStatementRef: string }, actor: string): Promise<Invoice> {
  const inv = await deps.store.getInvoice(id);
  if (!inv) throw new InvoiceError(`Invoice ${id} not found`);
  if (inv.status === "settled") return inv;
  if (inv.status !== "issued" && inv.status !== "draft" && inv.status !== "pending_approval") throw new InvoiceError(`A ${inv.status} invoice cannot be settled`);
  if (!input.closingStatementRef.trim()) throw new InvoiceError("Reference the closing statement that shows the payment");
  const now = deps.now();
  for (const l of inv.lines) await deps.store.updateFeeEntry(l.feeEntryId, { status: "settled" }, actor, now);
  return deps.store.updateInvoice(inv.id, { status: "settled", settledOn: input.settledOn, closingStatementRef: input.closingStatementRef.trim(), issuedAt: inv.issuedAt ?? now.toISOString() }, actor, now);
}

/** Void an unsettled invoice; its entries return to earned so they can be re-invoiced. */
export async function voidInvoice(deps: { store: DealDeskStore; now: Clock }, id: string, reason: string, actor: string): Promise<Invoice> {
  const inv = await deps.store.getInvoice(id);
  if (!inv) throw new InvoiceError(`Invoice ${id} not found`);
  if (inv.status === "settled") throw new InvoiceError("A settled invoice cannot be voided");
  if (inv.status === "void") return inv;
  if (!reason.trim()) throw new InvoiceError("Give a reason");
  const now = deps.now();
  for (const l of inv.lines) await deps.store.updateFeeEntry(l.feeEntryId, { status: "earned", invoiceId: null }, actor, now);
  return deps.store.updateInvoice(inv.id, { status: "void", voidReason: reason.trim() }, actor, now);
}
