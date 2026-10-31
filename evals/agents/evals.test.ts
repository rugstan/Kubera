// Validates every suite in evals/agents and runs the deterministic ones, so
// `npm test` fails when a golden set, the injection red-team suite or an
// agent's safety contract regresses. Model-backed suites run with
// `npm run evals:agents -- --live`.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssertion, discoverSubjectModules, getPath, gradeCase, loadEvalSuites, runSuite, runSuites, type EvalSubject, type EvalSuite } from "@/lib/agents/core/evals";
import { BUILTIN_SUBJECTS } from "./subjects";

const DIR = import.meta.dirname;
const ROOT = path.resolve(DIR, "..", "..");
const { suites, errors } = loadEvalSuites(DIR);
const bySuite = new Map(suites.map((s) => [s.suite.suite, s.suite]));

describe("agent eval suites", () => {
  it("are valid, uniquely named and reference known or discoverable subjects", () => {
    expect(errors).toEqual([]);
    expect(suites.length).toBeGreaterThanOrEqual(15);
    const builtin = new Set(Object.keys(BUILTIN_SUBJECTS));
    for (const { suite } of suites) {
      const owned = suite.subject.startsWith("documents.") || builtin.has(suite.subject);
      expect(owned, `${suite.suite} → ${suite.subject}`).toBe(true);
    }
  });

  it("cover every document type with a golden set", () => {
    const docTypes = suites.map((s) => s.suite.docType).filter(Boolean).sort();
    expect(docTypes).toEqual(["CENSUS", "CONSTRUCTION_BUDGET", "PFS", "RENT_ROLL", "STR_REPORT", "T12", "TERM_SHEET"]);
    for (const { suite } of suites.filter((s) => s.suite.docType)) {
      expect(suite.outputSchema, suite.suite).toBeDefined();
      expect(suite.fallbackSubject).toBe("documents.reference");
      // Every expected field is a property of the output schema.
      const props = Object.keys((suite.outputSchema as { properties: Record<string, unknown> }).properties);
      for (const c of suite.cases) for (const a of c.assert) if ("path" in a) expect(props, `${c.id}: ${a.path}`).toContain(a.path.split(".")[0]);
      // At least one case per document type carries an injection.
      expect(suite.cases.some((c) => c.tags.includes("injection")) || suite.docType === "CENSUS" || suite.docType === "STR_REPORT" || suite.docType === "CONSTRUCTION_BUDGET").toBe(true);
    }
  });

  it("has a red-team suite with at least 30 attacks and 10 benign controls", () => {
    const rt = bySuite.get("injection.redteam")!;
    expect(rt.cases.filter((c) => c.tags.includes("attack")).length).toBeGreaterThanOrEqual(30);
    expect(rt.cases.filter((c) => c.tags.includes("benign")).length).toBeGreaterThanOrEqual(10);
  });
});

describe("deterministic suites pass", () => {
  const deterministic = suites.filter((s) => BUILTIN_SUBJECTS[s.suite.subject]?.kind === "deterministic");
  it.each(deterministic.map((s) => [s.suite.suite, s.suite] as const))("%s", async (_name, suite) => {
    const r = await runSuite(suite, BUILTIN_SUBJECTS);
    const failing = r.cases.filter((c) => !c.pass).map((c) => ({ id: c.id, error: c.error, failures: c.failures }));
    expect(failing).toEqual([]);
    expect(r.status).toBe("pass");
  });

  it("skips model suites offline and document suites without an extractor", async () => {
    const results = await runSuites([bySuite.get("mail.triage.model")!, bySuite.get("documents.t12")!], BUILTIN_SUBJECTS);
    expect(results.map((r) => [r.status, r.skipReason, r.subject])).toEqual([
      ["skipped", "model_subject_offline", "mail.triage.model"],
      ["skipped", "model_subject_offline", "documents.reference"],
    ]);
  });
});

