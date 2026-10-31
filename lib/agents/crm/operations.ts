// The five CRM changes an agent may ask for. Each is a plain, validated JSON
// object: it is what the broker sees in the approval queue, what the writer
// executes, and what the event log summarises. Payloads read back from the
// approvals table are re-validated with these schemas before anything runs.

import { z } from "zod";
import type { OperationType } from "./policy";
import { CRM_TASKS, TASK_SCOPES, type CrmScope, type CrmTask } from "./scopes";

export const crmId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "invalid CRM id");

export const targetsSchema = z
  .object({ personId: crmId.optional(), companyId: crmId.optional(), opportunityId: crmId.optional() })
  .strict()
  .refine((t) => Boolean(t.personId || t.companyId || t.opportunityId), "at least one target is required");

/** Where a note or task came from: the log entry that explains it. */
export const sourceSchema = z.object({ kind: z.enum(["mail", "call", "stage", "dedupe", "manual"]), id: z.string().min(1).max(200) }).strict();
export type OperationSource = z.infer<typeof sourceSchema>;

export const TWENTY_STAGE = /^[A-Z][A-Z0-9_]{1,40}$/;

const stageUpdate = z
  .object({
    type: z.literal("stage_update"),
    opportunityId: crmId,
    toStage: z.string().regex(TWENTY_STAGE),
    /** Twenty stage when the change was proposed; the write is skipped if someone changed it since. */
    fromStage: z.string().regex(TWENTY_STAGE).nullable(),
    dealId: z.uuid().nullable(),
    /** Deal-desk stage that triggered it; the write is skipped if the deal moved on since. */
    dealStage: z.string().min(1).max(60).nullable(),
  })
  .strict();

const ownerAssign = z.object({ type: z.literal("owner_assign"), opportunityId: crmId, memberId: crmId.nullable(), dealId: z.uuid().nullable() }).strict();

const noteCreate = z
  .object({
    type: z.literal("note_create"),
    title: z.string().min(1).max(200),
    markdown: z.string().min(1).max(20_000),
    targets: targetsSchema,
    source: sourceSchema,
  })
  .strict();

const taskCreate = z
  .object({
    type: z.literal("task_create"),
    title: z.string().min(1).max(200),
    markdown: z.string().max(4_000),
    dueAt: z.iso.datetime().nullable(),
    assigneeId: crmId.nullable(),
    targets: targetsSchema,
    source: sourceSchema,
  })
  .strict();

const companyMerge = z
  .object({
    type: z.literal("company_merge"),
    survivorId: crmId,
    duplicateId: crmId,
    score: z.number().min(0).max(1),
    reasons: z.array(z.string().max(60)).max(10),
  })
  .strict()
  .refine((m) => m.survivorId !== m.duplicateId, "a company cannot be merged into itself");

export const operationSchema = z.discriminatedUnion("type", [stageUpdate, ownerAssign, noteCreate, taskCreate, companyMerge]);
export type CrmOperation = z.infer<typeof operationSchema>;
export type StageUpdateOp = z.infer<typeof stageUpdate>;
export type NoteCreateOp = z.infer<typeof noteCreate>;
export type TaskCreateOp = z.infer<typeof taskCreate>;
export type CompanyMergeOp = z.infer<typeof companyMerge>;
export type OwnerAssignOp = z.infer<typeof ownerAssign>;

/** What goes in `approvals.payload` for every CRM agent action. */
export const approvalPayloadSchema = z
  .object({
    agent: z.literal("crm"),
    v: z.literal(1),
    task: z.enum(CRM_TASKS),
    operation: operationSchema,
    reasonCodes: z.array(z.string().max(60)).max(20),
    dealId: z.uuid().nullable(),
    leadId: z.uuid().nullable(),
  })
  .strict();
export type CrmApprovalPayload = z.infer<typeof approvalPayloadSchema>;

export const APPROVAL_IDEMPOTENCY_PREFIX = "crm:";

/** Scope an operation needs; a task may only submit operations its profile grants. */
export const OPERATION_SCOPE: Readonly<Record<OperationType, CrmScope>> = {
  stage_update: "crm.opportunity.stage",
  owner_assign: "crm.opportunity.owner",
  note_create: "crm.note.create",
  task_create: "crm.task.create",
  company_merge: "crm.company.merge",
};

export function taskMayRun(task: CrmTask, op: OperationType): boolean {
  return TASK_SCOPES[task].includes(OPERATION_SCOPE[op]);
}

export function targetOf(op: CrmOperation): { object: string; id: string } {
  switch (op.type) {
    case "stage_update":
    case "owner_assign":
      return { object: "opportunity", id: op.opportunityId };
    case "company_merge":
      return { object: "company", id: op.duplicateId };
    case "note_create":
    case "task_create": {
      const t = op.targets;
      if (t.opportunityId) return { object: "opportunity", id: t.opportunityId };
      if (t.companyId) return { object: "company", id: t.companyId };
      return { object: "person", id: t.personId! };
    }
  }
}

/** One line for the broker's approval queue. */
export function describeOperation(op: CrmOperation): string {
  switch (op.type) {
    case "stage_update":
      return `Move the Twenty opportunity from ${op.fromStage ?? "its current stage"} to ${op.toStage}${op.dealStage ? ` (deal stage: ${op.dealStage})` : ""}`;
    case "owner_assign":
      return op.memberId ? "Assign the Twenty opportunity to a new owner" : "Clear the Twenty opportunity owner";
    case "note_create":
      return `Add a Twenty note: ${op.title}`;
    case "task_create":
      return `Create a Twenty task for the broker: ${op.title}`;
    case "company_merge":
      return `Merge duplicate company ${op.duplicateId} into ${op.survivorId} in Twenty (${op.reasons.join(", ") || "similar records"}; the duplicate goes to Twenty's trash)`;
  }
}
