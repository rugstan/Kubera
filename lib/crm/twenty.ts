// Twenty CRM REST client — the system of record for borrowers, deals, and partners.
//
// Field names follow this workspace's metadata (opportunity stages
// QUALIFICATION → CLOSED_WON, note targets via targetPersonId /
// targetCompanyId / targetOpportunityId). Every write is best-effort: a CRM
// outage is logged and surfaced to the caller but never loses the borrower's
// submission, which is also persisted to Supabase.

import type { JevResult } from "@/lib/ai/jev";
import { toE164 } from "@/lib/notify/phone";
import type { Contact, Intake, PartnerRegistration } from "@/lib/validation";
import { companyFields, opportunityFields, type TwentyFieldValues } from "./twenty-fields";

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

/**
 * Contact consent is optional (see `contactSchema`). Without it the borrower or
 * partner agreed to email replies about their request only: no phone call, text
 * or automated outreach. Brokers and the outreach agents work from Twenty, so
 * the person record carries that decision in `smsOptOut` (the field the SMS
 * STOP handler also writes) and never gets a phone number to dial.
 */
export function hasContactConsent(contact: Pick<Contact, "consent">): boolean {
  return contact.consent === true;
}

/** Consent as the CRM should show it: the form's answer, narrowed by a later SMS revocation in the ledger. */
type CrmConsent = { consent: boolean; smsRevoked: boolean };

/**
 * The form's consent box, then the consent ledger: a STOP (or other
 * revocation) recorded for the phone after the form was sent wins, so a push
 * that runs later (the crm-retry cron) never writes a revoked number as
 * textable. A ledger read failure fails the push, which is retried.
 */
async function crmConsent(contact: Contact, opts?: PushOptions): Promise<CrmConsent> {
  const consent = hasContactConsent(contact);
  if (!consent || !contact.phone || !opts?.smsConsent) return { consent, smsRevoked: false };
  const phone = toE164(contact.phone);
  if (!phone) return { consent, smsRevoked: false };
  return { consent, smsRevoked: (await opts.smsConsent(phone)) === "revoked" };
}

/** Whether brokers may call or text from the CRM record (and get the phone number). */
const reachable = (c: CrmConsent) => c.consent && !c.smsRevoked;

async function upsertPerson(contact: Contact, c: CrmConsent, companyId?: string): Promise<string> {
  // A failed lookup (timeout, 429, 5xx) must fail this step, not read as "no such person":
  // the push checkpoint resumes here on retry, and a create now would duplicate the person.
  const existing = await findPersonByEmail(contact.email);
  if (existing) {
    // A later submission without consent (or a number revoked since) narrows
    // an existing record. A submission with consent never clears an earlier
    // opt-out (for example a STOP reply); that is the consent ledger's job.
    if (!reachable(c)) await call("PATCH", `people/${encodeURIComponent(existing)}`, { smsOptOut: true });
    return existing;
  }
  // Twenty refuses a number without a country code ("(415) 555-0100": 400
  // INVALID_PHONE_NUMBER), and that would fail the whole lead. E.164 alone is
  // enough (no primaryPhoneCountryCode, which Twenty can reject as conflicting).
  // A number that cannot be normalized stays out of the CRM (the lead row keeps
  // it) so the lead still arrives.
  const phone = reachable(c) ? toE164(contact.phone) : null;
  return create("people", {
    name: { firstName: contact.firstName, lastName: contact.lastName },
    emails: { primaryEmail: contact.email },
    ...(phone ? { phones: { primaryPhoneNumber: phone } } : {}),
    ...(companyId ? { companyId } : {}),
    smsOptOut: !reachable(c),
    leadStatus: "NEW",
  });
}

function consentLine(contact: Contact, c: CrmConsent, consentEventId?: string | null): string {
  if (!hasContactConsent(contact)) return "Contact consent: none (email only). Do not call, text or autodial; phone withheld from CRM.";
  if (c.smsRevoked) return "Contact consent was given on the form, but texts were revoked since (STOP in the consent ledger). Do not text or autodial; phone withheld from CRM. Email instead.";
  return `Contact consent: phone, text and automated contact on file${consentEventId ? ` (consent event ${consentEventId})` : ""}.`;
}

