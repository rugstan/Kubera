// Twenty REST implementation of CrmClient for the CRM agents. Field names
// follow the same workspace metadata as lib/crm/twenty.ts (note targets via
// targetPersonId / targetCompanyId / targetOpportunityId, bodyV2.markdown).
//
// VERIFY against the live workspace: `ownerId` on opportunities (the owner
// relation to a workspace member), `dueAt` / `assigneeId` / `status` on tasks,
// and `deletedAt` on soft-deleted companies.
//
// Use a dedicated Twenty API key (TWENTY_AGENT_API_KEY) whose role is limited
// to the objects below; the scopes in ./scopes.ts then narrow it further per
// task. Falls back to TWENTY_API_KEY, with a one-time warning.

import {
  CrmError,
  type CrmClient,
  type CrmCompany,
  type CrmCompanyRelations,
  type CrmMember,
  type CrmOpportunity,
  type CrmPage,
  type CrmTargets,
} from "./types";
import { crmId } from "./operations";

type Json = Record<string, unknown>;

export type TwentyAgentConfig = { baseUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number };

let warnedSharedKey = false;
let warnedMissing = false;

/** Config from env, or null (logged once) when Twenty is not configured. */
export function twentyAgentConfigFromEnv(env: Record<string, string | undefined> = process.env): TwentyAgentConfig | null {
  const baseUrl = env.TWENTY_API_URL?.trim().replace(/\/$/, "");
  const dedicated = env.TWENTY_AGENT_API_KEY?.trim();
  const apiKey = dedicated || env.TWENTY_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.info("[crm-agent] Twenty is not configured (TWENTY_API_URL / TWENTY_AGENT_API_KEY); the CRM agents are off.");
    }
    return null;
  }
  if (!dedicated && !warnedSharedKey) {
    warnedSharedKey = true;
    console.warn("[crm-agent] TWENTY_AGENT_API_KEY is not set; using TWENTY_API_KEY. Give the agents their own least-privilege key.");
  }
  return { baseUrl, apiKey };
}

const PAGE = 60;
const MAX_PAGES = 50;

