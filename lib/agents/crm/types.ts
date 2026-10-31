// Twenty CRM surface the CRM agents use. The agents never see a raw HTTP
// client: they get a CrmClient through scopedClient (./scopes.ts), which grants
// only the operations a task needs (least privilege), and every write goes
// through the CrmAgentWriter (./writer.ts): policy, approval gate, event log.
//
// Broker only (Global rule 1): nothing here models money. Twenty is the
// advisors' working record of borrowers, deals and partners.

export type CrmOpportunity = {
  id: string;
  name: string;
  /** Twenty stage enum value, e.g. QUALIFICATION or CLOSED_WON. */
  stage: string;
  ownerId: string | null;
  companyId: string | null;
  pointOfContactId: string | null;
};

export type CrmCompany = {
  id: string;
  name: string;
  /** Primary website host without scheme or www, or null. */
  domain: string | null;
  /** One-line address, or null. */
  address: string | null;
  createdAt: string;
  deleted: boolean;
};

export type CrmMember = { id: string; name: string; email: string | null };

/** Records pointing at a company; a merge re-points all of them before the duplicate is removed. */
export type CrmCompanyRelations = {
  peopleIds: string[];
  opportunityIds: string[];
  noteTargetIds: string[];
  taskTargetIds: string[];
};

export type CrmTargets = { personId?: string; companyId?: string; opportunityId?: string };

export type CrmPage<T> = { items: T[]; nextCursor: string | null };

export interface CrmReader {
  getOpportunity(id: string): Promise<CrmOpportunity | null>;
  getCompany(id: string): Promise<CrmCompany | null>;
  listCompanies(page: { cursor?: string | null; limit: number }): Promise<CrmPage<CrmCompany>>;
  companyRelations(companyId: string): Promise<CrmCompanyRelations>;
  listMembers(): Promise<CrmMember[]>;
}

export interface CrmMutations {
  updateOpportunityStage(id: string, stage: string): Promise<void>;
  assignOpportunityOwner(id: string, memberId: string | null): Promise<void>;
  createNote(input: { title: string; markdown: string; targets: CrmTargets }): Promise<{ noteId: string; targetIds: string[] }>;
  createTask(input: { title: string; markdown: string; dueAt: string | null; assigneeId: string | null; targets: CrmTargets }): Promise<{ taskId: string; targetIds: string[] }>;
  setPersonCompany(personId: string, companyId: string): Promise<void>;
  setOpportunityCompany(opportunityId: string, companyId: string): Promise<void>;
  setNoteTargetCompany(noteTargetId: string, companyId: string): Promise<void>;
  setTaskTargetCompany(taskTargetId: string, companyId: string): Promise<void>;
  /** Soft delete: Twenty keeps the record in its trash, so a bad merge is recoverable. */
  softDeleteCompany(id: string): Promise<void>;
}

export type CrmClient = CrmReader & CrmMutations;

export class CrmError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CrmError";
  }
}