/** The broker's next step, never a phone call without consent. */
export function leadNextStep(contact: Contact, requiresImmediateBrokerCall: boolean): string {
  if (!hasContactConsent(contact)) {
    return requiresImmediateBrokerCall
      ? "Email borrower today — Jev flagged priority; no phone/SMS consent on file"
      : "Email borrower — no phone/SMS consent on file; request T-12, rent roll / census, and PFS";
  }
  return requiresImmediateBrokerCall ? "Call borrower today — Jev flagged immediate broker call" : "Request T-12, rent roll / census, and PFS";
}

/**
 * Ids of the Twenty records a push has created so far. A push is a chain of
 * creates; when a later step fails, the caller persists this checkpoint and the
 * next attempt resumes from it, so a retry never creates a second company,
 * person, opportunity or note for the same submission.
 */
export type CrmProgress = {
  companyId?: string;
  personId?: string;
  opportunityId?: string;
  noteId?: string;
  noteTargetId?: string;
};

export type PushOptions = {
  /** Checkpoint from an earlier, partly failed attempt. Steps with an id are skipped. */
  progress?: CrmProgress | null;
  /** Called after each step that created a record, with the checkpoint so far. */
  onProgress?: (progress: CrmProgress) => Promise<void> | void;
  /** consent_events row id when the contact ticked the consent box, noted on the CRM record. */
  consentEventId?: string | null;
  /**
   * Latest SMS consent state for an E.164 phone from the consent ledger
   * (lib/notify/consent.ts smsConsentLookup). A revoked number is withheld
   * from Twenty and the person is marked `smsOptOut`.
   */
  smsConsent?: (phoneE164: string) => Promise<"granted" | "revoked" | "none">;
  /** The lead's id in the site database, written to the opportunity's Site lead ID field. */
  leadId?: string | null;
  /** The registration's id in the site database, written to the company's Site partner ID field. */
  partnerId?: string | null;
};

/** Accepts only string ids from a stored (untyped) checkpoint. */
export function parseCrmProgress(raw: unknown): CrmProgress {
  if (!raw || typeof raw !== "object") return {};
  const out: CrmProgress = {};
  for (const key of ["companyId", "personId", "opportunityId", "noteId", "noteTargetId"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v) out[key] = v;
  }
  return out;
}

/** Runs each create once per submission, recording its id before moving on. */
function checkpoint(opts: PushOptions = {}) {
  const progress: CrmProgress = { ...parseCrmProgress(opts.progress) };
  return {
    progress,
    async step(key: keyof CrmProgress, run: () => Promise<string>): Promise<string> {
      const existing = progress[key];
      if (existing) return existing;
      const id = await run();
      progress[key] = id;
      try {
        await opts.onProgress?.({ ...progress });
      } catch (err) {
        // Losing a checkpoint only risks a duplicate on retry; never fail the push for it.
        console.error("Twenty push: saving progress failed", err instanceof Error ? err.message : err);
      }
      return id;
    },
  };
}

/**
 * Writes the structured form fields (lib/crm/twenty-fields.ts) on a record that
 * already exists. A PATCH with the same values is harmless, so a retry simply
 * writes them again and no checkpoint is needed.
 *
 * Twenty answers 400 when a field or select option is missing from the
 * workspace (ops/twenty/fields.json has not been applied yet). That is logged
 * and skipped: the lead or partner still reaches the CRM with its note, the
 * full record. Timeouts, 429 and 5xx fail the step, so crm-retry tries again.
 */
async function patchFields(object: "opportunities" | "companies", id: string, values: TwentyFieldValues): Promise<void> {
  if (Object.keys(values).length === 0) return;
  try {
    await call("PATCH", `${object}/${encodeURIComponent(id)}`, values);
  } catch (err) {
    const status = err instanceof TwentyError ? err.status : undefined;
    if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      console.warn(`Twenty: the form fields on ${object}/${id} were refused (${status}); apply ops/twenty/fields.json to the workspace. ${(err as Error).message.slice(0, 300)}`);
      return;
    }
    throw err;
  }
}

