import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MemoryCostWriter, SupabaseCostWriter, type SourceCostWriter } from "./costs";
import { reportingFixture } from "./fixtures";
import { SupabaseReportingSource } from "./supabase";
import type { ReportingData, ReportingSource } from "./types";

// Production wiring (Global rule 3). Without Supabase there is nothing to
// report on: the pages say so. Fake-auth mode (local development and e2e)
// shows the illustrative ledger fixture instead.

let warned = false;

export function reportingSource(): ReportingSource | null {
  const db = supabaseAdmin();
  if (!db) {
    if (!warned) {
      warned = true;
      console.warn("[reports] Supabase is not configured; reports are unavailable.");
    }
    return null;
  }
  return new SupabaseReportingSource(db);
}

export function costWriter(): SourceCostWriter | null {
  const db = supabaseAdmin();
  return db ? new SupabaseCostWriter(db) : null;
}

// --- Demo (fake-auth) mode ------------------------------------------------------------------

// One demo store per server process. globalThis keeps it shared across route
// bundles (pages, actions and route handlers load separately), like the fake auth store.
const DEMO_KEY = Symbol.for("kubera.reports.demo-costs");

function demoCosts(): MemoryCostWriter {
  const g = globalThis as unknown as Record<symbol, MemoryCostWriter | undefined>;
  return (g[DEMO_KEY] ??= new MemoryCostWriter());
}

export function demoReportingSource(now: Date): ReportingSource {
  return {
    async load(): Promise<ReportingData> {
      const data = reportingFixture(now);
      return { ...data, costs: [...data.costs, ...demoCosts().costs] };
    },
  };
}

export function demoCostWriter(): SourceCostWriter {
  return demoCosts();
}
