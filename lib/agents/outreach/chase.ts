import { safeRecord, type OutreachAuditSink } from "./audit";
import { planSeries, type CadenceConfig } from "./cadence";
import type { EscalationSink, Escalation } from "./escalation";
import type { OutreachSend, OutreachSender } from "./sender";
import type { OutreachStore } from "./store";
import type { OutreachTemplateId } from "./templates";
import type { OutreachAudience, OutreachKind, OutreachMessageRow, OutreachOutcome } from "./types";

// The shared round runner behind the document reminders, closing nudges and
// vendor nudges. Given what is outstanding right now it asks the cadence
// whether a round is due, resumes a round that is waiting on approval or the
// texting window, or starts the next round. It never sends on its own: every
// message goes through OutreachSender (consent, window, approval gate).

export type ChaseAgent = "document_reminders" | "closing_nudges" | "vendor_nudges";

export type ChaseRecipient = {
  audience: OutreachAudience;
  email?: string | null;
  phone?: string | null;
};

export type ChaseSpec = {
  agent: ChaseAgent;
  kind: OutreachKind;
  /** Idempotency key prefix, unique per series: `docrem:<deal>`. Round and channel are appended. */
  keyPrefix: string;
  subjectKey: string;
  dealId?: string | null;
  leadId?: string | null;
  cadence: CadenceConfig;
  anchor: Date;
  /** Whatever is outstanding right now (empty = the series is done). */
  outstanding: number;
  recipient: ChaseRecipient | null;
  email?: { templateId: OutreachTemplateId; data: (round: number) => unknown } | null;
  sms?: { templateId: OutreachTemplateId; data: (round: number) => unknown; fromRound: number } | null;
  /** Raised once when the cadence is exhausted (or the recipient cannot be reached). */
  escalation: { kind: Escalation["kind"]; title: string; lines: string[] };
  requestedBy: string;
};

export type ChaseDeps = {
  sender: OutreachSender;
  store: OutreachStore;
  escalation?: EscalationSink | null;
  audit?: OutreachAuditSink;
  now: () => Date;
};

export type ChaseResult = {
  action: "sent" | "resumed" | "none" | "capped" | "no_contact" | "done";
  reason: string;
  round?: number;
  outcomes: OutreachOutcome[];
};

const resend = (sender: OutreachSender, row: OutreachMessageRow): Promise<OutreachOutcome> => {
  const send: OutreachSend = {
    templateId: row.templateId as OutreachTemplateId,
    to: row.channel === "sms" ? { audience: row.audience, phone: row.recipient } : { audience: row.audience, email: row.recipient },
    // The sender reuses the data stored at the first attempt; this is only a fallback.
    data: row.metadata.renderData ?? {},
    idempotencyKey: row.idempotencyKey,
    leadId: row.leadId,
    dealId: row.dealId,
    subjectKey: row.subjectKey,
    sequence: row.sequence,
  };
  return sender.send(send);
};

async function raise(deps: ChaseDeps, spec: ChaseSpec, key: string, why: string): Promise<void> {
  await safeRecord(deps.audit, { at: deps.now().toISOString(), agent: spec.agent, action: "escalate", kind: spec.kind, reason: why, dealId: spec.dealId ?? null, leadId: spec.leadId ?? null });
  if (!deps.escalation) return;
  await deps.escalation
    .escalate({ key, kind: spec.escalation.kind, dealId: spec.dealId ?? null, leadId: spec.leadId ?? null, title: spec.escalation.title, lines: spec.escalation.lines })
    .catch((err) => console.error("outreach: escalation failed", err instanceof Error ? err.message : err));
}

/** Messages still waiting for a decision that no longer matters (the checklist is satisfied): close them so nothing is released later. */
async function supersede(store: OutreachStore, rows: readonly OutreachMessageRow[]): Promise<void> {
  for (const r of rows) await store.update(r.id, { status: "expired", reasonCode: "approval_expired", error: "superseded: nothing is outstanding any more" });
}

export async function chase(spec: ChaseSpec, deps: ChaseDeps): Promise<ChaseResult> {
  const now = deps.now();

  // Nothing outstanding: the series is finished. Release nothing that is still waiting.
  if (spec.outstanding === 0) {
    const open = await deps.store.listSeries({ kind: spec.kind, dealId: spec.dealId ?? null, subjectKey: spec.subjectKey });
    const waiting = open.filter((r) => r.status === "pending_approval" || r.status === "deferred_quiet_hours");
    await supersede(deps.store, waiting);
    return { action: "done", reason: "nothing_outstanding", outcomes: [] };
  }

  const plan = await planSeries(deps.store, {
    kind: spec.kind,
    dealId: spec.dealId ?? null,
    subjectKey: spec.subjectKey,
    anchor: spec.anchor,
    cadence: spec.cadence,
    now,
  });

  if (plan.action === "none") return { action: "none", reason: plan.reason, outcomes: [] };

  if (plan.action === "cap_reached") {
    await raise(deps, spec, `${spec.keyPrefix}:cap`, "cadence_exhausted");
    return { action: "capped", reason: "cadence_exhausted", round: plan.rounds, outcomes: [] };
  }

  if (plan.action === "resume") {
    const outcomes: OutreachOutcome[] = [];
    for (const row of plan.rows) outcomes.push(await resend(deps.sender, row));
    return { action: "resumed", reason: "resumed_waiting_round", round: plan.round, outcomes };
  }

  // A new round needs somebody to send to.
  const to = spec.recipient;
  if (!to || (!to.email && !to.phone)) {
    await raise(deps, spec, `${spec.keyPrefix}:nocontact`, "no_contact");
    return { action: "no_contact", reason: "no_contact", outcomes: [] };
  }

  const round = plan.round;
  const outcomes: OutreachOutcome[] = [];
  const common = { leadId: spec.leadId ?? null, dealId: spec.dealId ?? null, subjectKey: spec.subjectKey, sequence: round, requestedBy: spec.requestedBy };
  if (spec.email && to.email) {
    outcomes.push(
      await deps.sender.send({ ...common, templateId: spec.email.templateId, to: { audience: to.audience, email: to.email }, data: spec.email.data(round), idempotencyKey: `${spec.keyPrefix}:r${round}:email` }),
    );
  }
  // Texts start at `fromRound`, or at round 1 when there is no email address to use.
  if (spec.sms && to.phone && (round >= spec.sms.fromRound || !to.email)) {
    outcomes.push(
      await deps.sender.send({ ...common, templateId: spec.sms.templateId, to: { audience: to.audience, phone: to.phone }, data: spec.sms.data(round), idempotencyKey: `${spec.keyPrefix}:r${round}:sms` }),
    );
  }
  if (outcomes.length === 0) {
    await raise(deps, spec, `${spec.keyPrefix}:nocontact`, "no_contact");
    return { action: "no_contact", reason: "no_contact", outcomes };
  }
  // Every channel may still have been refused (e.g. no text consent): it is still a round, so the cap applies.
  return { action: "sent", reason: outcomes.some((o) => o.status === "sent") ? "sent" : "round_started_nothing_sent", round, outcomes };
}
