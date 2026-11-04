// In-memory Twenty for tests and for running the agents with no CRM
// configured: records every call, so tests can assert exactly what was (and was
// not) written.

import { CrmError, type CrmClient, type CrmCompany, type CrmCompanyRelations, type CrmMember, type CrmOpportunity, type CrmPage, type CrmTargets } from "./types";

export type FakeNote = { id: string; title: string; markdown: string; targets: CrmTargets };
export type FakeTask = { id: string; title: string; markdown: string; dueAt: string | null; assigneeId: string | null; targets: CrmTargets };
export type FakePerson = { id: string; companyId: string | null };
export type FakeTarget = { id: string; companyId: string | null };

export class FakeCrmClient implements CrmClient {
  readonly opportunities = new Map<string, CrmOpportunity>();
  readonly companies = new Map<string, CrmCompany>();
  readonly people = new Map<string, FakePerson>();
  readonly noteTargets = new Map<string, FakeTarget>();
  readonly taskTargets = new Map<string, FakeTarget>();
  readonly notes: FakeNote[] = [];
  readonly tasks: FakeTask[] = [];
  readonly members: CrmMember[] = [];
  /** Every method call, in order: `${method}`. */
  readonly calls: string[] = [];
  /** Errors thrown by the next calls of a method, in order. */
  private readonly failures = new Map<string, CrmError[]>();
  private n = 0;

  failNext(method: keyof CrmClient, ...errors: CrmError[]): this {
    this.failures.set(method, [...(this.failures.get(method) ?? []), ...errors]);
    return this;
  }

  /** Calls to mutating methods only. */
  get writes(): string[] {
    return this.calls.filter((c) => !/^(get|list|company(Relations))/.test(c));
  }

  private enter(method: string): void {
    this.calls.push(method);
    const queue = this.failures.get(method);
    const err = queue?.shift();
    if (err) throw err;
  }

  private id(prefix: string): string {
    this.n += 1;
    return `${prefix}-${this.n}`;
  }

  addOpportunity(o: Partial<CrmOpportunity> & { id: string }): CrmOpportunity {
    const full: CrmOpportunity = { name: `Opportunity ${o.id}`, stage: "QUALIFICATION", ownerId: null, companyId: null, pointOfContactId: null, ...o };
    this.opportunities.set(full.id, full);
    return full;
  }

  addCompany(c: Partial<CrmCompany> & { id: string; name: string }): CrmCompany {
    const full: CrmCompany = { domain: null, address: null, createdAt: "2026-01-01T00:00:00.000Z", deleted: false, ...c };
    this.companies.set(full.id, full);
    return full;
  }

  addPerson(id: string, companyId: string | null): void {
    this.people.set(id, { id, companyId });
  }

  addNoteTarget(id: string, companyId: string | null): void {
    this.noteTargets.set(id, { id, companyId });
  }

  addTaskTarget(id: string, companyId: string | null): void {
    this.taskTargets.set(id, { id, companyId });
  }

  // --- reads ----------------------------------------------------------------------------------

  async getOpportunity(id: string) {
    this.enter("getOpportunity");
    const o = this.opportunities.get(id);
    return o ? { ...o } : null;
  }

  async getCompany(id: string) {
    this.enter("getCompany");
    const c = this.companies.get(id);
    return c ? { ...c } : null;
  }

  async listCompanies(page: { cursor?: string | null; limit: number }): Promise<CrmPage<CrmCompany>> {
    this.enter("listCompanies");
    const all = [...this.companies.values()].filter((c) => !c.deleted).sort((a, b) => (a.id < b.id ? -1 : 1));
    const start = page.cursor ? Number(page.cursor) : 0;
    const items = all.slice(start, start + page.limit).map((c) => ({ ...c }));
    const next = start + page.limit;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }

  async companyRelations(companyId: string): Promise<CrmCompanyRelations> {
    this.enter("companyRelations");
    const ids = <T extends { id: string; companyId: string | null }>(m: Map<string, T>) => [...m.values()].filter((x) => x.companyId === companyId).map((x) => x.id);
    return { peopleIds: ids(this.people), opportunityIds: ids(this.opportunities as Map<string, { id: string; companyId: string | null }>), noteTargetIds: ids(this.noteTargets), taskTargetIds: ids(this.taskTargets) };
  }

  async listMembers() {
    this.enter("listMembers");
    return this.members.map((m) => ({ ...m }));
  }

  // --- writes ----------------------------------------------------------------------------------

  async updateOpportunityStage(id: string, stage: string) {
    this.enter("updateOpportunityStage");
    const o = this.opportunities.get(id);
    if (!o) throw new CrmError(`opportunity ${id} not found`, 404);
    o.stage = stage;
  }

  async assignOpportunityOwner(id: string, memberId: string | null) {
    this.enter("assignOpportunityOwner");
    const o = this.opportunities.get(id);
    if (!o) throw new CrmError(`opportunity ${id} not found`, 404);
    o.ownerId = memberId;
  }

  async createNote(input: { title: string; markdown: string; targets: CrmTargets }) {
    this.enter("createNote");
    const id = this.id("note");
    this.notes.push({ id, ...input });
    return { noteId: id, targetIds: Object.keys(input.targets).map(() => this.id("note-target")) };
  }

  async createTask(input: { title: string; markdown: string; dueAt: string | null; assigneeId: string | null; targets: CrmTargets }) {
    this.enter("createTask");
    const id = this.id("task");
    this.tasks.push({ id, ...input });
    return { taskId: id, targetIds: Object.keys(input.targets).map(() => this.id("task-target")) };
  }

  async setPersonCompany(personId: string, companyId: string) {
    this.enter("setPersonCompany");
    const p = this.people.get(personId);
    if (!p) throw new CrmError(`person ${personId} not found`, 404);
    p.companyId = companyId;
  }

  async setOpportunityCompany(opportunityId: string, companyId: string) {
    this.enter("setOpportunityCompany");
    const o = this.opportunities.get(opportunityId);
    if (!o) throw new CrmError(`opportunity ${opportunityId} not found`, 404);
    o.companyId = companyId;
  }

  async setNoteTargetCompany(id: string, companyId: string) {
    this.enter("setNoteTargetCompany");
    const t = this.noteTargets.get(id);
    if (!t) throw new CrmError(`note target ${id} not found`, 404);
    t.companyId = companyId;
  }

  async setTaskTargetCompany(id: string, companyId: string) {
    this.enter("setTaskTargetCompany");
    const t = this.taskTargets.get(id);
    if (!t) throw new CrmError(`task target ${id} not found`, 404);
    t.companyId = companyId;
  }

  async softDeleteCompany(id: string) {
    this.enter("softDeleteCompany");
    const c = this.companies.get(id);
    if (!c) throw new CrmError(`company ${id} not found`, 404);
    c.deleted = true;
  }
}
