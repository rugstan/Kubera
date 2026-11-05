// Which model each AI task runs on (/settings/ai).
//
// Every task that calls a model is listed in AI_TASKS with its default: the
// code constant it always used, or the env variable that already overrode it
// (DOCUMENT_TEXT_MODEL, XAI_MODEL). An administrator can choose another model
// for a task; each choice is a row in the append-only ai_task_models history
// (who, when, from, to, why) and the latest row wins. With no row, or with no
// database, every task runs exactly as it did before this file existed.
//
//   code constant  <  env variable  <  latest ai_task_models row
//
// A task may only run on a model that is
//   - on the approved model list (lib/agents/core/registry.ts approvedModels),
//     active, and xAI only for market intel (the registry's own rules);
//   - reachable by the task's call path: the staff assistant and the PDF
//     reader call Anthropic directly, market intel is pinned to xAI, and the
//     rest go through the model gateway; and
//   - accepted by the routing guard (lib/ai/routing.ts) for the task's purpose
//     at the task's data ceiling and categories. The guard itself decides, so a
//     task that handles restricted documents is never offered a provider the
//     guard would refuse them to.
// The same check runs when a choice is saved and again whenever it is read: a
// stored model that has since left the approved list (or that a tightened
// guard now refuses) is ignored with a warning and the task uses its default.
//
// Call sites use resolveTaskModel(task). It caches the latest settings for a
// minute and never throws: no database, a read error or an unusable row all
// mean the default. The model a call actually ran on is recorded with it
// (the registry's runRef, agent_events.model and each task's model column).
//
// No server-only imports here: the call sites (mail, documents, lenders, CRM,
// intel) also run in tests and CLIs. The Supabase client is loaded lazily, and
// only when Supabase is configured.

import type { SupabaseClient } from "@supabase/supabase-js";
import { approvedModels, type ApprovedModel, type ModelTier } from "@/lib/agents/core/registry";
import { resolveAuthMode } from "@/lib/auth/config";
import type { Classification, DataCategory } from "@/lib/privacy/classification";
import { MODELS, xaiModel } from "./gateway";
import { checkRoute, MODEL_PROVIDERS, providerForModel, type AiPurpose, type ModelProvider, type RefusalCode } from "./routing";

type Env = Record<string, string | undefined>;

export type AiTask = {
  label: string;
  description: string;
  purpose: AiPurpose;
  /** Providers the task's call path can reach. */
  providers: readonly ModelProvider[];
  /** Highest classification of data the task sends (what the routing guard is asked to allow). */
  dataCeiling: Classification;
  /** Data categories the task sends. */
  dataCategories: readonly DataCategory[];
  /** Plain-English note on what the task sends, for the settings page. */
  dataNote: string;
  /** The model used when no choice is stored: the code constant, or its env override. */
  defaultModel: (env: Env) => string;
  /** Env variable that overrides the code default, if any. */
  defaultEnv?: string;
};

export const AI_TASK_IDS = [
  "advisor.chat",
  "mail.triage",
  "documents.extract_text",
  "documents.extract_pdf",
  "lenders.term_sheet",
  "prospecting.intro",
  "crm.call_summary",
  "intel.market_draft",
] as const;
export type AiTaskId = (typeof AI_TASK_IDS)[number];

export function isAiTaskId(v: unknown): v is AiTaskId {
  return typeof v === "string" && (AI_TASK_IDS as readonly string[]).includes(v);
}

/** Through lib/ai/gateway.ts: any gateway provider, as far as the routing guard allows. */
const GATEWAY: readonly ModelProvider[] = MODEL_PROVIDERS;

