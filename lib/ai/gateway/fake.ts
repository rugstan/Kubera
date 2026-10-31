// In-memory provider for tests: records every request it receives and answers
// from a script (a function or a queue of results).

import type { ModelProvider } from "@/lib/ai/routing";
import type { ModelProviderClient, ProviderRequest, ProviderResult } from "./types";

export type FakeReply = Partial<ProviderResult> | ((req: ProviderRequest) => Partial<ProviderResult> | Promise<Partial<ProviderResult>>);

export class FakeModelProvider implements ModelProviderClient {
  readonly requests: ProviderRequest[] = [];
  private readonly queue: FakeReply[] = [];

  constructor(
    readonly provider: ModelProvider,
    private readonly fallback: FakeReply = { text: "ok" },
    private readonly isConfigured = true,
  ) {}

  configured(): boolean {
    return this.isConfigured;
  }

  /** Queues replies used in order before the fallback. */
  reply(...replies: FakeReply[]): this {
    this.queue.push(...replies);
    return this;
  }

  async complete(req: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(req);
    const next = this.queue.shift() ?? this.fallback;
    const partial = typeof next === "function" ? await next(req) : next;
    return {
      text: "",
      servedModel: req.model,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
      ...partial,
    };
  }
}
