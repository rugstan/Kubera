import { randomUUID } from "node:crypto";
import { SmsError, type OutboundSms, type SmsClient, type SmsSendResult } from "./types";

/** In-memory SMS client for tests and local development. */
export class FakeSmsClient implements SmsClient {
  readonly name = "fake" as const;
  readonly sent: (OutboundSms & { providerMessageId: string })[] = [];
  failNext: SmsError | null = null;

  constructor(readonly fromNumber = "+13105550199") {}

  async send(sms: OutboundSms): Promise<SmsSendResult> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    const providerMessageId = `fake_sms_${randomUUID()}`;
    this.sent.push({ ...sms, providerMessageId });
    return { providerMessageId };
  }
}
