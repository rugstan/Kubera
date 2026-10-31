import { describe, expect, it } from "vitest";
import { seedDemoExtractions } from "./demo";
import { correctAndApprove, listReviewQueue, rejectExtraction } from "./review";
import { MemoryExtractionEventLog, MemoryExtractionStore } from "./store";

describe("demo extraction review queue", () => {
  it("seeds two extractions waiting for review that a reviewer can correct, approve and reject", async () => {
    const store = new MemoryExtractionStore();
    await seedDemoExtractions(store);
    const queue = await listReviewQueue(store);
    expect(queue.map((r) => r.doc_type).sort()).toEqual(["PFS", "T12"]);
    const pfs = queue.find((r) => r.doc_type === "PFS")!;
    expect(pfs.warnings.some((w) => w.endsWith("_mismatch"))).toBe(true);
    const deps = { store, events: new MemoryExtractionEventLog() };
    await expect(correctAndApprove(deps, pfs.id, { reviewer: "a" })).rejects.toThrow(/disagree/);
    expect(await correctAndApprove(deps, pfs.id, { reviewer: "a", corrections: { scalars: { totalAssets: "1900000" } } })).toMatchObject({ status: "approved" });
    const t12 = queue.find((r) => r.doc_type === "T12")!;
    expect(await rejectExtraction(deps, t12.id, { reviewer: "a", reason: "Wrong year" })).toMatchObject({ status: "rejected" });
    expect(await listReviewQueue(store)).toEqual([]);
  });
});
