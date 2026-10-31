// Prospect outreach drafts (WS-S): draft -> broker approval -> send or mail.
//
//   draftOutreach   builds the message (deterministic template, with an
//                   optional model-written opening that must pass the output
//                   guardrails), stores it as an immutable version and asks
//                   the broker approval gate (Global rule 2).
//   settleOutreach  looks the approval up. Approved: an email is sent exactly
//                   once (the approval is claimed first), a letter becomes
//                   "ready to mail" for staff. Rejected, expired or still
//                   pending: nothing goes out. A timed-out approval expires
//                   and never sends.
//
// Gates, in order, at draft time and again at settle time (state can change
// while a draft waits): do-not-contact list, revoked email consent, contact
// details for the channel, California property (licensing review otherwise),
// licensed office address on file (an unsubscribe notice needs a postal
// address). Copy follows Global rule 4: advisor-led, no approval or
// qualification language, no timelines, licenseLine() on every message.

import { createHash } from "node:crypto";
import { checkText } from "@/lib/ai/guardrails";
import { GatewayProviderError, GatewayUnavailableError, MODELS, RoutingRefusedError, type ModelGateway } from "@/lib/ai/gateway";
import { agentRegistry, RegistryError, sha256 } from "@/lib/agents/core/registry";
import { isApproved, peekApproval, type ApprovalGate, type OutboundAction } from "@/lib/compliance/approval-gate";
import { consentState, type ConsentReader } from "@/lib/notify/consent";
import type { EmailClient } from "@/lib/notify/email/types";
import { licenseLine, site } from "@/lib/site";
import { PROSPECTING_AGENT, TASKS, levelFor, logIntelEvent, uuidOrNull, type IntelEventSink } from "./audit";
import type { AutonomyLevel } from "@/lib/agents/core/autonomy";
import type { ProspectStore } from "./prospect-store";
import { isSuppressed } from "./suppression";
import { PROPERTY_TYPE_LABELS, PROSPECT_PROGRAM_LABELS, type OutreachChannel, type OutreachReason, type OutreachStatus, type Prospect, type ProspectOutreach } from "./types";

export class OutreachError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "status" | "suppressed" | "consent_revoked" | "no_contact" | "out_of_state" | "identity" | "guardrail" | "autonomy" = "status",
  ) {
    super(message);
    this.name = "OutreachError";
  }
}

// ---------------------------------------------------------------------------
// Sender identity

export type SenderIdentity = {
  legalName: string;
  /** The "from" voice in the sign-off. */
  signOff: string;
  licenseLine: string;
  /** Licensed office address (postal address for the unsubscribe notice). Empty = not configured. */
  address: string;
  phone: string;
  replyEmail: string;
  optOutEmail: string;
};

export function senderIdentityFromSite(): SenderIdentity {
  return {
    legalName: site.legalName,
    signOff: `${site.designatedOfficer}, ${site.name}`,
    licenseLine: licenseLine(),
    address: site.licensedAddress,
    phone: site.phone,
    replyEmail: site.email,
    optOutEmail: site.privacyEmail,
  };
}

// ---------------------------------------------------------------------------
// Copy

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthYear(iso: string): string {
  const [y, m] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  return month && y ? `${month} ${y}` : iso;
}

function typePhrase(p: Pick<Prospect, "propertyType" | "units">): string {
  const label = PROPERTY_TYPE_LABELS[p.propertyType].toLowerCase();
  if (p.propertyType === "multifamily" && p.units && p.units >= 5) return `${p.units}-unit multifamily property`;
  if (p.propertyType === "other") return "commercial property";
  return `${label} property`;
}

function typePlural(p: Pick<Prospect, "propertyType" | "units">): string {
  return typePhrase(p).replace(/property$/, "properties");
}

export function templateIntro(p: Pick<Prospect, "addressLine1" | "city" | "propertyType" | "units" | "loanMaturityDate">): string {
  return `Public county records show a loan recorded against ${p.addressLine1}${p.city ? ` in ${p.city}` : ""} with a stated maturity around ${monthYear(p.loanMaturityDate)}. If a refinance or extension is something you are planning for, we would be glad to share how lenders are looking at ${typePlural(p)} like yours today.`;
}

