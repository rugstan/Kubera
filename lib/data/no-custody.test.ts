import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanTs } from "@/lib/compliance/no-custody";

// WS-Z owns lib/data and lib/rules, which the repository-wide custody scan does
// not cover. Corin holds no funds and has no draw role (Global rule 1).

const root = path.resolve(import.meta.dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("no-custody guard over WS-Z code", () => {
  it("has no funds or draw identifiers in lib/data or lib/rules", () => {
    const files = [...walk(path.join(root, "lib", "data")), ...walk(path.join(root, "lib", "rules"))];
    expect(files.length).toBeGreaterThan(10);
    const violations = files.flatMap((f) => scanTs(path.relative(root, f), readFileSync(f, "utf8")));
    expect(violations).toEqual([]);
  });
});
