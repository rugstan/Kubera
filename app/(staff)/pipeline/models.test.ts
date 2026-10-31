import { describe, expect, it } from "vitest";
import { relativeExpiry, statusLabel } from "../approvals/format";
import { safeDispositionName, scanStatusOf, servable } from "../documents/model";
import { DEMO_PIPELINE } from "./demo";
import { formatUsd, matchesQuery, stageOrder, summarizeStages, type PipelineRow } from "./model";

const rows: PipelineRow[] = DEMO_PIPELINE.map((d) => ({ ...d, pendingApprovals: 0 }));

describe("pipeline model", () => {
  it("summarizes active deals by stage in lifecycle order", () => {
    const s = summarizeStages(rows);
    expect(s.map((x) => x.stage)).toEqual(["intake", "qualifying", "packaging", "lender_outreach", "term_sheet", "underwriting", "closing"]);
    expect(s.find((x) => x.stage === "packaging")).toMatchObject({ count: 1, amountUsd: 18_500_000, label: "Packaging" });
    expect(s.some((x) => x.stage === "lost")).toBe(false);
    expect(stageOrder("intake")).toBeLessThan(stageOrder("closing"));
    expect(stageOrder("unknown")).toBeGreaterThan(stageOrder("lost"));
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
