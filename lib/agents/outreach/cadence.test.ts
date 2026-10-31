import { describe, expect, it } from "vitest";
import { planSeries, sentRounds, WAITING_STATUSES } from "./cadence";
import { DAY, DAYTIME, HOUR } from "./testing";
import { MemoryOutreachStore } from "./store";
import type { OutreachStatus } from "./types";

const CFG = { firstAfterHours: 24, repeatEveryHours: 72, maxRounds: 3 };

async function seed(store: MemoryOutreachStore, round: number, status: OutreachStatus, createdAt: Date, channel: "email" | "sms" = "email") {
  const store2 = store;
  const { row } = await store2.claim({
    kind: "document_reminder",
    channel,
    templateId: "document_reminder_email",
    templateVersion: 1,
    audience: "borrower",
    recipient: "pat@example.com",
    idempotencyKey: `k:${round}:${channel}:${status}`,
    dealId: "deal-1",
    subjectKey: "docs:deal-1",
    sequence: round,
  });
  row.createdAt = createdAt.toISOString();
  await store2.update(row.id, { status });
  return row;
}

const q = (store: MemoryOutreachStore, now: Date, anchor = new Date(DAYTIME.getTime() - 2 * DAY)) =>
  planSeries(store, { kind: "document_reminder", dealId: "deal-1", subjectKey: "docs:deal-1", anchor, cadence: CFG, now });

describe("reminder cadence", () => {
  it("round 1 is due once the item has been outstanding for the first interval", async () => {
    const store = new MemoryOutreachStore();
    expect(await q(store, DAYTIME, new Date(DAYTIME.getTime() - 23 * HOUR))).toMatchObject({ action: "none", reason: "not_due" });
    expect(await q(store, DAYTIME, new Date(DAYTIME.getTime() - 24 * HOUR))).toEqual({ action: "start", round: 1 });
  });

  it("the next round waits for the repeat interval after the last round started", async () => {
    const store = new MemoryOutreachStore();
    await seed(store, 1, "sent", new Date(DAYTIME.getTime() - 71 * HOUR));
    expect((await q(store, DAYTIME)).action).toBe("none");
    expect(await q(store, new Date(DAYTIME.getTime() + 2 * HOUR))).toEqual({ action: "start", round: 2 });
  });

  it("resumes a round that is waiting on approval or the texting window instead of starting another", async () => {
    for (const status of WAITING_STATUSES) {
      const store = new MemoryOutreachStore();
      await seed(store, 1, status, new Date(DAYTIME.getTime() - 10 * DAY));
      const plan = await q(store, DAYTIME);
      expect(plan.action).toBe("resume");
      if (plan.action === "resume") expect(plan.rows).toHaveLength(1);
    }
  });

  it("only the waiting rows of a round are resumed", async () => {
    const store = new MemoryOutreachStore();
    await seed(store, 2, "sent", new Date(DAYTIME.getTime() - 2 * HOUR), "email");
    await seed(store, 2, "deferred_quiet_hours", new Date(DAYTIME.getTime() - 2 * HOUR), "sms");
    const plan = await q(store, DAYTIME);
    expect(plan.action === "resume" && plan.rows.map((r) => r.channel)).toEqual(["sms"]);
  });

  it("a rejected or expired or refused round still counts, so the series cannot run forever", async () => {
    const store = new MemoryOutreachStore();
    await seed(store, 1, "rejected", new Date(DAYTIME.getTime() - 20 * DAY));
    await seed(store, 2, "expired", new Date(DAYTIME.getTime() - 15 * DAY));
    await seed(store, 3, "skipped_no_consent", new Date(DAYTIME.getTime() - 10 * DAY));
    expect(await q(store, DAYTIME)).toEqual({ action: "cap_reached", rounds: 3 });
  });

  it("counts rounds that actually delivered", async () => {
    const store = new MemoryOutreachStore();
    const a = await seed(store, 1, "sent", DAYTIME, "email");
    const b = await seed(store, 1, "sent", DAYTIME, "sms");
    const c = await seed(store, 2, "skipped_no_consent", DAYTIME);
    expect(sentRounds([a, b, c])).toBe(1);
  });
});
