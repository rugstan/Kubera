import { outstandingForBorrower } from "@/lib/checklists/engine";
import type { Condition } from "@/lib/checklists/conditions";
import type { DealChecklistItem } from "@/lib/checklists/types";
import { CLOSING_CADENCE, DOCUMENT_CADENCE, type CadenceConfig } from "./cadence";
import { chase, type ChaseDeps, type ChaseResult } from "./chase";
import { portalUrl } from "./templates";
import type { DealOutreachContext, OutreachSources } from "./sources";

// Checklist-driven reminders for borrowers.
//
// Document reminders follow the deal checklist (WS-U): a borrower-owned,
// required item that is still `requested` or `rejected` (needs a corrected
// copy) is chased. Items that were submitted, are in review, accepted, waived
// or not applicable are never chased, and neither is an item whose upload is
// in flight. Closing nudges cover only what is left before closing: the
// checklist's pre-closing items and the lender's open conditions that the
// borrower owes, once the deal is at commitment or closing. Both stop the
// moment the deal is not active (held, won, lost, withdrawn) or has closed.
// Nothing here concerns money movement or construction draws.

export const CLOSING_STAGES: readonly string[] = ["firm_commitment", "commitment", "sba_authorization", "closing"];
/** Conditions due at the closing table itself are not chased ahead of time. */
const NUDGED_TIMING: readonly Condition["timing"][] = ["prior_to_docs", "prior_to_closing"];

export type ReminderDeps = Omit<ChaseDeps, "now"> & {
  sources: Pick<OutreachSources, "lead">;
  now?: () => Date;
  documentCadence?: CadenceConfig;
  closingCadence?: CadenceConfig;
  /** Round from which a text is added to the email (default 2). */
  smsFromRound?: number;
  portalUrl?: string | null;
};

export type DealChaseResult = ChaseResult & { dealId: string; agent: "document_reminders" | "closing_nudges"; outstanding: number };

const clock = (d: ReminderDeps) => d.now ?? (() => new Date());

/** Since when an item has been waiting on the borrower. */
export function outstandingSince(item: DealChecklistItem): Date {
  return new Date(item.status === "rejected" ? (item.reviewedAt ?? item.updatedAt) : item.createdAt);
}

const isActiveDeal = (ctx: DealOutreachContext) => ctx.deal.status === "active" && !ctx.deal.closedOn && ctx.deal.stage !== "closed";

function chaseableItems(ctx: DealOutreachContext, stage: "pre_closing" | "before_closing"): DealChecklistItem[] {
  return outstandingForBorrower(ctx.items)
    .filter((i) => i.required)
    .filter((i) => (stage === "pre_closing" ? i.stage === "pre_closing" : i.stage !== "pre_closing"))
    .filter((i) => !ctx.uploadsInFlight.has(i.id));
}

