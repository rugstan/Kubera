// NVIDIA NeMo Retriever (extraction NIM) client: PDF -> page text and tables.
//
// Env-gated on NVIDIA_NEMO_RETRIEVER_URL (+ NVIDIA_API_KEY for hosted
// endpoints). The request/response shape below follows the self-hosted
// extraction service: POST {base}/v1/extract with the base64 document, answer
// { pages: [{ page, text, tables: [{ rows: string[][] }] }] }.
// VERIFY: confirm the route and field names against the deployed NIM's OpenAPI
// before enabling in production; as of 2026-10-31.
//
// The routing guard runs before upload: NVIDIA's ceiling is confidential, so a
// personal financial statement (restricted) or a document of unknown type never
// goes to NeMo; the pipeline reads those with Claude instead.

import { assertRoutable, RoutingRefusedError } from "@/lib/ai/routing";
import type { Cell, Table } from "./types";

export type NemoDocument = { bytes: Uint8Array; contentType: string; fileName?: string };
export type NemoResult = { text: string; tables: Table[]; pages: number };

export interface NemoRetrieverClient {
  configured(): boolean;
  extract(doc: NemoDocument, route: { level: "confidential" | "restricted"; subject?: { aiProcessingOptOut?: boolean } }): Promise<NemoResult>;
}

export const NEMO_MODEL_ID = "nvidia/nemo-retriever-extraction";

export class NemoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NemoUnavailableError";
  }
}

type NemoResponse = { pages?: { page?: number; text?: string; tables?: { rows?: unknown[][] }[] }[] };

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  return s ? s : null;
}

export function parseNemoResponse(body: NemoResponse): NemoResult {
  const pages = Array.isArray(body.pages) ? body.pages : [];
  const tables: Table[] = [];
  const texts: string[] = [];
  pages.forEach((p, i) => {
    const page = typeof p.page === "number" ? p.page : i + 1;
    if (typeof p.text === "string" && p.text.trim()) texts.push(p.text);
    (p.tables ?? []).forEach((t, ti) => {
      if (Array.isArray(t.rows)) tables.push({ name: `page ${page} table ${ti + 1}`, rows: t.rows.map((r) => (Array.isArray(r) ? r.map(toCell) : [])) });
    });
  });
  return { text: texts.join("\n"), tables, pages: pages.length };
}

/** Throws RoutingRefusedError when the document may not go to NVIDIA. */
export function assertNemoRoutable(route: { level: "confidential" | "restricted"; subject?: { aiProcessingOptOut?: boolean } }, fileName?: string): void {
  assertRoutable({
    model: NEMO_MODEL_ID,
    provider: "nvidia",
    purpose: "document_extraction",
    payload: { document: { fileName: fileName ?? null } },
    declared: { level: route.level, categories: ["borrower", "deal"] },
    ...(route.subject ? { subject: route.subject } : {}),
  });
}

export class HttpNemoRetriever implements NemoRetrieverClient {
  constructor(private readonly cfg: { baseUrl?: string; apiKey?: string; fetch?: typeof fetch; timeoutMs?: number }) {}

  configured(): boolean {
    return Boolean(this.cfg.baseUrl);
  }

  async extract(doc: NemoDocument, route: { level: "confidential" | "restricted"; subject?: { aiProcessingOptOut?: boolean } }): Promise<NemoResult> {
    if (!this.cfg.baseUrl) throw new NemoUnavailableError("NeMo Retriever is not configured");
    assertNemoRoutable(route, doc.fileName);
    const fetchImpl = this.cfg.fetch ?? globalThis.fetch.bind(globalThis);
    let res: Response;
    try {
      res = await fetchImpl(`${this.cfg.baseUrl.replace(/\/+$/, "")}/v1/extract`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          document: { content: Buffer.from(doc.bytes).toString("base64"), content_type: doc.contentType, file_name: doc.fileName ?? "document" },
          extract: { text: true, tables: true, charts: false, images: false },
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
      });
    } catch (err) {
      throw new NemoUnavailableError(`NeMo Retriever request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new NemoUnavailableError(`NeMo Retriever HTTP ${res.status}`);
    return parseNemoResponse((await res.json()) as NemoResponse);
  }
}

export function nemoFromEnv(env: Record<string, string | undefined> = process.env): NemoRetrieverClient {
  const baseUrl = env.NVIDIA_NEMO_RETRIEVER_URL?.trim() || undefined;
  const apiKey = env.NVIDIA_API_KEY?.trim() || undefined;
  return new HttpNemoRetriever({ ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) });
}

export class FakeNemoRetriever implements NemoRetrieverClient {
  readonly calls: NemoDocument[] = [];
  constructor(private readonly answer: (doc: NemoDocument) => NemoResult | Promise<NemoResult>) {}
  configured() {
    return true;
  }
  async extract(doc: NemoDocument, route: { level: "confidential" | "restricted"; subject?: { aiProcessingOptOut?: boolean } }): Promise<NemoResult> {
    assertNemoRoutable(route, doc.fileName);
    this.calls.push(doc);
    return this.answer(doc);
  }
}

export { RoutingRefusedError };
