// Contact details and the mailbox routing table for /contact. The mailboxes
// mirror the real Zoho Mail boxes in docs/BUILD_PLAN.md. docs@, admin@ and the
// send-only addresses are deliberately not listed: documents go through the
// secure upload link an advisor sends, and the rest are internal.

import { CALL_LINK, type NavLink } from "@/components/site/nav";
import { site } from "@/lib/site";

export interface Mailbox {
  /** Local part of the address, e.g. "deals". */
  local: string;
  audience: string;
  useFor: string;
  /** Other addresses that land in this mailbox. */
  aliases?: readonly string[];
}

export const MAILBOXES: readonly Mailbox[] = [
  {
    local: "deals",
    audience: "Borrowers and property owners",
    useFor: "Financing a property, questions about a quote or sizing result, and general inquiries.",
    aliases: ["hello", "info"],
  },
  {
    local: "lenders",
    audience: "Lenders and capital providers",
    useFor: "Term sheets, credit box updates and replies to a loan package.",
  },
  {
    local: "partners",
    audience: "Referral brokers and operators",
    useFor: "Referral partnerships, co-brokering and operator introductions.",
  },
  {
    local: "vendors",
    audience: "Appraisers, engineers and other third-party vendors",
    useFor: "Vendor registration, report orders and invoices.",
  },
  {
    local: "compliance",
    audience: "Anyone with a licensing, disclosure or complaint question",
    useFor: "Licensing and disclosure questions, complaints, and privacy requests.",
    aliases: ["privacy"],
  },
];

export function mailboxAddress(local: string): string {
  return `${local}@${site.primaryDomain}`;
}

/** Cal.com handle such as `kubera/intro`: one to three path segments of letters, digits, `-` and `_`. */
const CAL_LINK = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,2}$/i;

type Env = Record<string, string | undefined>;

/** The booking handle from NEXT_PUBLIC_CALCOM_LINK, or null when unset or malformed. */
export function calcomHandle(env: Env = process.env): string | null {
  const raw = (env.NEXT_PUBLIC_CALCOM_LINK ?? "").trim().replace(/^\/+|\/+$/g, "");
  return CAL_LINK.test(raw) ? raw : null;
}

export function calcomUrls(handle: string): { page: string; embed: string } {
  const page = `https://cal.com/${handle}`;
  return { page, embed: `${page}?embed=true&layout=month_view` };
}

export interface ContactDetails {
  email: string;
  phone: string;
  /** Office address; NEXT_PUBLIC_OFFICE_ADDRESS, else the DRE licensed address. Empty when neither is set. */
  address: string;
  /** Digits and a leading plus only, for a tel: link. Empty when the phone is unset. */
  telHref: string;
  scheduling: ReturnType<typeof calcomUrls> | null;
}

export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 7 ? digits : "";
}

export function contactDetails(env: Env = process.env): ContactDetails {
  const handle = calcomHandle(env);
  const phone = (env.NEXT_PUBLIC_CONTACT_PHONE ?? site.phone).trim();
  return {
    email: site.email,
    phone,
    address: (env.NEXT_PUBLIC_OFFICE_ADDRESS ?? "").trim() || site.licensedAddress,
    telHref: telHref(phone),
    scheduling: handle ? calcomUrls(handle) : null,
  };
}

/** The fallback for "Book a call" while online scheduling is not configured. */
export const EMAIL_ADVISOR_LABEL = "Email an advisor";

/**
 * The "talk to a person" action shown beside the primary call to action. It is
 * "Book a call" (to the scheduler on /contact) once NEXT_PUBLIC_CALCOM_LINK is
 * a valid handle, and "Email an advisor" until then, so no button lands on a
 * page that cannot book. Client components receive the result as a prop:
 * `process.env` is not populated in the browser.
 */
export function callLink(env: Env = process.env): NavLink & { kind: "book" | "email" } {
  return calcomHandle(env) ? { ...CALL_LINK, kind: "book" } : { href: `mailto:${site.email}`, label: EMAIL_ADVISOR_LABEL, kind: "email" };
}
