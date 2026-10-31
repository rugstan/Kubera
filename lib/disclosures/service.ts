// Disclosure workflow: open an MLDS case from deal facts (gate A), generate the
// RE 882 document, send it for e-signature (UETA consent + broker approval
// gate), and apply provider webhooks (signed copy stored with a 3-year
// retention date). Every state change appends to the audit trail.
//
// Rendering is injected (`render`) so this module never pulls the PDF engine
// into the webhook route bundle.

import { createHash } from "node:crypto";
import { isApproved, type ApprovalDecision, type ApprovalGate } from "@/lib/compliance/approval-gate";
import { mldsRequirement, type MldsRequirement } from "@/lib/compliance/gates";
import type { MldsFacts } from "@/lib/compliance/schemas";
import type { EsignEvent, EsignProvider } from "@/lib/esign/types";
import { civilDateOf } from "./business-days";
import type { DealRecordSink } from "./deal-record";
import { MLDS_RETENTION_YEARS, buildMlds, mldsDocument, mldsPrefillFields, type DocumentSpec, type Mlds, type MldsData, type MldsInput } from "./mlds";
import { nextStatus, type DisclosureStatus, type DisclosureTransition } from "./state";
import type { DisclosureRecord, DisclosureStore, DocumentStorage, UetaConsent } from "./store";
import { computeMldsTimer } from "./timer";
import { UETA_CONSENT_TEXTS } from "./ueta";

export type BlockReason =
  | "not_found"
  | "invalid_status"
  | "held_for_counsel"
  | "template_not_approved"
  | "ueta_consent_missing"
  | "approval_pending"
  | "approval_rejected"
  | "approval_expired"
  | "provider_unavailable";

export class DisclosureBlockedError extends Error {
  constructor(
    readonly reason: BlockReason,
    message: string,
  ) {
    super(message);
    this.name = "DisclosureBlockedError";
  }
}

export type Clock = () => Date;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function transition(
  store: DisclosureStore,
  record: DisclosureRecord,
  t: DisclosureTransition,
  patch: Partial<DisclosureRecord>,
  audit: { actor: string; at: Date; eventType?: string; detail?: Record<string, unknown>; providerEventId?: string },
): Promise<DisclosureRecord> {
  const to = nextStatus(record.status, t);
  const updated = await store.update(record.id, record.version, { ...patch, status: to }, audit.at);
  await store.appendEvent({
    disclosureId: record.id,
    occurredAt: audit.at.toISOString(),
    eventType: audit.eventType ?? t,
    fromStatus: record.status,
    toStatus: to,
    actor: audit.actor,
    providerEventId: audit.providerEventId,
    detail: audit.detail ?? {},
  });
  return updated;
}

async function load(store: DisclosureStore, id: string): Promise<DisclosureRecord> {
  const r = await store.get(id);
  if (!r) throw new DisclosureBlockedError("not_found", `Disclosure ${id} not found`);
  return r;
}

// ---------------------------------------------------------------------------
// Open

export type OpenMldsInput = {
  leadId?: string;
  dealId?: string;
  twentyOpportunityId?: string;
  facts: MldsFacts;
  /** When Kubera received the completed written loan application. */
  applicationCompletedAt: Date;
  borrowerObligatedAt?: Date;
  actor: string;
};

export type OpenMldsResult = { requirement: MldsRequirement; record: DisclosureRecord | null };

/** Evaluate gate A and, when an MLDS is required (or the deal must be held), open the disclosure. */
export async function openMldsCase(deps: { store: DisclosureStore; now: Clock }, input: OpenMldsInput): Promise<OpenMldsResult> {
  if (!input.leadId && !input.dealId && !input.twentyOpportunityId) throw new Error("An MLDS case needs a lead, deal or opportunity reference");
  const requirement = mldsRequirement(input.facts);
  if (!requirement.required && !requirement.heldForCounsel) return { requirement, record: null };

  const existing = (await deps.store.listForDeal({ leadId: input.leadId, dealId: input.dealId })).find((r) => r.kind === "MLDS_RE882");
  if (existing) return { requirement, record: existing };

  const now = deps.now();
  const timer = computeMldsTimer({ applicationCompletedAt: input.applicationCompletedAt, borrowerObligatedAt: input.borrowerObligatedAt, now });
  const held = requirement.heldForCounsel;
  const record = await deps.store.insert(
    {
      kind: "MLDS_RE882",
      status: held ? "held_for_counsel" : "required",
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      twentyOpportunityId: input.twentyOpportunityId ?? null,
      applicationCompletedAt: input.applicationCompletedAt.toISOString(),
      borrowerObligatedAt: input.borrowerObligatedAt?.toISOString() ?? null,
      dueAt: timer.dueAt.toISOString(),
      heldReason: held ? requirement.flags.filter((f) => f.code === "held_for_counsel").map((f) => f.reason).join(" ") : null,
      flags: [...new Set(requirement.flags.map((f) => f.code))],
    },
    now,
  );
  await deps.store.appendEvent({
    disclosureId: record.id,
    occurredAt: now.toISOString(),
    eventType: "opened",
    fromStatus: null,
    toStatus: record.status,
    actor: input.actor,
    detail: { reasons: requirement.reasons, flags: requirement.flags, dueAt: record.dueAt, dueReason: timer.dueReason },
  });
  return { requirement, record };
}

