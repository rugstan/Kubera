import { describe, expect, it } from "vitest";
import { AgentRegistry, approvedModels, compareVersions, RegistryError, sha256, type PromptDefinition } from "./registry";
import { xaiModel } from "@/lib/ai/gateway";

const prompt = (o: Partial<PromptDefinition> = {}): PromptDefinition => ({
  id: "outreach.reminder",
  version: "1.0.0",
  description: "Document reminder drafting",
  purpose: "drafting",
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 2000,
  system: "You draft short, polite document reminders.",
  ...o,
});

describe("prompt registry", () => {
  it("hashes the exact system text and returns the latest version", () => {
    const r = new AgentRegistry();
    const v1 = r.registerPrompt(prompt());
    r.registerPrompt(prompt({ version: "1.10.0", system: "v1.10" }));
    r.registerPrompt(prompt({ version: "1.2.0", system: "v1.2" }));
    expect(v1.sha256).toBe(sha256("You draft short, polite document reminders."));
    expect(r.prompt("outreach.reminder").version).toBe("1.10.0");
    expect(r.prompt("outreach.reminder@1.0.0").sha256).toBe(v1.sha256);
    expect(r.promptRef("outreach.reminder", "1.2.0")).toEqual({ id: "outreach.reminder", version: "1.2.0", sha256: sha256("v1.2"), model: "claude-opus-5-5" });
  });

  it("makes versions immutable", () => {
    const r = new AgentRegistry();
    r.registerPrompt(prompt());
    expect(() => r.registerPrompt(prompt())).not.toThrow(); // identical re-registration is fine
    expect(() => r.registerPrompt(prompt({ system: "changed wording" }))).toThrow(/bump the version/);
    expect(() => r.registerPrompt(prompt({ model: "claude-haiku-5-5" }))).toThrow(/bump the version/);
  });

  it("allows only approved, active models and keeps xAI to market intel", () => {
    const r = new AgentRegistry(() => [...approvedModels({}), { id: "grok-x", tier: "xai", status: "active" }, { id: "old-model", tier: "default", status: "deprecated" }]);
    expect(() => r.registerPrompt(prompt({ model: "gpt-unknown" }))).toThrow(/approved model list/);
    expect(() => r.registerPrompt(prompt({ model: "old-model" }))).toThrow(/deprecated/);
    expect(() => r.registerPrompt(prompt({ id: "intel.bad", model: "grok-x" }))).toThrow(/market intel/);
    expect(() => r.registerPrompt(prompt({ id: "intel.note", model: "grok-x", purpose: "market_intel" }))).not.toThrow();
  });

  it("validates ids, versions and limits", () => {
    const r = new AgentRegistry();
    expect(() => r.registerPrompt(prompt({ id: "Bad Id" }))).toThrow(RegistryError);
    expect(() => r.registerPrompt(prompt({ version: "1.0" }))).toThrow(/x\.y\.z/);
    expect(() => r.registerPrompt(prompt({ system: "  " }))).toThrow(/empty/);
    expect(() => r.registerPrompt(prompt({ maxTokens: 0 }))).toThrow(/maxTokens/);
    expect(() => r.prompt("missing")).toThrow(/not registered/);
  });

  it("reads configured NVIDIA and xAI ids from the environment", () => {
    expect(approvedModels({ NVIDIA_NIM_MODEL: "nvidia/x", XAI_MODEL: "grok-x" }).map((m) => m.tier)).toEqual(["default", "mid", "bulk", "nvidia", "xai"]);
    expect(approvedModels({ XAI_MODEL: "grok-x" }).find((m) => m.tier === "xai")?.id).toBe("grok-x");
  });

  it("approves the gateway's default xAI model without XAI_MODEL", () => {
    expect(approvedModels({}).find((m) => m.tier === "xai")?.id).toBe(xaiModel({}));
  });
});

describe("agent registry", () => {
  it("snapshots agent, prompt and tool versions for the audit trail", () => {
    const r = new AgentRegistry();
    r.registerPrompt(prompt());
    r.registerAgent({ id: "outreach.chaser", version: "1.0.0", description: "Chasers", prompts: ["outreach.reminder"], tools: [{ name: "email.send_document_reminder", version: "1.2.0" }], tasks: ["outreach.document_reminder"] });
    const snap = r.snapshot("outreach.chaser");
    expect(snap).toEqual({
      agent: "outreach.chaser",
      agentVersion: "1.0.0",
      prompts: [{ id: "outreach.reminder", version: "1.0.0", sha256: sha256(prompt().system), model: "claude-opus-5-5" }],
      tools: [{ name: "email.send_document_reminder", version: "1.2.0" }],
      tasks: ["outreach.document_reminder"],
    });
    expect(() => r.registerAgent({ id: "outreach.chaser", version: "1.0.0", description: "Changed", prompts: [], tools: [], tasks: [] })).toThrow(/bump the version/);
    expect(() => r.registerAgent({ id: "x.agent", version: "1.0.0", description: "x", prompts: ["missing.prompt"], tools: [], tasks: [] })).toThrow(/not registered/);
    expect(r.list().agents).toEqual([{ id: "outreach.chaser", version: "1.0.0" }]);
  });

  it("compares semantic versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });
});
