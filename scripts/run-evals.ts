// Golden-set evals for Ask Kubera AI.
//
//   npm run evals                 validate eval files; run them live when ANTHROPIC_API_KEY is set
//   npm run evals -- --validate   validate only (what CI runs without a key)
//   npm run evals -- --only=hud232-dscr-ltv,sba-stack --out=evals-report.json
//
// Live runs go through the same code path as /api/ask (streamAdvisorTurn with
// an in-memory conversation store and a fixed, offline market snapshot), so a
// pass here means the production prompt, limits and guardrails produced the
// expected facts and none of the forbidden claims. Live runs cost money.
//
// Exit codes: 0 pass, 1 invalid eval files, 2 forbidden claim or pass rate
// below EVAL_MIN_PASS_RATE (default 0.8).

import { writeFileSync } from "node:fs";
import { loadAdvisorEvals } from "../evals/advisor/load";
import { gradeReply, type CaseGrade, type EvalCase } from "../evals/advisor/schema";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k = "", v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v] as const;
  }),
);

const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.8);

async function main() {
  const { suites, errors } = loadAdvisorEvals();
  const only = args.get("only")?.split(",").filter(Boolean);
  let cases = suites.flatMap((s) => s.suite.cases);
  if (only?.length) cases = cases.filter((c) => only.includes(c.id));

  // Deal contexts must pass the advisor's own validation.
  const { dealContextSchema } = await import("../lib/ai/advisor");
  for (const c of cases) {
    if (c.dealContext && !dealContextSchema.safeParse(c.dealContext).success) errors.push(`${c.id}: dealContext rejected by the advisor schema`);
  }

  if (errors.length) {
    console.error(`✗ ${errors.length} problem(s) in evals/advisor:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✓ ${suites.length} suites, ${cases.length} cases valid`);

  if (args.has("validate") || !process.env.ANTHROPIC_API_KEY) {
    if (!args.has("validate")) console.log("ANTHROPIC_API_KEY not set; skipping live run.");
    return;
  }

  const grades = await runLive(cases);
  report(grades, cases);
}

async function runLive(cases: EvalCase[]): Promise<(CaseGrade & { reply: string; ms: number })[]> {
  const { dealContextSchema, streamAdvisorTurn } = await import("../lib/ai/advisor");
  const { MemoryConversationStore } = await import("../lib/conversations/store");
  const { buildTicker } = await import("../lib/rates");
  const { FALLBACK_BENCHMARKS } = await import("../lib/sizing/assumptions");
  const market = { benchmarks: FALLBACK_BENCHMARKS, items: buildTicker(FALLBACK_BENCHMARKS), asOf: "eval-fixture", live: false };

  const results: (CaseGrade & { reply: string; ms: number })[] = [];
  const queue = [...cases];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const started = Date.now();
      const store = new MemoryConversationStore();
      const conv = await store.create({ ipHash: "eval", userAgent: "run-evals", page: null });
      const claimed = await store.claim(conv.id, 300_000);
      if (claimed.status !== "ok") throw new Error("eval store claim failed");
      const stream = await streamAdvisorTurn({
        conversationId: conv.id,
        history: [],
        turnCount: 0,
        message: c.question,
        mode: c.mode,
        dealContext: c.dealContext ? dealContextSchema.parse(c.dealContext) : undefined,
        market,
        store,
      });
      const reply = await new Response(stream).text();
      const grade = gradeReply(c, reply);
      results.push({ ...grade, reply, ms: Date.now() - started });
      console.log(`${grade.passed ? "✓" : "✗"} ${c.id} (${Date.now() - started} ms)`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  return results;
}

function report(grades: (CaseGrade & { reply: string; ms: number })[], cases: EvalCase[]) {
  const byId = new Map(grades.map((g) => [g.id, g]));
  const passed = grades.filter((g) => g.passed).length;
  const forbidden = grades.filter((g) => g.forbiddenHits.length);
  const rate = grades.length ? passed / grades.length : 0;

  console.log("");
  for (const c of cases) {
    const g = byId.get(c.id);
    if (!g || g.passed) continue;
    console.log(`✗ ${c.id}`);
    for (const f of g.missingFacts) console.log(`    missing fact: ${f}`);
    for (const f of g.forbiddenHits) console.log(`    FORBIDDEN: ${f}`);
  }
  console.log(`\n${passed}/${grades.length} passed (${(rate * 100).toFixed(1)}%), ${forbidden.length} with forbidden claims`);

  const out = args.get("out");
  if (out) {
    writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), passRate: rate, results: grades }, null, 2));
    console.log(`report written to ${out}`);
  }
  if (forbidden.length || rate < MIN_PASS_RATE) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
