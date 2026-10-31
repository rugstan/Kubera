import { TelnyxSmsClient, telnyxConfigFromEnv } from "./telnyx";
import type { SmsClient } from "./types";

export type { SmsClient, OutboundSms } from "./types";

let warned = false;

/** Telnyx when TELNYX_API_KEY and TELNYX_FROM_NUMBER are set; otherwise null (one log line, sends are skipped). */
export function smsClientFromEnv(env: Record<string, string | undefined> = process.env): SmsClient | null {
  const config = telnyxConfigFromEnv(env);
  if (config) return new TelnyxSmsClient(config);
  if (!warned) {
    warned = true;
    console.warn("notify: TELNYX_API_KEY / TELNYX_FROM_NUMBER are not set; SMS notifications are skipped");
  }
  return null;
}
