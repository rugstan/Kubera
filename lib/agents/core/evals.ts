// Golden-set evals for agents and document types.
//
// A suite (evals/agents/*.json) names a subject (the agent or extractor under
// test), a pass-rate bar and cases. Each case has an input and assertions on
// the subject's output: exact values, numbers within a tolerance, set
// membership, containment, absence, regex, and forbidden text anywhere in the
// output. Assertions marked `critical` fail the whole suite on their own (an
// injected email that caused a send, a guaranteed-closing claim).
//
// Subjects are plain async functions registered by name. Deterministic ones
// (rules engines, scanners, the tool runner) run in every `npm test`; model-
// backed ones run only with --live and a key. Agents owned by other
// workstreams register theirs in `lib/agents/<agent>/eval-subjects.ts`
// (exporting `subjects`), which the runner discovers at start-up, so adding an
// agent never requires editing this file.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const ID = /^[a-z0-9][a-z0-9_.-]{1,80}$/;

const jsonValue: z.ZodType<unknown> = z.unknown();

export const assertionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("equals"), path: z.string(), value: jsonValue, critical: z.boolean().optional() }),
  z.object({
    op: z.literal("approx"),
    path: z.string(),
    value: z.number(),
    /** Relative tolerance (0.01 = 1%) unless `absolute` is set. */
    tolerance: z.number().min(0).max(1).default(0.005),
    absolute: z.number().min(0).optional(),
    critical: z.boolean().optional(),
  }),
  z.object({ op: z.literal("oneOf"), path: z.string(), values: z.array(jsonValue).min(1), critical: z.boolean().optional() }),
  z.object({ op: z.literal("contains"), path: z.string(), values: z.array(jsonValue).min(1), critical: z.boolean().optional() }),
  z.object({ op: z.literal("notContains"), path: z.string(), values: z.array(jsonValue).min(1), critical: z.boolean().optional() }),
  z.object({ op: z.literal("exists"), path: z.string(), critical: z.boolean().optional() }),
  z.object({ op: z.literal("absent"), path: z.string(), critical: z.boolean().optional() }),
  z.object({ op: z.literal("gte"), path: z.string(), value: z.number(), critical: z.boolean().optional() }),
  z.object({ op: z.literal("lte"), path: z.string(), value: z.number(), critical: z.boolean().optional() }),
  z.object({ op: z.literal("matches"), path: z.string(), pattern: z.string().min(1), critical: z.boolean().optional() }),
  z.object({ op: z.literal("forbiddenText"), values: z.array(z.string().min(1)).min(1), critical: z.boolean().optional() }),
]);
export type Assertion = z.infer<typeof assertionSchema>;

