// Typed SMS client. The real implementation is Telnyx (REST); tests use the
// in-memory fake. No key configured means no client (see ./index.ts).

export type OutboundSms = {
  /** E.164 destination. */
  to: string;
  text: string;
};

export type SmsSendResult = { providerMessageId: string };

export class SmsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SmsError";
  }
}

export interface SmsClient {
  readonly name: "telnyx" | "fake";
  /** The sending number (E.164). */
  readonly fromNumber: string;
  send(sms: OutboundSms): Promise<SmsSendResult>;
}
