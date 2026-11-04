// Golden fixtures per document type through the deterministic path (parse ->
// rules -> cross-checks -> assessment). Every case must reproduce its expected
// values exactly and land in the expected queue state.

import { describe, expect, it } from "vitest";
import { parseDocument } from "@/lib/agents/documents/parse";
import { extractWithRules } from "@/lib/agents/documents/rules";
import { DOC_TYPES } from "@/lib/agents/documents/types";
import { assessExtraction, validateExtraction } from "@/lib/agents/documents/validate";
import { loadDocumentEvals, sourceBytes } from "./load";
import { scoreCase } from "./score";

const { suites, errors } = loadDocumentEvals();

describe("document eval files", () => {
  it("load and validate", () => {
    expect(errors).toEqual([]);
  });

  it("cover every document type with at least three cases in three formats", () => {
    const types = suites.map((s) => s.suite.docType).sort();
    expect(types).toEqual([...DOC_TYPES].sort());
    for (const { suite } of suites) {
      expect(suite.cases.length).toBeGreaterThanOrEqual(3);
      expect(new Set(suite.cases.map((c) => c.source.format)).size).toBeGreaterThanOrEqual(3);
    }
  });
});

for (const { suite } of suites) {
  describe(`golden ${suite.docType}`, () => {
    for (const c of suite.cases) {
      it(c.id, () => {
        const src = sourceBytes(c);
        const parsed = parseDocument(src.bytes, src.contentType);
        expect(parsed.format).toBe(c.source.format);
        const result = validateExtraction(extractWithRules(suite.docType, parsed.tables));
        const score = scoreCase(c, result, assessExtraction(result));
        expect(score.failures).toEqual([]);
      });
    }
  });
}
