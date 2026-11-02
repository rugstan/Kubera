// Model gateway: one interface for every model Corin calls.
//
//   Claude      Anthropic SDK (lib/ai/gateway/anthropic.ts)
//   NVIDIA NIM  OpenAI-compatible HTTP (integrate.api.nvidia.com)
//   xAI         OpenAI-compatible HTTP (api.x.ai)
//
// Every call passes the model routing guard (lib/ai/routing.ts) before a byte
// leaves the server: xAI never receives borrower data, restricted fields go
// only to Claude for document extraction, and opted-out subjects' personal
// data goes nowhere. A refused route throws RoutingRefusedError and the
// provider is never called. Calls are traced to Langfuse when configured
// (metadata only by default; lib/langfuse).
//
// Providers without an API key are "unavailable": the gateway throws
// GatewayUnavailableError, which callers turn into a degraded path (e.g. the
// mail classifier falls back to rules).

import { assertRoutable, isModelProvider, prepareForRoute, providerForModel, RoutingRefusedError, type ModelProvider, type RouteDecision } from "@/lib/ai/routing";
import { getTracer, type Tracer } from "@/lib/langfuse";
import { AnthropicProvider } from "./gateway/anthropic";
import { NVIDIA_BASE_URL, OpenAICompatibleProvider, XAI_BASE_URL } from "./gateway/openai-compatible";
import {
  GatewayUnavailableError,
  type GatewayRequest,
  type GatewayResponse,
  type ModelProviderClient,
  type ProviderRequest,
} from "./gateway/types";

export * from "./gateway/types";
export { RoutingRefusedError };

/** Model ids by tier (Global rule 7). */
export const MODELS = {
  /** Default: advisor, drafting, document extraction. */
  claude: "claude-opus-5-5",
  /** Mid tier. */
  claudeMid: "claude-sonnet-5-5",
  /** Cheap bulk classification (inbound mail triage). */
  claudeBulk: "claude-haiku-5-5",
} as const;

/** NVIDIA / xAI model ids are configurable; these are the defaults. */
export function nvidiaModel(env: Record<string, string | undefined> = process.env): string {
  return env.NVIDIA_NIM_MODEL?.trim() || "nvidia/llama-3.3-nemotron-super-49b-v1.5";
}
export function xaiModel(env: Record<string, string | undefined> = process.env): string {
  return env.XAI_MODEL?.trim() || "grok-4";
}

export type ModelGateway = {
  complete(req: GatewayRequest): Promise<GatewayResponse>;
  /** True when the provider for `model` has credentials. */
  available(model: string, provider?: ModelProvider): boolean;
};

export type GatewayDeps = {
  providers: Partial<Record<ModelProvider, ModelProviderClient>>;
  tracer?: Tracer;
  now?: () => number;
};

/**
 * Accepts AI Gateway-style ids ("<provider>/<model>") as
 * well as bare provider ids, and returns the id the provider's own API expects.
 * NVIDIA ids keep their namespace ("nvidia/…", "meta/…"): that is their native form.
 */
