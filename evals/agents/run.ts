// Golden-set evals for agents and document types.
//
//   npm run evals:agents                       validate suites; run deterministic subjects
//   npm run evals:agents -- --live             also run model-backed subjects (needs ANTHROPIC_API_KEY; costs money)
//   npm run evals:agents -- --only=injection.redteam,qual-no-income --out=agent-evals.json
//
// Subjects come from evals/agents/subjects.ts plus any lib/agents/<agent>/eval-subjects.ts.
// Exit codes: 0 pass, 1 invalid suite files or subject modules, 2 a suite failed.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { formatReport, loadDiscoveredSubjects, loadEvalSuites, runSuites, type EvalSubject } from "../../lib/agents/core/evals";
import { BUILTIN_SUBJECTS } from "./subjects";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIR = import.meta.dirname;

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k = "", v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v] as const;
  }),
);

async function main() {
  const { suites, errors } = loadEvalSuites(DIR);
  const subjects: Record<string, EvalSubject> = { ...BUILTIN_SUBJECTS };
  const discovered = await loadDiscoveredSubjects(ROOT, subjects);
  errors.push(...discovered.errors);
  if (discovered.loaded.length) console.log(`subject modules: ${discovered.loaded.join(", ")}`);
  if (errors.length) {
    console.error(`Invalid agent evals:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }

  let live = args.get("live") === "true";
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.warn("--live needs ANTHROPIC_API_KEY; running deterministic subjects only.");
    live = false;
  }
  const only = args.get("only")?.split(",").filter(Boolean);
  const results = await runSuites(
    suites.map((s) => s.suite),
    subjects,
    { live, ...(only?.length ? { only } : {}), concurrency: Number(process.env.EVAL_CONCURRENCY ?? 4) },
  );
  console.log(formatReport(results));
  const ran = results.filter((r) => r.status !== "skipped");
  const failed = results.filter((r) => r.status === "fail");
  console.log(`\n${ran.length} suites ran, ${failed.length} failed, ${results.length - ran.length} skipped.`);
  const out = args.get("out");
  if (out) writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), live, results }, null, 2));
  process.exit(failed.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
