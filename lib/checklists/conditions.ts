// Conditions tracker: the lender of record's approval conditions (and
// Corin's or counsel's own) between term sheet and closing. Open conditions
// due before documents or closing block closing readiness. Only the party that
// imposed a condition can waive it, so a lender condition is waived only with
// the lender's written waiver on record.

import { z } from "zod";

export const CONDITION_SOURCES = ["lender", "corin", "counsel", "title", "hud", "sba", "cdc"] as const;
export type ConditionSource = (typeof CONDITION_SOURCES)[number];

export const CONDITION_TIMING = ["prior_to_approval", "prior_to_docs", "prior_to_closing", "at_closing", "post_closing"] as const;
export type ConditionTiming = (typeof CONDITION_TIMING)[number];

export const TIMING_LABEL: Record<ConditionTiming, string> = {
  prior_to_approval: "Prior to approval",
  prior_to_docs: "Prior to documents",
  prior_to_closing: "Prior to closing",
  at_closing: "At closing",
  post_closing: "Post-closing (lender's)",
};

export const CONDITION_STATUSES = ["open", "submitted", "cleared", "waived", "rejected"] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export type Condition = {
  id: string;
  dealId: string;
  source: ConditionSource;
  /** Lender of record that imposed the condition (source = lender). */
  lenderName: string | null;
  timing: ConditionTiming;
  description: string;
  status: ConditionStatus;
  responsible: "borrower" | "corin" | "lender" | "vendor" | "title_escrow";
  dueDate: string | null;
  checklistItemId: string | null;
  notes: string | null;
  clearedBy: string | null;
  clearedAt: string | null;
  waiverReason: string | null;
  /** Reference to the written waiver from the imposing party. */
  waiverEvidence: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const newConditionSchema = z
  .object({
    dealId: z.uuid(),
    source: z.enum(CONDITION_SOURCES),
    lenderName: z.string().trim().min(2).max(200).nullable().optional(),
    timing: z.enum(CONDITION_TIMING),
    description: z.string().trim().min(5).max(2000),
    responsible: z.enum(["borrower", "corin", "lender", "vendor", "title_escrow"]),
    dueDate: z.iso.date().nullable().optional(),
    checklistItemId: z.uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((c) => c.source !== "lender" || Boolean(c.lenderName), { path: ["lenderName"], message: "Name the lender of record that set this condition." });
export type NewCondition = z.input<typeof newConditionSchema>;

export class ConditionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionTransitionError";
  }
}

/** Status changes allowed from each status (the desk offers exactly these). */
export const CONDITION_MOVES: Record<ConditionStatus, readonly ConditionStatus[]> = {
  open: ["submitted", "cleared", "waived"],
  submitted: ["cleared", "rejected", "waived", "open"],
  rejected: ["submitted", "open", "waived"],
  cleared: ["open"],
  waived: ["open"],
};

export type ConditionPatch = Partial<Pick<Condition, "status" | "clearedBy" | "clearedAt" | "waiverReason" | "waiverEvidence" | "notes">>;

export function transitionCondition(c: Condition, input: { to: ConditionStatus; staffId: string; note?: string | null; waiverEvidence?: string | null; now: Date }): ConditionPatch {
  if (!CONDITION_MOVES[c.status].includes(input.to)) throw new ConditionTransitionError(`Cannot move a condition from ${c.status} to ${input.to}.`);
  const at = input.now.toISOString();
  const note = input.note?.trim() || null;
  switch (input.to) {
    case "cleared":
      return { status: "cleared", clearedBy: input.staffId, clearedAt: at, ...(note ? { notes: note } : {}) };
    case "waived": {
      if (!note || note.length < 5) throw new ConditionTransitionError("Give the reason for the waiver.");
      const evidence = input.waiverEvidence?.trim() || null;
      // Corin cannot waive a condition someone else imposed; it needs that party's written waiver.
      if (c.source !== "corin" && !evidence) throw new ConditionTransitionError(`A ${c.source} condition needs the ${c.source === "lender" ? "lender of record's" : c.source} written waiver (reference the email or letter).`);
      return { status: "waived", clearedBy: input.staffId, clearedAt: at, waiverReason: note, waiverEvidence: evidence };
    }
    case "rejected":
      if (!note) throw new ConditionTransitionError("Say why the submission did not satisfy the condition.");
      return { status: "rejected", notes: note };
    case "open":
      return { status: "open", clearedBy: null, clearedAt: null, waiverReason: null, waiverEvidence: null, ...(note ? { notes: note } : {}) };
    case "submitted":
      return { status: "submitted", ...(note ? { notes: note } : {}) };
  }
}

const CLOSING_TIMINGS: readonly ConditionTiming[] = ["prior_to_approval", "prior_to_docs", "prior_to_closing", "at_closing"];
const DONE: readonly ConditionStatus[] = ["cleared", "waived"];

/** Conditions that must be cleared or waived before closing. Post-closing conditions are the lender's to track. */
export function conditionsBlockingClosing(conditions: readonly Condition[]): Condition[] {
  return conditions.filter((c) => CLOSING_TIMINGS.includes(c.timing) && !DONE.includes(c.status));
}

/** Conditions past their due date and not done. */
export function overdueConditions(conditions: readonly Condition[], now: Date): Condition[] {
  const today = now.toISOString().slice(0, 10);
  return conditions.filter((c) => c.dueDate && c.dueDate < today && !DONE.includes(c.status));
}
