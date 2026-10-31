import { asArray, asRecord, firstStr, getJson, isoDate, outcomeFromFailure, stripUndefined, type FetchLike } from "./http";
import { notFound, ok, type EntityClient, type EntityRecord, type SourceOutcome } from "./types";

// OpenCorporates REST API v0.4 company search. VERIFY the plan's rate limits
// and whether the account may cache results (their terms limit redistribution).

const BASE_URL = "https://api.opencorporates.com/v0.4";

/** Words that make an owner name look like a legal entity rather than a person. */
const ENTITY_WORDS = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|lp|l\.p|llp|ltd|limited|partners|partnership|trust|holdings|properties|investments|associates|enterprises|group|fund|reit)\b/i;

export function looksLikeEntity(name: string): boolean {
  return ENTITY_WORDS.test(name);
}

const SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|lp|l\.p|llp|ltd|limited|the)\b/g;

/** Lower-case, strip punctuation and legal suffixes, collapse whitespace. */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/[.\s]+/g, " ")
    .trim();
}

function isActive(status: string | undefined, dissolution: string | undefined): boolean | undefined {
  if (dissolution) return false;
  if (!status) return undefined;
  const s = status.toLowerCase();
  if (/(dissolv|cancel|forfeit|suspend|inactive|terminat|merged|revoked|withdrawn|struck|surrender)/.test(s)) return false;
  if (/(active|good standing|in existence|registered|exist)/.test(s)) return true;
  return undefined;
}

export function parseCompany(raw: unknown): EntityRecord | undefined {
  const c = asRecord(asRecord(raw)?.company);
  if (!c) return undefined;
  const name = firstStr(c.name);
  const companyNumber = firstStr(c.company_number);
  const jurisdiction = firstStr(c.jurisdiction_code);
  if (!name || !companyNumber || !jurisdiction) return undefined;
  const status = firstStr(c.current_status);
  const dissolutionDate = isoDate(c.dissolution_date);
  return stripUndefined<EntityRecord>({
    name,
    companyNumber,
    jurisdiction,
    status,
    active: isActive(status, dissolutionDate),
    incorporationDate: isoDate(c.incorporation_date),
    dissolutionDate,
    companyType: firstStr(c.company_type),
    registeredAddress: firstStr(c.registered_address_in_full),
    agentName: firstStr(c.agent_name),
    url: firstStr(c.opencorporates_url),
  });
}

/**
 * Pick the candidate whose normalized name equals the query's; if none does,
 * return undefined rather than guess (a wrong entity is worse than none).
 */
export function pickExactMatch(query: string, candidates: EntityRecord[]): EntityRecord | undefined {
  const target = normalizeEntityName(query);
  if (!target) return undefined;
  const exact = candidates.filter((c) => normalizeEntityName(c.name) === target);
  if (exact.length === 0) return undefined;
  // Prefer an active registration when the name was reused by a dissolved entity.
  return exact.find((c) => c.active === true) ?? exact[0];
}

export class OpenCorporatesClient implements EntityClient {
  constructor(
    private readonly apiToken: string,
    private readonly fetchImpl?: FetchLike,
    private readonly baseUrl: string = BASE_URL,
  ) {}

  async searchEntity(name: string, jurisdiction = "us_ca"): Promise<SourceOutcome<EntityRecord>> {
    const q = encodeURIComponent(name);
    const url = `${this.baseUrl}/companies/search?q=${q}&jurisdiction_code=${encodeURIComponent(jurisdiction)}&per_page=10&api_token=${encodeURIComponent(this.apiToken)}`;
    const res = await getJson(url, { fetchImpl: this.fetchImpl });
    if (!res.ok) return outcomeFromFailure(res);
    const companies = asArray(asRecord(asRecord(res.data)?.results)?.companies)
      .map(parseCompany)
      .filter((c): c is EntityRecord => c !== undefined);
    const match = pickExactMatch(name, companies);
    return match ? ok(match) : notFound();
  }
}
