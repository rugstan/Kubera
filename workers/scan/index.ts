// Env-gated scanner selection. SCANNER_PROVIDER picks explicitly
// ("clamav" | "fake"); otherwise ClamAV when CLAMAV_REST_URL is set. With nothing
// configured this returns null and logs once: uploads still succeed but stay
// quarantined (and so undownloadable) until a scanner is configured.

import { ClamAvRestScanner, clamAvConfigFromEnv } from "./clamav";
import { FakeScanner } from "./fake";
import type { MalwareScanner } from "./scanner";

export type { MalwareScanner, ScanVerdict } from "./scanner";
export { announceDocumentClean, runScanCycle, type ScanReport } from "./worker";

let warned = false;

export function scannerFromEnv(env: Record<string, string | undefined> = process.env): MalwareScanner | null {
  const explicit = env.SCANNER_PROVIDER?.trim();
  if (explicit === "fake") {
    if (env.NODE_ENV === "production" && env.VERCEL_ENV === "production") throw new Error("SCANNER_PROVIDER=fake is not allowed in production");
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