export const AI_TASKS: Readonly<Record<AiTaskId, AiTask>> = {
  "advisor.chat": {
    label: "Staff assistant (Ask Corin AI)",
    description: "Answers staff questions about loan programs and structures, and drafts indicative term sheets from the loan sizer.",
    purpose: "advisor",
    // lib/ai/advisor.ts calls the Anthropic SDK directly (streaming, prompt cache).
    providers: ["anthropic"],
    dataCeiling: "confidential",
    dataCategories: ["borrower", "deal"],
    dataNote: "Questions and deal context; Social Security, account and similar numbers are masked before the call.",
    defaultModel: () => MODELS.claude,
  },
  "mail.triage": {
    label: "Mail triage",
    description: "Reads each inbound email to deals@, docs@, lenders@, vendors@ and closing@, labels it, rates urgency and finds the deal it belongs to.",
    purpose: "classification",
    providers: GATEWAY,
    dataCeiling: "confidential",
    dataCategories: ["borrower", "partner", "deal"],
    dataNote: "Borrower, lender and deal email; restricted values are removed before the call.",
    defaultModel: () => MODELS.claudeBulk,
  },
  "documents.extract_text": {
    label: "Document extraction (text)",
    description: "Pulls figures from rent rolls, T12s, census reports, personal financial statements, tax returns and other deal documents that have readable text.",
    purpose: "document_extraction",
    providers: GATEWAY,
    dataCeiling: "restricted",
    dataCategories: ["borrower", "deal"],
    dataNote: "Includes personal financial statements and tax returns, which only Claude may read.",
    defaultModel: (env) => env.DOCUMENT_TEXT_MODEL?.trim() || MODELS.claude,
    defaultEnv: "DOCUMENT_TEXT_MODEL",
  },
  "documents.extract_pdf": {
    label: "Document extraction (scanned PDF)",
    description: "Reads the PDF itself when a document has no usable text layer, such as a scan.",
    purpose: "document_extraction",
    // lib/agents/documents/claude-pdf.ts sends the file as an Anthropic document block.
    providers: ["anthropic"],
    dataCeiling: "restricted",
    dataCategories: ["borrower", "deal"],
    dataNote: "The whole file is sent and treated as restricted, so only Claude may read it.",
    defaultModel: () => MODELS.claude,
  },
  "lenders.term_sheet": {
    label: "Term-sheet parser",
    description: "Turns lender quotes and term sheets that arrive at lenders@ into loan terms for quote comparison.",
    purpose: "document_extraction",
    providers: GATEWAY,
    dataCeiling: "confidential",
    dataCategories: ["partner", "deal"],
    dataNote: "Lender and deal terms; values above confidential are removed before a non-Claude model sees them.",
    defaultModel: () => MODELS.claude,
  },
  "prospecting.intro": {
    label: "Prospect intro",
    description: "Writes the two opening sentences of a refinance-maturity note to a property owner, for broker review.",
    purpose: "drafting",
    providers: GATEWAY,
    dataCeiling: "internal",
    dataCategories: [],
    dataNote: "Property type, city and loan maturity month only; no owner, contact or lender details.",
    defaultModel: () => MODELS.claudeMid,
  },
  "crm.call_summary": {
    label: "CRM call summary",
    description: "Summarises a call transcript into a CRM note with agreed facts and follow-up tasks.",
    purpose: "drafting",
    providers: GATEWAY,
    dataCeiling: "confidential",
    dataCategories: ["borrower", "deal"],
    dataNote: "Call transcripts with borrowers; restricted values are removed before the call.",
    defaultModel: () => MODELS.claudeMid,
  },
  "intel.market_draft": {
    label: "Market intel note",
    description: "Drafts the weekly market-intel note from public rate, Federal Register and news signals.",
    purpose: "market_intel",
    // lib/agents/intel/market.ts pins the call to xAI.
    providers: ["xai"],
    dataCeiling: "public",
    dataCategories: ["market"],
    dataNote: "Public signals only; the routing guard refuses any borrower, partner or deal data.",
    defaultModel: (env) => xaiModel(env),
    defaultEnv: "XAI_MODEL",
  },
};

export const CLASSIFICATION_LABELS: Readonly<Record<Classification, string>> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
};

export const MODEL_TIER_LABELS: Readonly<Record<ModelTier, string>> = {
  default: "Claude, most capable",
  mid: "Claude, balanced",
  bulk: "Claude, fastest and lowest cost",
  nvidia: "NVIDIA NIM",
  xai: "xAI",
};

export const PROVIDER_LABELS: Readonly<Record<ModelProvider, string>> = { anthropic: "Claude (Anthropic)", nvidia: "NVIDIA NIM", xai: "xAI" };

// ---------------------------------------------------------------------------
// What a task may run on

export type ModelRefusal =
  | { code: "not_approved" | "deprecated" | "xai_market_intel_only" | "provider_not_supported" }
  | { code: "routing_refused"; reasons: RefusalCode[] };

/** Why `model` may not run `task`, or null when it may. */
export function modelRefusal(taskId: AiTaskId, model: string, env: Env = process.env): ModelRefusal | null {
  const task = AI_TASKS[taskId];
  const approved = approvedModels(env).find((m) => m.id === model);
  if (!approved) return { code: "not_approved" };
  if (approved.status !== "active") return { code: "deprecated" };
  if (approved.tier === "xai" && task.purpose !== "market_intel") return { code: "xai_market_intel_only" };
  const provider = providerForModel(model);
  if (!provider || !task.providers.includes(provider)) return { code: "provider_not_supported" };
  // Ask the guard itself: an empty payload declared at the task's ceiling and categories.
  const decision = checkRoute({ model, provider, purpose: task.purpose, payload: {}, declared: { level: task.dataCeiling, categories: task.dataCategories } });
  return decision.allowed ? null : { code: "routing_refused", reasons: decision.reasons };
}

