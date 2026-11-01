// Env-gated scanner selection. SCANNER_PROVIDER picks explicitly
// ("clamav" | "fake"); otherwise ClamAV when CLAMAV_REST_URL is set. With nothing
// configured this returns null and logs once: uploads still succeed but stay
// quarantined (and so undownloadable) until a scanner is configured.

import { fakeProviderRefusal } from "@/lib/deploy-env";
import { ClamAvRestScanner, clamAvConfigFromEnv } from "./clamav";
import { FakeScanner } from "./fake";
import type { MalwareScanner } from "./scanner";

export type { MalwareScanner, ScanVerdict } from "./scanner";
export { announceDocumentClean, runScanCycle, type ScanReport } from "./worker";

let warned = false;

export function scannerFromEnv(env: Record<string, string | undefined> = process.env): MalwareScanner | null {
  const explicit = env.SCANNER_PROVIDER?.trim();
  if (explicit === "fake") {
    // Same rule as AUTH_PROVIDER=fake: the fake marks almost everything clean,
    // so it must never release real uploads from quarantine. This also covers
    // the container worker, which runs without NODE_ENV or VERCEL_ENV.
    const refused = fakeProviderRefusal("SCANNER_PROVIDER", env);
    if (refused) throw new Error(refused);
    return new FakeScanner();
  }
  const clam = clamAvConfigFromEnv(env);
  if ((explicit === "clamav" || !explicit) && clam) return new ClamAvRestScanner(clam);
  if (!warned) {
    warned = true;
    console.warn(`[scan] No malware scanner configured${explicit ? ` for SCANNER_PROVIDER=${explicit}` : ""}; uploaded documents stay quarantined.`);
  }
  return null;
}
