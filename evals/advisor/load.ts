import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { evalSuiteSchema, type EvalSuite } from "./schema";

export const ADVISOR_EVAL_DIR = path.resolve(import.meta.dirname);

export type LoadedSuite = { file: string; suite: EvalSuite };
export type LoadResult = { suites: LoadedSuite[]; errors: string[] };

/** Reads and validates every evals/advisor/*.json file; also checks ids are unique across suites. */
export function loadAdvisorEvals(dir = ADVISOR_EVAL_DIR): LoadResult {
  const suites: LoadedSuite[] = [];
  const errors: string[] = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (!files.length) errors.push(`no eval files in ${dir}`);

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const parsed = evalSuiteSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      continue;
    }
    suites.push({ file, suite: parsed.data });
  }

  const seen = new Map<string, string>();
  for (const { file, suite } of suites) {
    for (const c of suite.cases) {
      const prior = seen.get(c.id);
      if (prior) errors.push(`${file}: duplicate case id "${c.id}" (also in ${prior})`);
      seen.set(c.id, file);
    }
  }
  return { suites, errors };
}
