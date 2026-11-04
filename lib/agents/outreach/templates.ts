import { createHash } from "node:crypto";
import { z } from "zod";
import type { ConsentPolicy } from "@/lib/notify/types";
import { site } from "@/lib/site";
import type { OutreachAudience, OutreachChannel, OutreachKind } from "./types";

// Template registry for the chasers. Every template is versioned: bump
// `version` whenever the wording changes. `preApproved` marks the templates a
// broker signed off for automatic sending (Global rule 2); every other template
// goes through the approval queue. Pre-approval is tied to the version and can
// also be granted through OUTREACH_PREAPPROVED_TEMPLATES ("id@version,...") or
// by a broker pre-approving the template body in the approvals queue
// (`fingerprint` is the body hash the queue compares).
//
// Copy rules (Global rule 4): no "approved" / "qualified for" / "fees
// protected" / "will call you today", no closing-timeline promises,
// advisor-led positioning. templates.test.ts lints every rendered body.
// Reminders ask for documents and conditions only: nothing about money moving.

export const OUTREACH_TEMPLATE_IDS = [
  "speed_to_lead_sms",
  "speed_to_lead_email",
  "document_reminder_sms",
  "document_reminder_email",
  "closing_nudge_sms",
  "closing_nudge_email",
  "vendor_nudge_email",
] as const;
export type OutreachTemplateId = (typeof OUTREACH_TEMPLATE_IDS)[number];

export type BuiltSms = { channel: "sms"; body: string };
export type BuiltEmail = { channel: "email"; subject: string; text: string; html: string };
export type BuiltMessage = BuiltSms | BuiltEmail;