export type BuiltMessage = { subject: string; bodyText: string };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildMessage(
  p: Pick<Prospect, "addressLine1" | "city" | "propertyType" | "units" | "loanMaturityDate" | "recommendedProgram" | "contactName">,
  channel: OutreachChannel,
  id: SenderIdentity,
  intro: string,
): BuiltMessage {
  const first = p.contactName?.trim().split(/\s+/)[0];
  const program = p.recommendedProgram && p.recommendedProgram !== "other" ? PROSPECT_PROGRAM_LABELS[p.recommendedProgram] : null;
  const paragraphs = [
    first ? `Hello ${first},` : "Hello,",
    intro.trim(),
    `Kubera Commercial arranges commercial real estate loans as a licensed California real estate broker. We compare programs and lenders for owners, and an advisor works through the options with you.${program ? ` For a property like this, a starting point to discuss would be ${program}, though the right fit depends on the property, its financials and the lender.` : ""}`,
    "Anything we share is indicative only and subject to lender underwriting and program guidelines. We are the broker, not the lender, and nothing here is a commitment to lend.",
    `If a conversation would be useful, reply to this ${channel === "email" ? "message" : "letter by email"} at ${id.replyEmail}${id.phone ? ` or call ${id.phone}` : ""}.`,
    `${id.signOff}`,
  ];
  const footer = [
    id.licenseLine,
    id.address,
    `You are receiving this because loan and ownership details for this property appear in public records. If you would rather not hear from us, tell us at ${id.optOutEmail} (or reply "unsubscribe") and we will add you to our do-not-contact list.`,
  ];
  const bodyText = `${paragraphs.join("\n\n")}\n\n--\n${footer.join("\n")}`;
  return { subject: `Financing options for ${p.addressLine1}`.slice(0, 200), bodyText };
}