// ---------------------------------------------------------------------------
// Generate

export type Renderer = (doc: DocumentSpec) => Promise<Uint8Array>;

export async function generateMlds(
  deps: { store: DisclosureStore; storage: DocumentStorage; render: Renderer; now: Clock; approvedTemplate?: boolean },
  id: string,
  input: MldsInput,
  actor: string,
): Promise<{ record: DisclosureRecord; mlds: Mlds; pdf: Uint8Array }> {
  const record = await load(deps.store, id);
  if (record.status === "held_for_counsel") throw new DisclosureBlockedError("held_for_counsel", "Disclosure is held for counsel review");
  if (record.status !== "required" && record.status !== "generated") {
    throw new DisclosureBlockedError("invalid_status", `Cannot generate an MLDS in status ${record.status}`);
  }
  const mlds = buildMlds(input, { approved: deps.approvedTemplate });
  const pdf = await deps.render(mldsDocument(mlds));
  const digest = sha256(pdf);
  const path = `disclosures/${record.id}/mlds-${digest.slice(0, 16)}.pdf`;
  await deps.storage.put(path, pdf, "application/pdf");
  const now = deps.now();
  const flags = new Set(record.flags.filter((f) => f !== "draft_template"));
  if (mlds.draft) flags.add("draft_template");
  const updated = await transition(
    deps.store,
    record,
    record.status === "required" ? "generate" : "regenerate",
    {
      generatedAt: now.toISOString(),
      templateVersion: mlds.templateVersion,
      payload: { data: mlds.data, totals: mlds.totals, draft: mlds.draft },
      documentPath: path,
      documentSha256: digest,
      flags: [...flags],
    },
    { actor, at: now, detail: { documentSha256: digest, templateVersion: mlds.templateVersion, draft: mlds.draft } },
  );
  return { record: updated, mlds, pdf };
}

function mldsFromRecord(record: DisclosureRecord, approvedTemplate?: boolean): Mlds {
  const data = (record.payload as { data?: MldsData } | null)?.data;
  if (!data) throw new DisclosureBlockedError("invalid_status", "Disclosure has no generated MLDS data");
  return buildMlds(data, { approved: approvedTemplate });
}

// ---------------------------------------------------------------------------
// UETA consent

