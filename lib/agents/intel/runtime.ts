import "server-only";
import { agentSafety } from "@/lib/agents/core/server";
import type { AutonomyLevel } from "@/lib/agents/core/autonomy";
import type { AgentEventStore } from "@/lib/agents/core/events";
import { modelGateway, type ModelGateway } from "@/lib/ai/gateway";
import { approvalGate } from "@/lib/approvals/server";
import { resolveAuthMode } from "@/lib/auth/config";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import type { ConsentReader } from "@/lib/notify/consent";
import { emailClientFromEnv } from "@/lib/notify/email";
import type { EmailClient } from "@/lib/notify/email/types";
import { notifyRuntime } from "@/lib/notify/runtime";
import { getMarketSnapshot } from "@/lib/rates";
import { supabaseAdmin } from "@/lib/supabase/server";
import { demoMaturityRecords, demoNoticeSignals, demoRateSnapshot } from "./demo";
import { MemoryIntelStore, type IntelStore } from "./intel-store";
import { SupabaseIntelStore } from "./intel-store-supabase";
import { FakeMaturityProvider, maturityProviderFromEnv, type MaturityProvider } from "./maturity";
import type { OutreachDeps, SenderIdentity } from "./outreach";
import { senderIdentityFromSite } from "./outreach";
import { marketRateFromEnv, scanProspects, type ScanDeps } from "./prospects";
import { MemoryProspectStore, type ProspectStore } from "./prospect-store";
import { SupabaseProspectStore } from "./prospect-store-supabase";
import { FederalRegisterSource, RatesSignalSource, StaticSignalSource, FeedSource, feedUrlsFromEnv, type SignalSourceClient } from "./signals";
import type { MarketDeps } from "./market";

// Production wiring for market intel and prospecting (Global rule 3). Missing
// pieces degrade instead of failing:
//   - no Supabase: the staff pages say the storage is not configured
//   - no ATTOM key: scans report "not configured"
//   - no xAI key: the weekly note is a rules digest of the signals
//   - no Resend key: approved emails wait (the approval is kept), letters work
//   - no approvals queue: the closed gate leaves every draft pending
// Fake-auth mode (local development and e2e) runs on in-memory stores seeded
// with invented properties through the same scan and scoring code.

export type IntelRuntime = {
  mode: "supabase" | "demo";
  intel: IntelStore;
  prospects: ProspectStore;
  provider: MaturityProvider | null;
  sources: SignalSourceClient[];
  gateway: ModelGateway;
  gate: ApprovalGate;
  email: EmailClient | null;
  consent: ConsentReader | null;
  events: AgentEventStore | null;
  autonomy: { level(task: string): Promise<AutonomyLevel> };
  identity: SenderIdentity;
  marketRatePct: number;
  now: () => Date;
};

const DEMO_KEY = Symbol.for("kubera.intel.demo");
type DemoBundle = { intel: MemoryIntelStore; prospects: MemoryProspectStore; ready: Promise<void> };

function demoBundle(now: () => Date): DemoBundle {
  const g = globalThis as unknown as Record<symbol, DemoBundle | undefined>;
  let b = g[DEMO_KEY];
  if (!b) {
    const intel = new MemoryIntelStore();
    const prospects = new MemoryProspectStore();
    const ready = scanProspects(
      { provider: new FakeMaturityProvider(demoMaturityRecords(now())), store: prospects, now },
      { query: { zips: ["90001", "91201", "92801", "89501"], fromMonths: -6, toMonths: 18 }, actor: "system:demo" },
    ).then(
      () => undefined,
      (err) => console.error("[intel] demo seed failed", err instanceof Error ? err.message : err),
    );
    b = { intel, prospects, ready };
    g[DEMO_KEY] = b;
  }
  return b;
}

/** Demo mode only: a labeled placeholder office address so the draft flow can be exercised without production licensing config. */
function withDemoAddress(identity: SenderIdentity, demo: boolean): SenderIdentity {
  return demo && !identity.address.trim() ? { ...identity, address: "123 Example Plaza, Los Angeles, CA 90001 (demo address)" } : identity;
}

function signalSources(demo: boolean, now: () => Date): SignalSourceClient[] {
  if (demo) {
    return [new RatesSignalSource(async () => demoRateSnapshot(now())), new StaticSignalSource("demo-notices", demoNoticeSignals(now()))];
  }
  const sources: SignalSourceClient[] = [new RatesSignalSource(() => getMarketSnapshot()), new FederalRegisterSource()];
  const feeds = feedUrlsFromEnv();
  if (feeds.length) sources.push(new FeedSource(feeds));
  return sources;
}

/** The runtime, or null when neither Supabase nor fake-auth mode is available. Awaits the demo seed. */
export async function intelRuntime(): Promise<IntelRuntime | null> {
  const demo = resolveAuthMode().mode === "fake";
  const db = demo ? null : supabaseAdmin();
  if (!demo && !db) return null;
  const now = () => new Date();
  const safety = agentSafety();
  const common = {
    sources: signalSources(demo, now),
    gateway: modelGateway(),
    gate: approvalGate(),
    email: emailClientFromEnv(),
    consent: notifyRuntime().consent,
    events: safety.events,
    autonomy: safety.autonomy,
    identity: withDemoAddress(senderIdentityFromSite(), demo),
    marketRatePct: marketRateFromEnv(),
    now,
  };
  if (demo) {
    const b = demoBundle(now);
    await b.ready;
    return { mode: "demo", intel: b.intel, prospects: b.prospects, provider: new FakeMaturityProvider(demoMaturityRecords(now())), ...common };
  }
  return { mode: "supabase", intel: new SupabaseIntelStore(db!), prospects: new SupabaseProspectStore(db!), provider: maturityProviderFromEnv(), ...common };
}

export function marketDeps(rt: IntelRuntime): MarketDeps {
  return { gateway: rt.gateway, sources: rt.sources, store: rt.intel, events: rt.events, autonomy: rt.autonomy, now: rt.now };
}

export function scanDeps(rt: IntelRuntime): ScanDeps {
  return { provider: rt.provider, store: rt.prospects, events: rt.events, now: rt.now, marketRatePct: rt.marketRatePct };
}

export function outreachDeps(rt: IntelRuntime): OutreachDeps {
  return { store: rt.prospects, gate: rt.gate, email: rt.email, consent: rt.consent, gateway: rt.gateway, events: rt.events, autonomy: rt.autonomy, identity: rt.identity, now: rt.now };
}

