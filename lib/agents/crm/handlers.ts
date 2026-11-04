// Entry points the platform calls: a routed email (corin/mail.routed), a
// logged call, the daily duplicate scan and the stage reconcile sweep. Each
// builds CRM changes and hands them to the CrmAgentWriter, which applies the
// autonomy policy, the broker approval gate and the event log.
//
// Handlers return counts and statuses only (workflow step results are
// persisted), never note text, transcripts or contact details.

import type { AgentEventStore } from "@/lib/agents/core/events";
import { recordInjection, taintFromCodes } from "@/lib/agents/core/inbound";
import type { ModelGateway } from "@/lib/ai/gateway";
import { mailRoutedSchema } from "@/lib/workflows/events";
import { callNoteOp, callTaskDrafts, summarizeCall, type CallRecord } from "./call-notes";
import { findDuplicates } from "./dedupe";
import type { CrmLinkLookup, CrmLinks } from "./links";
import type { RoutedMailSource } from "./mail-source";
import { noteFromMail } from "./notes";
import { clientForTask } from "./scopes";
import { targetsFrom, mailTaskDraft, taskOp } from "./tasks";
import type { CrmClient, CrmCompany } from "./types";
import type { CrmAgentWriter, WriteOutcome } from "./writer";

export type CrmAgentDeps = {
  writer: CrmAgentWriter;
  client: CrmClient;
  links: CrmLinkLookup;
  mail: RoutedMailSource | null;
  gateway: ModelGateway | null;
  stageMap?: Readonly<Record<string, string>>;
  /** agent_events (lib/agents/core): injection findings in call transcripts are recorded here. */
  events?: Pick<AgentEventStore, "append"> | null;
  now?: () => Date;
};

/** CRM agent version for core agent_events rows. */
const CRM_AGENT_SEMVER = "1.1.0";

const nowOf = (deps: Pick<CrmAgentDeps, "now">) => (deps.now ?? (() => new Date()))();

async function linksFor(ids: { dealId: string | null; leadId: string | null }, deps: Pick<CrmAgentDeps, "links">): Promise<CrmLinks | null> {
  const deal = ids.dealId ? await deps.links.forDeal(ids.dealId) : null;
  if (deal && (deal.opportunityId || deal.personId)) return deal;
  const lead = ids.leadId ? await deps.links.forLead(ids.leadId) : null;
  if (!deal) return lead;
  // The deal row may not carry the person; the lead does.
  return lead ? { ...deal, opportunityId: deal.opportunityId ?? lead.opportunityId, personId: deal.personId ?? lead.personId } : deal;
}

async function assigneeFor(links: CrmLinks | null, deps: Pick<CrmAgentDeps, "links">): Promise<string | null> {
  if (!links?.ownerUserId) return null;
  return deps.links.memberIdForUser(links.ownerUserId).catch(() => null);
}

// --- Routed email -------------------------------------------------------------------------------

export type MailHandled = { note: WriteOutcome; task: WriteOutcome };

/** A routed message becomes a CRM note on its deal and, where an advisor needs to act, a task. */
export async function handleMailRouted(data: unknown, deps: CrmAgentDeps): Promise<MailHandled> {
  const event = mailRoutedSchema.parse(data);
  const skipped = (reason: string): MailHandled => ({ note: { status: "skipped", reason }, task: { status: "skipped", reason } });
  if (!deps.mail) return skipped("mail_source_unavailable");
  const mail = await deps.mail.get(event.mailMessageId);
  if (!mail) return skipped("mail_not_found");
  const links = await linksFor({ dealId: mail.dealId, leadId: mail.leadId }, deps);

  const decision = noteFromMail(mail, links);
  // The note is built from the model's reading of an untrusted email: carry its taint.
  const taint = taintFromCodes("email", mail.injectionCodes ?? []);
  const base = { dealId: mail.dealId, leadId: mail.leadId, taint } as const;
  const note: WriteOutcome =
    "skip" in decision
      ? { status: "skipped", reason: decision.skip }
      : await deps.writer.submit(decision.op, { task: "email_notes", idempotencyKey: `note:mail:${mail.id}`, ...base, reasonCodes: ["mail_routed", `category:${mail.category}`] });

  const draft = mailTaskDraft(mail);
  const targets = targetsFrom(links);
  const task: WriteOutcome =
    !draft || !targets
      ? { status: "skipped", reason: draft ? "no_crm_record" : "no_task_needed" }
      : await deps.writer.submit(taskOp(draft, { targets, source: { kind: "mail", id: mail.id }, assigneeId: await assigneeFor(links, deps), now: nowOf(deps) }), {
          task: "broker_tasks",
          idempotencyKey: `task:mail:${mail.id}:${draft.key}`,
          ...base,
          reasonCodes: ["mail_routed", draft.key === "suspicious" ? "suspicious_mail" : "needs_advisor"],
        });
  return { note, task };
}

// --- Calls ----------------------------------------------------------------------------------------

export type CallHandled = { note: WriteOutcome; tasks: WriteOutcome[]; summarized: boolean; fallbackReason: string | null };

