// The send flow end to end on memory stores: the readiness gate before
// anything is stored, the summary stored once and locked into the package,
// one approval per lender, and no email without a lender mailer.

import { describe, expect, it } from "vitest";
import { MemoryDocumentStorage } from "@/lib/disclosures/store";
import { PackageError, type LenderMailer } from "../packages";
import { lenderInput, newDeal, noHolds, setup } from "../test-fixtures";
import { emailSha256 } from "./email";
import { playbookLoanTypes } from "./playbooks";
import { prepareSubmission, previewSubmission, submitDealToLenders, type SubmissionSendDeps } from "./send";
import { summarySpecSha256 } from "./summary";
import { computeSubmissionMetrics } from "./metrics";
import { submissionFixture } from "./test-fixtures";
import { EMAIL_PLACEHOLDERS, type DealSummaryRecord, type DealSummarySpec, type SubmissionContext, type SubmissionPlaybook } from "./types";

const ADVISOR = { name: "Ana Ruiz", title: "Senior Advisor", dreLicense: "01234567", email: "ana@corincommercial.com", phone: "415-555-0100" };

/** A minimal deal_summaries store with the real one's (deal_id, pdf_sha256) rule. */
function summaryStore() {
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

function recordingMailer(): LenderMailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { sent, async send(m) { sent.push(m); return { messageId: `msg-${sent.length}` }; } };
}

/** A fixture context on a real desk deal (the desk mints the deal id). */
async function world(playbook: SubmissionPlaybook = "bridge", gateDefault: "approved" | "pending" = "approved", mutate?: (ctx: SubmissionContext) => void) {
  const { store, gate, now } = setup(gateDefault);
  const ctx = submissionFixture(playbook);
  const deal = await newDeal(store, now, { title: ctx.deal.title, program: ctx.deal.program, loanAmountCents: ctx.deal.loanAmountCents, propertyState: ctx.deal.propertyState, propertyAddress: ctx.deal.propertyAddress, borrowerName: ctx.deal.borrowerName });
  ctx.deal = deal;
  ctx.profile!.dealId = deal.id;
  ctx.sponsor!.dealId = deal.id;
  mutate?.(ctx);
  const lenderBase = { programs: [deal.program], loanTypes: [...playbookLoanTypes[playbook]], minLoanCents: 50_000_000, maxLoanCents: 5_000_000_000, states: ["CA", "AZ"], assetTypes: [] };
  const a = await store.insertLender(lenderInput({ ...lenderBase, name: "Harborline Capital", submissionEmail: "desk@harborline.example" }), "broker:ana", now());
  const b = await store.insertLender(lenderInput({ ...lenderBase, name: "Northgate Bank", submissionEmail: "loans@northgate.example" }), "broker:ana", now());
  const outOfBox = await store.insertLender(lenderInput({ ...lenderBase, name: "Desert Only Capital", states: ["NV"], submissionEmail: "x@desert.example" }), "broker:ana", now());
  const summaries = summaryStore();
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
  return { store, gate, now, ctx, deal, deps, summaries, storage, renders, items, lenders: { a, b, outOfBox } };
}