/** Phrases outreach must never carry (Global rule 4), on top of the output guardrails. */
const BANNED = [
  /\bguarantee[sd]?\b/i,
  /\b(pre-?approved|approved for|you(?:'re| are) approved|qualif(?:y|ied|ies) for)\b/i,
  /\b(lowest|best) (?:rate|price)s?\b/i,
  /\bfees? (?:are )?protected\b/i,
  /\bwill call you today\b/i,
  /\bautonomous\b/i,
  /\b(act now|limited time|last chance|urgent(?:ly)?)\b/i,
  /\b(foreclos|default|distress|in trouble|behind on)/i,
  /\b(close|closes|closing) in \d/i,
  /\busur(?:y|ious)\b/i,
];

export type Lint = { ok: boolean; problems: string[] };

export function lintOutreach(bodyText: string, id: SenderIdentity): Lint {
  const problems: string[] = [];
  const g = checkText(bodyText);
  for (const v of g.violations) problems.push(`guardrail:${v.ruleId}`);
  for (const re of BANNED) if (re.test(bodyText)) problems.push(`banned:${re.source.slice(0, 40)}`);
  if (!bodyText.includes(id.licenseLine)) problems.push("missing_license_line");
  if (!id.address || !bodyText.includes(id.address)) problems.push("missing_postal_address");
  if (!/do-not-contact|unsubscribe/i.test(bodyText)) problems.push("missing_opt_out");
  if (!/not the lender/i.test(bodyText)) problems.push("missing_broker_disclosure");
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Optional model-written opening

const INTRO_SYSTEM = `You write the opening two sentences of a short introductory note from a licensed California commercial mortgage broker to the owner of a commercial property. The broker arranges loans for others; it is never the lender.

You are given facts about the property and the month its recorded loan matures. Write two warm, plain sentences that say public records suggest a loan on the property matures around that month, and offer to share how lenders are currently looking at that kind of property.

Rules:
- Use only the facts given. Do not add numbers, rates, amounts, names, lenders or dates beyond what is given.
- Never imply the owner is in trouble, behind or in default. Never use urgency or pressure.
- Never state or imply an approval, a commitment, a guaranteed rate or fee, a closing timeline, or that the owner qualifies for anything.
- Do not mention AI. Do not include links, email addresses or phone numbers.
- Output only the two sentences, no greeting and no sign-off.`;

export const INTRO_PROMPT_ID = "prospecting.outreach_intro";
export const INTRO_PROMPT_VERSION = "1.0.0";
const INTRO_MAX_TOKENS = 400;

export function introPrompt() {
  try {
    const p = agentRegistry().registerPrompt({
      id: INTRO_PROMPT_ID,
      version: INTRO_PROMPT_VERSION,
      description: "Opening sentences of a refinance-maturity outreach note",
      purpose: "drafting",
      model: MODELS.claudeMid,
      effort: "low",
      maxTokens: INTRO_MAX_TOKENS,
      system: INTRO_SYSTEM,
    });
    return { id: p.id, version: p.version, sha256: p.sha256, model: p.model, system: p.system };
  } catch (err) {
    if (!(err instanceof RegistryError)) throw err;
    return { id: INTRO_PROMPT_ID, version: INTRO_PROMPT_VERSION, sha256: sha256(INTRO_SYSTEM), model: MODELS.claudeMid, system: INTRO_SYSTEM };
  }
}

/** Facts the model may see: no owner, contact, street address or lender. */
export function introFacts(p: Pick<Prospect, "propertyType" | "units" | "city" | "state" | "loanMaturityDate">): string {
  return [
    `Property: ${typePhrase(p)}${p.city ? ` in ${p.city}${p.state ? `, ${p.state}` : ""}` : ""}.`,
    `The recorded loan on the property has a stated maturity around ${monthYear(p.loanMaturityDate)}.`,
  ].join("\n");
}

export type IntroResult = { text: string; generatedBy: "template" | "model"; model: string | null; reason?: string };

export async function writeIntro(gateway: ModelGateway | null | undefined, p: Prospect): Promise<IntroResult> {
  const fallback: IntroResult = { text: templateIntro(p), generatedBy: "template", model: null };
  if (!gateway) return fallback;
  const prompt = introPrompt();
  if (!gateway.available(prompt.model)) return { ...fallback, reason: "provider_unconfigured" };
  try {
    const facts = introFacts(p);
    const res = await gateway.complete({
      model: prompt.model,
      purpose: "drafting",
      system: prompt.system,
      messages: [{ role: "user", content: `${facts}\n\nWrite the two sentences.` }],
      maxTokens: INTRO_MAX_TOKENS,
      effort: "low",
      declared: { level: "internal" },
      trace: { name: "prospecting.outreach_intro" },
    });
    if (res.refused || res.stopReason !== "end_turn") return { ...fallback, reason: res.refused ? "model_refusal" : "model_truncated" };
    const text = res.text.trim().replace(/\s+/g, " ");
    const allowedDigits = new Set([...(facts.match(/\d+/g) ?? [])]);
    const stray = (text.match(/\d+/g) ?? []).some((d) => !allowedDigits.has(d));
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    const g = checkText(text);
    const banned = BANNED.some((re) => re.test(text));
    const contact = /@|https?:\/\/|www\./i.test(text);
    if (!text || text.length > 500 || sentences > 3 || stray || !g.ok || banned || contact) return { ...fallback, reason: "output_rejected" };
    return { text, generatedBy: "model", model: res.servedModel };
  } catch (err) {
    if (err instanceof RoutingRefusedError || err instanceof GatewayUnavailableError || err instanceof GatewayProviderError) return { ...fallback, reason: err.name };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Draft

export type OutreachDeps = {
  store: ProspectStore;
  gate: ApprovalGate;
  email: EmailClient | null;
  consent?: ConsentReader | null;
  gateway?: ModelGateway | null;
  events?: IntelEventSink;
  autonomy?: { level(task: string): Promise<AutonomyLevel> } | null;
  identity: SenderIdentity;
  now?: () => Date;
};

const clock = (d: Pick<OutreachDeps, "now">) => (d.now ?? (() => new Date()))();

export function mailingLine(p: Pick<Prospect, "ownerName" | "mailing">): string | null {
  const m = p.mailing;
  if (!m?.line1) return null;
  const place = [m.city, [m.state, m.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.ownerName, m.line1, place].filter(Boolean).join(", ");
}

export function recipientFor(p: Prospect, channel: OutreachChannel): string | null {
  return channel === "email" ? (p.contactEmail ?? null) : mailingLine(p);
}

/** Why outreach to this prospect is not allowed right now; null when it is. */
export async function outreachBlock(deps: Pick<OutreachDeps, "store" | "consent" | "identity">, p: Prospect, channel: OutreachChannel): Promise<{ code: OutreachError["code"]; reason: OutreachReason; message: string } | null> {
  if (p.status === "do_not_contact") return { code: "suppressed", reason: "suppressed", message: "This prospect is on the do-not-contact list." };
  if (p.status === "not_a_fit") return { code: "status", reason: "cancelled", message: "This prospect is marked not a fit." };
  const match = await isSuppressed(deps.store, p);
  if (match.suppressed) return { code: "suppressed", reason: "suppressed", message: "This prospect matches an entry on the do-not-contact list." };
  if (channel === "email" && p.contactEmail && deps.consent) {
    try {
      const state = consentState(await deps.consent.history("email", { email: p.contactEmail }), "email");
      if (state.state === "revoked") return { code: "consent_revoked", reason: "consent_revoked", message: "This address has opted out of email." };
    } catch (err) {
      // Fail closed: if the ledger cannot be read, nothing goes out.
      console.error("[prospecting] consent lookup failed; blocking outreach", err instanceof Error ? err.message : err);
      return { code: "consent_revoked", reason: "consent_revoked", message: "The consent ledger could not be read; try again shortly." };
    }
  }
  if (!recipientFor(p, channel)) {
    return { code: "no_contact", reason: "no_contact", message: channel === "email" ? "Add a contact email first. Public records do not include one." : "There is no mailing address on record for this owner." };
  }
  if (p.state !== "CA") return { code: "out_of_state", reason: "cancelled", message: "This property is outside California. Review licensing before any outreach." };
  if (!deps.identity.address.trim()) return { code: "identity", reason: "provider_unconfigured", message: "The licensed office address is not configured (NEXT_PUBLIC_DRE_LICENSED_ADDRESS); outreach needs a postal address." };
  return null;
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The approval request for a stored draft. Built only from the stored row, so the payload (and its hash) is identical on every lookup. */
export function approvalActionFor(row: ProspectOutreach): OutboundAction {
  const masked = row.channel === "email" ? row.recipient.replace(/^(.).*(@.*)$/, "$1***$2") : row.recipient.split(",").slice(0, 1).join("").slice(0, 40);
  return {
    kind: (row.channel === "email" ? "email" : "prospect_letter") as OutboundAction["kind"],
    idempotencyKey: row.idempotencyKey,
    summary: `Prospect outreach (${row.channel}) to ${masked}: ${row.subject}`.slice(0, 480),
    payload: { channel: row.channel, outreachId: row.id, prospectId: row.prospectId, recipient: row.recipient, subject: row.subject, body: row.bodyText, bodySha256: row.bodySha256 },
    requestedBy: "agent:prospecting",
  };
}

export type DraftInput = { prospectId: string; channel: OutreachChannel; actor: string; personalize?: boolean };
export type DraftResult = { status: "drafted"; outreach: ProspectOutreach; reused: boolean } | { status: "audit_only"; subject: string };

export async function draftOutreach(deps: OutreachDeps, input: DraftInput): Promise<DraftResult> {
  const now = clock(deps);
  const prospect = await deps.store.getProspect(input.prospectId);
  if (!prospect) throw new OutreachError("Prospect not found", "not_found");

  const block = await outreachBlock(deps, prospect, input.channel);
  if (block) {
    if (block.code === "suppressed" && prospect.status !== "do_not_contact") await deps.store.updateStaff(prospect.id, { status: "do_not_contact" }, "system:suppression", now);
    await logIntelEvent(deps.events, { eventType: "prospect.outreach_blocked", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "blocked", reasonCodes: [`outreach.${block.reason}`], detail: { prospectId: prospect.id, channel: input.channel } });
    throw new OutreachError(block.message, block.code);
  }

  const level = await levelFor(deps.autonomy, TASKS.outreachDraft);
  const intro = input.personalize ? await writeIntro(deps.gateway, prospect) : ({ text: templateIntro(prospect), generatedBy: "template", model: null } satisfies IntroResult);
  const message = buildMessage(prospect, input.channel, deps.identity, intro.text);
  const lint = lintOutreach(message.bodyText, deps.identity);
  if (!lint.ok) {
    await logIntelEvent(deps.events, { eventType: "prospect.outreach_blocked", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "blocked", reasonCodes: ["outreach.guardrail", ...lint.problems.map((p) => `lint.${p.replace(/[^a-z0-9_]+/gi, "_").toLowerCase().slice(0, 40)}`)], detail: { prospectId: prospect.id } });
    throw new OutreachError(`The draft failed the compliance checks (${lint.problems.join(", ")}); nothing was saved.`, "guardrail");
  }

  if (level === "audit") {
    await logIntelEvent(deps.events, { eventType: "prospect.outreach_proposed", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, autonomy: level, outcome: "proposed", reasonCodes: ["autonomy.audit_only"], detail: { prospectId: prospect.id, channel: input.channel } });
    return { status: "audit_only", subject: message.subject };
  }

  const recipient = recipientFor(prospect, input.channel)!;
  const bodySha = sha(message.bodyText);
  const existing = await deps.store.listOutreach(prospect.id);
  // The same message already waiting for a decision is reused, not requested twice.
  const waiting = existing.find((o) => o.status === "pending_approval" && o.channel === input.channel && o.bodySha256 === bodySha && o.recipient === recipient);
  if (waiting) return { status: "drafted", outreach: waiting, reused: true };

  const row = await deps.store.insertOutreach(
    {
      prospectId: prospect.id,
      channel: input.channel,
      status: "pending_approval",
      idempotencyKey: `prospect-outreach:${prospect.id}:${input.channel}:${existing.length + 1}`,
      recipient,
      subject: message.subject,
      bodyText: message.bodyText,
      bodySha256: bodySha,
      generatedBy: intro.generatedBy,
      model: intro.model,
      guardrailHits: [],
      draftedBy: input.actor,
      reasonCode: "approval_pending",
    },
    now,
  );

  // Register the request with the broker approval gate. peek never claims it.
  let approvalId: string | null = null;
  let gateNote: OutreachReason = "approval_pending";
  try {
    const decision = await peekApproval(deps.gate, approvalActionFor(row));
    if ("approvalId" in decision && decision.approvalId) approvalId = decision.approvalId;
  } catch (err) {
    console.error("[prospecting] approval request failed; the draft stays pending", err instanceof Error ? err.message : err);
    gateNote = "approval_pending";
  }
  const withApproval = approvalId ? ((await deps.store.updateOutreach(row.id, ["pending_approval"], { approvalId, reasonCode: gateNote }, now)) ?? row) : row;

  if (prospect.status === "new" || prospect.status === "reviewing") await deps.store.updateStaff(prospect.id, { status: "drafted" }, input.actor, now);
  await logIntelEvent(deps.events, {
    eventType: "prospect.outreach_drafted",
    agent: PROSPECTING_AGENT,
    task: TASKS.outreachDraft,
    autonomy: level,
    outcome: "pending_approval",
    approvalId: uuidOrNull(approvalId),
    idempotencyKey: row.idempotencyKey,
    model: intro.model,
    reasonCodes: ["approval.pending", ...(intro.reason ? [`intro.${intro.reason.toLowerCase()}`] : [])],
    detail: { prospectId: prospect.id, outreachId: row.id, channel: input.channel, version: row.version, generatedBy: intro.generatedBy },
  });
  return { status: "drafted", outreach: withApproval, reused: false };
}

// ---------------------------------------------------------------------------
// Settle

export type SettleResult = { outreach: ProspectOutreach; changed: boolean; note?: string };

export async function settleOutreach(deps: OutreachDeps, outreachId: string): Promise<SettleResult> {
  const now = clock(deps);
  const row = await deps.store.getOutreach(outreachId);
  if (!row) throw new OutreachError("Outreach draft not found", "not_found");
  if (row.status !== "pending_approval") return { outreach: row, changed: false };

  const finish = async (from: readonly OutreachStatus[], status: OutreachStatus, reason: OutreachReason, extra: Parameters<ProspectStore["updateOutreach"]>[2] = {}, event?: { type: string; outcome: "executed" | "rejected" | "expired" | "blocked" | "failed" }) => {
    const next = await deps.store.updateOutreach(row.id, from, { status, reasonCode: reason, ...extra }, now);
    if (event && next) {
      await logIntelEvent(deps.events, {
        eventType: event.type,
        agent: PROSPECTING_AGENT,
        task: TASKS.outreachDraft,
        outcome: event.outcome,
        approvalId: uuidOrNull(extra.approvalId ?? row.approvalId),
        idempotencyKey: row.idempotencyKey,
        externalMessageIds: extra.providerMessageId ? [extra.providerMessageId] : [],
        reasonCodes: [`outreach.${reason}`],
        detail: { prospectId: row.prospectId, outreachId: row.id, channel: row.channel },
      });
    }
    return { outreach: next ?? (await deps.store.getOutreach(row.id)) ?? row, changed: Boolean(next) };
  };

  const prospect = await deps.store.getProspect(row.prospectId);
  if (!prospect) return finish(["pending_approval"], "blocked", "cancelled", { error: "prospect no longer exists" }, { type: "prospect.outreach_blocked", outcome: "blocked" });

  // State may have changed while the draft waited: the gates run again before anything is released.
  const block = await outreachBlock(deps, prospect, row.channel);
  if (block && block.code !== "identity") {
    return finish(["pending_approval"], "blocked", block.reason, { error: block.message }, { type: "prospect.outreach_blocked", outcome: "blocked" });
  }
  if (block) return { outreach: row, changed: false, note: block.message };
  if (recipientFor(prospect, row.channel) !== row.recipient) {
    return finish(["pending_approval"], "blocked", "no_contact", { error: "the contact details changed after the draft was approved for review; draft again" }, { type: "prospect.outreach_blocked", outcome: "blocked" });
  }

  // What the broker approved is the stored row. If it no longer matches its hash, nothing is released.
  if (!bodyIntact(row)) return finish(["pending_approval"], "failed", "guardrail", { error: "the stored message no longer matches its recorded hash" }, { type: "prospect.outreach_failed", outcome: "failed" });

  const action = approvalActionFor(row);
  let decision: Awaited<ReturnType<typeof peekApproval>>;
  try {
    decision = await peekApproval(deps.gate, action);
  } catch (err) {
    // Fail closed: if the approval cannot be looked up, nothing is sent.
    console.error("[prospecting] approval lookup failed; not sending", err instanceof Error ? err.message : err);
    return { outreach: row, changed: false, note: "The approval could not be looked up; try again shortly." };
  }
  if (decision.status === "rejected") return finish(["pending_approval"], "rejected", "approval_rejected", { approvalId: decision.approvalId }, { type: "prospect.outreach_rejected", outcome: "rejected" });
  if (decision.status === "expired") return finish(["pending_approval"], "expired", "approval_expired", { approvalId: decision.approvalId }, { type: "prospect.outreach_expired", outcome: "expired" });
  if (!isApproved(decision)) {
    const reason: OutreachReason = decision.reason === "reauth_required" ? "reauth_required" : "approval_pending";
    if (decision.approvalId && decision.approvalId !== row.approvalId) await deps.store.updateOutreach(row.id, ["pending_approval"], { approvalId: decision.approvalId, reasonCode: reason }, now);
    return { outreach: (await deps.store.getOutreach(row.id)) ?? row, changed: false, note: reason === "reauth_required" ? "The approving broker must confirm their identity again." : "Waiting for broker approval." };
  }

  // Approved. If it was already claimed (a send in flight or done elsewhere), leave it alone.
  if (decision.executedAt) return { outreach: row, changed: false, note: "This approval was already used." };
  if (row.channel === "email" && !deps.email) return { outreach: row, changed: false, note: "Email is not configured (RESEND_API_KEY); the approval is kept for later." };

  // Claim the approval: it is handed out once, so a duplicate settle sends nothing.
  const claimed = await deps.gate.request(action);
  if (!isApproved(claimed)) return { outreach: (await deps.store.getOutreach(row.id)) ?? row, changed: false, note: "This approval was already used." };

  if (row.channel === "letter") {
    return finish(["pending_approval"], "ready_to_mail", "ready_to_mail", { approvalId: claimed.approvalId }, { type: "prospect.outreach_ready_to_mail", outcome: "executed" });
  }

  try {
    const sent = await deps.email!.send({
      to: row.recipient,
      subject: row.subject,
      text: row.bodyText,
      html: htmlFor(row.bodyText),
      replyTo: deps.identity.replyEmail,
      idempotencyKey: `prospect-outreach-${row.id}`,
      tags: { template: "prospect_outreach", channel: "email" },
    });
    const result = await finish(["pending_approval"], "sent", "sent", { approvalId: claimed.approvalId, providerMessageId: sent.providerMessageId, sentAt: now.toISOString(), error: null }, { type: "prospect.outreach_sent", outcome: "executed" });
    if (prospect.status !== "engaged") await deps.store.updateStaff(prospect.id, { status: "contacted" }, "system:outreach", now);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[prospecting] email send failed", message);
    return finish(["pending_approval"], "failed", "send_failed", { approvalId: claimed.approvalId, error: message.slice(0, 1000) }, { type: "prospect.outreach_failed", outcome: "failed" });
  }
}

function bodyIntact(row: ProspectOutreach): boolean {
  return sha(row.bodyText) === row.bodySha256;
}

/** HTML for a stored plain-text body (paragraphs and the footer). */
export function htmlFor(bodyText: string): string {
  const [main = "", footer = ""] = bodyText.split("\n\n--\n");
  const paras = main.split(/\n{2,}/).map((t) => `<p>${escapeHtml(t)}</p>`).join("");
  return `${paras}${footer ? `<hr><p style="font-size:12px;color:#555">${escapeHtml(footer).replace(/\n/g, "<br>")}</p>` : ""}`;
}

export type SweepResult = { checked: number; sent: number; readyToMail: number; rejected: number; expired: number; blocked: number; failed: number; waiting: number };

/** Looks up every waiting draft once. Safe to run on a schedule: each draft sends at most once. */
export async function settlePending(deps: OutreachDeps, limit = 50): Promise<SweepResult> {
  const out: SweepResult = { checked: 0, sent: 0, readyToMail: 0, rejected: 0, expired: 0, blocked: 0, failed: 0, waiting: 0 };
  for (const row of await deps.store.listOutreachByStatus("pending_approval", limit)) {
    out.checked++;
    try {
      const r = await settleOutreach(deps, row.id);
      switch (r.outreach.status) {
        case "sent":
          out.sent++;
          break;
        case "ready_to_mail":
          out.readyToMail++;
          break;
        case "rejected":
          out.rejected++;
          break;
        case "expired":
          out.expired++;
          break;
        case "blocked":
          out.blocked++;
          break;
        case "failed":
          out.failed++;
          break;
        default:
          out.waiting++;
      }
    } catch (err) {
      console.error("[prospecting] settle failed for one draft", err instanceof Error ? err.message : err);
      out.failed++;
    }
  }
  return out;
}

export async function markMailed(deps: Pick<OutreachDeps, "store" | "events" | "now">, outreachId: string, actor: string): Promise<ProspectOutreach> {
  const now = clock(deps);
  const row = await deps.store.getOutreach(outreachId);
  if (!row) throw new OutreachError("Outreach draft not found", "not_found");
  if (row.channel !== "letter") throw new OutreachError("Only letters are marked mailed", "status");
  const next = await deps.store.updateOutreach(outreachId, ["ready_to_mail"], { status: "mailed", reasonCode: "mailed", mailedAt: now.toISOString(), mailedBy: actor }, now);
  if (!next) throw new OutreachError("Only an approved letter can be marked mailed", "status");
  await deps.store.updateStaff(row.prospectId, { status: "contacted" }, actor, now);
  await logIntelEvent(deps.events, { eventType: "prospect.outreach_mailed", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "executed", approvalId: uuidOrNull(next.approvalId), idempotencyKey: next.idempotencyKey, reasonCodes: ["outreach.mailed"], detail: { prospectId: row.prospectId, outreachId } });
  return next;
}

export async function cancelOutreach(deps: Pick<OutreachDeps, "store" | "events" | "now">, outreachId: string, actor: string): Promise<ProspectOutreach> {
  const now = clock(deps);
  const next = await deps.store.updateOutreach(outreachId, ["pending_approval", "ready_to_mail"], { status: "cancelled", reasonCode: "cancelled", error: `cancelled by ${actor}`.slice(0, 200) }, now);
  if (!next) throw new OutreachError("Only a draft that is waiting or ready to mail can be cancelled", "status");
  await logIntelEvent(deps.events, { eventType: "prospect.outreach_cancelled", agent: PROSPECTING_AGENT, task: TASKS.outreachDraft, outcome: "recorded", approvalId: uuidOrNull(next.approvalId), idempotencyKey: next.idempotencyKey, reasonCodes: ["outreach.cancelled"], detail: { prospectId: next.prospectId, outreachId } });
  return next;
}
