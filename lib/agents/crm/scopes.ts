// Least-privilege tool scopes for the CRM agents. Each agent task gets a
// profile listing the scopes it needs; scopedClient hands it a client in which
// every other operation throws ScopeDeniedError before any request is made.
// Nothing here can delete a person or an opportunity, edit contact details or
// opt-out flags (the consent ledger owns smsOptOut), or touch any object other
// than the ones listed.

import type { CrmClient } from "./types";

export const CRM_SCOPES = ["crm.read", "crm.opportunity.stage", "crm.opportunity.owner", "crm.note.create", "crm.task.create", "crm.company.merge"] as const;
export type CrmScope = (typeof CRM_SCOPES)[number];

export const CRM_TASKS = ["stage_sync", "email_notes", "call_notes", "broker_tasks", "dedupe", "owner_assignment"] as const;
export type CrmTask = (typeof CRM_TASKS)[number];

/** What each agent task may do. Reads are always granted so a task can check before it writes. */
export const TASK_SCOPES: Readonly<Record<CrmTask, readonly CrmScope[]>> = {
  stage_sync: ["crm.read", "crm.opportunity.stage"],
  email_notes: ["crm.read", "crm.note.create"],
  call_notes: ["crm.read", "crm.note.create", "crm.task.create"],
  broker_tasks: ["crm.read", "crm.task.create"],
  dedupe: ["crm.read", "crm.company.merge"],
  owner_assignment: ["crm.read", "crm.opportunity.owner"],
};

/** The scope each CrmClient method requires. */
export const METHOD_SCOPE: Readonly<Record<keyof CrmClient, CrmScope>> = {
  getOpportunity: "crm.read",
  getCompany: "crm.read",
  listCompanies: "crm.read",
  companyRelations: "crm.read",
  listMembers: "crm.read",
  updateOpportunityStage: "crm.opportunity.stage",
  assignOpportunityOwner: "crm.opportunity.owner",
  createNote: "crm.note.create",
  createTask: "crm.task.create",
  setPersonCompany: "crm.company.merge",
  setOpportunityCompany: "crm.company.merge",
  setNoteTargetCompany: "crm.company.merge",
  setTaskTargetCompany: "crm.company.merge",
  softDeleteCompany: "crm.company.merge",
};

export class ScopeDeniedError extends Error {
  constructor(
    readonly method: string,
    readonly required: CrmScope,
  ) {
    super(`CRM agent scope "${required}" is required for ${method}`);
    this.name = "ScopeDeniedError";
  }
}

export function scopedClient(client: CrmClient, scopes: readonly CrmScope[]): CrmClient {
  const granted = new Set<CrmScope>(scopes);
  const out: Record<string, unknown> = {};
  for (const method of Object.keys(METHOD_SCOPE) as (keyof CrmClient)[]) {
    const required = METHOD_SCOPE[method];
    out[method] = (...args: unknown[]) => {
      if (!granted.has(required)) return Promise.reject(new ScopeDeniedError(method, required));
      return (client[method] as (...a: unknown[]) => unknown)(...args);
    };
  }
  return out as unknown as CrmClient;
}

export function clientForTask(client: CrmClient, task: CrmTask): CrmClient {
  return scopedClient(client, TASK_SCOPES[task]);
}
