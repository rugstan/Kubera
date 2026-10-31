// OpenSanctions matching API client (https://api.opensanctions.org). The
// default `sanctions` collection includes the OFAC SDN and consolidated
// (non-SDN) lists alongside UN, EU and UK lists. Configure with
//   OPENSANCTIONS_API_KEY   API key (required; without it screening is unavailable)
//   OPENSANCTIONS_DATASET   collection to match against (default "sanctions")
//   OPENSANCTIONS_API_URL   base URL override (default https://api.opensanctions.org)
//
// Only the name, birth date and countries leave Kubera. The list version
// comes from the catalog so every screening records exactly what it was
// checked against.

import { ScreeningUnavailableError, type SanctionsClient, type ScreeningMatch, type ScreeningResponse, type ScreeningSubject } from "./types";

type FetchLike = typeof fetch;

type MatchResult = {
  id?: string;
  caption?: string;
  schema?: string;
  score?: number;
  match?: boolean;
  datasets?: string[];
  properties?: Record<string, unknown>;
};

type CatalogDataset = { name?: string; version?: string; last_change?: string; updated_at?: string; last_export?: string; children?: string[]; sources?: string[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export type OpenSanctionsOptions = {
  apiKey: string;
  dataset?: string;
  baseUrl?: string;
  /** Results below this score are not returned by the API. */
  threshold?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

export class OpenSanctionsClient implements SanctionsClient {
  readonly name = "opensanctions";
  private readonly dataset: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private catalog: { at: number; dataset: CatalogDataset | null } | null = null;

  constructor(private readonly opts: OpenSanctionsOptions) {
    if (!opts.apiKey) throw new ScreeningUnavailableError("OPENSANCTIONS_API_KEY is not configured");
    this.dataset = opts.dataset || "sanctions";
    this.baseUrl = (opts.baseUrl || "https://api.opensanctions.org").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return { authorization: `ApiKey ${this.opts.apiKey}`, accept: "application/json" };
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000) });
    } catch (err) {
      throw new ScreeningUnavailableError(`Sanctions provider unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new ScreeningUnavailableError(`Sanctions provider returned HTTP ${res.status}`);
    return res.json();
  }

  /** Dataset metadata from the catalog, cached for an hour. */
  private async datasetInfo(): Promise<CatalogDataset | null> {
    const now = Date.now();
    if (this.catalog && now - this.catalog.at < 3_600_000) return this.catalog.dataset;
    try {
      const body = (await this.request("/catalog")) as { datasets?: CatalogDataset[] };
      const dataset = (body.datasets ?? []).find((d) => d.name === this.dataset) ?? null;
      this.catalog = { at: now, dataset };
      return dataset;
    } catch {
      return null;
    }
  }

  async screen(subject: ScreeningSubject): Promise<ScreeningResponse> {
    const properties: Record<string, string[]> = { name: [subject.name] };
    if (subject.kind === "individual" && subject.dateOfBirth) properties.birthDate = [subject.dateOfBirth];
    if (subject.countries?.length) properties[subject.kind === "individual" ? "nationality" : "jurisdiction"] = [...subject.countries];
    const params = new URLSearchParams({ threshold: String(this.opts.threshold ?? 0.5), limit: "10" });
    const body = (await this.request(`/match/${encodeURIComponent(this.dataset)}?${params}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: { q: { schema: subject.kind === "individual" ? "Person" : "LegalEntity", properties } } }),
    })) as { responses?: Record<string, { status?: number; results?: MatchResult[] }> };

    const response = body.responses?.q;
    if (!response || (response.status !== undefined && response.status !== 200)) throw new ScreeningUnavailableError("Sanctions provider returned no result for the query");

    const matches: ScreeningMatch[] = (response.results ?? []).map((r) => {
      const props = r.properties ?? {};
      return {
        entryId: r.id ?? "unknown",
        name: r.caption ?? strings(props.name)[0] ?? "unknown",
        score: typeof r.score === "number" ? Math.max(0, Math.min(1, r.score)) : 0,
        lists: r.datasets ?? [],
        programs: [...strings(props.program), ...strings(props.programId), ...strings(props.topics)],
        birthDates: strings(props.birthDate),
        countries: [...strings(props.nationality), ...strings(props.country), ...strings(props.jurisdiction)],
        providerMatch: typeof r.match === "boolean" ? r.match : null,
      };
    });

    const screenedAt = (this.opts.now?.() ?? new Date()).toISOString();
    const info = await this.datasetInfo();
    const version = info?.version ?? info?.last_export ?? info?.last_change ?? info?.updated_at;
    return {
      provider: this.name,
      // Without catalog metadata, record the collection and screening date so the row still says what was checked.
      listVersion: version ? `${this.dataset}@${version}` : `${this.dataset}@unversioned:${screenedAt.slice(0, 10)}`,
      listsChecked: [this.dataset, ...(info?.children ?? info?.sources ?? [])].slice(0, 50),
      matches: matches.sort((a, b) => b.score - a.score),
      screenedAt,
    };
  }
}
