// Which mailbox connector the inbound pipeline reads from. Pure (no
// server-only imports) so it can be unit-tested.
//
//   MAIL_PROVIDER=mailflare  Mailflare over JMAP (MAILFLARE_URL + MAILFLARE_JMAP_KEY[_<MAILBOX>])
//   MAIL_PROVIDER=zoho       Zoho Mail REST (ZOHO_MAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)
//   unset                    Mailflare when it is configured, else Zoho Mail when it is
//
// Both connectors are read-only. Null means inbound mail stays off.

import { MailflareClient, mailflareConfigFromEnv } from "./mailflare";
import type { MailProvider } from "./types";
import { ZohoMailClient, zohoMailConfigFromEnv } from "./zoho";

export type MailProviderChoice = { provider: MailProvider; reason: null } | { provider: null; reason: string };

export function mailProviderFromEnv(env: Record<string, string | undefined> = process.env): MailProviderChoice {
  const wanted = env.MAIL_PROVIDER?.trim().toLowerCase() || "";
  if (wanted && wanted !== "mailflare" && wanted !== "zoho") return { provider: null, reason: `MAIL_PROVIDER "${wanted}" is not mailflare or zoho` };
  if (wanted !== "zoho") {
    const mailflare = mailflareConfigFromEnv(env);
    if (mailflare) return { provider: new MailflareClient(mailflare), reason: null };
    if (wanted === "mailflare") return { provider: null, reason: "MAILFLARE_URL (https) and MAILFLARE_JMAP_KEY are not set" };
  }
  const zoho = zohoMailConfigFromEnv(env);
  if (zoho) return { provider: new ZohoMailClient(zoho), reason: null };
  return { provider: null, reason: wanted === "zoho" ? "ZOHO_MAIL_CLIENT_ID/SECRET/REFRESH_TOKEN are not set" : "no mail provider is configured (MAILFLARE_URL + MAILFLARE_JMAP_KEY, or ZOHO_MAIL_*)" };
}
