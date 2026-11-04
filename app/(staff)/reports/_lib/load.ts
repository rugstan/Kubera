import "server-only";
import type { AuthServices } from "@/lib/auth/server";
import { buildReports, type ReportBundle } from "@/lib/reporting/build";
import { demoReportingSource, reportingSource } from "@/lib/reporting/server";
import type { RangeKey } from "@/lib/reporting/types";

export type BundleResult = { status: "ok"; bundle: ReportBundle } | { status: "unavailable" } | { status: "error" };

/** Loads one snapshot and builds every report. Fake-auth mode reports on the illustrative fixture. */
export async function loadBundle(services: Pick<AuthServices, "mode">, range: RangeKey, now: Date): Promise<BundleResult> {
  const source = services.mode === "fake" ? demoReportingSource(now) : reportingSource();
  if (!source) return { status: "unavailable" };
  try {
    return { status: "ok", bundle: buildReports(await source.load(), { range, now }) };
  } catch (err) {
    console.error("[reports] could not build reports:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }
}
