import { describe, expect, it } from "vitest";
import { FakeCrmClient } from "./fake-client";
import { CRM_SCOPES, CRM_TASKS, METHOD_SCOPE, ScopeDeniedError, TASK_SCOPES, clientForTask, scopedClient } from "./scopes";
import { OPERATION_SCOPE, taskMayRun } from "./operations";

describe("tool scopes", () => {
  it("assigns a scope to every client method, and the fake implements exactly those methods", () => {
    const proto = Object.getOwnPropertyNames(FakeCrmClient.prototype).filter((m) => m !== "constructor" && !["failNext", "addOpportunity", "addCompany", "addPerson", "addNoteTarget", "addTaskTarget", "writes", "enter", "id"].includes(m));
    expect(proto.sort()).toEqual(Object.keys(METHOD_SCOPE).sort());
    for (const scope of Object.values(METHOD_SCOPE)) expect(CRM_SCOPES).toContain(scope);
  });

  it("every task can read and has a minimal write scope set", () => {
    for (const task of CRM_TASKS) {
      expect(TASK_SCOPES[task]).toContain("crm.read");
      expect(TASK_SCOPES[task].filter((s) => s !== "crm.read").length).toBeLessThanOrEqual(2);
    }
    // Only the dedupe task can touch companies; only stage_sync moves stages; only owner_assignment assigns owners.
    const holders = (scope: string) => CRM_TASKS.filter((t) => (TASK_SCOPES[t] as readonly string[]).includes(scope));
    expect(holders("crm.company.merge")).toEqual(["dedupe"]);
    expect(holders("crm.opportunity.stage")).toEqual(["stage_sync"]);
    expect(holders("crm.opportunity.owner")).toEqual(["owner_assignment"]);
  });

  it("a scoped client rejects everything outside its scopes without calling the CRM", async () => {
    const crm = new FakeCrmClient();
    crm.addOpportunity({ id: "o1" });
    const notes = clientForTask(crm, "email_notes");
    await expect(notes.updateOpportunityStage("o1", "CLOSED_WON")).rejects.toBeInstanceOf(ScopeDeniedError);
    await expect(notes.softDeleteCompany("c1")).rejects.toMatchObject({ required: "crm.company.merge" });
    await expect(notes.assignOpportunityOwner("o1", "m1")).rejects.toBeInstanceOf(ScopeDeniedError);
    await expect(notes.createTask({ title: "t", markdown: "", dueAt: null, assigneeId: null, targets: { opportunityId: "o1" } })).rejects.toBeInstanceOf(ScopeDeniedError);
    expect(crm.calls).toEqual([]);
    await expect(notes.getOpportunity("o1")).resolves.toMatchObject({ id: "o1" });
    await expect(notes.createNote({ title: "n", markdown: "m", targets: { opportunityId: "o1" } })).resolves.toMatchObject({ noteId: expect.any(String) });
  });

  it("scopedClient with no scopes is inert", async () => {
    const crm = new FakeCrmClient();
    const none = scopedClient(crm, []);
    await expect(none.getCompany("c1")).rejects.toBeInstanceOf(ScopeDeniedError);
  });

  it("each operation type is runnable only by the tasks whose profile grants its scope", () => {
    expect(taskMayRun("stage_sync", "stage_update")).toBe(true);
    expect(taskMayRun("email_notes", "stage_update")).toBe(false);
    expect(taskMayRun("email_notes", "note_create")).toBe(true);
    expect(taskMayRun("email_notes", "task_create")).toBe(false);
    expect(taskMayRun("call_notes", "task_create")).toBe(true);
    expect(taskMayRun("dedupe", "company_merge")).toBe(true);
    expect(taskMayRun("stage_sync", "company_merge")).toBe(false);
    expect(Object.keys(OPERATION_SCOPE)).toHaveLength(5);
  });
});
