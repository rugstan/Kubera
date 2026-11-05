// Prompt and model version registry.
//
// Every agent prompt is registered under an id and a semantic version, and
// the registry stores the SHA-256 of its exact system text. A version is
// immutable: registering the same id and version with different text throws,
// so any wording change needs a new version, and each agent event records the
// prompt id, version and hash it ran with. Models are checked against the
// approved model list (lib/ai/gateway.ts tiers, a configured NVIDIA id and
// the gateway's xAI model) and agents declare the tools (with versions) and tasks they use.
//
// A prompt registers its default model. An administrator may run the task on
// another model (lib/ai/model-settings.ts, /settings/ai) without a new prompt
// version: `modelForRun` accepts only approved, active models (xAI for market
// intel only), and every call records the model it actually used (`runRef`,
// agent_events.model and the task's own model column), so the audit trail
// never infers the model from the version.

import { createHash } from "node:crypto";
import { MODELS, xaiModel, type Effort } from "@/lib/ai/gateway";
import type { AiPurpose } from "@/lib/ai/routing";

const ID = /^[a-z][a-z0-9_.-]{1,62}$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export type ModelTier = "default" | "mid" | "bulk" | "nvidia" | "xai";

export type ApprovedModel = { id: string; tier: ModelTier; status: "active" | "deprecated" };

/** Models agents may be registered with. Claude ids come from the gateway tiers (Global rule 7). */
export function approvedModels(env: Record<string, string | undefined> = process.env): ApprovedModel[] {
  const out: ApprovedModel[] = [
    { id: MODELS.claude, tier: "default", status: "active" },
    { id: MODELS.claudeMid, tier: "mid", status: "active" },
    { id: MODELS.claudeBulk, tier: "bulk", status: "active" },
  ];
  const nvidia = env.NVIDIA_NIM_MODEL?.trim();
  if (nvidia) out.push({ id: nvidia, tier: "nvidia", status: "active" });
  // The xAI model is always approved (for market intel only, see registerPrompt);
  // XAI_MODEL overrides the gateway default.
  out.push({ id: xaiModel(env), tier: "xai", status: "active" });
  return out;
}

export type PromptDefinition = {
  id: string;
  version: string;
  description: string;
  purpose: AiPurpose;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Frozen system text. Untrusted content never goes here (it goes in an isolated user-turn block). */
  system: string;
  /** Tools the prompt may call (names). */
  tools?: readonly string[];
};

export type RegisteredPrompt = PromptDefinition & { sha256: string; tools: readonly string[] };

export type PromptRef = { id: string; version: string; sha256: string; model: string };

export type ToolRef = { name: string; version: string };

export type AgentDefinition = {
  id: string;
  version: string;
  description: string;
  /** Prompt ids this agent uses (latest registered version unless pinned as "id@version"). */
  prompts: readonly string[];
  tools: readonly ToolRef[];
  /** Autonomy tasks (lib/agents/core/autonomy.ts) the agent acts under. */
  tasks: readonly string[];
};

export type AgentSnapshot = {
  agent: string;
  agentVersion: string;
  prompts: PromptRef[];
  tools: ToolRef[];
  tasks: string[];
};

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a)!;
  const pb = SEMVER.exec(b)!;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

export class AgentRegistry {
  private readonly prompts = new Map<string, Map<string, RegisteredPrompt>>();
  private readonly agents = new Map<string, Map<string, AgentDefinition>>();

  constructor(private readonly models: () => ApprovedModel[] = () => approvedModels()) {}

  registerPrompt(def: PromptDefinition): RegisteredPrompt {
    if (!ID.test(def.id)) throw new RegistryError(`prompt id "${def.id}" is invalid`);
    if (!SEMVER.test(def.version)) throw new RegistryError(`prompt ${def.id}: version "${def.version}" is not x.y.z`);
    if (!def.system.trim()) throw new RegistryError(`prompt ${def.id}@${def.version}: empty system text`);
    if (!Number.isInteger(def.maxTokens) || def.maxTokens < 1 || def.maxTokens > 128_000) throw new RegistryError(`prompt ${def.id}: maxTokens out of range`);
    this.checkModel(def.id, def.purpose, def.model);
    const registered: RegisteredPrompt = { ...def, tools: [...(def.tools ?? [])], sha256: sha256(def.system) };
    const versions = this.prompts.get(def.id) ?? new Map<string, RegisteredPrompt>();
    const prior = versions.get(def.version);
    if (prior) {
      if (prior.sha256 !== registered.sha256 || prior.model !== registered.model) {
        throw new RegistryError(`prompt ${def.id}@${def.version} is already registered with different text or model; bump the version`);
      }
      return prior;
    }
    versions.set(def.version, Object.freeze(registered));
    this.prompts.set(def.id, versions);
    return registered;
  }

