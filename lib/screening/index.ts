// Env-gated sanctions client (Global rule 3). Without OPENSANCTIONS_API_KEY
// screening is unavailable: screenings are recorded as `error`, which never
// clears a principal, so a deal cannot reach closing unscreened.

import { OpenSanctionsClient } from "./opensanctions";
import type { SanctionsClient } from "./types";

export * from "./types";
export { FakeSanctionsClient, type FakeListEntry } from "./fake";
export { OpenSanctionsClient } from "./opensanctions";

let cached: SanctionsClient | null | undefined;
let warned = false;

export function sanctionsClientFromEnv(env: Record<string, string | undefined> = process.env): SanctionsClient | null {
  const apiKey = env.OPENSANCTIONS_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenSanctionsClient({ apiKey, dataset: env.OPENSANCTIONS_DATASET?.trim() || undefined, baseUrl: env.OPENSANCTIONS_API_URL?.trim() || undefined });
}

export function sanctionsClient(): SanctionsClient | null {
  if (cached === undefined) {
    cached = sanctionsClientFromEnv();
    if (!cached && !warned) {
      warned = true;
      console.warn("[screening] OPENSANCTIONS_API_KEY is not set; sanctions screening is unavailable and deals cannot clear screening.");
    }
  }
  return cached;
}

/** Test hook: inject a client (undefined re-reads the environment). */
export function setSanctionsClient(client: SanctionsClient | null | undefined): void {
  cached = client;
}