/** The models an administrator may choose for a task (approved list order, no duplicates). */
export function allowedModels(taskId: AiTaskId, env: Env = process.env): ApprovedModel[] {
  const seen = new Set<string>();
  return approvedModels(env).filter((m) => {
    if (seen.has(m.id) || modelRefusal(taskId, m.id, env)) return false;
    seen.add(m.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Stored choices (ai_task_models)

export type TaskModelSetting = {
  task: string;
  /** The model chosen; null means back to the default. */
  model: string | null;
  /** The model the task ran on when the change was made. */
  previousModel: string;
  setAt: string;
  setBy: string | null;
  setByLabel: string;
  reason: string;
};

export interface TaskModelStore {
  /** Latest setting per task. */
  current(): Promise<TaskModelSetting[]>;
  /** One task's settings, newest first. */
  history(task: string, limit?: number): Promise<TaskModelSetting[]>;
  append(setting: TaskModelSetting): Promise<void>;
}

export class MemoryTaskModelStore implements TaskModelStore {
  readonly rows: TaskModelSetting[] = [];

  async current(): Promise<TaskModelSetting[]> {
    const latest = new Map<string, TaskModelSetting>();
    for (const r of this.rows) latest.set(r.task, r);
    return [...latest.values()].map((r) => ({ ...r }));
  }

  async history(task: string, limit = 20): Promise<TaskModelSetting[]> {
    return this.rows
      .filter((r) => r.task === task)
      .reverse()
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async append(setting: TaskModelSetting): Promise<void> {
    this.rows.push({ ...setting });
  }
}

type Row = { task: string; model: string | null; previous_model: string; created_at: string; set_by: string | null; set_by_label: string; reason: string };

const COLS = "task, model, previous_model, created_at, set_by, set_by_label, reason";

export const fromRow = (r: Row): TaskModelSetting => ({
  task: r.task,
  model: r.model,
  previousModel: r.previous_model,
  setAt: r.created_at,
  setBy: r.set_by,
  setByLabel: r.set_by_label,
  reason: r.reason,
});

export function supabaseTaskModelStore(db: SupabaseClient): TaskModelStore {
  const table = () => db.from("ai_task_models");
  return {
    async current() {
      // Small table (one row per change): newest first, the first row per task wins.
      const { data, error } = await table().select(COLS).order("id", { ascending: false }).limit(2000);
      if (error) throw new Error(`ai_task_models read failed: ${error.message}`);
      const latest = new Map<string, TaskModelSetting>();
      for (const r of (data ?? []) as Row[]) if (!latest.has(r.task)) latest.set(r.task, fromRow(r));
      return [...latest.values()];
    },
    async history(task, limit = 20) {
      const { data, error } = await table()
        .select(COLS)
        .eq("task", task)
        .order("id", { ascending: false })
        .limit(Math.min(Math.max(1, limit), 200));
      if (error) throw new Error(`ai_task_models read failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(fromRow);
    },
    async append(s) {
      const { error } = await table().insert({
        task: s.task,
        model: s.model,
        previous_model: s.previousModel,
        created_at: s.setAt,
        set_by: s.setBy,
        set_by_label: s.setByLabel,
        reason: s.reason,
      });
      if (error) throw new Error(`ai_task_models insert failed: ${error.message}`);
    },
  };
}

const MEMORY_KEY = Symbol.for("corin.ai.task-models.memory");

/** The in-memory store for fake-auth mode (demo / e2e): one per server process, shared by pages, actions and jobs. */
export function memoryTaskModelStore(): MemoryTaskModelStore {
  const g = globalThis as unknown as Record<symbol, MemoryTaskModelStore | undefined>;
  g[MEMORY_KEY] ??= new MemoryTaskModelStore();
  return g[MEMORY_KEY]!;
}

/**
 * Where choices live: Supabase (service role) when configured, the in-memory
 * store in fake-auth mode, otherwise nowhere and every task uses its default.
 * The same split as the agent safety platform (lib/agents/core/server.ts).
 */
export async function taskModelStore(env: Env = process.env): Promise<TaskModelStore | null> {
  if (resolveAuthMode(env).mode === "fake") return memoryTaskModelStore();
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  // Loaded only when configured, so the modules that resolve models import nothing server-only.
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const db = supabaseAdmin();
  return db ? supabaseTaskModelStore(db) : null;
}

// ---------------------------------------------------------------------------
// Resolution

export type TaskModelResolution = {
  task: AiTaskId;
  /** The model calls use. */
  model: string;
  source: "default" | "setting";
  defaultModel: string;
  /** The latest stored choice, if any (also when it is ignored). */
  setting: TaskModelSetting | null;
  /** A stored model that is no longer allowed; the task uses its default instead. */
  ignored: { model: string; refusal: ModelRefusal } | null;
};

/** What a task runs on, given its latest stored choice. Pure: the allow-list and the guard are checked again here. */
export function effectiveTaskModel(taskId: AiTaskId, latest: TaskModelSetting | null, env: Env = process.env): TaskModelResolution {
  const defaultModel = AI_TASKS[taskId].defaultModel(env);
  const base = { task: taskId, defaultModel, setting: latest } as const;
  if (!latest?.model) return { ...base, model: defaultModel, source: "default", ignored: null };
  const refusal = modelRefusal(taskId, latest.model, env);
  if (refusal) return { ...base, model: defaultModel, source: "default", ignored: { model: latest.model, refusal } };
  return { ...base, model: latest.model, source: "setting", ignored: null };
}

/** How long resolved settings are reused before the store is read again. */
export const TASK_MODEL_CACHE_MS = 60_000;

type Source = () => Promise<TaskModelStore | null>;

let sourceOverride: Source | undefined;
let cache: { at: number; latest: ReadonlyMap<string, TaskModelSetting> } | undefined;
let loading: Promise<ReadonlyMap<string, TaskModelSetting>> | undefined;
/** Bumped by every reset, so a read that started before a save never caches what it saw. */
let generation = 0;
const warned = new Set<string>();

/** Test hook: where choices are read from (undefined restores the env wiring). Clears the cache. */
export function setTaskModelSource(source: Source | undefined): void {
  sourceOverride = source;
  resetTaskModelCache();
}

/** Drops cached choices, so the next call reads the store (after a save, and in tests). */
export function resetTaskModelCache(): void {
  generation += 1;
  cache = undefined;
  loading = undefined;
}

async function latestSettings(now: number): Promise<ReadonlyMap<string, TaskModelSetting>> {
  if (cache && now >= cache.at && now - cache.at < TASK_MODEL_CACHE_MS) return cache.latest;
  if (loading) return loading;
  const gen = generation;
  const load = (async () => {
    let latest: ReadonlyMap<string, TaskModelSetting>;
    try {
      const store = await (sourceOverride ?? (() => taskModelStore()))();
      latest = new Map((store ? await store.current() : []).map((s) => [s.task, s]));
    } catch (err) {
      // Keep the last good settings (or none: the defaults) and try again after the cache period.
      console.warn("[model-settings] could not read ai_task_models; using the last known settings or the defaults:", err instanceof Error ? err.message : err);
      latest = cache?.latest ?? new Map();
    }
    if (gen === generation) cache = { at: now, latest };
    return latest;
  })();
  loading = load;
  void load.finally(() => {
    if (loading === load) loading = undefined;
  });
  return load;
}

export type ResolveOptions = { env?: Env; now?: number };

/** The task's model with where it came from. Never throws. */
export async function resolveTaskModelDetail(taskId: AiTaskId, opts: ResolveOptions = {}): Promise<TaskModelResolution> {
  const env = opts.env ?? process.env;
  const latest = (await latestSettings(opts.now ?? Date.now())).get(taskId) ?? null;
  const r = effectiveTaskModel(taskId, latest, env);
  if (r.ignored) {
    const key = `${taskId}:${r.ignored.model}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[model-settings] ${taskId}: the saved model ${r.ignored.model} is no longer allowed (${r.ignored.refusal.code}); using the default ${r.defaultModel}`);
    }
  }
  return r;
}

/** The model id a task's calls use: the latest valid administrator choice, else the default. Never throws. */
export async function resolveTaskModel(taskId: AiTaskId, opts: ResolveOptions = {}): Promise<string> {
  return (await resolveTaskModelDetail(taskId, opts)).model;
}

// ---------------------------------------------------------------------------
// Settings page data

export type TaskModelOverview = {
  id: AiTaskId;
  task: AiTask;
  resolution: TaskModelResolution;
  /** The env variable that set the default, when it is set. */
  defaultFromEnv: string | null;
  allowed: ApprovedModel[];
  /** Newest first. */
  history: TaskModelSetting[];
};

/** Every task with its current model, choices and recent history, read straight from the store (no cache). */
export async function taskModelOverview(store: TaskModelStore | null, opts: { historyLimit?: number; env?: Env } = {}): Promise<TaskModelOverview[]> {
  const env = opts.env ?? process.env;
  const limit = opts.historyLimit ?? 5;
  return Promise.all(
    AI_TASK_IDS.map(async (id) => {
      const task = AI_TASKS[id];
      const history = store ? await store.history(id, limit) : [];
      return {
        id,
        task,
        resolution: effectiveTaskModel(id, history[0] ?? null, env),
        defaultFromEnv: task.defaultEnv && env[task.defaultEnv]?.trim() ? task.defaultEnv : null,
        allowed: allowedModels(id, env),
        history,
      };
    }),
  );
}
