import { ResendEmailClient, resendConfigFromEnv } from "./resend";
import type { EmailClient } from "./types";

export type { EmailClient, OutboundEmail } from "./types";

let warned = false;

/** Resend when RESEND_API_KEY is set; otherwise null (one log line, sends are skipped, nothing crashes). */
export function emailClientFromEnv(env: Record<string, string | undefined> = process.env): EmailClient | null {
  const config = resendConfigFromEnv(env);
  if (config) return new ResendEmailClient(config);
  if (!warned) {
    warned = true;
    console.warn("notify: RESEND_API_KEY is not set; email notifications are skipped");
  }
  return null;
}
