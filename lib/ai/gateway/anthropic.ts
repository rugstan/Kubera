// Claude behind the gateway, through the official Anthropic SDK.
//
// Request shape (Global rule 7): beta messages stream + finalMessage(), the
// server-side refusal fallback where the model supports it, explicit effort,
// structured output via output_config.format. Never temperature/top_p,
// budget_tokens, disabled thinking, assistant prefill or forced tool_choice.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { GatewayProviderError, type GatewayStopReason, type ModelProviderClient, type ProviderRequest, type ProviderResult } from "./types";

export const CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The seam tests replace: just the streaming call the provider uses. */
export interface AnthropicLike {
  beta: { messages: { stream(params: BetaMessageStreamParams, options?: { signal?: AbortSignal }): { finalMessage(): Promise<BetaMessage> } } };
}

/**
 * Models with a server-side refusal fallback. The bulk tier has none (a fallback list
 * is a 400 there, and "default" changes nothing), so it gets no `fallbacks`.
 */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5|fable-5-1)$/.test(model);
}

/** Builds the Messages API request. Pure, so tests can pin exactly what is sent. */
export function buildClaudeParams(req: ProviderRequest): BetaMessageStreamParams {
  const fallback = supportsServerFallback(req.model);
  const outputConfig: NonNullable<BetaMessageStreamParams["output_config"]> = { effort: req.effort ?? "medium" };
  if (req.jsonSchema) outputConfig.format = { type: "json_schema", schema: req.jsonSchema };
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(fallback ? { betas: [CLAUDE_FALLBACK_BETA], fallbacks: "default" as const } : {}),
    output_config: outputConfig,
    ...(req.system ? { system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }] } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
}

function mapStop(reason: string | null | undefined): GatewayStopReason {
  switch (reason) {
    case "end_turn":
    case "max_tokens":
    case "refusal":
    case "stop_sequence":
    case "tool_use":
    case "pause_turn":
      return reason;
    default:
      return "other";
  }
}

export function claudeResult(msg: BetaMessage): ProviderResult {
  const text = msg.content
    .filter((b): b is Extract<BetaMessage["content"][number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const stopReason = mapStop(msg.stop_reason);
  const details = (msg as { stop_details?: { category?: string | null } | null }).stop_details;
  return {
    text,
    servedModel: msg.model,
    stopReason,
    usage: { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 },
    ...(stopReason === "refusal" ? { refusalCategory: details?.category ?? null } : {}),
  };
}

export class AnthropicProvider implements ModelProviderClient {
  readonly provider = "anthropic" as const;
  private client: AnthropicLike | undefined;

  constructor(private readonly opts: { client?: AnthropicLike; apiKey?: string } = {}) {
    this.client = opts.client;
  }

  configured(): boolean {
    return Boolean(this.opts.client || this.opts.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  private sdk(): AnthropicLike {
    // Lazy: no SDK constructor at module load.
    this.client ??= new Anthropic(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {});
    return this.client;
  }

  async complete(req: ProviderRequest): Promise<ProviderResult> {
    try {
      const stream = this.sdk().beta.messages.stream(buildClaudeParams(req), req.signal ? { signal: req.signal } : undefined);
      return claudeResult(await stream.finalMessage());
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw new GatewayProviderError("anthropic", 429, err.message, true);
      if (err instanceof Anthropic.InternalServerError) throw new GatewayProviderError("anthropic", err.status ?? 500, err.message, true);
      if (err instanceof Anthropic.APIConnectionError) throw new GatewayProviderError("anthropic", null, err.message, true);
      if (err instanceof Anthropic.APIError) throw new GatewayProviderError("anthropic", err.status ?? null, err.message, false);
      throw err;
    }
  }
}