  /** A prompt by id, latest version unless one is given ("id@1.2.0" also works). */
  prompt(idOrRef: string, version?: string): RegisteredPrompt {
    const [id, pinned] = idOrRef.includes("@") ? (idOrRef.split("@") as [string, string]) : [idOrRef, version];
    const versions = this.prompts.get(id);
    if (!versions?.size) throw new RegistryError(`prompt ${id} is not registered`);
    if (pinned) {
      const p = versions.get(pinned);
      if (!p) throw new RegistryError(`prompt ${id}@${pinned} is not registered`);
      return p;
    }
    return [...versions.values()].sort((a, b) => compareVersions(b.version, a.version))[0]!;
  }

  promptRef(idOrRef: string, version?: string): PromptRef {
    const p = this.prompt(idOrRef, version);
    return { id: p.id, version: p.version, sha256: p.sha256, model: p.model };
  }

  /** Throws unless `model` is approved, active and allowed for the purpose (xAI: market intel only). */
  private checkModel(promptId: string, purpose: AiPurpose, model: string): void {
    const approved = this.models().find((m) => m.id === model);
    if (!approved) throw new RegistryError(`prompt ${promptId}: model "${model}" is not on the approved model list`);
    if (approved.status !== "active") throw new RegistryError(`prompt ${promptId}: model "${model}" is deprecated`);
    if (approved.tier === "xai" && purpose !== "market_intel") throw new RegistryError(`prompt ${promptId}: xAI models are for market intel only`);
  }

  /**
   * The model a run of `prompt` uses: its registered (default) model, or an
   * override chosen for the task. The override must pass the same checks as a
   * registration; the prompt version is unchanged because it pins the text,
   * and the caller records the model it ran on. Throws RegistryError otherwise.
   */
  modelForRun(prompt: Pick<RegisteredPrompt, "id" | "purpose" | "model">, model?: string | null): string {
    const wanted = model?.trim() || prompt.model;
    if (wanted !== prompt.model) this.checkModel(prompt.id, prompt.purpose, wanted);
    return wanted;
  }

  /** What a call records about its prompt: id, version and hash, with the model the run actually used. */
  runRef(prompt: RegisteredPrompt, model?: string | null): PromptRef {
    return { id: prompt.id, version: prompt.version, sha256: prompt.sha256, model: this.modelForRun(prompt, model) };
  }

  registerAgent(def: AgentDefinition): AgentDefinition {
    if (!ID.test(def.id)) throw new RegistryError(`agent id "${def.id}" is invalid`);
    if (!SEMVER.test(def.version)) throw new RegistryError(`agent ${def.id}: version "${def.version}" is not x.y.z`);
    for (const t of def.tools) {
      if (!/^[a-z][a-z0-9_.]{1,62}$/.test(t.name) || !SEMVER.test(t.version)) throw new RegistryError(`agent ${def.id}: tool ${t.name}@${t.version} is invalid`);
    }
    for (const p of def.prompts) this.prompt(p); // must exist
    const frozen: AgentDefinition = Object.freeze({ ...def, prompts: [...def.prompts], tools: def.tools.map((t) => ({ ...t })), tasks: [...def.tasks] });
    const versions = this.agents.get(def.id) ?? new Map<string, AgentDefinition>();
    const prior = versions.get(def.version);
    if (prior && JSON.stringify(prior) !== JSON.stringify(frozen)) throw new RegistryError(`agent ${def.id}@${def.version} is already registered differently; bump the version`);
    versions.set(def.version, prior ?? frozen);
    this.agents.set(def.id, versions);
    return prior ?? frozen;
  }

  agent(id: string, version?: string): AgentDefinition {
    const versions = this.agents.get(id);
    if (!versions?.size) throw new RegistryError(`agent ${id} is not registered`);
    if (version) {
      const a = versions.get(version);
      if (!a) throw new RegistryError(`agent ${id}@${version} is not registered`);
      return a;
    }
    return [...versions.values()].sort((a, b) => compareVersions(b.version, a.version))[0]!;
  }

  hasAgent(id: string): boolean {
    return Boolean(this.agents.get(id)?.size);
  }

  /** What an agent event records about the versions in play. */
  snapshot(agentId: string, version?: string): AgentSnapshot {
    const a = this.agent(agentId, version);
    return { agent: a.id, agentVersion: a.version, prompts: a.prompts.map((p) => this.promptRef(p)), tools: a.tools.map((t) => ({ ...t })), tasks: [...a.tasks] };
  }

  list(): { prompts: PromptRef[]; agents: { id: string; version: string }[] } {
    return {
      prompts: [...this.prompts.values()].flatMap((v) => [...v.values()]).map((p) => ({ id: p.id, version: p.version, sha256: p.sha256, model: p.model })),
      agents: [...this.agents.values()].flatMap((v) => [...v.values()]).map((a) => ({ id: a.id, version: a.version })),
    };
  }
}

let shared: AgentRegistry | undefined;

/** Process-wide registry that agents register into at module load. */
export function agentRegistry(): AgentRegistry {
  shared ??= new AgentRegistry();
  return shared;
}

/** Test hook. */
export function resetAgentRegistry(r?: AgentRegistry): void {
  shared = r;
}
