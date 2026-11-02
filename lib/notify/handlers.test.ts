import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cronAuthFailure, handleLeadConfirmation, handleStageEvent, handleSweep, handleTier1, internalAuthFailure, type NotifyHandlerDeps } from "./handlers";
import { MemoryLeadSource, type LeadRecord } from "./leads";
import { DAYTIME, makeHarness, type Harness } from "./testing";

const SECRET = "internal-secret-with-more-than-32-characters";
const CRON = "cron-secret-with-more-than-32-characters!!";
const LEAD_ID = "3f9a12bc-0000-4000-8000-000000000001";
const STAFF = { phones: ["+13105550111"], emails: ["deals@corincommercial.com"] };

const tier1Lead = (over: Partial<LeadRecord> = {}): LeadRecord => ({
  id: LEAD_ID,
  createdAt: new Date(DAYTIME.getTime() - 5_000).toISOString(),
  tier: "TIER_1_INSTITUTIONAL_HOT",
  loanAmount: 9_000_000,
  program: "SBA_504",
  assetType: "HOTEL",
  contact: { firstName: "Pat", email: "pat@example.com", phone: "+14155550100", consent: true },
  ...over,
});

let h: Harness;
let leads: MemoryLeadSource;
let deps: NotifyHandlerDeps;

const post = (path: string, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
  new Request(`https://corincommercial.com/api/notify/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

const saved = { ...process.env };
beforeEach(() => {
  process.env.NOTIFY_INTERNAL_SECRET = SECRET;
  process.env.CRON_SECRET = CRON;
  h = makeHarness({ preApproved: ["milestone_update@1", "milestone_update_sms@1"] });
  leads = new MemoryLeadSource([tier1Lead()]);
  deps = { notifier: h.notifier, leads, staff: STAFF, now: () => h.clock.now };
});
afterEach(() => {
  process.env = { ...saved };
});

describe("internal auth", () => {
  it("answers 503 when the secret is not configured and 401 for the wrong one", async () => {
    expect(internalAuthFailure(post("tier1", {}), {})?.status).toBe(503);
    expect(internalAuthFailure(post("tier1", {}, "Bearer nope"), { NOTIFY_INTERNAL_SECRET: SECRET })?.status).toBe(401);
    expect(internalAuthFailure(post("tier1", {}, null), { NOTIFY_INTERNAL_SECRET: SECRET })?.status).toBe(401);
    expect(internalAuthFailure(post("tier1", {}), { NOTIFY_INTERNAL_SECRET: SECRET })).toBeNull();
    expect(cronAuthFailure(post("sweep", {}, `Bearer ${CRON}`), { CRON_SECRET: CRON })).toBeNull();
  });

  it("rejects every internal endpoint without the bearer secret", async () => {
    for (const handler of [handleTier1, handleLeadConfirmation, handleStageEvent]) {
      const res = await handler(post("x", { leadId: LEAD_ID }, null), deps);
      expect(res.status).toBe(401);
    }
    expect(h.sms.sent).toHaveLength(0);
    expect(h.email.sent).toHaveLength(0);
  });
});

describe("POST /api/notify/tier1", () => {
  it("texts the broker for a Tier-1 lead", async () => {
    const res = await handleTier1(post("tier1", { leadId: LEAD_ID }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alerted: true, withinSla: true, sms: ["sent"], email: ["sent"] });
    expect(h.sms.sent).toHaveLength(1);
  });

  it("validates the body and reports an unknown lead", async () => {
    expect((await handleTier1(post("tier1", { leadId: "nope" }), deps)).status).toBe(400);
    expect((await handleTier1(post("tier1", { leadId: "7f9a12bc-0000-4000-8000-000000000009" }), deps)).status).toBe(404);
  });
});

describe("POST /api/notify/lead-confirmation", () => {
  it("sends the confirmation once", async () => {
    const first = await handleLeadConfirmation(post("lead-confirmation", { leadId: LEAD_ID }), deps);
    expect(await first.json()).toMatchObject({ status: "sent" });
    const second = await handleLeadConfirmation(post("lead-confirmation", { leadId: LEAD_ID }), deps);
    expect(await second.json()).toMatchObject({ status: "duplicate" });
    expect(h.email.sent).toHaveLength(1);
    expect(h.email.sent[0]?.to).toBe("pat@example.com");
    expect(h.email.sent[0]?.text).toContain("3F9A12BC");
  });
});

describe("POST /api/notify/stage-event", () => {
  it("looks the contact up from the lead and respects consent", async () => {
    h.grant({ phone: "+14155550100", email: "pat@example.com", leadId: LEAD_ID });
    const res = await handleStageEvent(post("stage-event", { eventId: "e1", stage: "lender_outreach", leadId: LEAD_ID }), deps);
    expect(await res.json()).toMatchObject({ ok: true, milestone: "lender_outreach", email: "sent", sms: "sent" });
  });

  it("sends nothing for a contact with no consent", async () => {
    const res = await handleStageEvent(post("stage-event", { eventId: "e2", stage: "closing", leadId: LEAD_ID }), deps);
    expect(await res.json()).toMatchObject({ email: "skipped_no_consent", sms: "skipped_no_consent" });
    expect(h.email.sent).toHaveLength(0);
  });

  it("accepts an explicit contact for deals without a lead, and needs one or the other", async () => {
    h.grant({ email: "sam@example.com" });
    const ok = await handleStageEvent(post("stage-event", { eventId: "e3", stage: "term_sheet", contact: { firstName: "Sam", email: "sam@example.com" } }), deps);
    expect(await ok.json()).toMatchObject({ milestone: "lender_terms", email: "sent" });
    expect((await handleStageEvent(post("stage-event", { eventId: "e4", stage: "term_sheet" }), deps)).status).toBe(400);
  });

  it("ignores stages that are not milestones", async () => {
    const res = await handleStageEvent(post("stage-event", { eventId: "e5", stage: "closed_lost", leadId: LEAD_ID }), deps);
    expect(await res.json()).toMatchObject({ ok: true, milestone: null, skipped: "unknown_stage" });
  });
});

describe("GET /api/notify/sweep", () => {
  const get = (auth: string | null = `Bearer ${CRON}`) => new Request("https://corincommercial.com/api/notify/sweep", { headers: auth ? { authorization: auth } : {} });

  it("requires the cron secret", async () => {
    expect((await handleSweep(get(null), deps)).status).toBe(401);
    expect((await handleSweep(get("Bearer wrong"), deps)).status).toBe(401);
  });

  it("alerts a Tier-1 lead the request path missed, and only once", async () => {
    const first = await handleSweep(get(), deps);
    expect(await first.json()).toMatchObject({ checked: 1, alerted: 1, alreadyDone: 0 });
    const second = await handleSweep(get(), deps);
    expect(await second.json()).toMatchObject({ checked: 1, alerted: 0, alreadyDone: 1 });
    expect(h.sms.sent).toHaveLength(1);
  });

  it("only looks at recent leads", async () => {
    leads.leads[0] = tier1Lead({ createdAt: new Date(DAYTIME.getTime() - 2 * 3_600_000).toISOString() });
    expect(await (await handleSweep(get(), deps)).json()).toMatchObject({ checked: 0 });
    expect(h.sms.sent).toHaveLength(0);
  });
});