describe("document golden sets score extractors", () => {
  const t12 = bySuite.get("documents.t12")!;
  const expected = (suite: EvalSuite, id: string) => {
    const c = suite.cases.find((x) => x.id === id)!;
    const out: Record<string, unknown> = {};
    for (const a of c.assert) {
      if (a.op === "equals" || a.op === "approx") out[a.path] = a.value;
    }
    return out;
  };

  it("passes an extractor that returns the golden values and fails one that follows the injection", async () => {
    const good: EvalSubject = { kind: "deterministic", description: "oracle", run: async (_i, { caseId }) => expected(t12, caseId) };
    expect((await runSuite(t12, { "documents.extract": good })).status).toBe("pass");

    const fooled: EvalSubject = {
      kind: "deterministic",
      description: "follows injected text",
      run: async (_i, { caseId }) => ({ ...expected(t12, caseId), ...(caseId.includes("injected") ? { netOperatingIncome: 5_000_000, injection_suspected: false } : {}) }),
    };
    const r = await runSuite(t12, { "documents.extract": fooled });
    expect(r.status).toBe("fail");
    expect(r.criticalFailures).toBe(1);
  });

  it("an extractor that is off by more than the tolerance fails", async () => {
    const sloppy: EvalSubject = { kind: "deterministic", description: "2% off", run: async (_i, { caseId }) => ({ ...expected(t12, caseId), effectiveGrossIncome: (expected(t12, caseId).effectiveGrossIncome as number) * 1.02 }) };
    expect((await runSuite(t12, { "documents.extract": sloppy })).passRate).toBe(0);
  });
});

describe("scoring primitives", () => {
  it("reads dotted paths and array lengths", () => {
    expect(getPath({ a: { b: [1, { c: 2 }] } }, "a.b.1.c")).toBe(2);
    expect(getPath({ a: [1, 2, 3] }, "a.length")).toBe(3);
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(getPath({}, "constructor")).toBeUndefined();
  });

  it("checks every assertion type", () => {
    const out = { n: 100, s: "Yield maintenance", arr: ["a", "b"], z: null };
    const ok = (a: Parameters<typeof checkAssertion>[1]) => checkAssertion(out, a).pass;
    expect(ok({ op: "approx", path: "n", value: 100.4, tolerance: 0.005 })).toBe(true);
    expect(ok({ op: "approx", path: "n", value: 102, tolerance: 0.005 })).toBe(false);
    expect(ok({ op: "approx", path: "n", value: 101, tolerance: 0, absolute: 1 })).toBe(true);
    expect(ok({ op: "oneOf", path: "n", values: [1, 100] })).toBe(true);
    expect(ok({ op: "contains", path: "arr", values: ["a"] })).toBe(true);
    expect(ok({ op: "contains", path: "s", values: ["yield"] })).toBe(true);
    expect(ok({ op: "notContains", path: "arr", values: ["c"] })).toBe(true);
    expect(ok({ op: "absent", path: "z" })).toBe(true);
    expect(ok({ op: "exists", path: "z" })).toBe(false);
    expect(ok({ op: "gte", path: "n", value: 100 })).toBe(true);
    expect(ok({ op: "lte", path: "n", value: 99 })).toBe(false);
    expect(ok({ op: "matches", path: "s", pattern: "^Yield" })).toBe(true);
    expect(ok({ op: "forbiddenText", values: ["guaranteed"] })).toBe(true);
    expect(ok({ op: "forbiddenText", values: ["MAINTENANCE"] })).toBe(false);
  });

  it("marks critical failures and thrown subjects", () => {
    const c = { id: "x1", description: "x", input: null, tags: [], assert: [{ op: "equals" as const, path: "a", value: 1, critical: true }] };
    expect(gradeCase(c, { a: 2 })).toMatchObject({ pass: false, criticalFailure: true });
  });

  it("discovers agent subject modules by convention", () => {
    // Only lib/agents/<agent>/eval-subjects.ts outside core; none required to exist yet.
    for (const f of discoverSubjectModules(ROOT)) expect(f).toMatch(/lib\/agents\/(?!core\/)[^/]+\/eval-subjects\.ts$/);
  });
});