describe("prepareSubmission", () => {
  it("stores the summary once, locks it into the package, and builds each lender's exact email, without asking the gate", async () => {
    const w = await world();
    const p = await prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id, w.lenders.b.id, w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    expect(p.readiness).toMatchObject({ stage: "term_sheet", ready: true, missing: [] });
    const locked = p.locked!;
    expect(w.summaries.rows.size).toBe(1);
    expect(locked.summary).toMatchObject({ dealId: w.deal.id, targetStage: "term_sheet", playbook: "bridge", profileVersion: 7, sponsorVersion: 3, createdBy: "broker:ana" });
    expect(locked.summary.specSha256).toBe(summarySpecSha256(locked.summary.spec));
    expect([...w.storage.objects.keys()]).toEqual([locked.summaryItem.storagePath]);
    expect(locked.pkg).toMatchObject({ status: "locked", version: 1 });
    expect(locked.pkg.manifest.map((i) => i.kind)).toContain("DEAL_SUMMARY");
    expect(locked.pkg.manifest).toHaveLength(w.items.length + 1);
    expect(p.lenders.map((l) => l.lender.name)).toEqual(["Harborline Capital", "Northgate Bank"]);
    for (const l of p.lenders) {
      expect(l.email.text).toContain(EMAIL_PLACEHOLDERS.shareLink);
      expect(l.email.sha256).toBe(emailSha256(l.email.subject, l.email.text));
      expect(l.submission).toMatchObject({ targetStage: "term_sheet", summaryId: locked.summary.id, email: { sha256: l.email.sha256 } });
      expect(l.email.text).toContain(`IN THE PACKAGE (${locked.pkg.manifest.length} documents)`);
    }
    // Only the greeting, the fit lines and the lender's name differ.
    expect(p.lenders[0]!.email.text.split("Harborline Capital").join("X")).toBe(p.lenders[1]!.email.text.split("Northgate Bank").join("X"));
    expect(w.gate.requests).toHaveLength(0);

    // Preparing the same facts again reuses the summary row and the locked version.
    const again = await prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.b.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    expect(again.locked!.summary.id).toBe(locked.summary.id);
    expect(again.locked!.pkg.id).toBe(locked.pkg.id);
    expect(await w.store.listPackages(w.deal.id)).toHaveLength(1);
  });

  it("stores and locks nothing when no lender is admitted", async () => {
    const w = await world();
    const p = await prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id, "missing-lender"], items: w.items, advisor: ADVISOR, actor: "a", admit: (l) => `${l.name} is paused` });
    expect(p.locked).toBeNull();
    expect(p.lenders).toEqual([]);
    expect(p.skipped.map((s) => s.error)).toEqual(["Harborline Capital is paused", "Lender not found on the panel"]);
    expect(w.summaries.rows.size).toBe(0);
    expect(w.storage.objects.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
  });

  it("refuses when required items are missing and no reason is given: nothing stored, nothing locked", async () => {
    const w = await world("bridge", "approved", (ctx) => {
      ctx.vaultDocuments = ctx.vaultDocuments.filter((d) => d.kind !== "T12");
      for (const i of ctx.checklistItems) if (i.templateKey === "t12") i.status = "requested";
    });
    const err = await prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err).toMatchObject({ reason: "not_ready", message: "1 required item is missing for a term-sheet request: T-12 operating statement. Add it or give a reason to send anyway." });
    expect(w.summaries.rows.size).toBe(0);
    expect(w.storage.objects.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
    // A Screen request needs no T-12.
    await expect(prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a" })).resolves.toBeTruthy();
  });

  it("lets holds and a closed deal win over an override reason", async () => {
    const w = await world();
    const input = { dealId: w.deal.id, targetStage: "underwrite" as const, lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a", overrideReason: "The lender orders the appraisal and Phase I itself" };
    await expect(prepareSubmission({ ...w.deps, holds: { active: async () => [{ detail: "Possible OFAC match" }] } }, input)).rejects.toMatchObject({ reason: "deal_held" });
    await expect(prepareSubmission({ ...w.deps, holds: null }, input)).rejects.toMatchObject({ reason: "deal_held" });
    w.ctx.openHolds = ["Possible OFAC match"];
    await expect(prepareSubmission(w.deps, input)).rejects.toMatchObject({ reason: "deal_held" });
    expect(w.summaries.rows.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
  });
});

describe("submitDealToLenders", () => {
  it("with no mailer, emails nothing and hands staff the link and the approved email", async () => {
    const w = await world();
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    const o = r.outcomes[0]!;
    expect(o.ok).toBe(true);
    if (!o.ok) throw new Error(o.error);
    expect(o.result.outreach.status).toBe("approved");
    expect(o.result.shareUrl).toMatch(/\/api\/deals\/share\//);
    expect(o.result.email!.text).toContain(o.result.shareUrl!);
    expect(o.result.email!.text).not.toContain("{{");
    const row = (await w.store.getOutreach(o.result.outreach.id))!;
    expect(row.emailText).toBe(r.prepared.lenders[0]!.email.text);
    expect(row.emailSha256).toBe(r.prepared.lenders[0]!.email.sha256);
    expect(w.gate.requests[0]!.templateId).toBe("lender_package_submission_v2");
  });

  it("with a lender mailer, sends the approved text with the link filled in", async () => {
    const w = await world();
    const m = recordingMailer();
    const r = await submitDealToLenders({ ...w.deps, mailer: m }, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    expect(r.outcomes[0]).toMatchObject({ ok: true, result: { outreach: { status: "sent" } } });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.to).toBe("desk@harborline.example");
    expect(m.sent[0]!.subject).toBe(r.prepared.lenders[0]!.email.subject);
    expect(m.sent[0]!.text).toMatch(/\nhttps:\/\/corincommercial\.com\/api\/deals\/share\/[A-Za-z0-9_-]{43}\n/);
  });

  it("sends nothing while approval is pending", async () => {
    const w = await world("bridge", "pending");
    const m = recordingMailer();
    const r = await submitDealToLenders({ ...w.deps, mailer: m }, { dealId: w.deal.id, targetStage: "screen", lenderIds: [w.lenders.a.id, w.lenders.b.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    expect(r.outcomes.map((o) => o.ok && o.result.outreach.status)).toEqual(["pending_approval", "pending_approval"]);
    expect(m.sent).toEqual([]);
    expect(w.store.links.size).toBe(0);
  });

  it("needs a reason for a lender outside its recorded box, and passes it to the approving broker", async () => {
    const w = await world("bridge", "pending");
    const input = { dealId: w.deal.id, targetStage: "screen" as const, lenderIds: [w.lenders.outOfBox.id], items: w.items, advisor: ADVISOR, actor: "broker:ana" };
    const refused = await submitDealToLenders(w.deps, input);
    expect(refused.outcomes[0]).toMatchObject({ ok: false, error: "Outside Desert Only Capital's recorded box: CA is outside your recorded states (NV). Give a reason to submit to this lender anyway." });
    expect(w.gate.requests).toEqual([]);
    // The readiness reason is not a lender override.
    const stillRefused = await submitDealToLenders(w.deps, { ...input, overrideReason: "Lender confirmed a CA exception by phone" });
    expect(stillRefused.outcomes[0]).toMatchObject({ ok: false });
    const sent = await submitDealToLenders(w.deps, { ...input, lenderOverrideReason: "Lender confirmed a CA exception by phone" });
    expect(sent.outcomes[0]).toMatchObject({ ok: true });
    expect(w.gate.requests[0]!.summary).toContain("Lender fit exceptions: CA is outside your recorded states (NV) — lender override: Lender confirmed a CA exception by phone.");
    expect(w.gate.requests[0]!.payload).toMatchObject({ fitExceptions: ["CA is outside your recorded states (NV)"], lenderOverrideReason: "Lender confirmed a CA exception by phone", overrideReason: null });
    expect(sent.prepared.lenders[0]!.email.text).toContain("Outside your recorded box: CA is outside your recorded states (NV).");
  });

  it("sends with missing items only with a reason, which the broker sees", async () => {
    const w = await world("bridge", "pending");
    const reason = "The lender orders the appraisal and Phase I itself";
    await expect(submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "underwrite", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a" })).rejects.toMatchObject({ reason: "not_ready" });
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "underwrite", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a", overrideReason: reason });
    expect(r.outcomes[0]).toMatchObject({ ok: true });
    const req = w.gate.requests[0]!;
    expect(req.payload).toMatchObject({ targetStage: "underwrite", overrideReason: reason, readinessMissing: r.prepared.readiness.missing });
    expect(r.prepared.readiness.missing.length).toBeGreaterThan(0);
    expect(req.summary).toContain(`— reason: ${reason}`);
    expect(r.prepared.locked!.summary.spec.openItems.length).toBe(r.prepared.readiness.missing.length);
    expect(r.prepared.lenders[0]!.email.text).toContain("Not yet in hand: ");
  });

  it("names missing per-principal items in the email without the principals' names", async () => {
    const w = await world("bridge", "pending", (ctx) => {
      for (const i of ctx.checklistItems.filter((x) => x.templateKey === "pfs" && x.principalId)) {
        i.title = `${i.title} — ${ctx.principals.find((p) => p.id === i.principalId)!.legalName}`;
        i.status = "requested";
      }
    });
    const r = await submitDealToLenders(w.deps, { dealId: w.deal.id, targetStage: "underwrite", lenderIds: [w.lenders.a.id], items: w.items, advisor: ADVISOR, actor: "a", overrideReason: "The lender orders the appraisal and Phase I itself" });
    expect(r.outcomes[0]).toMatchObject({ ok: true });
    const text = r.prepared.lenders[0]!.email.text;
    expect(text).toMatch(/Not yet in hand: .*\(2 principals\)/);
    for (const p of w.ctx.principals.filter((x) => x.kind === "individual")) expect(text).not.toContain(p.legalName);
    // Behind the link, the summary names them.
    expect(r.prepared.locked!.summary.spec.openItems.join(" ")).toContain(w.ctx.principals[1]!.legalName);
  });
});

describe("previewSubmission", () => {
  it("writes nothing, calls no gate, and shows the same email the approval will carry", async () => {
    const w = await world();
    const lenders = [w.lenders.a, w.lenders.b];
    const preview = previewSubmission({ ctx: w.ctx, metrics: computeSubmissionMetrics(w.ctx), stage: "term_sheet", lenders, boxes: [], documents: w.items, advisor: ADVISOR });
    expect(w.summaries.rows.size).toBe(0);
    expect(w.storage.objects.size).toBe(0);
    expect(await w.store.listPackages(w.deal.id)).toEqual([]);
    expect(w.gate.requests).toEqual([]);
    expect(preview.readiness.ready).toBe(true);
    expect(preview.neutralCopy).toEqual([]);
    expect(preview.summary.title).toBe("Brindlewood Court Apartments acquisition — loan request summary");
    const prepared = await prepareSubmission(w.deps, { dealId: w.deal.id, targetStage: "term_sheet", lenderIds: lenders.map((l) => l.id), items: w.items, advisor: ADVISOR, actor: "broker:ana" });
    for (const [i, l] of preview.lenders.entries()) {
      if (!l.ok) throw new Error(l.error);
      expect(l.email.sha256).toBe(prepared.lenders[i]!.email.sha256);
    }
    expect(summarySpecSha256(preview.summary)).toBe(prepared.locked!.summary.specSha256);
  });

  it("reports a lender whose email fails a check, and refuses identifiers typed into free text outright", async () => {
    const w = await world();
    // A principal's name is fine behind the link but never in the email body.
    w.ctx.profile!.exitDetail = `${w.ctx.principals[1]!.legalName} will sign the completion guaranty. His wife co-owns the business.`;
    const preview = previewSubmission({ ctx: w.ctx, metrics: computeSubmissionMetrics(w.ctx), stage: "screen", lenders: [w.lenders.a], boxes: [], documents: w.items, advisor: ADVISOR });
    expect(preview.lenders[0]).toMatchObject({ ok: false, error: expect.stringMatching(/guarantor's or principal's name/) });
    expect(preview.neutralCopy.map((f) => f.topic)).toEqual(["sex"]);
    const ctx = submissionFixture("bridge");
    ctx.profile!.exitDetail = "Guarantor SSN 123-45-6789 on file";
    expect(() => previewSubmission({ ctx, metrics: computeSubmissionMetrics(ctx), stage: "screen", lenders: [], boxes: [], documents: [], advisor: ADVISOR })).toThrow(/Social Security/);
  });
});
