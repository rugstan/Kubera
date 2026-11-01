// Typed SMS client. The real implementation is Telnyx (REST); tests use the
// in-memory fake. No key configured means no client (see ./index.ts).

export type OutboundSms = {
  /** E.164 destination. */
  to: string;
  text: string;
};

export type SmsSendResult = { providerMessageId: string };

export class SmsError extends Error {
  /** True when the provider certainly did not take the message (failed before the request went out). */
  readonly notSent: boolean;

  constructor(
    message: string,
    readonly status?: number,
    options: { notSent?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SmsError";
    this.notSent = options.notSent ?? false;
  }
}

/**
 * Whether an SMS send failure is definitive, so sending again cannot deliver a
 * second text. Telnyx /v2/messages takes no idempotency key, so only a failure
 * we know the provider refused may be retried: an error raised before the
 * request went out, or a 4xx rejection other than 408 (timeout) and 429 (rate
 * limit). A timeout, a network error, a 5xx, an unreadable success response or
 * any error that is not an SmsError may mean the message was accepted.
 */
export function smsFailureIsDefinitive(err: unknown): boolean {
  if (!(err instanceof SmsError)) return false;
  if (err.notSent) return true;
  const s = err.status;
  return s !== undefined && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

export interface SmsClient {
  readonly name: "telnyx" | "fake";
  /** The sending number (E.164). */
  readonly fromNumber: string;
  send(sms: OutboundSms): Promise<SmsSendResult>;
}
