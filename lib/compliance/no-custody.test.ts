import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_CUSTODY_SQL_REGEX, FORBIDDEN_CUSTODY_TOKENS, forbiddenTokenIn, scanSql, scanTs } from "./no-custody";
import { scanRepository } from "./no-custody-scan";

const root = path.resolve(import.meta.dirname, "..", "..");

describe("no-custody guard: repository scan", () => {
  it("finds no funds or draw fields in any migration, API route or validation schema", () => {
    const { files, violations } = scanRepository(root);
    expect(files.some((f) => f.startsWith("supabase/migrations/"))).toBe(true);
    expect(files.some((f) => f.startsWith("app/api/"))).toBe(true);
    expect(files).toContain("lib/validation.ts");
    expect(violations).toEqual([]);
  });

  it("keeps the database-side regex in the WS-W migration in sync with the token list", () => {
    const sql = readFileSync(path.join(root, "supabase/migrations/20261101000700_w_disclosures.sql"), "utf8");
    expect(sql).toContain(`'${FORBIDDEN_CUSTODY_SQL_REGEX}'`);
  });
});

describe("no-custody guard: detection", () => {
  it.each(["disbursement", "disbursed_at", "escrow_balance", "trust_account", "draw_amount", "draw_request_id", "lien_waiver_url", "funds_held_usd", "custodial_account"])(
    "flags SQL column %s",
    (column) => {
      const v = scanSql("x.sql", `create table public.t (\n  id uuid primary key,\n  ${column} numeric\n);`);
      expect(v).toEqual([expect.objectContaining({ line: 3, identifier: column })]);
    },
  );

  it("flags columns added later with ALTER TABLE", () => {
    expect(scanSql("x.sql", "alter table public.deals add column trust_account_number text;")).toHaveLength(1);
  });

  it.each(["escrowBalance", "drawAmount", "TrustAccount", "disburseFunds", "lienWaivers"])("flags TypeScript identifier %s", (id) => {
    expect(scanTs("route.ts", `const schema = z.object({ ${id}: z.number() });`)).toHaveLength(1);
  });

  it("ignores comments and string literals (copy may say Corin never disburses funds)", () => {
    expect(scanSql("x.sql", "-- Corin never disburses funds\ncomment on table public.t is 'no escrow_balance here';\n/* draw_amount */")).toEqual([]);
    expect(scanTs("x.ts", `// no draw_amount\nconst copy = "Corin never disburses funds";\nconst t = \`trust_account\`;\n/* escrowBalance */`)).toEqual([]);
  });

  it("does not flag ordinary fields", () => {
    for (const ok of ["loan_amount", "broker_compensation_usd", "escrow_agent", "draw_down_notes_removed", "trustee_name", "account_owner"]) {
      expect(forbiddenTokenIn(ok)).toBeUndefined();
    }
  });

  it("covers the four columns named in the build plan", () => {
    for (const name of ["disbursement", "escrow_balance", "trust_account", "draw_amount"]) expect(forbiddenTokenIn(name)).toBeDefined();
    expect(FORBIDDEN_CUSTODY_TOKENS.length).toBeGreaterThanOrEqual(4);
  });
});
