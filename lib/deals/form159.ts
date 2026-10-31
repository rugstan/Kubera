// SBA Form 159 (Fee Disclosure and Compensation Agreement) data built from the
// fee ledger, rendered as a data sheet, and sent for signature (Kubera as
// Agent, the applicant, the lender) through lib/esign behind the broker
// approval gate.
//
// SBA requires Form 159 whenever an Agent is compensated in connection with a
// 7(a) or 504 loan. Kubera's compensation lines come only from the ledger, so
// the form, the invoice and the closing statement can never disagree.
//
// VERIFY (counsel / SBA SOP 50 10): agent-type labels, the itemization
// threshold, and the dual-compensation rule below follow the current SOP as
// researched and are pending counsel review.

import { createHash } from "node:crypto";
import { isApproved, type ApprovalDecision, type ApprovalGate } from "@/lib/compliance/approval-gate";
import { DRAFT_NOTICE, type DocumentSpec, type Section } from "@/lib/disclosures/mlds";
import type { DocumentStorage } from "@/lib/disclosures/store";
import type { EsignEvent, EsignProvider } from "@/lib/esign/types";
import { sba159CategoryOf } from "./ledger";
import { formatCents, sumCents } from "./money";
import type { DealDeskStore } from "./store";
import { isSbaProgram, type Clock, type Deal, type FeeEntry, type Form159Record } from "./types";

export const FORM159_TEMPLATE_VERSION = "kubera-sba159-2026.11";
export const FORM159_TITLE = "SBA Form 159 — Fee Disclosure and Compensation Agreement (data sheet)";

/** VERIFY: SOP 50 10 requires an itemized statement of services above this applicant-paid amount. */
export const ITEMIZATION_THRESHOLD_CENTS = 250_000;

export function form159TemplateApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SBA159_TEMPLATE_APPROVED === "true";
}

export const agentTypes = ["BROKER", "REFERRAL_AGENT", "LOAN_PACKAGER", "LENDER_SERVICE_PROVIDER", "OTHER"] as const;
export type AgentType = (typeof agentTypes)[number];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  BROKER: "Broker",
  REFERRAL_AGENT: "Referral agent",
  LOAN_PACKAGER: "Loan packager",
  LENDER_SERVICE_PROVIDER: "Lender service provider",
  OTHER: "Other",
};

export type Form159Signer = { name: string; email: string; title?: string };

export type Form159Data = {
  sbaProgram: "7A" | "504";
  sbaLoanNumber: string | null;
  loanAmountCents: number;
  lender: { name: string; locationId: string | null; signer: Form159Signer | null };
  applicant: { businessName: string; signers: Form159Signer[] };
  agent: {
    legalName: string;
    agentType: AgentType;
    address: string;
    dreLicense: string;
    signer: Form159Signer & { dreLicense?: string };
  };
  applicantPaid: { packagingCents: number; otherServicesCents: number; otherServicesDescription: string; totalCents: number };
  lenderPaid: { referralCents: number; totalCents: number };
  totalCents: number;
  /** Ledger lines the totals came from (the itemization). */
  lines: { feeEntryId: string; description: string; payer: "applicant" | "lender"; category: "packaging" | "other_services" | "referral"; amountCents: number }[];
  preparedOn: string;
};

export type Form159Flag =
  | "not_sba_program"
  | "no_agent_compensation"
  | "itemization_required"
  | "dual_compensation_review"
  | "sba_loan_number_pending"
  | "agent_license_missing"
  | "lender_signer_missing"
  | "applicant_signer_missing";

/** Flags that stop a send (the form would be incomplete). */
export const FORM159_BLOCKING_FLAGS: ReadonlySet<Form159Flag> = new Set(["not_sba_program", "no_agent_compensation", "agent_license_missing", "lender_signer_missing", "applicant_signer_missing"]);

export type Form159Build = { required: boolean; data: Form159Data; flags: Form159Flag[]; ledgerEntryIds: string[] };

export type Form159Input = {
  deal: Deal;
  entries: FeeEntry[];
  sbaLoanNumber?: string | null;
  lender: { name: string; locationId?: string | null; signer?: Form159Signer | null };
  applicant: { businessName: string; signers: Form159Signer[] };
  agent: Form159Data["agent"];
  preparedOn: string;
};

