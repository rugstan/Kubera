import { CloudflareEmailClient, cloudflareEmailConfigFromEnv } from "./cloudflare";
import { ResendEmailClient, resendConfigFromEnv } from "./resend";
import type { EmailClient } from "./types";

export type { EmailClient, OutboundEmail } from "./types";

// Which provider sends transactional email:
//
//   EMAIL_PROVIDER=cloudflare  Cloudflare Email Service (CLOUDFLARE_EMAIL_ACCOUNT_ID + CLOUDFLARE_EMAIL_TOKEN)
//   EMAIL_PROVIDER=resend      Resend (RESEND_API_KEY)
//   unset                      Cloudflare when it is configured, else Resend when it is
//
// Null means no email client: sends are skipped (one log line) and nothing
// crashes. Mail that Cloudflare's terms exclude (the newsletter, cold prospect
// outreach) never takes this path; it uses resendEmailClientFromEnv.

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export function emailClientFromEnv(env: Record<string, string | undefined> = process.env): EmailClient | null {
  const wanted = env.EMAIL_PROVIDER?.trim().toLowerCase() || "";
  if (wanted && wanted !== "cloudflare" && wanted !== "resend") {
    warnOnce(`notify: EMAIL_PROVIDER "${wanted}" is not cloudflare or resend; email notifications are skipped`);
    return null;
  }
  if (wanted !== "resend") {
    const cloudflare = cloudflareEmailConfigFromEnv(env);
    if (cloudflare) return new CloudflareEmailClient(cloudflare);
    if (wanted === "cloudflare") {
      warnOnce("notify: CLOUDFLARE_EMAIL_ACCOUNT_ID (32 hex characters) and CLOUDFLARE_EMAIL_TOKEN are not set; email notifications are skipped");
      return null;
    }
  }
  const resend = resendConfigFromEnv(env);
  if (resend) return new ResendEmailClient(resend);
  warnOnce(
    wanted === "resend"
      ? "notify: RESEND_API_KEY is not set; email notifications are skipped"
      : "notify: no email provider is configured (CLOUDFLARE_EMAIL_ACCOUNT_ID + CLOUDFLARE_EMAIL_TOKEN, or RESEND_API_KEY); email notifications are skipped",
  );
  return null;
}

/**
 * Resend only, whatever EMAIL_PROVIDER says, for mail Cloudflare Email Service
 * does not allow (marketing and unsolicited messages): the newsletter and cold
 * prospect outreach. Null without RESEND_API_KEY, so those stay off.
 */
export function resendEmailClientFromEnv(env: Record<string, string | undefined> = process.env): EmailClient | null {
  const resend = resendConfigFromEnv(env);
  return resend ? new ResendEmailClient(resend) : null;
}