function openConditions(ctx: DealOutreachContext): Condition[] {
  return ctx.conditions.filter((c) => c.responsible === "borrower" && (c.status === "open" || c.status === "rejected") && NUDGED_TIMING.includes(c.timing));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function remindDocuments(ctx: DealOutreachContext, deps: ReminderDeps): Promise<DealChaseResult> {
  const now = clock(deps);
  const base = { dealId: ctx.deal.id, agent: "document_reminders" as const };
  const items = isActiveDeal(ctx) ? chaseableItems(ctx, "before_closing") : [];
  const lead = ctx.deal.leadId ? await deps.sources.lead(ctx.deal.leadId) : null;
  const anchor = items.length ? new Date(Math.min(...items.map((i) => outstandingSince(i).getTime()))) : now();
  const cadence = deps.documentCadence ?? DOCUMENT_CADENCE;
  const portal = deps.portalUrl === undefined ? portalUrl() : deps.portalUrl;
  const firstName = lead?.contact.firstName ?? "there";

  const result = await chase(
    {
      agent: "document_reminders",
      kind: "document_reminder",
      keyPrefix: `docrem:${ctx.deal.id}`,
      subjectKey: `docs:${ctx.deal.id}`,
      dealId: ctx.deal.id,
      leadId: ctx.deal.leadId,
      cadence,
      anchor,
      outstanding: items.length,
      recipient: lead ? { audience: "borrower", email: lead.contact.email, phone: lead.contact.phone } : null,
      email: {
        templateId: "document_reminder_email",
        data: (round) => ({
          firstName,
          reminderNumber: round,
          portalUrl: portal,
          items: items.slice(0, 30).map((i) => ({ title: clip(i.title, 200), needsCorrection: i.status === "rejected", note: i.status === "rejected" && i.reviewNote ? clip(i.reviewNote, 300) : null })),
        }),
      },
      sms: { templateId: "document_reminder_sms", fromRound: deps.smsFromRound ?? 2, data: () => ({ count: Math.min(items.length, 50) }) },
      escalation: {
        kind: "documents_overdue",
        title: `Documents still missing on deal ${ctx.deal.id.slice(0, 8)}`,
        lines: [
          `${items.length} required ${items.length === 1 ? "item is" : "items are"} still outstanding after ${cadence.maxRounds} reminders, or the borrower cannot be reached through a channel they agreed to.`,
          "Follow up personally and update the checklist (waive, mark not applicable or request again).",
        ],
      },
      requestedBy: "agent:document_reminders",
    },
    { ...deps, now },
  );
  return { ...result, ...base, outstanding: items.length };
}

export async function nudgeClosing(ctx: DealOutreachContext, deps: ReminderDeps): Promise<DealChaseResult> {
  const now = clock(deps);
  const base = { dealId: ctx.deal.id, agent: "closing_nudges" as const };
  const atClosing = isActiveDeal(ctx) && CLOSING_STAGES.includes(ctx.deal.stage);
  const items = atClosing ? chaseableItems(ctx, "pre_closing") : [];
  const conditions = atClosing ? openConditions(ctx) : [];
  const outstanding = items.length + conditions.length;
  const lead = ctx.deal.leadId ? await deps.sources.lead(ctx.deal.leadId) : null;
  // Closing nudges start when the deal reaches commitment or closing, not when the item was created.
  const anchor = new Date(ctx.deal.stageEnteredAt);
  const cadence = deps.closingCadence ?? CLOSING_CADENCE;
  const portal = deps.portalUrl === undefined ? portalUrl() : deps.portalUrl;
  const lines = [...items.map((i) => clip(i.title, 200)), ...conditions.map((c) => clip(c.source === "lender" ? `Lender condition: ${c.description}` : c.description, 200))].slice(0, 30);

  const result = await chase(
    {
      agent: "closing_nudges",
      kind: "closing_nudge",
      keyPrefix: `closenudge:${ctx.deal.id}`,
      subjectKey: `closing:${ctx.deal.id}`,
      dealId: ctx.deal.id,
      leadId: ctx.deal.leadId,
      cadence,
      anchor,
      outstanding,
      recipient: lead ? { audience: "borrower", email: lead.contact.email, phone: lead.contact.phone } : null,
      email: { templateId: "closing_nudge_email", data: (round) => ({ firstName: lead?.contact.firstName ?? "there", items: lines, portalUrl: portal, reminderNumber: round }) },
      sms: { templateId: "closing_nudge_sms", fromRound: deps.smsFromRound ?? 2, data: () => ({ count: Math.min(outstanding, 50) }) },
      escalation: {
        kind: "closing_items_overdue",
        title: `Closing items still open on deal ${ctx.deal.id.slice(0, 8)}`,
        lines: [`${outstanding} pre-closing ${outstanding === 1 ? "item is" : "items are"} still open after ${cadence.maxRounds} nudges, or the borrower cannot be reached through a channel they agreed to.`, "Follow up personally before the lender, title or escrow are affected."],
      },
      requestedBy: "agent:closing_nudges",
    },
    { ...deps, now },
  );
  return { ...result, ...base, outstanding };
}

