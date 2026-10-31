import { render } from "@react-email/components";
import { z } from "zod";
import DocumentRequest, { documentRequestSubject } from "@/emails/document-request";
import LeadConfirmation, { leadConfirmationSubject } from "@/emails/lead-confirmation";
import MilestoneUpdate, { milestoneUpdateSubject } from "@/emails/milestone-update";
import StaffAlert, { staffAlertSubject } from "@/emails/staff-alert";
import { site } from "@/lib/site";
import type { Audience, Channel, ConsentPolicy } from "./types";

// Template registry. Each template is versioned: bump `version` whenever the
// wording changes. `preApproved` marks the templates a broker has signed off
// for automatic sending (Global rule 2); anything else goes to the approval
// queue. The approval is tied to the version, so editing a template removes
// its pre-approval until the broker approves the new version (see gate.ts).
//
// Copy rules (Global rule 4): no "approved" / "qualified for" / "fees
// protected" / "will call you today", no closing-timeline promises, and
// "advisor-led" positioning only. templates.test.ts lints every rendered body.

export type BuiltEmail = { channel: "email"; subject: string; html: string; text: string };
export type BuiltSms = { channel: "sms"; body: string };
export type BuiltMessage = BuiltEmail | BuiltSms;

export const TEMPLATE_IDS = [
  "lead_confirmation",
  "document_request",
  "milestone_update",
  "staff_alert",
  "document_request_sms",
  "milestone_update_sms",
  "staff_tier1_sms",
  "staff_alert_sms",
  "sms_stop_reply",
  "sms_help_reply",
  "sms_start_reply",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type TemplateDef = {
  id: TemplateId;
  channel: Channel;
  version: number;
  /** Audiences this template may be addressed to. */
  audiences: readonly Audience[];
  consent: ConsentPolicy;
  /** Broker pre-approved for automatic sending at this version. */
  preApproved: boolean;
  /** Apply TCPA quiet hours (borrower and partner texts only). */
  quietHours: boolean;
  /** Validates `data` and renders the message. Throws a ZodError on bad data. */
  build(data: unknown): Promise<BuiltMessage>;
};

const httpsUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an https URL");
const firstName = z.string().trim().min(1).max(80);

async function renderEmail(subject: string, element: React.ReactElement): Promise<BuiltEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { channel: "email", subject, html, text };
}

function email<S extends z.ZodType>(
  base: Omit<TemplateDef, "channel" | "build" | "quietHours"> & { schema: S; run: (data: z.infer<S>) => Promise<BuiltEmail> },
): TemplateDef {
  const { schema, run, ...rest } = base;
  return { ...rest, channel: "email", quietHours: false, build: async (data) => run(schema.parse(data)) };
}

function sms<S extends z.ZodType>(
  base: Omit<TemplateDef, "channel" | "build"> & { schema: S; body: (data: z.infer<S>) => string },
): TemplateDef {
  const { schema, body, ...rest } = base;
  return { ...rest, channel: "sms", build: async (data) => ({ channel: "sms", body: body(schema.parse(data)) }) };
}

const OPT_OUT = "Reply STOP to opt out, HELP for help. Msg&data rates may apply.";