export class TwentyCrmClient implements CrmClient {
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: TwentyAgentConfig) {
    this.doFetch = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 8_000;
  }

  private async call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: Json): Promise<Json> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.config.baseUrl}/rest/${path}`, {
        method,
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      // A timeout or reset may have reached Twenty: never retried automatically.
      throw new CrmError(`Twenty ${method} /${path}: ${err instanceof Error ? err.message : "network error"}`, null, false);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CrmError(`Twenty ${method} /${path}: ${res.status} ${text.slice(0, 200)}`, res.status, res.status === 429 || res.status === 503);
    }
    if (res.status === 204) return {};
    return (await res.json().catch(() => ({}))) as Json;
  }

  private async list(object: string, params: string): Promise<{ rows: Json[]; next: string | null }> {
    const res = await this.call("GET", `${object}?${params}`);
    const data = (res.data ?? {}) as Json;
    const rows = Object.values(data).find(Array.isArray) as Json[] | undefined;
    const info = (res.pageInfo ?? {}) as { hasNextPage?: boolean; endCursor?: string | null };
    return { rows: rows ?? [], next: info.hasNextPage && info.endCursor ? info.endCursor : null };
  }

  private async listAll(object: string, filter: string): Promise<Json[]> {
    const out: Json[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page: { rows: Json[]; next: string | null } = await this.list(object, `filter=${encodeURIComponent(filter)}&limit=${PAGE}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`);
      out.push(...page.rows);
      if (!page.next) return out;
      cursor = page.next;
    }
    throw new CrmError(`Twenty ${object}: more than ${MAX_PAGES * PAGE} records match; refusing to continue`);
  }

  private async created(object: string, body: Json): Promise<string> {
    const res = await this.call("POST", object, body);
    const record = Object.values((res.data ?? {}) as Json)[0] as Json | undefined;
    const id = record && !Array.isArray(record) ? (record.id as string | undefined) : undefined;
    if (!id) throw new CrmError(`Twenty create ${object}: no id in response`);
    return id;
  }

  // --- reads ----------------------------------------------------------------------------------

  async getOpportunity(id: string): Promise<CrmOpportunity | null> {
    const row = await this.getOne("opportunities", id);
    if (!row) return null;
    return {
      id: String(row.id),
      name: typeof row.name === "string" ? row.name : "",
      stage: typeof row.stage === "string" ? row.stage : "",
      ownerId: strOrNull(row.ownerId),
      companyId: strOrNull(row.companyId),
      pointOfContactId: strOrNull(row.pointOfContactId),
    };
  }

  async getCompany(id: string): Promise<CrmCompany | null> {
    const row = await this.getOne("companies", id);
    return row ? toCompany(row) : null;
  }

  async listCompanies(page: { cursor?: string | null; limit: number }): Promise<CrmPage<CrmCompany>> {
    const limit = Math.min(Math.max(1, Math.floor(page.limit)), 200);
    const { rows, next } = await this.list("companies", `limit=${limit}${page.cursor ? `&starting_after=${encodeURIComponent(page.cursor)}` : ""}`);
    return { items: rows.map(toCompany), nextCursor: next };
  }

  async companyRelations(companyId: string): Promise<CrmCompanyRelations> {
    const id = this.id(companyId);
    const by = (field: string) => `${field}[eq]:"${id}"`;
    const [people, opportunities, noteTargets, taskTargets] = await Promise.all([
      this.listAll("people", by("companyId")),
      this.listAll("opportunities", by("companyId")),
      this.listAll("noteTargets", by("targetCompanyId")),
      this.listAll("taskTargets", by("targetCompanyId")),
    ]);
    const ids = (rows: Json[]) => rows.map((r) => String(r.id));
    return { peopleIds: ids(people), opportunityIds: ids(opportunities), noteTargetIds: ids(noteTargets), taskTargetIds: ids(taskTargets) };
  }

  async listMembers(): Promise<CrmMember[]> {
    const { rows } = await this.list("workspaceMembers", `limit=${PAGE}`);
    return rows.map((r) => {
      const name = (r.name ?? {}) as { firstName?: string; lastName?: string };
      return { id: String(r.id), name: [name.firstName, name.lastName].filter(Boolean).join(" "), email: strOrNull(r.userEmail) };
    });
  }

  private async getOne(object: string, id: string): Promise<Json | null> {
    try {
      const res = await this.call("GET", `${object}/${encodeURIComponent(this.id(id))}`);
      const record = Object.values((res.data ?? {}) as Json)[0] as Json | undefined;
      return record && !Array.isArray(record) && record.id ? record : null;
    } catch (err) {
      if (err instanceof CrmError && err.status === 404) return null;
      throw err;
    }
  }

  // --- writes ----------------------------------------------------------------------------------

  async updateOpportunityStage(id: string, stage: string): Promise<void> {
    await this.call("PATCH", `opportunities/${encodeURIComponent(this.id(id))}`, { stage });
  }

  async assignOpportunityOwner(id: string, memberId: string | null): Promise<void> {
    await this.call("PATCH", `opportunities/${encodeURIComponent(this.id(id))}`, { ownerId: memberId === null ? null : this.id(memberId) });
  }

  async createNote(input: { title: string; markdown: string; targets: CrmTargets }) {
    const noteId = await this.created("notes", { position: "first", title: input.title, bodyV2: { markdown: input.markdown } });
    const targetIds: string[] = [];
    for (const fields of targetFields(input.targets, (v) => this.id(v))) targetIds.push(await this.created("noteTargets", { noteId, ...fields }));
    return { noteId, targetIds };
  }

  async createTask(input: { title: string; markdown: string; dueAt: string | null; assigneeId: string | null; targets: CrmTargets }) {
    const taskId = await this.created("tasks", {
      position: "first",
      title: input.title,
      bodyV2: { markdown: input.markdown },
      status: "TODO",
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.assigneeId ? { assigneeId: this.id(input.assigneeId) } : {}),
    });
    const targetIds: string[] = [];
    for (const fields of targetFields(input.targets, (v) => this.id(v))) targetIds.push(await this.created("taskTargets", { taskId, ...fields }));
    return { taskId, targetIds };
  }

  async setPersonCompany(personId: string, companyId: string): Promise<void> {
    await this.call("PATCH", `people/${encodeURIComponent(this.id(personId))}`, { companyId: this.id(companyId) });
  }

  async setOpportunityCompany(opportunityId: string, companyId: string): Promise<void> {
    await this.call("PATCH", `opportunities/${encodeURIComponent(this.id(opportunityId))}`, { companyId: this.id(companyId) });
  }

  async setNoteTargetCompany(id: string, companyId: string): Promise<void> {
    await this.call("PATCH", `noteTargets/${encodeURIComponent(this.id(id))}`, { targetCompanyId: this.id(companyId) });
  }

  async setTaskTargetCompany(id: string, companyId: string): Promise<void> {
    await this.call("PATCH", `taskTargets/${encodeURIComponent(this.id(id))}`, { targetCompanyId: this.id(companyId) });
  }

  async softDeleteCompany(id: string): Promise<void> {
    await this.call("DELETE", `companies/${encodeURIComponent(this.id(id))}`);
  }

  /** Ids go into URLs and filters: only the Twenty id alphabet is accepted. */
  private id(value: string): string {
    const parsed = crmId.safeParse(value);
    if (!parsed.success) throw new CrmError(`Refusing to use "${value.slice(0, 40)}" as a Twenty id`);
    return parsed.data;
  }
}

/** One note/task target record per linked CRM record. */
function targetFields(t: CrmTargets, id: (v: string) => string): Json[] {
  const out: Json[] = [];
  if (t.opportunityId) out.push({ targetOpportunityId: id(t.opportunityId) });
  if (t.personId) out.push({ targetPersonId: id(t.personId) });
  if (t.companyId) out.push({ targetCompanyId: id(t.companyId) });
  return out;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Host of a website URL, lower case, without www. */
export function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function toCompany(row: Json): CrmCompany {
  const domain = (row.domainName ?? {}) as { primaryLinkUrl?: string };
  const a = (row.address ?? {}) as { addressStreet1?: string; addressCity?: string; addressState?: string; addressPostcode?: string };
  const address = [a.addressStreet1, a.addressCity, a.addressState, a.addressPostcode].filter(Boolean).join(", ");
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    domain: hostOf(domain.primaryLinkUrl),
    address: address || null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    deleted: Boolean(row.deletedAt),
  };
}
