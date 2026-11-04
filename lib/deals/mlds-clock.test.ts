import { describe, expect, it } from "vitest";
import { MemoryDisclosureStore } from "@/lib/disclosures/store";
import { sweepMldsClocks, type MldsClockAlert } from "./mlds-clock";
import { newDeal, setup } from "./test-fixtures";

describe("MLDS delivery clock sweep", () => {
  it("pages staff once when an undelivered MLDS enters its warning window and once when it is overdue", async () => {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    const deal = await newDeal(store, now, { title: "Sunrise refi" });
    // Completed application Monday 2026-11-02 10:00 Pacific: warn from Wednesday, due end of Thursday.
    const open = await disclosures.insert({ kind: "MLDS_RE882", status: "generated", dealId: deal.id, applicationCompletedAt: "2026-11-02T18:00:00.000Z", dueAt: "2026-11-06T01:00:00.000Z" }, now());
    // Delivered, re-issued and signed records are not paged.
    await disclosures.insert({ kind: "MLDS_RE882", status: "sent", dealId: deal.id, applicationCompletedAt: "2026-11-02T18:00:00.000Z", sentAt: "2026-11-03T18:00:00.000Z", provider: "fake", providerRequestId: "r" }, now());
    await disclosures.insert({ kind: "MLDS_RE882", status: "required", dealId: deal.id, applicationCompletedAt: "2026-11-02T18:00:00.000Z", supersedesId: open.id }, now());
    await disclosures.insert({ kind: "MLDS_RE882", status: "signed", dealId: deal.id, applicationCompletedAt: "2026-11-02T18:00:00.000Z" }, now());

    const sent = new Map<string, MldsClockAlert>();
    const sweep = (iso: string) => sweepMldsClocks({ disclosures, store, now: () => new Date(iso), alert: async (a) => void sent.set(a.key, a) });

    expect((await sweep("2026-11-03T17:00:00.000Z")).alerts).toEqual([]);
    const warn = await sweep("2026-11-04T17:00:00.000Z");
    expect(warn.alerts).toHaveLength(1);
    expect(warn.alerts[0]).toMatchObject({ key: `mlds-clock:${open.id}:warning`, status: "warning", dealId: deal.id, title: "MLDS due soon: Sunrise refi", path: `/deals/${deal.id}#mlds` });
    // Re-running in the same window repeats the same key (the staff_alert send is idempotent on it).
    await sweep("2026-11-04T19:00:00.000Z");
    expect([...sent.keys()]).toEqual([`mlds-clock:${open.id}:warning`]);

    const overdue = await sweep("2026-11-06T17:00:00.000Z");
    expect(overdue.alerts[0]).toMatchObject({ key: `mlds-clock:${open.id}:overdue`, status: "overdue", title: "MLDS overdue: Sunrise refi" });
    expect(overdue.alerts[0]!.lines[0]).toMatch(/B&P §10240/);
    expect(overdue.alerts[0]!.lines.join(" ")).not.toMatch(/@/);
  });

  it("keeps sweeping when one alert fails", async () => {
    const { store, now } = setup();
    const disclosures = new MemoryDisclosureStore();
    for (let i = 0; i < 2; i++) await disclosures.insert({ kind: "MLDS_RE882", status: "required", leadId: `00000000-0000-4000-8000-00000000000${i}`, applicationCompletedAt: "2026-11-02T18:00:00.000Z" }, now());
    let calls = 0;
    const r = await sweepMldsClocks({
      disclosures,
      store,
      now: () => new Date("2026-11-06T17:00:00.000Z"),
      alert: async () => {
        calls += 1;
        if (calls === 1) throw new Error("mail down");
      },
    });
    expect(r).toMatchObject({ checked: 2, failed: 1 });
    expect(r.alerts).toHaveLength(1);
  });
});