export function providerModelId(model: string, provider: ModelProvider): string {
  const m = model.trim();
  if (provider === "anthropic") return m.replace(/^anthropic[/:]/i, "");
  if (provider === "xai") return m.replace(/^xai[/:]/i, "");
  return m;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function createGateway(deps: GatewayDeps): ModelGateway {
  const now = deps.now ?? (() => Date.now());
  const resolve = (model: string, provider?: ModelProvider) => provider ?? providerForModel(model);

  return {
    available(model, provider) {
      const p = resolve(model, provider);
      return Boolean(p && deps.providers[p]?.configured());
    },

    async complete(req) {
      const tracer = deps.tracer ?? getTracer();
      const routeReq = {
        model: req.model,
        ...(req.provider ? { provider: req.provider } : {}),
        purpose: req.purpose,
        payload: { system: req.system ?? "", messages: req.messages },
        ...(req.declared ? { declared: req.declared } : {}),
        ...(req.table ? { table: req.table } : {}),
        ...(req.subject ? { subject: req.subject } : {}),
      };

      // 1. Routing guard first: nothing is sent if it refuses.
      let decision: RouteDecision;
      let system = req.system;
      let messages = req.messages;
      let redacted = false;
      if (req.onSensitive === "redact") {
        const prepared = prepareForRoute(routeReq);
        if (!prepared) assertRoutable(routeReq); // throws with the full decision (and logs it)
        decision = prepared!.decision;
        redacted = prepared!.payload !== routeReq.payload;
        system = prepared!.payload.system || undefined;
        messages = prepared!.payload.messages;
      } else {
        decision = assertRoutable(routeReq);
      }

      const provider = decision.provider;
      // Gateway requests only name gateway providers; a direct endpoint (Jev) is never called from here.
      if (!provider || !isModelProvider(provider)) throw new RoutingRefusedError(decision, routeReq);
      const client = deps.providers[provider];
      if (!client || !client.configured()) throw new GatewayUnavailableError(provider);

      const providerReq: ProviderRequest = {
        model: providerModelId(req.model, provider),
        purpose: req.purpose,
        messages,
        maxTokens: req.maxTokens,
        ...(system ? { system } : {}),
        ...(req.effort ? { effort: req.effort } : {}),
        ...(req.jsonSchema ? { jsonSchema: req.jsonSchema } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
      };

      // 2. Call the provider, traced.
      const trace = tracer.trace({
        ...(req.trace?.traceId ? { id: req.trace.traceId } : {}),
        name: req.trace?.name ?? `gateway.${req.purpose}`,
        tags: [provider, req.purpose],
        metadata: { purpose: req.purpose, level: decision.level, categories: decision.categories, ...req.trace?.metadata },
      });
      const started = now();
      const startTime = new Date(started);
      try {
        const result = await client.complete(providerReq);
        const latencyMs = now() - started;
        const refused = result.stopReason === "refusal";
        const json = req.jsonSchema && !refused ? parseJson(result.text) : undefined;
        trace.generation({
          name: req.trace?.name ?? req.purpose,
          model: result.servedModel,
          provider,
          startTime,
          endTime: new Date(started + latencyMs),
          input: { system, messages },
          output: result.text,
          usage: result.usage,
          level: refused ? "WARNING" : "DEFAULT",
          ...(refused ? { statusMessage: `refusal${result.refusalCategory ? `:${result.refusalCategory}` : ""}` } : {}),
          metadata: { requestedModel: req.model, stopReason: result.stopReason, redacted },
        });
        trace.end({ metadata: { stopReason: result.stopReason, latencyMs } });
        return {
          ...result,
          provider,
          requestedModel: req.model,
          refused,
          redacted,
          route: { level: decision.level, categories: decision.categories, ceiling: decision.ceiling },
          latencyMs,
          ...(json !== undefined ? { json } : {}),
        };
      } catch (err) {
        trace.generation({
          name: req.trace?.name ?? req.purpose,
          model: req.model,
          provider,
          startTime,
          endTime: new Date(now()),
          level: "ERROR",
          statusMessage: err instanceof Error ? err.message.slice(0, 300) : "error",
        });
        trace.end({ level: "ERROR" });
        throw err;
      } finally {
        await tracer.flush();
      }
    },
  };
}

/** Providers wired from the environment (keys read lazily, at call time). */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): Record<ModelProvider, ModelProviderClient> {
  return {
    anthropic: new AnthropicProvider(),
    nvidia: new OpenAICompatibleProvider({ provider: "nvidia", baseUrl: env.NVIDIA_NIM_BASE_URL?.trim() || NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY?.trim() || undefined }),
    xai: new OpenAICompatibleProvider({ provider: "xai", baseUrl: env.XAI_BASE_URL?.trim() || XAI_BASE_URL, apiKey: env.XAI_API_KEY?.trim() || undefined }),
  };
}

let gateway: ModelGateway | undefined;

/** Process-wide gateway. */
export function modelGateway(): ModelGateway {
  gateway ??= createGateway({ providers: providersFromEnv() });
  return gateway;
}

/** Test hook (undefined restores the env-based gateway). */
export function setModelGateway(g: ModelGateway | undefined): void {
  gateway = g;
}
