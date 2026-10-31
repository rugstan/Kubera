// Twenty CRM REST client — the system of record for borrowers, deals, and partners.
//
// Field names follow this workspace's metadata (opportunity stages
// QUALIFICATION → CLOSED_WON, note targets via targetPersonId /
// targetCompanyId / targetOpportunityId). Every write is best-effort: a CRM
// outage is logged and surfaced to the caller but never loses the borrower's
// submission, which is also persisted to Supabase.

import type { JevResult } from "@/lib/ai/jev";
import type { Contact, Intake, PartnerRegistration } from "@/lib/validation";

type Json = Record<string, unknown>;

export class TwentyError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function twentyConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_URL && process.env.TWENTY_API_KEY);
}

async function call<T = Json>(method: "GET" | "POST" | "PATCH", path: string, body?: Json): Promise<T> {
  const base = process.env.TWENTY_API_URL?.replace(/\/$/, "");
  if (!base || !process.env.TWENTY_API_KEY) throw new TwentyError("Twenty CRM is not configured");
  const res = await fetch(`${base}/rest/${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.TWENTY_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new TwentyError(`Twenty ${method} /${path}: ${res.status} ${await res.text().catch(() => "")}`, res.status);
  return (await res.json()) as T;
}

/** Twenty wraps results as { data: { createPerson: {...} } } or { data: { people: [...] } }. */
function unwrap(res: Json): Json | Json[] | undefined {
  const data = res.data as Json | undefined;
  if (!data) return undefined;
  const first = Object.values(data)[0];
  return first as Json | Json[] | undefined;
}

async function create(object: string, body: Json): Promise<string> {
  const record = unwrap(await call("POST", object, { position: "first", ...body }));
  const id = !Array.isArray(record) ? (record?.id as string | undefined) : undefined;
  if (!id) throw new TwentyError(`Twenty create ${object}: no id in response`);
  return id;
}

async function findPersonByEmail(email: string): Promise<string | null> {
  const filter = encodeURIComponent(`emails.primaryEmail[eq]:"${email.replace(/"/g, "")}"`);
  const list = unwrap(await call("GET", `people?filter=${filter}&limit=1`));
  return Array.isArray(list) ? ((list[0]?.id as string | undefined) ?? null) : null;
}

async function upsertPerson(contact: Contact, companyId?: string): Promise<string> {
  const existing = await findPersonByEmail(contact.email).catch(() => null);
  if (existing) return existing;
  return create("people", {
    name: { firstName: contact.firstName, lastName: contact.lastName },
    emails: { primaryEmail: contact.email },
    ...(contact.phone ? { phones: { primaryPhoneNumber: contact.phone } } : {}),
    ...(companyId ? { companyId } : {}),
    leadStatus: "NEW",
  });
}

async function attachNote(title: string, markdown: string, targets: Json): Promise<void> {
  const noteId = await create("notes", { title, bodyV2: { markdown } });
  await create("noteTargets", { noteId, ...targets });
}

const PROBABILITY: Record<JevResult["decision"]["leadUrgencyTier"], number> = {
  TIER_1_INSTITUTIONAL_HOT: 40,
  TIER_2_QUALIFIED_MIDMARKET: 25,
  TIER_3_NURTURE: 10,
  UNQUALIFIED: 2,
};

export type CrmRefs = { personId: string; companyId?: string; opportunityId?: string };

export async function pushLead(intake: Intake, contact: Contact, jev: JevResult): Promise<CrmRefs> {
  const companyId = contact.company ? await create("companies", { name: contact.company }) : undefined;
  const personId = await upsertPerson(contact, companyId);
  const d = jev.decision;
  const q = jev.primaryQuote;

  const opportunityId = await create("opportunities", {
    name: `${programLabel(d.primaryProgramFit)} · ${money(intake.loanAmount)} · ${humanize(intake.assetType)}`,
    amount: { amountMicros: Math.round(intake.loanAmount * 1_000_000), currencyCode: "USD" },
    expectedRevenue: { amountMicros: Math.round(d.estimatedBrokerCommissionUsd * 1_000_000), currencyCode: "USD" },
    stage: "QUALIFICATION",
    probability: PROBABILITY[d.leadUrgencyTier],
    dealType: "NEW_BUSINESS",
    nextStep: d.requiresImmediateBrokerCall ? "Call borrower today — Jev flagged immediate broker call" : "Request T-12, rent roll / census, and PFS",
    closeDate: new Date(Date.now() + Math.max(intake.timelineDays, 30) * 86_400_000).toISOString(),
    pointOfContactId: personId,
    ...(companyId ? { companyId } : {}),
  });

  const md = [
    `## Jev decision (${jev.engine}, ${jev.latencyMs}ms)`,
    "```json",
    JSON.stringify(d, null, 2),
    "```",
    "## Rationale",
    ...jev.rationale.map((r) => `- ${r}`),
    q ? `\n## Indicative structure\n- ${q.name}: ${money(q.loanAmount)} at ${q.ratePct.toFixed(2)}%, ${q.termLabel}, ${q.recourse}\n- Annual P&I ${money(q.annualPrincipalInterest)} · ${q.annualFee.label} ${money(q.annualFee.amount)} · Closing ${money(q.closingCosts)}` : "",
    "## Intake",
    "```json",
    JSON.stringify(intake, null, 2),
    "```",
  ].join("\n");
  await attachNote(`Jev intake — ${d.leadUrgencyTier}`, md, { targetOpportunityId: opportunityId });

  return { personId, companyId, opportunityId };
}

export async function pushPartner(reg: PartnerRegistration): Promise<CrmRefs> {
  const orgName = "organization" in reg && reg.organization ? reg.organization : `${reg.contact.firstName} ${reg.contact.lastName}`;
  const website = reg.partnerType === "LENDER" && reg.website ? { domainName: { primaryLinkUrl: reg.website } } : {};
  const companyId = await create("companies", { name: orgName, ...website });
  const personId = await upsertPerson(reg.contact, companyId);
  const { contact: _contact, ...profile } = reg;
  await attachNote(
    `Partner registration — ${humanize(reg.partnerType)}`,
    ["## Partner profile", "```json", JSON.stringify(profile, null, 2), "```"].join("\n"),
    { targetCompanyId: companyId },
  );
  return { personId, companyId };
}

const money = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;
const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const programLabel = (id: string) => humanize(id).replace(/Hud/g, "HUD").replace(/Sba/g, "SBA").replace(/Cmbs/g, "CMBS").replace(/Pip/g, "PIP").replace(/Cre/g, "CRE");
