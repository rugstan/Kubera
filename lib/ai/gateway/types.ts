// Model gateway contract shared by the providers (Claude, NVIDIA NIM, xAI).
// lib/ai/gateway.ts is the entry point; providers live next to this file.

import type { AiPurpose, ModelProvider, RouteDecision } from "@/lib/ai/routing";
import type { Classification, DataCategory } from "@/lib/privacy/classification";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type GatewayMessage = { role: "user" | "assistant"; content: string };

/** A JSON Schema object for structured output (object root, additionalProperties: false). */
export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: false; [k: string]: unknown };

export type GatewayRequest = {
  model: string;
  /** Explicit provider; inferred from the model id when omitted. */
  provider?: ModelProvider;
  purpose: AiPurpose;
  /** Frozen instructions (cached for Claude). Never put untrusted text here. */
  system?: string;
  messages: GatewayMessage[];
  maxTokens: number;
  effort?: Effort;
  /** Ask for JSON matching this schema; `json` on the response holds the parsed value. */
  jsonSchema?: JsonSchema;
  /** What the caller knows about the data (routing guard floor). */
  declared?: { level?: Classification; categories?: readonly DataCategory[] };
  table?: string;
  subject?: { aiProcessingOptOut?: boolean };
  /**
   * "refuse" (default) throws RoutingRefusedError when the payload is above
   * the route's ceiling; "redact" masks what is above it and re-checks.
   */
  onSensitive?: "refuse" | "redact";
  /** Tracing labels. */
  trace?: { name: string; traceId?: string; metadata?: Record<string, unknown> };
  signal?: AbortSignal;
};

export type GatewayStopReason = "end_turn" | "max_tokens" | "refusal" | "stop_sequence" | "tool_use" | "pause_turn" | "other";

export type ProviderResult = {
  text: string;
  /** Model that actually served the request (may differ after a server-side fallback). */
  servedModel: string;
  stopReason: GatewayStopReason;
  usage: { inputTokens: number; outputTokens: number };
  /** Refusal category when the provider reports one. */
  refusalCategory?: string | null;
};

export type GatewayResponse = ProviderResult & {
  provider: ModelProvider;
  requestedModel: string;
  /** Parsed structured output (only when jsonSchema was set and the reply parsed). */
  json?: unknown;
  refused: boolean;
  /** True when the routing guard masked part of the payload. */
  redacted: boolean;
  route: Pick<RouteDecision, "level" | "categories" | "ceiling">;
  latencyMs: number;
};

/** What a provider receives after routing (already redacted when allowed). */
export type ProviderRequest = Omit<GatewayRequest, "provider" | "declared" | "table" | "subject" | "onSensitive" | "trace">;

export interface ModelProviderClient {
  readonly provider: ModelProvider;
  /** False when the API key is missing; the gateway then refuses with GatewayUnavailableError. */
  configured(): boolean;
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

export class GatewayUnavailableError extends Error {
  constructor(readonly provider: ModelProvider) {
    super(`Model provider "${provider}" is not configured`);
    this.name = "GatewayUnavailableError";
  }
}

export class GatewayProviderError extends Error {
  constructor(
    readonly provider: ModelProvider,
    readonly status: number | null,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GatewayProviderError";
  }
}