async function attachNote(cp: ReturnType<typeof checkpoint>, title: string, markdown: string, targets: Json): Promise<void> {
  const noteId = await cp.step("noteId", () => create("notes", { title, bodyV2: { markdown } }));
  await cp.step("noteTargetId", () => create("noteTargets", { noteId, ...targets }));
}

const PROBABILITY: Record<JevResult["decision"]["leadUrgencyTier"], number> = {
  TIER_1_INSTITUTIONAL_HOT: 40,
  TIER_2_QUALIFIED_MIDMARKET: 25,
  TIER_3_NURTURE: 10,
  UNQUALIFIED: 2,
};

export type CrmRefs = { personId: string; companyId?: string; opportunityId?: string };

/** "Office — /financing/office-loans": the property and the financing page a short-form lead came from. */
export function leadSourceLabel(intake: Intake): string | null {
  return intake.origin ? `${humanize(intake.assetType)} — ${intake.origin.path}` : null;
}

/** Note section naming the financing page a lead came from, and what that short form did not ask. */
function sourceSection(intake: Intake): string[] {
  const o = intake.origin;
  if (!o) return [];
  return [
    "## Source",
    `- Financing page form: ${o.page} — ${o.path}`,
    `- Property type: ${humanize(intake.assetType)} · Transaction chosen: ${humanize(o.transaction)}`,
    "- Not collected on this form: NOI, value, unit count and occupancy. Broker review: confirm the numbers before quoting.",
  ];
}

/** The broker's next step for a short-form lead: confirm the numbers first, then the usual step. */
function sourcedNextStep(intake: Intake, step: string): string {
  return intake.origin ? `Broker review: confirm NOI, value and units — ${step}` : step;
}

/**
 * Pushes a qualifier submission. `jev` is null when the person asked for
 * advisor-only handling (privacy_preferences.human_review_only): the deal is
 * created without any automated score, tier, probability or commission estimate,
 * and the note tells the advisor to review it personally.
 */
