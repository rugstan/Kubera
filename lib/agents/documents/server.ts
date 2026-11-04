import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAgentEventStore } from "@/lib/agents/core/events";
import { modelGateway } from "@/lib/ai/gateway";
import { supabaseVaultStorage } from "@/lib/documents/storage";
import { supabaseDocumentStore, supabaseEventLog } from "@/lib/documents/store";
import { resolveAuthMode } from "@/lib/auth/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseAgentRunStore } from "@/lib/workflows/runs";
import { AnthropicDocumentClient } from "./claude-pdf";
import { nemoFromEnv } from "./nemo";
import { extractionConfigFromEnv, type ExtractionDeps } from "./pipeline";
import type { ReviewDeps } from "./review";
import { seedDemoExtractions } from "./demo";
import { MemoryConstructionBudgetStore, MemoryExtractionEventLog, MemoryExtractionStore, supabaseConstructionBudgetStore, supabaseExtractionEventLog, supabaseExtractionStore } from "./store";

// Server wiring for the document agent. Missing Supabase config yields null
// (callers degrade); missing model keys leave the agent rules-only, and every
// such extraction lands in the review queue instead of failing.

let override: ExtractionDeps | null | undefined;

/** Test hook (null = not configured; undefined restores the env wiring). */
export function setDocumentAgentDeps(deps: ExtractionDeps | null | undefined): void {
  override = deps;
}

let warned = false;

/**
 * Whether the lead's contact opted out of AI processing. Fails closed: when the
 * preference cannot be read, the document is treated as opted out (rules only).
 */
export function leadAiOptOut(db: SupabaseClient): (leadId: string | null) => Promise<boolean> {
  return async (leadId) => {
    if (!leadId) return false;
    const lead = await db.from("leads").select("contact").eq("id", leadId).maybeSingle();
    if (lead.error) return true;
    const email = (lead.data?.contact as { email?: string } | undefined)?.email?.trim().toLowerCase();
    if (!email) return false;
    const pref = await db.from("privacy_preferences").select("ai_processing_opt_out").eq("subject_email", email).maybeSingle();
    if (pref.error) return true;
    return Boolean(pref.data?.ai_processing_opt_out);
  };
}

export function documentAgentDeps(): ExtractionDeps | null {
  if (override !== undefined) return override;
  const db = supabaseAdmin();
  if (!db) {
    if (!warned) console.warn("[documents-agent] Supabase is not configured; document extraction is off");
    warned = true;
    return null;
  }
  const config = extractionConfigFromEnv();
  return {
    store: supabaseExtractionStore(db),
    events: supabaseExtractionEventLog(db),
    budgets: supabaseConstructionBudgetStore(db),
    gateway: modelGateway(),
    claude: new AnthropicDocumentClient(config.effort ? { effort: config.effort } : {}),
    nemo: nemoFromEnv(),
    vault: { documents: supabaseDocumentStore(db), storage: supabaseVaultStorage(db), events: supabaseEventLog(db) },
    aiOptOut: leadAiOptOut(db),
    runs: supabaseAgentRunStore(db),
    agentEvents: supabaseAgentEventStore(db),
    config,
  };
}

const DEMO_KEY = Symbol.for("corin.documents.review.demo");
type DemoReview = { deps: ReviewDeps; ready: Promise<void> };

/** In-memory review queue for fake-auth mode (demo / e2e), seeded once per process. */
function demoReviewDeps(): DemoReview {
  const g = globalThis as unknown as Record<symbol, DemoReview | undefined>;
  if (!g[DEMO_KEY]) {
    const store = new MemoryExtractionStore();
    g[DEMO_KEY] = { deps: { store, events: new MemoryExtractionEventLog(), budgets: new MemoryConstructionBudgetStore() }, ready: seedDemoExtractions(store) };
  }
  return g[DEMO_KEY]!;
}

/** The extraction review queue: Supabase when configured, the demo queue in fake-auth mode, else null. */
export async function documentReviewDeps(): Promise<ReviewDeps | null> {
  if (override === undefined && resolveAuthMode().mode === "fake") {
    const demo = demoReviewDeps();
    await demo.ready;
    return demo.deps;
  }
  const deps = documentAgentDeps();
  return deps ? { store: deps.store, events: deps.events, ...(deps.budgets ? { budgets: deps.budgets } : {}) } : null;
}
