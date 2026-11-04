// NVIDIA NIM and xAI behind the gateway, over their OpenAI-compatible
// chat-completions HTTP APIs (plain fetch; no extra SDK). Claude never goes
// through here: it uses the Anthropic SDK (./anthropic.ts).

import type { ModelProvider } from "@/lib/ai/routing";
import { GatewayProviderError, type GatewayStopReason, type ModelProviderClient, type ProviderRequest, type ProviderResult } from "./types";

export type OpenAICompatibleConfig = {
  provider: Exclude<ModelProvider, "anthropic">;
  baseUrl: string;
  apiKey: string | undefined;
  fetch?: typeof fetch;
  /** Request timeout (ms). Default 60 s. */
  timeoutMs?: number;
};

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const XAI_BASE_URL = "https://api.x.ai/v1";

type ChatCompletion = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function buildChatBody(req: ProviderRequest): Record<string, unknown> {
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });
  return {
    model: req.model,
    messages,
    max_tokens: req.maxTokens,
    stream: false,
    ...(req.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "response", schema: req.jsonSchema, strict: true } } } : {}),
  };
}

function mapFinish(reason: string | null | undefined, refusal: boolean): GatewayStopReason {
  if (refusal || reason === "content_filter") return "refusal";
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  return "other";
}

export class OpenAICompatibleProvider implements ModelProviderClient {
  readonly provider: Exclude<ModelProvider, "anthropic">;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.provider = config.provider;
  }

  configured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async complete(req: ProviderRequest): Promise<ProviderResult> {
    if (!this.config.apiKey) throw new GatewayProviderError(this.provider, null, `${this.provider} API key missing`, false);
    const fetchImpl = this.config.fetch ?? globalThis.fetch.bind(globalThis);
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetchImpl(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(buildChatBody(req)),
        signal,
      });
    } catch (err) {
      throw new GatewayProviderError(this.provider, null, err instanceof Error ? err.message : String(err), true);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new GatewayProviderError(this.provider, res.status, `${this.provider} HTTP ${res.status}${detail ? `: ${detail}` : ""}`, res.status === 429 || res.status >= 500);
    }
    const body = (await res.json()) as ChatCompletion;
    const choice = body.choices?.[0];
    const refusal = Boolean(choice?.message?.refusal);
    return {
      text: choice?.message?.content ?? "",
      servedModel: body.model ?? req.model,
      stopReason: mapFinish(choice?.finish_reason, refusal),
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      ...(refusal ? { refusalCategory: null } : {}),
    };
  }
}