export async function pushLead(intake: Intake, contact: Contact, jev: JevResult | null, opts?: PushOptions): Promise<CrmRefs> {
  const cp = checkpoint(opts);
  const cc = await crmConsent(contact, opts);
  // For the broker's next step a revoked number counts as no phone consent.
  const reach: Contact = reachable(cc) ? contact : { ...contact, consent: false };
  const companyId = contact.company ? await cp.step("companyId", () => create("companies", { name: contact.company })) : undefined;
  const personId = await cp.step("personId", () => upsertPerson(contact, cc, companyId));
  if (!jev) return pushReviewLead(cp, intake, contact, cc, personId, companyId, opts);
  const d = jev.decision;
  const q = jev.primaryQuote;

  const source = leadSourceLabel(intake);
  const opportunityId = await cp.step("opportunityId", () => create("opportunities", {
    name: source
      ? `Broker review · ${source} · ${money(intake.loanAmount)}`
      : `${programLabel(d.primaryProgramFit)} · ${money(intake.loanAmount)} · ${humanize(intake.assetType)}`,
    amount: { amountMicros: Math.round(intake.loanAmount * 1_000_000), currencyCode: "USD" },
    expectedRevenue: { amountMicros: Math.round(d.estimatedBrokerCommissionUsd * 1_000_000), currencyCode: "USD" },
    stage: "QUALIFICATION",
    probability: PROBABILITY[d.leadUrgencyTier],
    dealType: "NEW_BUSINESS",
    nextStep: sourcedNextStep(intake, leadNextStep(reach, d.requiresImmediateBrokerCall)),
    closeDate: closeDate(intake),
    pointOfContactId: personId,
    ...(companyId ? { companyId } : {}),
  }));
  await patchFields("opportunities", opportunityId, opportunityFields(intake, jev, { leadId: opts?.leadId }));

  const md = [
    `## Contact\n- ${consentLine(contact, cc, opts?.consentEventId)}`,
    ...sourceSection(intake),
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
  await attachNote(cp, source ? `Financing page lead — broker review — ${source}` : `Jev intake — ${d.leadUrgencyTier}`, md, { targetOpportunityId: opportunityId });

  return { personId, companyId, opportunityId };
}

/** The broker's next step for an advisor-only lead (no Jev flag to act on). */
export function reviewNextStep(contact: Contact): string {
  return hasContactConsent(contact)
    ? "Advisor-only handling requested — review personally; no automated scoring or AI tools"
    : "Advisor-only handling requested — review personally and email borrower; no automated scoring or AI tools; no phone/SMS consent on file";
}

async function pushReviewLead(cp: ReturnType<typeof checkpoint>, intake: Intake, contact: Contact, cc: CrmConsent, personId: string, companyId: string | undefined, opts?: PushOptions): Promise<CrmRefs> {
  const source = leadSourceLabel(intake);
  const opportunityId = await cp.step("opportunityId", () => create("opportunities", {
    name: source ? `Advisor review · ${source} · ${money(intake.loanAmount)}` : `Advisor review · ${money(intake.loanAmount)} · ${humanize(intake.assetType)}`,
    amount: { amountMicros: Math.round(intake.loanAmount * 1_000_000), currencyCode: "USD" },
    stage: "QUALIFICATION",
    dealType: "NEW_BUSINESS",
    nextStep: reviewNextStep(reachable(cc) ? contact : { ...contact, consent: false }),
    closeDate: closeDate(intake),
    pointOfContactId: personId,
    ...(companyId ? { companyId } : {}),
  }));
  await patchFields("opportunities", opportunityId, opportunityFields(intake, null, { leadId: opts?.leadId, advisorOnly: true }));
  const md = [
    `## Contact\n- ${consentLine(contact, cc, opts?.consentEventId)}`,
    ...sourceSection(intake),
    "## Advisor-only handling",
    "- This person asked that an advisor handle their requests personally (privacy request: human review).",
    "- No automated scoring was run. Do not paste their details into AI tools.",
    "## Intake",
    "```json",
    JSON.stringify(intake, null, 2),
    "```",
  ].join("\n");
  await attachNote(cp, source ? `Financing page lead — advisor review — ${source}` : "Qualifier intake — advisor review", md, { targetOpportunityId: opportunityId });
  return { personId, companyId, opportunityId };
}

const closeDate = (intake: Intake) => new Date(Date.now() + Math.max(intake.timelineDays, 30) * 86_400_000).toISOString();

export async function pushPartner(reg: PartnerRegistration, opts?: PushOptions): Promise<CrmRefs> {
  const cp = checkpoint(opts);
  const orgName = "organization" in reg && reg.organization ? reg.organization : `${reg.contact.firstName} ${reg.contact.lastName}`;
  const website = reg.partnerType === "LENDER" && reg.website ? { domainName: { primaryLinkUrl: reg.website } } : {};
  const companyId = await cp.step("companyId", () => create("companies", { name: orgName, ...website }));
  await patchFields("companies", companyId, companyFields(reg, opts?.partnerId));
  const cc = await crmConsent(reg.contact, opts);
  const personId = await cp.step("personId", () => upsertPerson(reg.contact, cc, companyId));
  const { contact: _contact, ...profile } = reg;
  await attachNote(
    cp,
    `Partner registration — ${humanize(reg.partnerType)}`,
    ["## Contact", `- ${consentLine(reg.contact, cc, opts?.consentEventId)}`, "## Partner profile", "```json", JSON.stringify(profile, null, 2), "```"].join("\n"),
    { targetCompanyId: companyId },
  );
  return { personId, companyId };
}

const money = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;
const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const programLabel = (id: string) => humanize(id).replace(/Hud/g, "HUD").replace(/Sba/g, "SBA").replace(/Cmbs/g, "CMBS").replace(/Pip/g, "PIP").replace(/Cre/g, "CRE");
