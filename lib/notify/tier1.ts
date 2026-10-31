import { site } from "@/lib/site";
import type { LeadRecord } from "./leads";
import type { Notifier } from "./service";
import type { SendOutcome } from "./types";

// Tier-1 lead alert: when Jev scores a lead TIER_1_INSTITUTIONAL_HOT, the
// brokers get a text within 60 seconds through the pre-approved staff_tier1_sms
// template, plus a staff email. The text carries a reference and a one-line
// summary only (no names, emails or phone numbers) and says whether the
// borrower gave phone and text consent, so nobody calls someone who only
// agreed to email.

export const TIER_1 = "TIER_1_INSTITUTIONAL_HOT";
export const TIER1_SLA_MS = 60_000;

export type StaffContacts = { phones: string[]; emails: string[] };

/** NOTIFY_STAFF_SMS_NUMBERS (E.164, comma-separated) and NOTIFY_STAFF_EMAILS (defaults to the deals@ mailbox). */
export function staffContactsFromEnv(env: Record<string, string | undefined> = process.env): StaffContacts {
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const emails = list(env.NOTIFY_STAFF_EMAILS);
  return { phones: list(env.NOTIFY_STAFF_SMS_NUMBERS), emails: emails.length > 0 ? emails : [site.email] };
}

const ACRONYMS: Record<string, string> = { hud: "HUD", sba: "SBA", cmbs: "CMBS", pip: "PIP", cre: "CRE", ltv: "LTV", dscr: "DSCR" };

const humanize = (s: string) =>
  s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w] ?? w)
    .join(" ");

export function loanAmountLabel(amount: number | null): string {
  if (amount == null || !Number.isFinite(amount)) return "amount not given";
  return amount >= 1_000_000 ? `$${(amount / 1_000_000).toFixed(1)}M` : `$${Math.round(amount / 1_000).toLocaleString("en-US")}K`;
}

export const leadReference = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

export function tier1Summary(lead: Pick<LeadRecord, "loanAmount" | "program" | "assetType">): string {
  const parts = [loanAmountLabel(lead.loanAmount), lead.assetType ? humanize(lead.assetType) : null, lead.program ? humanize(lead.program) : null].filter(Boolean);
  return parts.join(" ").slice(0, 100);
}

export type Tier1AlertResult = {
  alerted: boolean;
  skipped?: "not_tier_1";
  /** Milliseconds from lead creation to the end of this alert run. */
  latencyMs: number;
  withinSla: boolean;
  sms: SendOutcome[];
  email: SendOutcome[];
};

export async function alertTier1Lead(lead: LeadRecord, notifier: Notifier, staff: StaffContacts, now: () => Date = () => new Date()): Promise<Tier1AlertResult> {
  const elapsed = () => Math.max(0, now().getTime() - Date.parse(lead.createdAt));
  if (lead.tier !== TIER_1) return { alerted: false, skipped: "not_tier_1", latencyMs: elapsed(), withinSla: false, sms: [], email: [] };

  const reference = leadReference(lead.id);
  const summary = tier1Summary(lead);
  const contactOk = lead.contact.consent && Boolean(lead.contact.phone);
  const base = { leadId: lead.id, metadata: { tier: TIER_1, reference } };

  // Texts first: the 60-second target is for the broker SMS.
  const sms = await Promise.all(
    staff.phones.map((phone) =>
      notifier.send({
        ...base,
        templateId: "staff_tier1_sms",
        to: { audience: "staff", phone },
        data: { reference, summary, contactOk },
        idempotencyKey: `tier1:${lead.id}:sms:${phone}`,
      }),
    ),
  );
  const smsDoneMs = elapsed();

  const email = await Promise.all(
    staff.emails.map((address) =>
      notifier.send({
        ...base,
        templateId: "staff_alert",
        to: { audience: "staff", email: address },
        data: {
          title: `Tier-1 lead ${reference}: ${summary}`,
          lines: [
            `Reference ${reference}. Jev flagged this lead Tier 1 (institutional hot).`,
            contactOk ? "Phone and text consent is on file." : "No phone or text consent on file: contact by email only.",
            `Received ${lead.createdAt}.`,
            `Broker text sent ${Math.round(smsDoneMs / 1000)} seconds after the lead arrived.`,
          ],
          link: { href: `${site.siteUrl.replace(/\/$/, "")}/pipeline`, label: "Open the pipeline" },
        },
        idempotencyKey: `tier1:${lead.id}:email:${address.toLowerCase()}`,
      }),
    ),
  );

  const delivered = sms.some((o) => o.status === "sent");
  return { alerted: true, latencyMs: smsDoneMs, withinSla: delivered && smsDoneMs <= TIER1_SLA_MS, sms, email };
}