/** A logged call becomes a CRM note (model summary when allowed) and tasks for the broker's follow-ups. */
export async function handleCallLogged(call: CallRecord, deps: CrmAgentDeps): Promise<CallHandled> {
  const links = await linksFor({ dealId: call.dealId, leadId: call.leadId }, deps);
  const targets = targetsFrom(links);
  if (!targets) {
    const skipped: WriteOutcome = { status: "skipped", reason: "no_crm_record" };
    return { note: skipped, tasks: [], summarized: false, fallbackReason: null };
  }
  const result = await summarizeCall(call, { gateway: deps.gateway });
  await recordInjection(
    deps.events,
    { agent: "crm", agentVersion: CRM_AGENT_SEMVER, task: "call_notes", prompt: result.prompt, dealId: call.dealId, leadId: call.leadId, label: `call ${call.direction}` },
    result.guard,
  );
  const base = { dealId: call.dealId, leadId: call.leadId, taint: result.guard.taint } as const;
  // Prompt id and version come from the agent registry (the prompt the model call actually used).
  const model = { model: result.model, promptVersion: result.summary && result.prompt ? `${result.prompt.id}@${result.prompt.version}` : null } as const;
  const note = await deps.writer.submit(callNoteOp(call, result, targets), {
    task: "call_notes",
    idempotencyKey: `note:call:${call.callId}`,
    ...base,
    ...model,
    reasonCodes: ["call_logged", result.summary ? "model_summary" : `no_summary:${result.fallbackReason ?? "unknown"}`],
    detail: { summarized: Boolean(result.summary) },
  });
  const assigneeId = await assigneeFor(links, deps);
  const tasks: WriteOutcome[] = [];
  for (const draft of callTaskDrafts(call, result)) {
    tasks.push(
      await deps.writer.submit(taskOp({ ...draft }, { targets, source: { kind: "call", id: call.callId.slice(0, 200) }, assigneeId, now: nowOf(deps) }), {
        task: "call_notes",
        idempotencyKey: `task:call:${call.callId}:${draft.key}`,
        ...base,
        ...model,
        reasonCodes: ["call_logged", "call_follow_up"],
      }),
    );
  }
  return { note, tasks, summarized: Boolean(result.summary), fallbackReason: result.fallbackReason };
}

// --- Duplicate companies ---------------------------------------------------------------------------

export type DedupeResult = { scanned: number; clusters: number; proposed: number; pending: number; skipped: number; failed: number; reviewOnly: number; conflicts: number };

/** Approval wait for a merge proposal. Merges are low urgency; an expired or rejected pair is not asked again. */
export const MERGE_APPROVAL_TTL_MINUTES = 14 * 24 * 60;
const PAGE_SIZE = 100;

/** Reads companies and proposes merges for clear duplicates. Every merge waits for a broker. */
export async function runDedupeScan(deps: Pick<CrmAgentDeps, "writer" | "client">, opts: { maxCompanies?: number; maxProposals?: number } = {}): Promise<DedupeResult> {
  const reader = clientForTask(deps.client, "dedupe");
  const max = opts.maxCompanies ?? 2_000;
  const companies: CrmCompany[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof reader.listCompanies>> = await reader.listCompanies({ cursor, limit: PAGE_SIZE });
    companies.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && companies.length < max);

  // First pass finds the clusters; then linked-record counts decide each survivor.
  const first = findDuplicates(companies, () => 0, { maxProposals: opts.maxProposals ?? 25 });
  const involved = [...new Set(first.proposals.flatMap((p) => [p.survivorId, p.duplicateId]))].slice(0, 100);
  const weights = new Map<string, number>();
  for (const id of involved) {
    const r = await reader.companyRelations(id);
    weights.set(id, r.peopleIds.length + r.opportunityIds.length * 3 + r.noteTargetIds.length + r.taskTargetIds.length);
  }
  const scan = involved.length ? findDuplicates(companies, (id) => weights.get(id) ?? 0, { maxProposals: opts.maxProposals ?? 25 }) : first;

  const result: DedupeResult = { scanned: companies.length, clusters: scan.clusters, proposed: 0, pending: 0, skipped: 0, failed: 0, reviewOnly: scan.reviewOnly.length, conflicts: scan.conflicts.length };
  for (const p of scan.proposals) {
    const out = await deps.writer.submit(
      { type: "company_merge", survivorId: p.survivorId, duplicateId: p.duplicateId, score: p.score, reasons: p.reasons },
      { task: "dedupe", idempotencyKey: `merge:${p.survivorId}:${p.duplicateId}`, reasonCodes: ["duplicate_company", ...p.reasons], ttlMinutes: MERGE_APPROVAL_TTL_MINUTES },
    );
    if (out.status === "pending_approval" || out.status === "executed") result.proposed += 1;
    if (out.status === "pending_approval") result.pending += 1;
    else if (out.status === "failed" || out.status === "blocked") result.failed += 1;
    else if (out.status !== "executed") result.skipped += 1;
  }
  return result;
}
