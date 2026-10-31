// CI gate for the advisor golden set: every eval file must parse, case ids
// must be unique, there must be at least 30 cases covering every topic, and
// any deal context must be accepted by the advisor's own schema.
import { describe, expect, it, vi } from "vitest";
import { loadAdvisorEvals } from "./load";
import { GLOBAL_FORBIDDEN, gradeReply, TOPICS, type EvalCase } from "./schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => null }));
const { dealContextSchema } = await import("@/lib/ai/advisor");

const { suites, errors } = loadAdvisorEvals();
const cases = suites.flatMap((s) => s.suite.cases);

describe("advisor eval files", () => {
  it("all parse and validate", () => {
    expect(errors).toEqual([]);
  });

  it("contain at least 30 cases across every topic", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    for (const topic of TOPICS) expect(cases.some((c) => c.topic === topic), topic).toBe(true);
  });

  it("every case carries a source", () => {
    for (const c of cases) expect(c.source.length, c.id).toBeGreaterThan(3);
  });

  it("deal contexts are valid sizer exports", () => {
    for (const c of cases.filter((x) => x.dealContext)) {
      expect(dealContextSchema.safeParse(c.dealContext).success, c.id).toBe(true);
    }
  });
});

describe("grader", () => {
  const c: EvalCase = {
    id: "t",
    topic: "hud",
    question: "What DSCR does HUD 232 need?",
    mode: "chat",
    expectedFacts: [{ fact: "1.45x", anyOf: ["1\\.45\\s*x"] }],
    forbiddenClaims: [],
    source: "test",
  };

  it("passes a compliant reply", () => {
    expect(gradeReply(c, "HUD 232/223(f) typically requires a 1.45x minimum DSCR, subject to underwriting.").passed).toBe(true);
  });

  it("flags missing facts", () => {
    expect(gradeReply(c, "It depends.").missingFacts).toEqual(["1.45x"]);
  });

  it("flags global forbidden claims", () => {
    const hits = (reply: string) => gradeReply(c, `1.45x. ${reply}`).forbiddenHits;
    expect(hits("Good news: you are approved.")).toContain(GLOBAL_FORBIDDEN[0]!.claim);
    expect(hits("We guarantee to close in 14 days.")).toHaveLength(1);
    expect(hits("Your loan is exempt from usury limits.")).toHaveLength(1);
    expect(hits("Kubera will fund the loan at closing.")).toHaveLength(1);
    expect(hits("Kubera can hold your funds in escrow.")).toHaveLength(1);
  });

  it("does not flag conditional or negated phrasing", () => {
    const hits = (reply: string) => gradeReply(c, `1.45x. ${reply}`).forbiddenHits;
    expect(hits("Once you're approved by HUD, the lender sets the rate.")).toEqual([]);
    expect(hits("We'll check whether you qualify for SBA 504.")).toEqual([]);
    expect(hits("Kubera never funds loans; the lender of record does.")).toEqual([]);
    expect(hits("Timing is not guaranteed.")).toEqual([]);
  });
});
