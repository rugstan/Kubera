import { randomUUID } from "node:crypto";
import { VoiceError, type DialInput, type DialResult, type VoiceClient } from "./types";

/** In-memory voice client for tests and local development: records every command in order. */
export class FakeVoiceClient implements VoiceClient {
  readonly name = "fake" as const;
  readonly log: { type: "dial" | "speak" | "startRecording" | "stopRecording" | "transfer" | "hangup"; callControlId: string; text?: string; to?: string; clientState?: string }[] = [];
  failNext: VoiceError | null = null;

  constructor(readonly fromNumber = "+13105550188") {}

  private maybeFail() {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }

  async dial(input: DialInput): Promise<DialResult> {
    this.maybeFail();
    const callControlId = `fake_call_${randomUUID()}`;
    this.log.push({ type: "dial", callControlId, to: input.to, clientState: input.clientState });
    return { callControlId, callSessionId: `fake_session_${randomUUID()}` };
  }
  async speak(callControlId: string, text: string, clientState: string) {
    this.maybeFail();
    this.log.push({ type: "speak", callControlId, text, clientState });
  }
  async startRecording(callControlId: string) {
    this.maybeFail();
    this.log.push({ type: "startRecording", callControlId });
  }
  async stopRecording(callControlId: string) {
    this.maybeFail();
    this.log.push({ type: "stopRecording", callControlId });
  }
  async transfer(callControlId: string, to: string) {
    this.maybeFail();
    this.log.push({ type: "transfer", callControlId, to });
  }
  async hangup(callControlId: string) {
    this.maybeFail();
    this.log.push({ type: "hangup", callControlId });
  }

  types(): string[] {
    return this.log.map((l) => l.type);
  }
}
