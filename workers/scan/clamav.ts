// ClamAV adapter over a clamav-rest HTTP sidecar (clamd behind a small API).
//
// Request: multipart/form-data POST to `${CLAMAV_REST_URL}${CLAMAV_REST_SCAN_PATH}`
// (default /scan) with the file in the `file` field and, optionally,
// `Authorization: Bearer $CLAMAV_REST_API_KEY`.
//
// Response parsing is deliberately strict and fail-closed: only an explicit
// "OK"/not-infected answer is clean. Anything else (non-2xx other than the
// "virus found" 406, unparseable body, timeout, oversize rejection) is an
// error, which leaves the document quarantined.
//
// VERIFY against the image you deploy: this follows the two common shapes,
//   ajilach/clamav-rest        200 {"Status":"OK","Description":""}    406 {"Status":"FOUND","Description":"Eicar-Signature"}
//   benzino77/clamav-rest-api  200 {"success":true,"data":{"result":[{"name":"x","is_infected":false,"viruses":[]}]}}
// and clamd's StreamMaxLength must be at least the vault's 50 MB file limit.

import type { MalwareScanner, ScanVerdict } from "./scanner";

export type ClamAvConfig = {
  baseUrl: string;
  scanPath: string;
  apiKey?: string;
  timeoutMs: number;
};

export function clamAvConfigFromEnv(env: Record<string, string | undefined> = process.env): ClamAvConfig | null {
  const baseUrl = env.CLAMAV_REST_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const path = env.CLAMAV_REST_SCAN_PATH?.trim() || "/scan";
  const timeout = Number(env.CLAMAV_REST_TIMEOUT_MS);
  return {
    baseUrl,
    scanPath: path.startsWith("/") ? path : `/${path}`,
    apiKey: env.CLAMAV_REST_API_KEY?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000,
  };
}

type Item = { infected: boolean | null; signature?: string };

function items(body: unknown): Item[] | null {
  if (Array.isArray(body)) {
    const all = body.map(items);
    return all.every(Boolean) ? all.flatMap((a) => a!) : null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.Status === "string") {
    const status = b.Status.toUpperCase();
    if (status === "OK") return [{ infected: false }];
    if (status === "FOUND") return [{ infected: true, signature: typeof b.Description === "string" && b.Description ? b.Description : "unknown" }];
    return [{ infected: null }];
  }
  const result = (b.data as { result?: unknown } | undefined)?.result;
  if (Array.isArray(result)) {
    return result.map((r) => {
      const rec = r as { is_infected?: unknown; viruses?: unknown };
      if (typeof rec.is_infected !== "boolean") return { infected: null };
      const viruses = Array.isArray(rec.viruses) ? rec.viruses.filter((v): v is string => typeof v === "string") : [];
      return { infected: rec.is_infected, signature: viruses.join(", ") || (rec.is_infected ? "unknown" : undefined) };
    });
  }
  return null;
}

export class ClamAvRestScanner implements MalwareScanner {
  readonly name = "clamav-rest";

  constructor(
    private readonly config: ClamAvConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async scan(bytes: Uint8Array, fileName: string): Promise<ScanVerdict> {
    const err = (message: string): ScanVerdict => ({ status: "error", engine: this.name, message: message.slice(0, 300) });
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), fileName.replace(/[^\w.\- ]+/g, "_") || "upload");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${this.config.scanPath}`, {
        method: "POST",
        body: form,
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      return err(`scanner unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return err(`scanner returned HTTP ${res.status} with an unreadable body`);
    }
    const parsed = items(body);
    if (res.status !== 200 && res.status !== 406) return err(`scanner returned HTTP ${res.status}`);
    if (!parsed || parsed.length === 0 || parsed.some((i) => i.infected === null)) return err(`scanner returned an unrecognised answer (HTTP ${res.status})`);

    const hit = parsed.find((i) => i.infected);
    if (hit) return { status: "infected", engine: this.name, signature: (hit.signature ?? "unknown").slice(0, 200) };
    // A 406 means "virus found" in the ajilach image; never call that clean.
    if (res.status === 406) return err("scanner answered 406 without naming a signature");
    return { status: "clean", engine: this.name };
  }
}
