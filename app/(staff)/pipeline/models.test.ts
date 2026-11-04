import { describe, expect, it } from "vitest";
import { relativeExpiry, statusLabel } from "../approvals/format";
import { safeDispositionName, scanStatusOf, servable } from "../documents/model";
import { DEMO_PIPELINE } from "./demo";
import { applyStageEvent, stageTemplate } from "@/lib/deals/stages";
import type { Deal } from "@/lib/deals/types";
import { DEAL_STAGES, formatUsd, isOpenDeal, matchesQuery, stageLabel, stageOrder, summarizeStages, type PipelineRow } from "./model";

const rows: PipelineRow[] = DEMO_PIPELINE.map((d) => ({ ...d, pendingApprovals: 0 }));

describe("pipeline model", () => {
  it("summarizes active deals by stage in lifecycle order", () => {
    const s = summarizeStages(rows);
    expect(s.map((x) => x.stage)).toEqual(["intake", "engaged", "packaging", "lender_outreach", "term_sheet", "underwriting", "closing"]);
    expect(s.find((x) => x.stage === "packaging")).toMatchObject({ count: 1, amountUsd: 18_500_000, label: "Packaging" });
    expect(s.some((x) => x.stage === "lost")).toBe(false);
    expect(stageOrder("intake")).toBeLessThan(stageOrder("closing"));
    expect(stageOrder("unknown")).toBeGreaterThan(stageOrder("lost"));
  });

  it("orders every deal-desk template stage, including engaged and withdrawn", () => {
    const keys = DEAL_STAGES.map((s) => s.key);
    for (const program of ["HUD_232", "SBA_7A", "CONSTRUCTION", "HARD_MONEY"] as const) {
      for (const st of stageTemplate(program).stages) expect(keys).toContain(st.key);
    }
    expect(stageLabel("engaged")).toBe("Engaged");
    expect(stageLabel("withdrawn")).toBe("Withdrawn");
    expect(stageOrder("engaged")).toBeLessThan(stageOrder("packaging"));
    expect(stageOrder("closed")).toBeLessThan(stageOrder("withdrawn"));
  });

  it("drops a deal from the active summary once the deal desk closes, loses or withdraws it", () => {
    const deal = { id: "d1", title: "Closing deal", program: "PRIVATE_BRIDGE", stage: "closing", status: "active", stageTemplateVersion: 1 } as Deal;
    const compliance = { gates: { closing: { allowed: true, reasons: [] } } } as never;
    const closed = applyStageEvent({ deal, event: "loan_closed", context: { compliance }, now: new Date("2026-11-03T00:00:00Z") });
    const lost = applyStageEvent({ deal, event: "mark_lost", context: {}, now: new Date("2026-11-03T00:00:00Z") });
    const withdrawn = applyStageEvent({ deal, event: "withdraw", context: {}, now: new Date("2026-11-03T00:00:00Z") });
    expect(lost.ok && lost.patch.status).toBe("lost");
    expect(withdrawn.ok && withdrawn.patch.status).toBe("withdrawn");
    const row: PipelineRow = { ...rows[0]!, id: "d1", stage: "closing", status: "active", loanAmountUsd: 5_000_000 };
    const before = summarizeStages([row]).find((s) => s.stage === "closing")!;
    expect(before.count).toBe(1);
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.patch.status).toBe("won");
      const after = { ...row, stage: closed.to, status: closed.patch.status! };
      expect(isOpenDeal(after)).toBe(false);
      expect(summarizeStages([after])).toEqual([]);
    }
    expect(isOpenDeal({ status: "on_hold" })).toBe(true);
  });

  it("formats loan amounts compactly", () => {
    expect(formatUsd(18_500_000)).toBe("$18.5M");
    expect(formatUsd(9_200_000)).toBe("$9.2M");
    expect(formatUsd(6_000_000)).toBe("$6M");
    expect(formatUsd(780_000)).toBe("$780K");
    expect(formatUsd(null)).toBe("—");
  });

  it("searches the visible columns", () => {
    const harbor = rows.find((r) => r.name.startsWith("Harbor"))!;
    expect(matchesQuery(harbor, "sba")).toBe(true);
    expect(matchesQuery(harbor, "san diego")).toBe(true);
    expect(matchesQuery(harbor, "lender outreach")).toBe(true);
    expect(matchesQuery(harbor, "fresno")).toBe(false);
    expect(matchesQuery(harbor, "  ")).toBe(true);
  });
});

describe("document viewer rules", () => {
  it("holds quarantined or unscanned files and serves clean ones", () => {
    expect(servable({ scanStatus: "clean", storagePath: "a/b.pdf" })).toEqual({ ok: true });
    expect(servable({ scanStatus: null, storagePath: "a/b.pdf" })).toEqual({ ok: true });
    for (const s of ["quarantined", "pending", "infected", "scanning", "pending_upload", "scan_failed", "rejected", "something_new"]) expect(servable({ scanStatus: s, storagePath: "a/b.pdf" })).toMatchObject({ ok: false, status: 423 });
    expect(servable(null)).toMatchObject({ ok: false, status: 404 });
  });

  it("reads the vault's scan column when present", () => {
    expect(scanStatusOf({ scan_status: "Quarantined" })).toBe("quarantined");
    expect(scanStatusOf({ status: "clean" })).toBe("clean");
    expect(scanStatusOf({})).toBeNull();
  });

  it("keeps file names from breaking the Content-Disposition header", () => {
    expect(safeDispositionName('T-12 "final"\r\nSet-Cookie: x=1;.pdf')).toBe("T-12 _final_Set-Cookie: x=1_.pdf");
    expect(safeDispositionName("résumé.pdf")).toBe("resume.pdf");
    expect(safeDispositionName("日本")).toBe("document");
  });
});

describe("approval formatting", () => {
  const now = new Date("2026-11-03T17:00:00Z");
  it("describes time left", () => {
    expect(relativeExpiry("2026-11-03T17:20:00Z", now)).toBe("Expires in 20 min");
    expect(relativeExpiry("2026-11-03T20:20:00Z", now)).toBe("Expires in 3 h 20 min");
    expect(relativeExpiry("2026-11-03T19:00:00Z", now)).toBe("Expires in 2 h");
    expect(relativeExpiry("2026-11-06T17:00:00Z", now)).toBe("Expires in 3 days");
    expect(relativeExpiry("2026-11-03T16:00:00Z", now)).toBe("Expired");
  });

  it("states that non-approved requests were not sent", () => {
    expect(statusLabel({ status: "expired", autoApproved: false, executedAt: null })).toBe("Expired · never sent");
    expect(statusLabel({ status: "rejected", autoApproved: false, executedAt: null })).toBe("Rejected · not sent");
    expect(statusLabel({ status: "approved", autoApproved: true, executedAt: "x" })).toBe("Approved (pre-approved template) · sent");
  });
});