const TEMPLATES: readonly TemplateDef[] = [
  email({
    id: "lead_confirmation",
    version: 1,
    audiences: ["borrower", "partner"],
    consent: "not_revoked",
    preApproved: true,
    schema: z.object({ firstName, reference: z.string().max(40).optional(), bookingUrl: httpsUrl.nullish() }),
    run: (d) =>
      renderEmail(
        leadConfirmationSubject,
        <LeadConfirmation firstName={d.firstName} reference={d.reference} bookingUrl={d.bookingUrl ?? null} contactEmail={site.email} />,
      ),
  }),
  email({
    id: "document_request",
    version: 1,
    audiences: ["borrower", "partner"],
    consent: "not_revoked",
    preApproved: false,
    schema: z.object({ firstName, items: z.array(z.string().trim().min(1).max(160)).min(1).max(20), uploadUrl: httpsUrl.nullish() }),
    run: (d) =>
      renderEmail(documentRequestSubject, <DocumentRequest firstName={d.firstName} items={d.items} uploadUrl={d.uploadUrl ?? null} contactEmail={site.email} />),
  }),
  email({
    id: "milestone_update",
    version: 1,
    audiences: ["borrower", "partner"],
    consent: "required",
    preApproved: false,
    schema: z.object({ firstName, label: z.string().trim().min(1).max(80), message: z.string().trim().min(1).max(500), bookingUrl: httpsUrl.nullish() }),
    run: (d) =>
      renderEmail(
        milestoneUpdateSubject(d.label),
        <MilestoneUpdate firstName={d.firstName} label={d.label} message={d.message} bookingUrl={d.bookingUrl ?? null} contactEmail={site.email} />,
      ),
  }),
  email({
    id: "staff_alert",
    version: 1,
    audiences: ["staff"],
    consent: "none",
    preApproved: true,
    schema: z.object({
      title: z.string().trim().min(1).max(140),
      lines: z.array(z.string().trim().min(1).max(500)).max(12),
      link: z.object({ href: httpsUrl, label: z.string().trim().min(1).max(80) }).nullish(),
    }),
    run: (d) => renderEmail(staffAlertSubject(d.title), <StaffAlert title={d.title} lines={d.lines} link={d.link ?? null} />),
  }),

  sms({
    id: "document_request_sms",
    version: 1,
    audiences: ["borrower", "partner"],
    consent: "required",
    preApproved: false,
    quietHours: true,
    schema: z.object({ count: z.number().int().min(1).max(50) }),
    body: (d) => `${site.name}: your advisor needs ${d.count} ${d.count === 1 ? "document" : "documents"} for your financing request. Details are in your email. ${OPT_OUT}`,
  }),
  sms({
    id: "milestone_update_sms",
    version: 1,
    audiences: ["borrower", "partner"],
    consent: "required",
    preApproved: false,
    quietHours: true,
    schema: z.object({ label: z.string().trim().min(1).max(60) }),
    body: (d) => `${site.name}: an update on your financing request (${d.label}). Details are in your email. ${OPT_OUT}`,
  }),
  sms({
    id: "staff_tier1_sms",
    version: 1,
    audiences: ["staff"],
    consent: "none",
    preApproved: true,
    quietHours: false,
    schema: z.object({ reference: z.string().trim().min(1).max(20), summary: z.string().trim().min(1).max(100), contactOk: z.boolean() }),
    body: (d) =>
      `Kubera Tier-1 lead ${d.reference}: ${d.summary}. ${d.contactOk ? "Phone and text consent on file." : "Email only: no phone or text consent."} Details in the CRM.`,
  }),
  sms({
    id: "staff_alert_sms",
    version: 1,
    audiences: ["staff"],
    consent: "none",
    preApproved: true,
    quietHours: false,
    schema: z.object({ text: z.string().trim().min(1).max(140) }),
    body: (d) => `Kubera: ${d.text}`,
  }),

  // Protocol replies to an inbound STOP / HELP / START keyword. Always sent,
  // whatever the ledger says, and never held for quiet hours.
  sms({
    id: "sms_stop_reply",
    version: 1,
    audiences: ["borrower", "partner", "staff"],
    consent: "none",
    preApproved: true,
    quietHours: false,
    schema: z.object({}),
    body: () => `${site.name}: you are unsubscribed and will receive no more texts from this number. Reply START to resubscribe.`,
  }),
  sms({
    id: "sms_help_reply",
    version: 1,
    audiences: ["borrower", "partner", "staff"],
    consent: "none",
    preApproved: true,
    quietHours: false,
    schema: z.object({}),
    body: () =>
      `${site.name}: texts about your financing request. Help: email ${site.email}${site.phone ? ` or call ${site.phone}` : ""}. Msg&data rates may apply. Reply STOP to opt out.`,
  }),
  sms({
    id: "sms_start_reply",
    version: 1,
    audiences: ["borrower", "partner", "staff"],
    consent: "none",
    preApproved: true,
    quietHours: false,
    schema: z.object({}),
    body: () => `${site.name}: you are resubscribed to texts about your financing request. ${OPT_OUT}`,
  }),
];

const BY_ID = new Map<TemplateId, TemplateDef>(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: TemplateId): TemplateDef {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`unknown notification template: ${id}`);
  return t;
}

export function allTemplates(): readonly TemplateDef[] {
  return TEMPLATES;
}

// --- Copy lint -----------------------------------------------------------------

const BANNED_COPY: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bapproved\b/i, why: 'never say "approved"' },
  { pattern: /\bqualif(?:ied|y|ies) for\b/i, why: 'never say "qualified for"' },
  { pattern: /fees? protected/i, why: 'never say "fees protected"' },
  { pattern: /will call you today/i, why: 'never promise "will call you today"' },
  { pattern: /\bautonomous\b/i, why: 'positioning is "advisor-led, AI-assisted", not "autonomous"' },
  { pattern: /\b\d+\s*(?:-|–|to)\s*\d+\s*(?:business\s+)?days\b/i, why: "no closing-timeline ranges in notifications" },
  { pattern: /\busury[- ]exempt\b/i, why: "never state that a loan is usury-exempt" },
  { pattern: /(?<!\bnot )\bguarantee(?:d|s)?\b/i, why: 'no guarantees (only "not guaranteed")' },
];

/** Returns the copy-rule violations found in `text` (empty when clean). */
export function findBannedCopy(text: string): string[] {
  return BANNED_COPY.filter(({ pattern }) => pattern.test(text)).map(({ why }) => why);
}
