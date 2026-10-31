// Test wiring for the document agent: in-memory stores, a vault with one
// clean document per call, a fake gateway (Claude) and fake PDF / NeMo clients.

import { createGateway, type ModelGateway } from "@/lib/ai/gateway";
import { FakeModelProvider, type FakeReply } from "@/lib/ai/gateway/fake";
import { noopTracer } from "@/lib/langfuse";
import { MemoryVaultStorage } from "@/lib/documents/storage";
import { MemoryDocumentStore, MemoryEventLog } from "@/lib/documents/store";
import { VAULT_BUCKET, type DocumentKind } from "@/lib/documents/types";
import { MemoryAgentRunStore } from "@/lib/workflows/runs";
import { createHash } from "node:crypto";
import { FakeClaudeDocumentClient, type PdfExtractionRequest } from "./claude-pdf";
import type { NemoDocument, NemoResult } from "./nemo";
import { FakeNemoRetriever } from "./nemo";
import type { ExtractionDeps } from "./pipeline";
import { MemoryConstructionBudgetStore, MemoryExtractionEventLog, MemoryExtractionStore } from "./store";

export const TEST_LEAD = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";

export type Harness = {
  deps: ExtractionDeps;
  store: MemoryExtractionStore;
  events: MemoryExtractionEventLog;
  budgets: MemoryConstructionBudgetStore;
  documents: MemoryDocumentStore;
  storage: MemoryVaultStorage;
  vaultEvents: MemoryEventLog;
  runs: MemoryAgentRunStore;
  claudeText: FakeModelProvider;
  claudePdf: FakeClaudeDocumentClient;
  nemo: FakeNemoRetriever | undefined;
  gateway: ModelGateway;
  addDocument(bytes: Uint8Array, opts?: { kind?: DocumentKind; contentType?: string; fileName?: string; status?: "clean" | "quarantined" }): Promise<string>;
};

export function harness(opts: {
  textReply?: FakeReply;
  pdfAnswer?: (req: PdfExtractionRequest) => unknown;
  nemo?: (doc: NemoDocument) => NemoResult;
  optOut?: boolean;
  claudeConfigured?: boolean;
} = {}): Harness {
  const store = new MemoryExtractionStore();
  const events = new MemoryExtractionEventLog();
  const budgets = new MemoryConstructionBudgetStore();
  const documents = new MemoryDocumentStore();
  const storage = new MemoryVaultStorage();
  const vaultEvents = new MemoryEventLog();
  const runs = new MemoryAgentRunStore();
  const claudeText = new FakeModelProvider("anthropic", opts.textReply ?? { text: "{}" }, opts.claudeConfigured ?? true);
  const gateway = createGateway({ providers: { anthropic: claudeText }, tracer: noopTracer });
  const claudePdf = new FakeClaudeDocumentClient(opts.pdfAnswer ?? (() => ({})), opts.claudeConfigured ?? true);
  const nemo = opts.nemo ? new FakeNemoRetriever(opts.nemo) : undefined;
  let n = 0;
  return {
    store,
    events,
    budgets,
    documents,
    storage,
    vaultEvents,
    runs,
    claudeText,
    claudePdf,
    nemo,
    gateway,
    deps: {
      store,
      events,
      budgets,
      gateway,
      claude: claudePdf,
      ...(nemo ? { nemo } : {}),
      vault: { documents, storage, events: vaultEvents },
      aiOptOut: async () => opts.optOut ?? false,
      runs,
    },
    async addDocument(bytes, o = {}) {
      n++;
      const path = `${TEST_LEAD}/doc-${n}`;
      const row = documents.seedLegacy({
        lead_id: TEST_LEAD,
        storage_path: path,
        kind: o.kind ?? "OTHER",
        file_name: o.fileName ?? `doc-${n}`,
        content_type: o.contentType ?? "application/octet-stream",
        status: o.status ?? "clean",
        bucket: o.status === "quarantined" ? "deal-documents-quarantine" : VAULT_BUCKET,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      storage.seed(o.status === "quarantined" ? "deal-documents-quarantine" : VAULT_BUCKET, path, bytes, o.contentType);
      return row.id;
    },
  };
}
