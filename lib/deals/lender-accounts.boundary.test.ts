// Source boundary for sealed lender account numbers: only the files that seal,
// store, open or classify them may mention the ciphertext or the reveal-only
// accessors, so no CRM, AI, PDF, export, page or client path can touch them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SECRET = /numberEnc|number_enc|getLenderAccountSecret|openLenderAccountNumber/;
const ALLOWED = new Set([
  "lib/deals/lender-accounts.ts",
  "lib/deals/lender-directory.ts",
  "lib/deals/store.ts",
  "lib/deals/store-supabase.ts",
  "lib/deals/types.ts",
  "lib/deals/demo.ts",
  "lib/privacy/classification.ts",
]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

const files = ["lib", "app", "components"].flatMap((d) => sources(path.join(ROOT, d)));

describe("lender account ciphertext boundary", () => {
  it("scans the app, lib and components sources", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("lib/deals/lender-accounts.ts");
    expect(files).toContain("app/(staff)/deals/lenders/[id]/page.tsx");
  });

  it("mentions the sealed number and its accessors only in the allowlisted files", () => {
    const offenders = files.filter((f) => !ALLOWED.has(f) && SECRET.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
    for (const f of ALLOWED) expect(files, f).toContain(f);
  });

  it("keeps lender contacts and accounts out of the CRM and AI code", () => {
    const touched = files.filter((f) => (f.startsWith("lib/crm/") || f.startsWith("lib/ai/")) && /lender_contacts|lender_accounts/.test(readFileSync(path.join(ROOT, f), "utf8")));
    expect(touched).toEqual([]);
  });
});