export async function recordUetaConsent(deps: { store: DisclosureStore; now: Clock }, id: string, consent: UetaConsent): Promise<DisclosureRecord> {
  if (!UETA_CONSENT_TEXTS[consent.textVersion]) throw new Error(`Unknown UETA consent text version ${consent.textVersion}`);
  const record = await load(deps.store, id);
  const email = consent.email.trim().toLowerCase();
  const others = record.uetaConsent.filter((c) => c.email.toLowerCase() !== email);
  const now = deps.now();
  const updated = await deps.store.update(record.id, record.version, { uetaConsent: [...others, { ...consent, email }] }, now);
  await deps.store.appendEvent({
    disclosureId: record.id,
    occurredAt: now.toISOString(),
    eventType: "ueta_consent",
    fromStatus: record.status,
    toStatus: record.status,
    actor: `borrower:${email}`,
    detail: { textVersion: consent.textVersion, consentedAt: consent.consentedAt, ip: consent.ip ?? null, userAgent: consent.userAgent ?? null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Send

export type SendDeps = {
  store: DisclosureStore;
  provider: EsignProvider | null;
  gate: ApprovalGate;
  now: Clock;
  templateId: string;
  /** Kubera's signer (the broker or a licensee acting for the broker). */
  brokerSigner: { name: string; email: string };
  approvedTemplate?: boolean;
  embedded?: boolean;
  deal?: DealRecordSink;
};

export type SendResult = { sent: true; record: DisclosureRecord } | { sent: false; record: DisclosureRecord; decision: ApprovalDecision };

export async function sendMlds(deps: SendDeps, id: string, actor: string): Promise<SendResult> {
  const record = await load(deps.store, id);
  if (record.status === "sent" || record.status === "signed") return { sent: true, record };
  if (record.status === "held_for_counsel") throw new DisclosureBlockedError("held_for_counsel", "Disclosure is held for counsel review");
  if (record.status !== "generated") throw new DisclosureBlockedError("invalid_status", `Cannot send a disclosure in status ${record.status}`);

  const mlds = mldsFromRecord(record, deps.approvedTemplate);
  if (mlds.draft) throw new DisclosureBlockedError("template_not_approved", "The MLDS template is a draft pending counsel review and cannot be sent to borrowers");
  const consented = new Set(record.uetaConsent.map((c) => c.email.toLowerCase()));
  const missing = mlds.data.borrowers.filter((b) => !consented.has(b.email.toLowerCase()));
  if (missing.length) throw new DisclosureBlockedError("ueta_consent_missing", `E-sign consent missing for ${missing.map((b) => b.email).join(", ")}`);
  if (!deps.provider) throw new DisclosureBlockedError("provider_unavailable", "No e-sign provider is configured");

  const attempt = (await deps.store.events(record.id)).filter((e) => e.eventType === "send").length + 1;
  const recipients = [
    ...mlds.data.borrowers.map((b, i) => ({ role: `Borrower ${i + 1}`, name: b.name, email: b.email, embedded: deps.embedded, verifyByEmail: true })),
    { role: "Broker", name: deps.brokerSigner.name, email: deps.brokerSigner.email, embedded: false, verifyByEmail: true },
  ];
  const decision = await deps.gate.request({
    kind: "esign_send",
    idempotencyKey: `esign_send:${record.id}:${record.documentSha256}:${attempt}`,
    summary: `Send MLDS (RE 882) for ${mlds.data.property.address} to ${mlds.data.borrowers.map((b) => b.name).join(", ")}`,
    templateId: deps.templateId,
    payload: { disclosureId: record.id, documentSha256: record.documentSha256, recipients: recipients.map(({ role, name, email }) => ({ role, name, email })) },
    requestedBy: actor,
  });
  const now = deps.now();
  if (!isApproved(decision)) {
    await deps.store.appendEvent({
      disclosureId: record.id,
      occurredAt: now.toISOString(),
      eventType: `send_${decision.status}`,
      fromStatus: record.status,
      toStatus: record.status,
      actor,
      detail: { approvalId: "approvalId" in decision ? (decision.approvalId ?? null) : null },
    });
    return { sent: false, record, decision };
  }

  const created = await deps.provider.createFromTemplate({
    templateId: deps.templateId,
    requestName: `MLDS RE 882 · ${mlds.data.property.address}`.slice(0, 100),
    recipients,
    fields: mldsPrefillFields(mlds),
    reference: record.id,
  });
  const updated = await transition(
    deps.store,
    record,
    "send",
    { sentAt: now.toISOString(), provider: deps.provider.name, providerRequestId: created.requestId, signerActions: created.actions },
    { actor, at: now, detail: { approvalId: decision.approvalId, approvedBy: decision.decidedBy, requestId: created.requestId, attempt } },
  );
  await deps.deal?.disclosureChanged(updated, { from: record.status, to: updated.status, at: now });
  return { sent: true, record: updated };
}

// ---------------------------------------------------------------------------
// Webhook events

export type ApplyDeps = {
  store: DisclosureStore;
  storage: DocumentStorage;
  provider: EsignProvider;
  now: Clock;
  deal?: DealRecordSink;
};

export type ApplyResult =
  | { outcome: "duplicate" }
  | { outcome: "unknown_request" }
  | { outcome: "recorded"; record: DisclosureRecord }
  | { outcome: "transitioned"; record: DisclosureRecord; from: DisclosureStatus; to: DisclosureStatus };

export function retentionDate(signedAt: Date): string {
  const [y, m, d] = civilDateOf(signedAt).split("-").map(Number) as [number, number, number];
  // Date.UTC rolls Feb 29 into Mar 1 in non-leap target years.
  return new Date(Date.UTC(y + MLDS_RETENTION_YEARS, m - 1, d)).toISOString().slice(0, 10);
}

export async function applyEsignEvent(deps: ApplyDeps, event: EsignEvent): Promise<ApplyResult> {
  if (await deps.store.hasProviderEvent(event.eventId)) return { outcome: "duplicate" };
  const record = await deps.store.getByProviderRequest(deps.provider.name, event.requestId);
  if (!record) return { outcome: "unknown_request" };

  const now = deps.now();
  const occurredAt = event.occurredAt.getTime() > 0 ? event.occurredAt : now;
  const actor = `${event.provider}${event.actorEmail ? `:${event.actorEmail}` : ""}`;
  const detail = { providerType: event.providerType, requestId: event.requestId, occurredAt: occurredAt.toISOString() };

  const record_only = async (): Promise<ApplyResult> => {
    const fresh = await deps.store.appendEvent({
      disclosureId: record.id,
      occurredAt: now.toISOString(),
      eventType: `esign_${event.type}`,
      fromStatus: record.status,
      toStatus: record.status,
      actor,
      providerEventId: event.eventId,
      detail,
    });
    return fresh ? { outcome: "recorded", record } : { outcome: "duplicate" };
  };

  if (event.type === "completed" && record.status === "sent") {
    const signed = await deps.provider.downloadSigned(event.requestId);
    const digest = sha256(signed);
    const path = `disclosures/${record.id}/signed-${digest.slice(0, 16)}.pdf`;
    await deps.storage.put(path, signed, "application/pdf");
    const updated = await transition(
      deps.store,
      record,
      "complete",
      { signedAt: occurredAt.toISOString(), signedDocumentPath: path, signedDocumentSha256: digest, retainUntil: retentionDate(occurredAt) },
      { actor, at: now, eventType: "esign_completed", providerEventId: event.eventId, detail: { ...detail, signedDocumentSha256: digest } },
    );
    await deps.deal?.disclosureChanged(updated, { from: record.status, to: updated.status, at: now });
    return { outcome: "transitioned", record: updated, from: record.status, to: updated.status };
  }

  if ((event.type === "declined" || event.type === "expired" || event.type === "recalled") && record.status === "sent") {
    const updated = await transition(
      deps.store,
      record,
      "void",
      { providerRequestId: null, provider: null, signerActions: [], sentAt: null },
      { actor, at: now, eventType: `esign_${event.type}`, providerEventId: event.eventId, detail },
    );
    await deps.deal?.disclosureChanged(updated, { from: record.status, to: updated.status, at: now });
    return { outcome: "transitioned", record: updated, from: record.status, to: updated.status };
  }

  return record_only();
}

// ---------------------------------------------------------------------------
// Counsel hold / release, supersede

export async function holdForCounsel(deps: { store: DisclosureStore; now: Clock; deal?: DealRecordSink }, id: string, reason: string, actor: string): Promise<DisclosureRecord> {
  const record = await load(deps.store, id);
  if (record.status === "held_for_counsel") return record;
  const now = deps.now();
  const updated = await transition(deps.store, record, "hold", { heldReason: reason, flags: [...new Set([...record.flags, "held_for_counsel"])] }, { actor, at: now, detail: { reason } });
  await deps.deal?.disclosureChanged(updated, { from: record.status, to: updated.status, at: now });
  return updated;
}

export async function releaseFromCounsel(deps: { store: DisclosureStore; now: Clock }, id: string, counsel: string, note: string): Promise<DisclosureRecord> {
  const record = await load(deps.store, id);
  return transition(
    deps.store,
    record,
    "release",
    { heldReason: null, flags: record.flags.filter((f) => f !== "held_for_counsel") },
    { actor: `counsel:${counsel}`, at: deps.now(), detail: { note } },
  );
}

/** Terms changed after signature: supersede the signed MLDS (kept for retention) and open a new one. */
export async function supersedeSigned(deps: { store: DisclosureStore; now: Clock }, id: string, reason: string, actor: string): Promise<DisclosureRecord> {
  const record = await load(deps.store, id);
  const now = deps.now();
  await transition(deps.store, record, "supersede", {}, { actor, at: now, detail: { reason } });
  const next = await deps.store.insert(
    {
      kind: record.kind,
      status: "required",
      leadId: record.leadId,
      dealId: record.dealId,
      twentyOpportunityId: record.twentyOpportunityId,
      supersedesId: record.id,
      applicationCompletedAt: record.applicationCompletedAt,
      borrowerObligatedAt: record.borrowerObligatedAt,
      // Re-issue has no fresh statutory clock (counsel open question 5); it must be signed before obligation.
      dueAt: record.borrowerObligatedAt,
      flags: record.flags.filter((f) => f !== "draft_template"),
    },
    now,
  );
  await deps.store.appendEvent({ disclosureId: next.id, occurredAt: now.toISOString(), eventType: "opened", fromStatus: null, toStatus: "required", actor, detail: { supersedes: record.id, reason } });
  return next;
}

/** Current MLDS status for a deal, for the compliance gates. */
export async function currentMldsStatus(store: DisclosureStore, ref: { leadId?: string; dealId?: string }): Promise<DisclosureStatus | null> {
  const rows = (await store.listForDeal(ref)).filter((r) => r.kind === "MLDS_RE882");
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows[0]?.status ?? null;
}