/** Form 159 data from the deal's ledger (Kubera-received, non-void entries only). */
export function form159FromLedger(input: Form159Input): Form159Build {
  const flags: Form159Flag[] = [];
  if (!isSbaProgram(input.deal.program)) flags.push("not_sba_program");
  const counted = input.entries.filter((e) => e.dealId === input.deal.id && e.payee === "kubera" && e.status !== "void");
  const lines = counted.map((e) => {
    const category = sba159CategoryOf(e);
    return { feeEntryId: e.id, description: e.description, payer: e.payer === "lender" ? ("lender" as const) : ("applicant" as const), category, amountCents: e.amountCents };
  });
  const sumOf = (pred: (l: (typeof lines)[number]) => boolean) => sumCents(lines.filter(pred).map((l) => l.amountCents));
  const packagingCents = sumOf((l) => l.payer === "applicant" && l.category === "packaging");
  const otherServicesCents = sumOf((l) => l.payer === "applicant" && l.category !== "packaging");
  const referralCents = sumOf((l) => l.payer === "lender");
  const applicantTotal = packagingCents + otherServicesCents;
  const totalCents = applicantTotal + referralCents;

  if (totalCents === 0) flags.push("no_agent_compensation");
  if (applicantTotal > ITEMIZATION_THRESHOLD_CENTS) flags.push("itemization_required");
  if (applicantTotal > 0 && referralCents > 0) flags.push("dual_compensation_review");
  if (!input.sbaLoanNumber) flags.push("sba_loan_number_pending");
  if (!/^\d{8}$/.test(input.agent.dreLicense)) flags.push("agent_license_missing");
  if (!input.lender.signer) flags.push("lender_signer_missing");
  if (!input.applicant.signers.length) flags.push("applicant_signer_missing");

  const otherDescriptions = [...new Set(lines.filter((l) => l.payer === "applicant" && l.category !== "packaging").map((l) => l.description))];
  const data: Form159Data = {
    sbaProgram: input.deal.program === "SBA_504" ? "504" : "7A",
    sbaLoanNumber: input.sbaLoanNumber ?? null,
    loanAmountCents: input.deal.loanAmountCents ?? 0,
    lender: { name: input.lender.name, locationId: input.lender.locationId ?? null, signer: input.lender.signer ?? null },
    applicant: input.applicant,
    agent: input.agent,
    applicantPaid: { packagingCents, otherServicesCents, otherServicesDescription: otherDescriptions.join("; ") || "None", totalCents: applicantTotal },
    lenderPaid: { referralCents, totalCents: referralCents },
    totalCents,
    lines,
    preparedOn: input.preparedOn,
  };
  return { required: totalCents > 0 && isSbaProgram(input.deal.program), data, flags, ledgerEntryIds: counted.map((e) => e.id) };
}

