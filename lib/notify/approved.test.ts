// End to end through the real approvals queue: a held notification goes out
// when a broker approves it, exactly once, without anyone calling send again.
import { describe, expect, it, vi } from "vitest";
import { executeApproved } from "@/lib/approvals/executors";
import { queueApprovalGate } from "@/lib/approvals/gate";
import { ApprovalService } from "@/lib/approvals/service";
import { MemoryApprovalStore } from "@/lib/approvals/store";
import { APPROVAL_KIND_LABELS, type Approver } from "@/lib/approvals/types";
import { isNotifyApproval, notifyApprovalExecutor, resumeApprovedNotifications } from "./approved";
import type { Notifier } from "./service";
import { makeHarness, NIGHT, type HarnessOptions } from "./testing";

const PHONE = "+14155550100";
const EMAIL = "pat@example.com";
const broker: Approver = { userId: "00000000-0000-4000-8000-0000000000b1", label: "Pat Broker", dreLicense: "01234567" };

const milestoneSms = (key = "milestone:evt-1:sms") => ({
  templateId: "milestone_update_sms" as const,
  to: { audience: "borrower" as const, phone: PHONE },
  data: { label: "Lender outreach" },
  idempotencyKey: key,
});

const milestoneEmail = (key = "milestone:evt-1:email") => ({
  templateId: "milestone_update" as const,
  to: { audience: "borrower" as const, email: EMAIL },
  data: { firstName: "Pat", label: "Lender outreach", message: "Your loan package is being shared with lenders." },
  idempotencyKey: key,
});

/** A harness whose Notifier asks the real approvals queue, with the notify executor registered as the queue's decision hook. */
function setup(opts: HarnessOptions & { withExecutor?: boolean } = {}) {
  const clock = { now: opts.now ?? new Date("2026-11-03T20:00:00Z") };
  const approvalStore = new MemoryApprovalStore();
  // Filled below: the executor needs the harness's notifier, the harness needs the gate.
  const holder: { notifier?: Notifier } = {};
  const executor = { name: "notify_send", matches: isNotifyApproval, run: notifyApprovalExecutor(() => holder.notifier!) };
  const service: ApprovalService = new ApprovalService(
    approvalStore,
    () => clock.now,
    opts.withExecutor === false
      ? {}
      : {
          async onDecided(records) {
            await executeApproved(service, records, [executor]);
          },
        },
  );
  const h = makeHarness({ ...opts, gate: queueApprovalGate(service) });
  holder.notifier = h.notifier;
  h.clock.now = clock.now;
  const setNow = (d: Date) => {
    clock.now = d;
    h.clock.now = d;
  };
  return { h, service, approvalStore, setNow, resume: () => resumeApprovedNotifications({ store: h.store, notifier: h.notifier, approvals: service, now: () => clock.now }) };
}

