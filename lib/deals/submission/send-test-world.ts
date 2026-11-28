// Test helper (no production caller): a fixture submission context on a real
// memory desk deal, with a deal_summaries store, a memory vault and the fake
// approval gate, for the send-flow regression tests.

import { MemoryDocumentStorage } from "@/lib/disclosures/store";
import type { LenderMailer } from "../packages";
import { lenderInput, newDeal, noHolds, setup } from "../test-fixtures";
import { computeSubmissionMetrics } from "./metrics";
import { playbookLoanTypes } from "./playbooks";
import type { SubmissionSendDeps } from "./send";
import { submissionFixture } from "./test-fixtures";
import type { DealSummaryRecord, DealSummarySpec, EmailAdvisor, SubmissionContext, SubmissionPlaybook } from "./types";

export const TEST_ADVISOR: EmailAdvisor = { name: "Ana Ruiz", title: "Senior Advisor", dreLicense: "01234567", email: "ana@corincommercial.com", phone: "415-555-0100" };

/** A minimal deal_summaries store with the real one's (deal_id, pdf_sha256) rule. */
export function testSummaryStore() {
  const rows = new Map<string, DealSummaryRecord>();
  return {
    rows,
    async insertSummary(s: Omit<DealSummaryRecord, "id" | "createdAt">, now: Date): Promise<DealSummaryRecord> {
      const existing = [...rows.values()].find((r) => r.dealId === s.dealId && r.pdfSha256 === s.pdfSha256);
      if (existing) return existing;
      const row = { ...s, id: `summary-${rows.size + 1}`, createdAt: now.toISOString() };
      rows.set(row.id, row);
      return row;
    },
    async getSummary(id: string) {
      return rows.get(id) ?? null;
    },
  };
}

export function recordingMailer(): LenderMailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
      return { messageId: `msg-${sent.length}` };
    },
  };
}

export async function sendWorld(playbook: SubmissionPlaybook = "bridge", gateDefault: "approved" | "pending" | "rejected" | "expired" = "approved", mutate?: (ctx: SubmissionContext) => void) {
  const { store, gate, now, clock } = setup(gateDefault);
  const ctx = submissionFixture(playbook);
  const deal = await newDeal(store, now, { title: ctx.deal.title, program: ctx.deal.program, loanAmountCents: ctx.deal.loanAmountCents, propertyState: ctx.deal.propertyState, propertyAddress: ctx.deal.propertyAddress, borrowerName: ctx.deal.borrowerName });
  ctx.deal = deal;
  ctx.profile!.dealId = deal.id;
  if (ctx.sponsor) ctx.sponsor.dealId = deal.id;
  mutate?.(ctx);
  const lenderBase = { programs: [deal.program], loanTypes: [...playbookLoanTypes[playbook]], minLoanCents: 50_000_000, maxLoanCents: 5_000_000_000, states: ["CA", "AZ"], assetTypes: [] };
  const a = await store.insertLender(lenderInput({ ...lenderBase, name: "Harborline Capital", submissionEmail: "desk@harborline.example" }), "broker:ana", now());
  const b = await store.insertLender(lenderInput({ ...lenderBase, name: "Northgate Bank", submissionEmail: "loans@northgate.example" }), "broker:ana", now());
  const outOfBox = await store.insertLender(lenderInput({ ...lenderBase, name: "Desert Only Capital", states: ["NV"], submissionEmail: "x@desert.example" }), "broker:ana", now());
  const summaries = testSummaryStore();
  const storage = new MemoryDocumentStorage();
  const renders: DealSummarySpec[] = [];
  const deps: SubmissionSendDeps = {
    desk: store,
    summaries,
    storage,
    renderPdf: async (spec) => (renders.push(spec), new TextEncoder().encode(JSON.stringify(spec))),
    loadContext: async (id) => (id === deal.id ? ctx : null),
    computeMetrics: computeSubmissionMetrics,
    boxes: null,
    gate,
    now,
    baseUrl: "https://corincommercial.com",
    mailer: null,
    holds: noHolds,
  };
  const items = ctx.vaultDocuments.map((d, i) => ({ documentId: d.id, label: d.fileName, kind: d.kind, storagePath: `leads/x/${d.id}.pdf`, sha256: String(i).padStart(64, "c") }));
  return { store, gate, now, clock, ctx, deal, deps, summaries, storage, renders, items, lenders: { a, b, outOfBox } };
}
