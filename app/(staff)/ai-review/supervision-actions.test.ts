// Staff server actions for AI review and reports: authentication, authorization
// and validation, against in-memory stores.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const staffForMutation = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ staffForMutation: () => staffForMutation() }));

const { DEMO_CONVERSATION_IDS, demoReviewStore } = await import("@/lib/ai/review/demo");
const { flagAction, reviewStatusAction, annotateAction } = await import("./actions");
const { recordSpendAction } = await import("../reports/actions");
const { demoCostWriter } = await import("@/lib/reporting/server");
const { canViewReports } = await import("../reports/_lib/access");

const ctx = (roles: string[], mode: "fake" | "supabase" = "fake") => ({
  ok: true as const,
  ctx: { principal: { userId: "u1", email: "Ana@Kubera.test", displayName: "Ana Ruiz", staffRoles: roles }, accessToken: "t", services: { mode } },
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const ID = DEMO_CONVERSATION_IDS.clean;

beforeEach(() => {
  staffForMutation.mockReset();
});

describe("AI review actions", () => {
  it("refuse anyone who is not signed in as staff with MFA", async () => {
    staffForMutation.mockResolvedValue({ ok: false, status: 401, reason: "signed_out" });
    expect(await flagAction({}, form({ id: ID, flagged: "true", reason: "x" }))).toMatchObject({ ok: false, message: expect.stringMatching(/Sign in/) });
    staffForMutation.mockResolvedValue({ ok: false, status: 403, reason: "mfa_required" });
    expect(await annotateAction({}, form({ id: ID, label: "tone", note: "x" }))).toMatchObject({ ok: false, message: expect.stringMatching(/two-step/) });
    expect(await reviewStatusAction({}, form({ id: ID, status: "reviewed" }))).toMatchObject({ ok: false });
  });

  it("flags with a reason, records who did it, and unflags", async () => {
    staffForMutation.mockResolvedValue(ctx(["analyst"]));
    const missing = await flagAction({}, form({ id: ID, flagged: "true", reason: "  " }));
    expect(missing).toMatchObject({ ok: false, message: expect.stringMatching(/reason/) });

    expect(await flagAction({}, form({ id: ID, flagged: "true", reason: "Quoted a rate as final" }))).toEqual({ ok: true, message: "Flagged for review." });
    expect(await demoReviewStore().get(ID)).toMatchObject({ flagged: true, flagReason: "Quoted a rate as final", flaggedBy: "staff:ana@kubera.test" });

    expect(await flagAction({}, form({ id: ID, flagged: "false" }))).toEqual({ ok: true, message: "Flag removed." });
    expect(await demoReviewStore().get(ID)).toMatchObject({ flagged: false, flagReason: null });
  });

  it("sets the review status for the signed-in reviewer", async () => {
    staffForMutation.mockResolvedValue(ctx(["broker"]));
    expect(await reviewStatusAction({}, form({ id: ID, status: "reviewed" }))).toEqual({ ok: true, message: "Marked reviewed." });
    expect(await demoReviewStore().get(ID)).toMatchObject({ reviewStatus: "reviewed", reviewedBy: "staff:ana@kubera.test" });
    expect(await reviewStatusAction({}, form({ id: ID, status: "done" }))).toMatchObject({ ok: false });
    expect(await reviewStatusAction({}, form({ id: "11111111-1111-4111-8111-999999999999", status: "reviewed" }))).toMatchObject({ ok: false, message: expect.stringMatching(/no longer exists/) });
  });

  it("adds notes to a message or the whole conversation and rejects bad input", async () => {
    staffForMutation.mockResolvedValue(ctx(["analyst"]));
    expect(await annotateAction({}, form({ id: ID, messageIndex: "1", label: "accurate", note: "Matches the primer." }))).toEqual({ ok: true, message: "Note added." });
    expect(await annotateAction({}, form({ id: ID, messageIndex: "", label: "other", note: "General note" }))).toMatchObject({ ok: true });
    const c = (await demoReviewStore().get(ID))!;
    expect(c.annotations.map((a) => [a.messageIndex, a.label, a.authorLabel])).toEqual([
      [1, "accurate", "Ana Ruiz"],
      [null, "other", "Ana Ruiz"],
    ]);
    expect(await annotateAction({}, form({ id: ID, messageIndex: "40", label: "tone", note: "x" }))).toMatchObject({ ok: false });
    expect(await annotateAction({}, form({ id: ID, label: "tone", note: "   " }))).toMatchObject({ ok: false, message: "Write a note" });
    expect(await annotateAction({}, form({ id: ID, label: "nonsense", note: "x" }))).toMatchObject({ ok: false });
    expect(await annotateAction({}, form({ id: "not-a-uuid", label: "tone", note: "x" }))).toMatchObject({ ok: false });
  });

  it("report that the queue is not configured outside fake mode without Supabase", async () => {
    staffForMutation.mockResolvedValue(ctx(["broker"], "supabase"));
    expect(await flagAction({}, form({ id: ID, flagged: "true", reason: "x" }))).toMatchObject({ ok: false, message: "The review queue is not configured." });
  });
});

describe("report access and spend action", () => {
  it("limits fee reports to brokers and administrators", () => {
    expect(canViewReports({ staffRoles: ["broker"] })).toBe(true);
    expect(canViewReports({ staffRoles: ["admin"] })).toBe(true);
    expect(canViewReports({ staffRoles: ["analyst"] })).toBe(false);
  });

  const spend = { source: "linkedin", periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: "1,200" };

  it("refuses an analyst and an unauthenticated caller", async () => {
    staffForMutation.mockResolvedValue(ctx(["analyst"]));
    expect(await recordSpendAction({}, form(spend))).toMatchObject({ ok: false, message: expect.stringMatching(/broker or administrator/) });
    staffForMutation.mockResolvedValue({ ok: false, status: 401, reason: "signed_out" });
    expect(await recordSpendAction({}, form(spend))).toMatchObject({ ok: false });
    expect(demoCostWriter()).toMatchObject({ costs: [] });
  });

  it("records spend for a broker, rejects bad input and a duplicate period", async () => {
    staffForMutation.mockResolvedValue(ctx(["broker"]));
    expect(await recordSpendAction({}, form({ ...spend, amount: "twelve" }))).toMatchObject({ ok: false });
    expect(await recordSpendAction({}, form(spend))).toEqual({ ok: true, message: "Recorded the spend for linkedin." });
    expect((demoCostWriter() as unknown as { costs: unknown[] }).costs).toEqual([{ source: "linkedin", periodStart: "2026-10-01", periodEnd: "2026-10-31", spendCents: 120_000 }]);
    expect(await recordSpendAction({}, form(spend))).toMatchObject({ ok: false, message: expect.stringMatching(/already recorded/) });
  });
});