describe("held notifications send once a broker approves them", () => {
  it("files the text as an sms approval and sends the borrower text exactly once on approve", async () => {
    const { h, service, resume } = setup();
    h.grant({ phone: PHONE });

    const held = await h.notifier.send(milestoneSms());
    expect(held.status).toBe("pending_approval");
    expect(h.sms.sent).toHaveLength(0);
    const [approval] = await service.list();
    expect(approval).toMatchObject({ kind: "sms", idempotencyKey: "notify:milestone:evt-1:sms", status: "pending" });
    expect(APPROVAL_KIND_LABELS[approval!.kind]).toBe("Text message");

    const decided = await service.approve(approval!.id, broker);
    expect(decided.ok).toBe(true);

    expect(h.sms.sent).toHaveLength(1);
    expect(h.sms.sent[0]?.to).toBe(PHONE);
    expect(h.sms.sent[0]?.text).toContain("Lender outreach");
    expect(h.store.notifications[0]).toMatchObject({ status: "sent", approvalId: approval!.id });
    const executed = await service.get(approval!.id);
    expect(executed?.executedAt).not.toBeNull();
    expect(executed?.executionRef).toBe(`notify:sent:${h.store.notifications[0]!.id}`);

    // Neither a repeated trigger, the sweep, nor a second hook run sends it again.
    expect((await h.notifier.send(milestoneSms())).status).toBe("duplicate");
    await resume();
    await executeApproved(service, [executed!], [{ name: "notify_send", matches: isNotifyApproval, run: notifyApprovalExecutor(() => h.notifier) }]);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("sends an approved email with the email kind", async () => {
    const { h, service } = setup();
    h.grant({ email: EMAIL, channels: ["email"] });
    expect((await h.notifier.send(milestoneEmail())).status).toBe("pending_approval");
    const [approval] = await service.list();
    expect(approval?.kind).toBe("email");
    await service.approve(approval!.id, broker);
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]).toMatchObject({ to: EMAIL, idempotencyKey: "milestone:evt-1:email" });
  });

  it("re-checks consent at send time: an opt-out after the request blocks the approved text", async () => {
    const { h, service } = setup();
    h.grant({ phone: PHONE, at: new Date("2026-11-03T10:00:00Z") });
    await h.notifier.send(milestoneSms());
    h.ledger.events.push({
      id: "rev1",
      eventType: "revoked",
      form: "sms" as never,
      textVersion: "sms-stop-keyword-2026-11-03",
      textSha256: "b".repeat(64),
      channels: ["sms", "autodialer"],
      email: null,
      phone: PHONE,
      ip: null,
      userAgent: null,
      page: null,
      occurredAt: "2026-11-03T19:00:00.000Z",
    });
    const [approval] = await service.list();
    await service.approve(approval!.id, broker);
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.notifications[0]?.status).toBe("skipped_no_consent");
  });

  it("holds an approval granted at night until the texting window opens, then the sweep sends it once", async () => {
    const { h, service, setNow, resume } = setup({ now: new Date("2026-11-03T20:00:00Z") });
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms());
    const [approval] = await service.list();

    setNow(NIGHT);
    await service.approve(approval!.id, broker);
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.notifications[0]?.status).toBe("deferred_quiet_hours");

    await resume(); // still night: nothing
    expect(h.sms.sent).toHaveLength(0);

    setNow(new Date(NIGHT.getTime() + 15 * 3_600_000)); // 13:00 ET next day
    // A retried trigger with the same message may also pick it up: the row holds the claimed approval.
    const [a, b] = await Promise.all([resume(), h.notifier.send(milestoneSms())]);
    expect(a.sent + (b.status === "sent" ? 1 : 0)).toBe(1);
    await resume();
    expect(h.sms.sent).toHaveLength(1);
    expect(h.store.notifications[0]?.status).toBe("sent");
  });

  it("the sweep sends a message approved while no executor ran, and closes expired ones", async () => {
    const { h, service, setNow, resume } = setup({ withExecutor: false });
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms("milestone:a:sms"));
    await h.notifier.send(milestoneSms("milestone:b:sms"));
    const approvals = await service.list();
    const a = approvals.find((r) => r.idempotencyKey === "notify:milestone:a:sms")!;
    await service.approve(a.id, broker);
    expect(h.sms.sent).toHaveLength(0);

    const first = await resume();
    expect(first.sent).toBe(1);
    expect(h.sms.sent).toHaveLength(1);
    expect((await service.get(a.id))?.executedAt).not.toBeNull();

    // b is never approved; once its approval expires the row stops waiting.
    setNow(new Date(Date.parse("2026-11-03T20:00:00Z") + 25 * 3_600_000));
    const later = await resume();
    expect(later.closed).toBe(1);
    expect(h.store.notifications.find((n) => n.idempotencyKey === "milestone:b:sms")?.status).toBe("expired");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("a rejected approval never sends", async () => {
    const { h, service, resume } = setup();
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms());
    const [approval] = await service.list();
    await service.reject(approval!.id, broker, "wrong borrower");
    await resume();
    expect(h.sms.sent).toHaveLength(0);
    expect(h.store.notifications[0]?.status).toBe("rejected");
  });

  it("refuses an approval whose payload does not match the held row", async () => {
    const { h } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.grant({ phone: PHONE });
    await h.notifier.send(milestoneSms());
    const row = h.store.notifications[0]!;
    const out = await h.notifier.sendApproved({
      id: row.approvalId!,
      idempotencyKey: `notify:${row.idempotencyKey}`,
      status: "approved",
      executedAt: new Date().toISOString(),
      payload: { channel: "sms", templateId: "milestone_update_sms", templateVersion: 1, recipient: "+14155550199", audience: "borrower", leadId: null, data: { label: "x" } },
    });
    expect(out.status).toBe("invalid");
    expect(h.sms.sent).toHaveLength(0);
  });
});
