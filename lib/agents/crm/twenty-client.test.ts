import { describe, expect, it } from "vitest";
import { TwentyCrmClient, hostOf, twentyAgentConfigFromEnv } from "./twenty-client";
import { CrmError } from "./types";

type Call = { method: string; url: string; body: unknown; auth: string | null };

function client(handler: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body as string) : undefined, auth: new Headers(init.headers).get("authorization") };
    calls.push(call);
    const r = handler(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, crm: new TwentyCrmClient({ baseUrl: "https://crm.example.com", apiKey: "agent-key", fetch: fetchFn }) };
}

describe("TwentyCrmClient reads", () => {
  it("reads an opportunity and returns null for a 404", async () => {
    const { crm, calls } = client((c) => (c.url.endsWith("/opportunities/opp-1") ? { json: { data: { opportunity: { id: "opp-1", name: "Oak", stage: "PROPOSAL", ownerId: "m1", companyId: null } } } } : { status: 404, json: {} }));
    expect(await crm.getOpportunity("opp-1")).toEqual({ id: "opp-1", name: "Oak", stage: "PROPOSAL", ownerId: "m1", companyId: null, pointOfContactId: null });
    expect(await crm.getOpportunity("missing")).toBeNull();
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://crm.example.com/rest/opportunities/opp-1", auth: "Bearer agent-key" });
  });

  it("maps companies, hosts and soft-deleted state", async () => {
    const { crm } = client(() => ({
      json: {
        data: { companies: [{ id: "c1", name: "Acme", domainName: { primaryLinkUrl: "https://www.Acme.com/about" }, address: { addressStreet1: "1 Main St", addressCity: "Fresno", addressState: "CA" }, createdAt: "2026-01-01T00:00:00Z", deletedAt: null }] },
        pageInfo: { hasNextPage: true, endCursor: "cur-2" },
      },
    }));
    const page = await crm.listCompanies({ limit: 50 });
    expect(page.nextCursor).toBe("cur-2");
    expect(page.items[0]).toEqual({ id: "c1", name: "Acme", domain: "acme.com", address: "1 Main St, Fresno, CA", createdAt: "2026-01-01T00:00:00Z", deleted: false });
    expect(hostOf("acme.com/x")).toBe("acme.com");
    expect(hostOf("")).toBeNull();
  });

  it("collects every record that points at a company, across pages", async () => {
    const { crm, calls } = client((c) => {
      const url = new URL(c.url);
      const object = url.pathname.split("/").pop()!;
      const first = !url.searchParams.has("starting_after");
      if (object === "people") return { json: { data: { people: first ? [{ id: "p1" }] : [{ id: "p2" }] }, pageInfo: { hasNextPage: first, endCursor: first ? "x" : null } } };
      if (object === "opportunities") return { json: { data: { opportunities: [{ id: "o1" }] }, pageInfo: { hasNextPage: false } } };
      return { json: { data: { [object]: [] }, pageInfo: { hasNextPage: false } } };
    });
    expect(await crm.companyRelations("c-1")).toEqual({ peopleIds: ["p1", "p2"], opportunityIds: ["o1"], noteTargetIds: [], taskTargetIds: [] });
    const filters = calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("filter") ?? ""));
    expect(filters).toContain('companyId[eq]:"c-1"');
    expect(filters).toContain('targetCompanyId[eq]:"c-1"');
  });
});

describe("TwentyCrmClient writes", () => {
  it("patches only the field it was asked to change", async () => {
    const { crm, calls } = client(() => ({ json: { data: {} } }));
    await crm.updateOpportunityStage("opp-1", "NEGOTIATION");
    await crm.assignOpportunityOwner("opp-1", null);
    await crm.setPersonCompany("p1", "c1");
    await crm.softDeleteCompany("c2");
    expect(calls.map((c) => [c.method, new URL(c.url).pathname, c.body])).toEqual([
      ["PATCH", "/rest/opportunities/opp-1", { stage: "NEGOTIATION" }],
      ["PATCH", "/rest/opportunities/opp-1", { ownerId: null }],
      ["PATCH", "/rest/people/p1", { companyId: "c1" }],
      ["DELETE", "/rest/companies/c2", undefined],
    ]);
  });

  it("creates a note with one target record per linked record", async () => {
    let n = 0;
    const { crm, calls } = client(() => ({ json: { data: { createX: { id: `id-${++n}` } } } }));
    const out = await crm.createNote({ title: "T", markdown: "M", targets: { opportunityId: "opp-1", personId: "p1" } });
    expect(out).toEqual({ noteId: "id-1", targetIds: ["id-2", "id-3"] });
    expect(calls[0]!.body).toEqual({ position: "first", title: "T", bodyV2: { markdown: "M" } });
    expect(calls[1]).toMatchObject({ url: "https://crm.example.com/rest/noteTargets", body: { noteId: "id-1", targetOpportunityId: "opp-1" } });
    expect(calls[2]!.body).toEqual({ noteId: "id-1", targetPersonId: "p1" });
  });

  it("creates a task with an assignee and due date", async () => {
    let n = 0;
    const { crm, calls } = client(() => ({ json: { data: { createX: { id: `id-${++n}` } } } }));
    await crm.createTask({ title: "T", markdown: "M", dueAt: "2026-11-05T00:00:00.000Z", assigneeId: "m1", targets: { companyId: "c1" } });
    expect(calls[0]!.body).toEqual({ position: "first", title: "T", bodyV2: { markdown: "M" }, status: "TODO", dueAt: "2026-11-05T00:00:00.000Z", assigneeId: "m1" });
    expect(calls[1]!.body).toEqual({ taskId: "id-1", targetCompanyId: "c1" });
  });

  it("refuses ids that could change the request path or filter", async () => {
    const { crm, calls } = client(() => ({ json: { data: {} } }));
    await expect(crm.updateOpportunityStage("../people/1", "X_Y")).rejects.toThrow(/Refusing/);
    await expect(crm.companyRelations('c1"] or [x')).rejects.toThrow(/Refusing/);
    expect(calls).toEqual([]);
  });

  it("flags only refused requests (429/503) as safe to retry; timeouts and 5xx may have created a record", async () => {
    const status = (s: number) => client(() => ({ status: s, json: { error: "x" } })).crm.updateOpportunityStage("o1", "AB");
    await expect(status(503)).rejects.toMatchObject({ retryable: true, status: 503 });
    await expect(status(429)).rejects.toMatchObject({ retryable: true });
    await expect(status(500)).rejects.toMatchObject({ retryable: false });
    await expect(status(400)).rejects.toMatchObject({ retryable: false });
    const down = new TwentyCrmClient({ baseUrl: "https://crm.example.com", apiKey: "k", fetch: (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch });
    const err = await down.updateOpportunityStage("o1", "AB").catch((e) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect(err).toMatchObject({ retryable: false, status: null });
  });
});

describe("config from env", () => {
  it("prefers the dedicated agent key and is null without Twenty", () => {
    expect(twentyAgentConfigFromEnv({ TWENTY_API_URL: "https://crm.example.com/", TWENTY_AGENT_API_KEY: "a", TWENTY_API_KEY: "b" })).toEqual({ baseUrl: "https://crm.example.com", apiKey: "a" });
    expect(twentyAgentConfigFromEnv({ TWENTY_API_URL: "https://crm.example.com", TWENTY_API_KEY: "b" })?.apiKey).toBe("b");
    expect(twentyAgentConfigFromEnv({})).toBeNull();
  });
});