export const evalCaseSchema = z.object({
  id: z.string().regex(ID),
  description: z.string().min(1).max(500),
  input: jsonValue,
  assert: z.array(assertionSchema).min(1),
  tags: z.array(z.string().regex(/^[a-z0-9_-]+$/)).default([]),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalSuiteSchema = z.object({
  suite: z.string().regex(ID),
  description: z.string().min(1).max(1000),
  /** Agent id (registry) or document type the suite covers. */
  agent: z.string().regex(ID),
  docType: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
  /** Subject name the cases run against. */
  subject: z.string().regex(ID),
  /** Used when `subject` is not registered (e.g. a reference extractor until the agent ships). */
  fallbackSubject: z.string().regex(ID).optional(),
  /** Subject options (passed to every case). */
  options: z.record(z.string(), jsonValue).default({}),
  /** JSON Schema for model-backed extraction subjects. */
  outputSchema: z.record(z.string(), jsonValue).optional(),
  minPassRate: z.number().min(0).max(1).default(1),
  cases: z.array(evalCaseSchema).min(1),
});
export type EvalSuite = z.infer<typeof evalSuiteSchema>;

export type EvalSubject = {
  /** "deterministic" subjects run in CI; "model" subjects only with --live. */
  kind: "deterministic" | "model";
  description: string;
  run(input: unknown, ctx: { suite: EvalSuite; caseId: string }): Promise<unknown>;
};

// --- Loading ------------------------------------------------------------------------------------

export type LoadedSuites = { suites: { file: string; suite: EvalSuite }[]; errors: string[] };

export function loadEvalSuites(dir: string): LoadedSuites {
  const suites: { file: string; suite: EvalSuite }[] = [];
  const errors: string[] = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) errors.push(`no eval suites in ${dir}`);
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${(err as Error).message})`);
      continue;
    }
    const parsed = evalSuiteSchema.safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) errors.push(`${file}: ${i.path.join(".") || "(root)"}: ${i.message}`);
      continue;
    }
    for (const c of parsed.data.cases) {
      for (const a of c.assert) {
        if (a.op === "matches") {
          try {
            new RegExp(a.pattern);
          } catch {
            errors.push(`${file}: ${c.id}: invalid regex ${a.pattern}`);
          }
        }
      }
    }
    suites.push({ file, suite: parsed.data });
  }
  const names = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const { file, suite } of suites) {
    if (names.has(suite.suite)) errors.push(`${file}: duplicate suite name ${suite.suite} (also ${names.get(suite.suite)})`);
    names.set(suite.suite, file);
    for (const c of suite.cases) {
      if (ids.has(c.id)) errors.push(`${file}: duplicate case id ${c.id} (also ${ids.get(c.id)})`);
      ids.set(c.id, file);
    }
  }
  return { suites, errors };
}

// --- Scoring ------------------------------------------------------------------------------------

export function getPath(value: unknown, p: string): unknown {
  if (!p) return value;
  let cur: unknown = value;
  for (const seg of p.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(seg);
      cur = Number.isInteger(i) ? cur[i] : seg === "length" ? cur.length : undefined;
    } else if (typeof cur === "object") {
      cur = Object.hasOwn(cur, seg) ? (cur as Record<string, unknown>)[seg] : undefined;
    } else return undefined;
  }
  return cur;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return deepEqual(ka, kb) && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function containsValue(hay: unknown, needle: unknown): boolean {
  if (typeof hay === "string") return typeof needle === "string" && hay.toLowerCase().includes(needle.toLowerCase());
  if (Array.isArray(hay)) return hay.some((h) => deepEqual(h, needle));
  return false;
}

export type AssertionResult = { assertion: Assertion; pass: boolean; actual?: unknown; message?: string };

export function checkAssertion(output: unknown, a: Assertion): AssertionResult {
  if (a.op === "forbiddenText") {
    const text = JSON.stringify(output ?? null).toLowerCase();
    const hit = a.values.find((v) => text.includes(v.toLowerCase()));
    return { assertion: a, pass: !hit, ...(hit ? { message: `output contains "${hit}"` } : {}) };
  }
  const actual = getPath(output, a.path);
  const res = (pass: boolean, message?: string): AssertionResult => ({ assertion: a, pass, actual, ...(pass || !message ? {} : { message }) });
  switch (a.op) {
    case "equals":
      return res(deepEqual(actual, a.value), `expected ${JSON.stringify(a.value)}`);
    case "approx": {
      if (typeof actual !== "number" || !Number.isFinite(actual)) return res(false, `expected a number near ${a.value}`);
      const allowed = a.absolute ?? Math.abs(a.value) * a.tolerance;
      return res(Math.abs(actual - a.value) <= allowed + 1e-9, `expected ${a.value} ± ${allowed}`);
    }
    case "oneOf":
      return res(a.values.some((v) => deepEqual(actual, v)), `expected one of ${JSON.stringify(a.values)}`);
    case "contains":
      return res(a.values.every((v) => containsValue(actual, v)), `expected to contain ${JSON.stringify(a.values)}`);
    case "notContains":
      return res(!a.values.some((v) => containsValue(actual, v)), `expected not to contain ${JSON.stringify(a.values)}`);
    case "exists":
      return res(actual !== undefined && actual !== null, "expected a value");
    case "absent":
      return res(actual === undefined || actual === null || (Array.isArray(actual) && actual.length === 0), "expected no value");
    case "gte":
      return res(typeof actual === "number" && actual >= a.value, `expected ≥ ${a.value}`);
    case "lte":
      return res(typeof actual === "number" && actual <= a.value, `expected ≤ ${a.value}`);
    case "matches":
      return res(typeof actual === "string" && new RegExp(a.pattern).test(actual), `expected to match /${a.pattern}/`);
  }
}

export type CaseResult = {
  id: string;
  pass: boolean;
  /** Share of assertions that passed. */
  score: number;
  criticalFailure: boolean;
  failures: { path?: string; op: string; message?: string; actual?: unknown }[];
  error?: string;
  ms: number;
};

export type SuiteResult = {
  suite: string;
  agent: string;
  subject: string;
  status: "pass" | "fail" | "skipped";
  skipReason?: "no_subject" | "model_subject_offline";
  passRate: number;
  minPassRate: number;
  criticalFailures: number;
  cases: CaseResult[];
};

export function gradeCase(c: EvalCase, output: unknown, ms = 0): CaseResult {
  const results = c.assert.map((a) => checkAssertion(output, a));
  const failed = results.filter((r) => !r.pass);
  return {
    id: c.id,
    pass: failed.length === 0,
    score: (results.length - failed.length) / results.length,
    criticalFailure: failed.some((r) => r.assertion.critical),
    failures: failed.map((r) => ({ ...("path" in r.assertion ? { path: r.assertion.path } : {}), op: r.assertion.op, ...(r.message ? { message: r.message } : {}), actual: r.actual })),
    ms,
  };
}

export type RunOptions = {
  /** Run model-backed subjects (costs money; needs keys). */
  live?: boolean;
  only?: readonly string[];
  concurrency?: number;
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function runSuite(suite: EvalSuite, subjects: Readonly<Record<string, EvalSubject>>, opts: RunOptions = {}): Promise<SuiteResult> {
  const name = subjects[suite.subject] ? suite.subject : suite.fallbackSubject && subjects[suite.fallbackSubject] ? suite.fallbackSubject : suite.subject;
  const subject = subjects[name];
  const base = { suite: suite.suite, agent: suite.agent, subject: name, minPassRate: suite.minPassRate };
  if (!subject) return { ...base, status: "skipped", skipReason: "no_subject", passRate: 0, criticalFailures: 0, cases: [] };
  if (subject.kind === "model" && !opts.live) return { ...base, status: "skipped", skipReason: "model_subject_offline", passRate: 0, criticalFailures: 0, cases: [] };
  const cases = opts.only?.length ? suite.cases.filter((c) => opts.only!.includes(c.id) || opts.only!.includes(suite.suite)) : suite.cases;
  const results = await mapLimit(cases, opts.concurrency ?? (subject.kind === "model" ? 4 : 8), async (c) => {
    const started = performance.now();
    try {
      const output = await subject.run(c.input, { suite, caseId: c.id });
      return gradeCase(c, output, Math.round(performance.now() - started));
    } catch (err) {
      return { id: c.id, pass: false, score: 0, criticalFailure: c.assert.some((a) => a.critical), failures: [], error: (err as Error).message?.slice(0, 300) ?? String(err), ms: Math.round(performance.now() - started) };
    }
  });
  const passRate = results.length ? results.filter((r) => r.pass).length / results.length : 0;
  const criticalFailures = results.filter((r) => r.criticalFailure).length;
  return { ...base, status: criticalFailures === 0 && passRate >= suite.minPassRate ? "pass" : "fail", passRate, criticalFailures, cases: results };
}

export async function runSuites(suites: readonly EvalSuite[], subjects: Readonly<Record<string, EvalSubject>>, opts: RunOptions = {}): Promise<SuiteResult[]> {
  const out: SuiteResult[] = [];
  for (const s of suites) {
    if (opts.only?.length && !opts.only.includes(s.suite) && !s.cases.some((c) => opts.only!.includes(c.id))) continue;
    out.push(await runSuite(s, subjects, opts));
  }
  return out;
}

// --- Subject discovery ------------------------------------------------------------------------------

/** `lib/agents/<agent>/eval-subjects.ts` files (other than core), in name order. */
export function discoverSubjectModules(repoRoot: string): string[] {
  const dir = path.join(repoRoot, "lib", "agents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => d !== "core" && statSync(path.join(dir, d)).isDirectory())
    .sort()
    .map((d) => path.join(dir, d, "eval-subjects.ts"))
    .filter((f) => existsSync(f));
}

/** Imports discovered modules and merges their `subjects` exports (later names do not override earlier ones). */
export async function loadDiscoveredSubjects(repoRoot: string, into: Record<string, EvalSubject>): Promise<{ loaded: string[]; errors: string[] }> {
  const loaded: string[] = [];
  const errors: string[] = [];
  for (const file of discoverSubjectModules(repoRoot)) {
    try {
      const mod = (await import(pathToFileURL(file).href)) as { subjects?: Record<string, EvalSubject> };
      for (const [name, s] of Object.entries(mod.subjects ?? {})) {
        if (into[name]) errors.push(`${path.relative(repoRoot, file)}: subject ${name} already registered`);
        else if (!s || typeof s.run !== "function" || (s.kind !== "deterministic" && s.kind !== "model")) errors.push(`${path.relative(repoRoot, file)}: subject ${name} is malformed`);
        else into[name] = s;
      }
      loaded.push(path.relative(repoRoot, file));
    } catch (err) {
      errors.push(`${path.relative(repoRoot, file)}: ${(err as Error).message}`);
    }
  }
  return { loaded, errors };
}

/** Plain-text report. */
export function formatReport(results: readonly SuiteResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const head =
      r.status === "skipped"
        ? `SKIP  ${r.suite} (${r.subject}: ${r.skipReason === "no_subject" ? "subject not registered" : "model subject, run with --live"})`
        : `${r.status === "pass" ? "PASS" : "FAIL"}  ${r.suite}  ${(r.passRate * 100).toFixed(0)}% (bar ${(r.minPassRate * 100).toFixed(0)}%)${r.criticalFailures ? `  ${r.criticalFailures} critical` : ""}`;
    lines.push(head);
    for (const c of r.cases.filter((x) => !x.pass)) {
      lines.push(`      ✗ ${c.id}${c.error ? `: ${c.error}` : ""}`);
      for (const f of c.failures.slice(0, 5)) lines.push(`          ${f.op} ${f.path ?? ""} ${f.message ?? ""} (got ${JSON.stringify(f.actual)?.slice(0, 120)})`);
    }
  }
  return lines.join("\n");
}