export type TemplateDef = {
  id: OutreachTemplateId;
  version: number;
  channel: OutreachChannel;
  kind: OutreachKind;
  audiences: readonly OutreachAudience[];
  consent: ConsentPolicy;
  preApproved: boolean;
  /** TCPA quiet hours apply (borrower texts). */
  quietHours: boolean;
  /** Sample data used to fingerprint the wording. */
  sample: unknown;
  /** Validates `data` and renders the message. Throws a ZodError on bad data. */
  build(data: unknown): BuiltMessage;
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
const line = z.string().trim().min(1).max(200);

const OPT_OUT = "Reply STOP to opt out, HELP for help. Msg&data rates may apply.";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type EmailParts = { subject: string; greeting: string; paragraphs: string[]; list?: string[]; link?: { href: string; label: string } | null; closing?: string[] };

/** Plain, accessible HTML (one column, system fonts) plus the matching plain-text body. */
function renderEmail(p: EmailParts): BuiltEmail {
  const text = [
    p.greeting,
    "",
    ...p.paragraphs.flatMap((x) => [x, ""]),
    ...(p.list ? [...p.list.map((x) => `- ${x}`), ""] : []),
    ...(p.link ? [`${p.link.label}: ${p.link.href}`, ""] : []),
    ...(p.closing ?? []).flatMap((x) => [x, ""]),
    `${site.name}`,
    `Reply to this email or write to ${site.email}.`,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;line-height:1.5"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px"><p style="margin:0 0 16px">${esc(p.greeting)}</p>${p.paragraphs.map((x) => `<p style="margin:0 0 16px">${esc(x)}</p>`).join("")}${p.list ? `<ul style="margin:0 0 16px;padding-left:20px">${p.list.map((x) => `<li style="margin:0 0 6px">${esc(x)}</li>`).join("")}</ul>` : ""}${p.link ? `<p style="margin:0 0 16px"><a href="${esc(p.link.href)}" style="color:#047857">${esc(p.link.label)}</a></p>` : ""}${(p.closing ?? []).map((x) => `<p style="margin:0 0 16px">${esc(x)}</p>`).join("")}<p style="margin:24px 0 0;color:#6e6e73;font-size:13px">${esc(site.name)}. Reply to this email or write to <a href="mailto:${esc(site.email)}" style="color:#047857">${esc(site.email)}</a>.</p></div></body></html>`;
  return { channel: "email", subject: p.subject, text, html };
}

function smsTemplate<S extends z.ZodType>(
  def: Omit<TemplateDef, "channel" | "build" | "quietHours"> & { quietHours?: boolean; schema: S; body: (d: z.infer<S>) => string },
): TemplateDef {
  const { schema, body, quietHours, ...rest } = def;
  return { ...rest, channel: "sms", quietHours: quietHours ?? true, build: (data) => ({ channel: "sms", body: body(schema.parse(data)) }) };
}

function emailTemplate<S extends z.ZodType>(def: Omit<TemplateDef, "channel" | "build" | "quietHours"> & { schema: S; run: (d: z.infer<S>) => EmailParts }): TemplateDef {
  const { schema, run, ...rest } = def;
  return { ...rest, channel: "email", quietHours: false, build: (data) => renderEmail(run(schema.parse(data))) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const portalUrl = () => `${site.siteUrl.replace(/\/$/, "")}/portal`;

const TEMPLATES: readonly TemplateDef[] = [
  // Speed to lead: sent within 60 seconds of a Tier-1/2 lead. Fixed wording that
  // carries only a first name and the booking link, so the broker signs off once.
  smsTemplate({
    id: "speed_to_lead_sms",
    version: 1,
    kind: "speed_to_lead",
    audiences: ["borrower"],
    consent: "required",
    preApproved: true,
    sample: { firstName: "Pat", bookingUrl: "https://cal.com/corin/intro" },
    schema: z.object({ firstName: firstName.nullish(), bookingUrl: httpsUrl.nullish() }),
    body: (d) =>
      `${site.name}: thanks for your financing request${d.firstName ? `, ${d.firstName}` : ""}. An advisor is reviewing it. ${
        d.bookingUrl ? `Pick a time to talk: ${d.bookingUrl}` : `Reply here or email ${site.email}.`
      } ${OPT_OUT}`,
  }),
  emailTemplate({
    id: "speed_to_lead_email",
    version: 1,
    kind: "speed_to_lead",
    audiences: ["borrower"],
    consent: "not_revoked",
    preApproved: true,
    sample: { firstName: "Pat", bookingUrl: "https://cal.com/corin/intro" },
    schema: z.object({ firstName: firstName.nullish(), bookingUrl: httpsUrl.nullish() }),
    run: (d) => ({
      subject: "We received your financing request",
      greeting: `Hi ${d.firstName ?? "there"},`,
      paragraphs: [
        "Thanks for your financing request. An advisor at Corin Commercial is reviewing the details you shared.",
        d.bookingUrl ? "If you would like to talk it through, you can pick a time that suits you." : "If you would like to talk it through, reply to this email with a good time.",
      ],
      link: d.bookingUrl ? { href: d.bookingUrl, label: "Pick a time to talk" } : null,
    }),
  }),

  // Document reminders: driven by the deal checklist, one per cadence window.
  smsTemplate({
    id: "document_reminder_sms",
    version: 1,
    kind: "document_reminder",
    audiences: ["borrower"],
    consent: "required",
    preApproved: false,
    sample: { count: 3 },
    schema: z.object({ count: z.number().int().min(1).max(50) }),
    body: (d) => `${site.name}: your advisor is still waiting on ${plural(d.count, "document", "documents")} for your financing request. The list is in your email. ${OPT_OUT}`,
  }),
  emailTemplate({
    id: "document_reminder_email",
    version: 1,
    kind: "document_reminder",
    audiences: ["borrower"],
    consent: "not_revoked",
    preApproved: false,
    sample: { firstName: "Pat", items: [{ title: "Trailing 12-month operating statement", needsCorrection: false }], portalUrl: "https://corincommercial.com/portal", reminderNumber: 1 },
    schema: z.object({
      firstName,
      items: z.array(z.object({ title: line, needsCorrection: z.boolean(), note: z.string().trim().max(300).nullish() })).min(1).max(30),
      portalUrl: httpsUrl.nullish(),
      reminderNumber: z.number().int().min(1).max(20),
    }),
    run: (d) => ({
      subject: d.reminderNumber > 1 ? "A reminder: documents for your financing request" : "Documents for your financing request",
      greeting: `Hi ${d.firstName},`,
      paragraphs: [
        d.reminderNumber > 1
          ? "A quick reminder: your advisor is still waiting on the items below. Having them lets your advisor keep your file moving."
          : "To keep your file moving, your advisor is waiting on the items below.",
      ],
      list: d.items.map((i) => (i.needsCorrection ? `${i.title} (needs a corrected copy${i.note ? `: ${i.note}` : ""})` : i.title)),
      link: d.portalUrl ? { href: d.portalUrl, label: "Open your document checklist" } : null,
      closing: [
        "If something here does not apply, or you need more time, just reply and tell us. Please do not email Social Security numbers or bank account numbers.",
      ],
    }),
  }),

  // Closing checklist nudges: pre-closing items and lender conditions only.
  smsTemplate({
    id: "closing_nudge_sms",
    version: 1,
    kind: "closing_nudge",
    audiences: ["borrower"],
    consent: "required",
    preApproved: false,
    sample: { count: 2 },
    schema: z.object({ count: z.number().int().min(1).max(50) }),
    body: (d) => `${site.name}: ${plural(d.count, "item is", "items are")} still open on your closing checklist. Your advisor emailed the details. ${OPT_OUT}`,
  }),
  emailTemplate({
    id: "closing_nudge_email",
    version: 1,
    kind: "closing_nudge",
    audiences: ["borrower"],
    consent: "not_revoked",
    preApproved: false,
    sample: { firstName: "Pat", items: ["Evidence of property insurance"], portalUrl: "https://corincommercial.com/portal", reminderNumber: 1 },
    schema: z.object({ firstName, items: z.array(line).min(1).max(30), portalUrl: httpsUrl.nullish(), reminderNumber: z.number().int().min(1).max(20) }),
    run: (d) => ({
      subject: "Open items on your closing checklist",
      greeting: `Hi ${d.firstName},`,
      paragraphs: [
        "These items are still open on your closing checklist. The lender, title and escrow need them before closing can be scheduled. Timing depends on the lender and third-party deliverables and is not guaranteed.",
      ],
      list: [...d.items],
      link: d.portalUrl ? { href: d.portalUrl, label: "Open your checklist" } : null,
      closing: ["Reply to this email if you have a question or an item will be late, and your advisor will adjust the plan."],
    }),
  }),

  // Vendor order tracking: a status nudge to the vendor on a third-party report order.
  emailTemplate({
    id: "vendor_nudge_email",
    version: 1,
    kind: "vendor_nudge",
    audiences: ["vendor"],
    consent: "not_revoked",
    preApproved: false,
    sample: { vendorName: "Pacific Environmental", reportLabel: "Phase I environmental", propertyRef: "Sample Gardens, Fresno CA", vendorReference: "PE-1042", dueDate: "2026-11-20", overdue: false, reminderNumber: 1 },
    schema: z.object({
      vendorName: z.string().trim().max(120).nullish(),
      reportLabel: line,
      propertyRef: z.string().trim().max(200).nullish(),
      vendorReference: z.string().trim().max(80).nullish(),
      dueDate: z.iso.date().nullish(),
      overdue: z.boolean(),
      reminderNumber: z.number().int().min(1).max(20),
    }),
    run: (d) => ({
      subject: `Status check: ${d.reportLabel}${d.vendorReference ? ` (${d.vendorReference})` : ""}`,
      greeting: `Hello${d.vendorName ? ` ${d.vendorName}` : ""},`,
      paragraphs: [
        `We are following up on the ${d.reportLabel} order${d.propertyRef ? ` for ${d.propertyRef}` : ""}${d.vendorReference ? ` (your reference ${d.vendorReference})` : ""}.`,
        d.dueDate ? (d.overdue ? `It was due ${d.dueDate}. Could you reply with a status update and an expected delivery date?` : `It is due ${d.dueDate}. Could you confirm you are on track, or reply with an expected delivery date?`) : "Could you reply with a status update and an expected delivery date?",
        "Corin Commercial is the borrower's loan broker. If anything is holding up the order, please tell us what you need and we will pass it to the borrower.",
      ],
    }),
  }),
];

const BY_ID = new Map<OutreachTemplateId, TemplateDef>(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: OutreachTemplateId): TemplateDef {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`unknown outreach template: ${id}`);
  return t;
}

export const allTemplates = (): readonly TemplateDef[] => TEMPLATES;

/** Hash of the template's wording at its version: what a broker approves in the queue. */
export function fingerprint(t: TemplateDef): string {
  const built = t.build(t.sample);
  return createHash("sha256").update(`${t.id}@${t.version}\n${JSON.stringify(built)}`).digest("hex");
}

/** "id@version" entries a broker pre-approved: OUTREACH_PREAPPROVED_TEMPLATES="document_reminder_email@1,...". */
export function preApprovedFromEnv(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  return new Set(
    (env.OUTREACH_PREAPPROVED_TEMPLATES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPreApproved(t: TemplateDef, extra: ReadonlySet<string> = new Set()): boolean {
  return t.preApproved || extra.has(`${t.id}@${t.version}`);
}