/** Canonical digest of the form's data (ledger changes produce a new version). */
export function form159DataDigest(data: Form159Data): string {
  const { preparedOn: _preparedOn, ...rest } = data;
  void _preparedOn;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

// ---------------------------------------------------------------------------
// Document

export function form159Document(data: Form159Data, opts: { draft: boolean }): DocumentSpec {
  const program = data.sbaProgram === "504" ? "SBA 504" : "SBA 7(a)";
  const sections: Section[] = [
    {
      title: "Loan and lender",
      rows: [
        { label: "Program", value: program },
        { label: "SBA loan number", value: data.sbaLoanNumber ?? "Pending SBA assignment" },
        { label: "Loan amount", value: formatCents(data.loanAmountCents) },
        { label: "SBA lender (lender of record)", value: data.lender.name },
        ...(data.lender.locationId ? [{ label: "Lender location ID", value: data.lender.locationId }] : []),
      ],
    },
    {
      title: "Applicant",
      rows: [{ label: "Small business applicant", value: data.applicant.businessName }, ...data.applicant.signers.map((s, i) => ({ label: `Signer ${i + 1}`, value: `${s.name}${s.title ? `, ${s.title}` : ""}` }))],
    },
    {
      title: "Agent",
      rows: [
        { label: "Agent", value: data.agent.legalName },
        { label: "Type of agent", value: AGENT_TYPE_LABELS[data.agent.agentType] },
        { label: "Address", value: data.agent.address },
        { label: "California DRE license", value: `#${data.agent.dreLicense} (real estate broker, California Department of Real Estate)` },
        { label: "Agent contact", value: `${data.agent.signer.name} · ${data.agent.signer.email}` },
      ],
    },
    {
      title: "Compensation paid by the applicant",
      rows: [
        { label: "Loan application packaging", value: formatCents(data.applicantPaid.packagingCents) },
        { label: "Other services", value: formatCents(data.applicantPaid.otherServicesCents) },
        { label: "Description of other services", value: data.applicantPaid.otherServicesDescription },
        { label: "Total paid by the applicant", value: formatCents(data.applicantPaid.totalCents), emphasis: true },
      ],
    },
    {
      title: "Compensation paid by the lender",
      rows: [
        { label: "Referral fee", value: formatCents(data.lenderPaid.referralCents) },
        { label: "Total paid by the lender", value: formatCents(data.lenderPaid.totalCents), emphasis: true },
      ],
    },
    {
      title: "Itemization (from Kubera's fee ledger)",
      rows: data.lines.length
        ? data.lines.map((l) => ({ label: `${l.description} (${l.payer === "lender" ? "lender-paid" : "applicant-paid"})`, value: formatCents(l.amountCents) }))
        : [{ label: "No compensation recorded", value: formatCents(0) }],
    },
    {
      title: "Statements",
      paragraphs: [
        `Total agent compensation in connection with this loan: ${formatCents(data.totalCents)}. Kubera Commercial, Inc. is the agent and broker only; it is not the lender and does not receive, hold or pay out loan proceeds.`,
        "Compensation is paid through the loan closing as shown on the lender's closing statement. No compensation is contingent on the use of any particular lender beyond what is disclosed above.",
        "The official SBA Form 159 signed by the agent, the applicant and the lender is the record the lender submits to SBA. This data sheet carries the same figures.",
      ],
    },
  ];
  return {
    title: FORM159_TITLE,
    subtitle: `${program} · prepared ${data.preparedOn} · template ${FORM159_TEMPLATE_VERSION}`,
    draft: opts.draft,
    notice: opts.draft ? [DRAFT_NOTICE] : [],
    sections,
    signatureLines: [
      { label: "Agent", name: `${data.agent.signer.name} for ${data.agent.legalName}`, detail: data.agent.signer.dreLicense ? `DRE #${data.agent.signer.dreLicense}` : undefined },
      ...data.applicant.signers.map((s) => ({ label: "Applicant", name: s.name, detail: s.title })),
      { label: "Lender", name: data.lender.signer?.name ?? "Authorized lender officer", detail: data.lender.name },
    ],
    footer: `${data.agent.legalName} · DRE #${data.agent.dreLicense} · SBA Form 159 data sheet`,
  };
}

/** Flat field map for the e-sign template (labels must match the Zoho Sign template). */
export function form159PrefillFields(data: Form159Data, draft: boolean): Record<string, string> {
  return {
    sba_program: data.sbaProgram,
    sba_loan_number: data.sbaLoanNumber ?? "",
    loan_amount: formatCents(data.loanAmountCents),
    lender_name: data.lender.name,
    lender_location_id: data.lender.locationId ?? "",
    applicant_name: data.applicant.businessName,
    agent_name: data.agent.legalName,
    agent_type: AGENT_TYPE_LABELS[data.agent.agentType],
    agent_address: data.agent.address,
    agent_dre_license: data.agent.dreLicense,
    agent_contact: data.agent.signer.name,
    applicant_paid_packaging: formatCents(data.applicantPaid.packagingCents),
    applicant_paid_other: formatCents(data.applicantPaid.otherServicesCents),
    applicant_paid_other_description: data.applicantPaid.otherServicesDescription,
    applicant_paid_total: formatCents(data.applicantPaid.totalCents),
    lender_paid_referral: formatCents(data.lenderPaid.referralCents),
    lender_paid_total: formatCents(data.lenderPaid.totalCents),
    total_compensation: formatCents(data.totalCents),
    template_version: FORM159_TEMPLATE_VERSION,
    draft_notice: draft ? DRAFT_NOTICE : "",
  };
}

// ---------------------------------------------------------------------------
// Workflow: generate → (approval) → send → signed

export class Form159BlockedError extends Error {
  constructor(
    readonly reason: "not_found" | "not_required" | "incomplete" | "template_not_approved" | "provider_unavailable" | "invalid_status",
    message: string,
  ) {
    super(message);
    this.name = "Form159BlockedError";
  }
}

export type Renderer = (doc: DocumentSpec) => Promise<Uint8Array>;

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/**
 * Builds Form 159 from the ledger and stores a new version when the data
 * changed (previous unsigned versions are superseded). A signed version with
 * identical data is returned as is.
 */
export async function generateForm159(
  deps: { store: DealDeskStore; render: Renderer; storage?: DocumentStorage; now: Clock; approvedTemplate?: boolean },
  input: Omit<Form159Input, "entries" | "preparedOn" | "deal"> & { dealId: string },
  actor: string,
): Promise<{ record: Form159Record; build: Form159Build; pdf: Uint8Array | null; reused: boolean }> {
  const deal = await deps.store.getDeal(input.dealId);
  if (!deal) throw new Form159BlockedError("not_found", `Deal ${input.dealId} not found`);
  const now = deps.now();
  const entries = await deps.store.listFeeEntries(deal.id);
  const build = form159FromLedger({ ...input, deal, entries, preparedOn: now.toISOString().slice(0, 10) });
  if (!build.required) throw new Form159BlockedError("not_required", build.flags.includes("not_sba_program") ? "Form 159 applies to SBA 7(a) and 504 loans only" : "No agent compensation is recorded in the ledger for this deal");

  const existing = await deps.store.listForm159(deal.id);
  const digest = form159DataDigest(build.data);
  const current = existing.filter((f) => f.status !== "superseded").at(-1);
  if (current && form159DataDigest(current.data) === digest) return { record: current, build, pdf: null, reused: true };

  const draft = !(deps.approvedTemplate ?? form159TemplateApproved());
  const pdf = await deps.render(form159Document(build.data, { draft }));
  const docSha = sha256(pdf);
  const version = (existing.at(-1)?.version ?? 0) + 1;
  const path = `deals/${deal.id}/form159-v${version}-${docSha.slice(0, 16)}.pdf`;
  if (deps.storage) await deps.storage.put(path, pdf, "application/pdf");
  for (const f of existing) if (f.status !== "superseded" && f.status !== "signed") await deps.store.updateForm159(f.id, { status: "superseded" }, actor, now);
  const record = await deps.store.insertForm159(
    {
      dealId: deal.id,
      version,
      sbaProgram: build.data.sbaProgram,
      status: "generated",
      data: build.data,
      ledgerEntryIds: build.ledgerEntryIds,
      flags: build.flags,
      templateVersion: FORM159_TEMPLATE_VERSION,
      draft,
      documentSha256: docSha,
      documentPath: deps.storage ? path : null,
      approvalKey: null,
      approvalId: null,
      provider: null,
      providerRequestId: null,
      sentAt: null,
      signedAt: null,
    },
    actor,
    now,
  );
  return { record, build, pdf, reused: false };
}

export type SendForm159Result = { sent: true; record: Form159Record } | { sent: false; record: Form159Record; decision: ApprovalDecision };

export async function sendForm159(
  deps: { store: DealDeskStore; provider: EsignProvider | null; gate: ApprovalGate; now: Clock; templateId: string | null },
  id: string,
  actor: string,
): Promise<SendForm159Result> {
  const record = await deps.store.getForm159(id);
  if (!record) throw new Form159BlockedError("not_found", `Form 159 ${id} not found`);
  if (record.status === "sent" || record.status === "signed") return { sent: true, record };
  if (record.status === "superseded") throw new Form159BlockedError("invalid_status", "This Form 159 version was superseded by a newer ledger");
  const blocking = record.flags.filter((f) => FORM159_BLOCKING_FLAGS.has(f as Form159Flag));
  if (blocking.length) throw new Form159BlockedError("incomplete", `Form 159 is incomplete: ${blocking.join(", ")}`);
  if (record.draft) throw new Form159BlockedError("template_not_approved", "The Form 159 template is a draft pending counsel review and cannot be sent");
  if (!deps.provider || !deps.templateId) throw new Form159BlockedError("provider_unavailable", "No e-sign provider or Form 159 template is configured");

  const d = record.data;
  const recipients = [
    { role: "Agent", name: d.agent.signer.name, email: d.agent.signer.email, verifyByEmail: true },
    ...d.applicant.signers.map((s, i) => ({ role: `Applicant ${i + 1}`, name: s.name, email: s.email, verifyByEmail: true })),
    { role: "Lender", name: d.lender.signer!.name, email: d.lender.signer!.email, verifyByEmail: true },
  ];
  const approvalKey = `esign_send:form159:${record.id}:${record.documentSha256}`;
  const decision = await deps.gate.request({
    kind: "esign_send",
    idempotencyKey: approvalKey,
    summary: `Send SBA Form 159 (${formatCents(d.totalCents)} agent compensation) to ${d.applicant.businessName} and ${d.lender.name}`,
    templateId: deps.templateId,
    payload: { form159Id: record.id, dealId: record.dealId, documentSha256: record.documentSha256, recipients: recipients.map(({ role, name, email }) => ({ role, name, email })) },
    requestedBy: actor,
  });
  const now = deps.now();
  if (!isApproved(decision)) {
    const updated = await deps.store.updateForm159(record.id, { status: "pending_approval", approvalKey, approvalId: "approvalId" in decision ? (decision.approvalId ?? null) : null }, actor, now);
    return { sent: false, record: updated, decision };
  }
  const created = await deps.provider.createFromTemplate({
    templateId: deps.templateId,
    requestName: `SBA Form 159 · ${d.applicant.businessName}`.slice(0, 100),
    recipients,
    fields: form159PrefillFields(d, record.draft),
    reference: record.id,
  });
  const updated = await deps.store.updateForm159(
    record.id,
    { status: "sent", approvalKey, approvalId: decision.approvalId, provider: deps.provider.name, providerRequestId: created.requestId, sentAt: now.toISOString() },
    actor,
    now,
  );
  return { sent: true, record: updated };
}

/** Applies a verified e-sign webhook event to the matching Form 159 (completed → signed). */
export async function applyForm159EsignEvent(deps: { store: DealDeskStore; now: Clock }, event: EsignEvent): Promise<Form159Record | null> {
  const record = await deps.store.getForm159ByProviderRequest(event.provider, event.requestId);
  if (!record) return null;
  if (event.type === "completed" && record.status === "sent") {
    return deps.store.updateForm159(record.id, { status: "signed", signedAt: event.occurredAt.toISOString() }, `${event.provider}${event.actorEmail ? `:${event.actorEmail}` : ""}`, deps.now());
  }
  // A declined, expired or recalled request retires this version; regenerating
  // creates a new version, which needs its own approval before it is sent.
  if ((event.type === "declined" || event.type === "expired" || event.type === "recalled") && record.status === "sent") {
    return deps.store.updateForm159(record.id, { status: "superseded", flags: [...new Set([...record.flags, `esign_${event.type}`])] }, `${event.provider}`, deps.now());
  }
  return record;
}

/** Closing requirement for SBA deals: no Kubera compensation, or the current Form 159 is signed and matches the ledger. */
export function form159Satisfied(deal: Deal, entries: FeeEntry[], forms: Form159Record[]): boolean {
  if (!isSbaProgram(deal.program)) return true;
  const comp = entries.filter((e) => e.payee === "kubera" && e.status !== "void");
  if (!comp.length) return true;
  const signed = forms.filter((f) => f.status === "signed").at(-1);
  if (!signed) return false;
  const ids = new Set(signed.ledgerEntryIds);
  return comp.every((e) => ids.has(e.id)) && sumCents(comp.map((e) => e.amountCents)) === signed.data.totalCents;
}
