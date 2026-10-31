// No-custody guard (Global rule 1). Kubera brokers loans; it never accepts,
// holds, transfers or disburses money and has no role in construction draws.
// This module finds identifiers that would model funds custody or draw
// servicing in SQL migrations and API/validation code. The same token list
// backs the database-side check in the WS-W migration
// (`public.custody_column_violations()`), so keep them in sync.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Forbidden identifier fragments, compared after lower-casing and removing
 * underscores (so `escrow_balance`, `escrowBalance` and `EscrowBalance` all match).
 */
export const FORBIDDEN_CUSTODY_TOKENS = [
  "disburse",
  "escrowbalance",
  "trustaccount",
  "drawamount",
  "drawrequest",
  "drawschedule",
  "lienwaiver",
  "fundsheld",
  "custodialaccount",
] as const;

/** SQL regex equivalent used by the migration (keep in sync with the list above). */
export const FORBIDDEN_CUSTODY_SQL_REGEX = `(${FORBIDDEN_CUSTODY_TOKENS.join("|")})`;

export type CustodyViolation = { file: string; line: number; identifier: string; token: string };

const normalize = (identifier: string) => identifier.toLowerCase().replace(/_/g, "");

export function forbiddenTokenIn(identifier: string): string | undefined {
  const n = normalize(identifier);
  return FORBIDDEN_CUSTODY_TOKENS.find((t) => n.includes(t));
}

/** Replace comments and string-literal contents with spaces, preserving line breaks. */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => m.replace(/[^\n]/g, " "));
}

export function stripSql(sql: string): string {
  // Removes comments and single-quoted literals ('' escapes). Dollar-quoted
  // function bodies are kept because they contain real identifiers.
  let out = blank(sql, /\/\*[\s\S]*?\*\//g);
  out = blank(out, /--[^\n]*/g);
  out = blank(out, /'(?:[^']|'')*'/g);
  return out;
}

export function stripTs(code: string): string {
  let out = blank(code, /\/\*[\s\S]*?\*\//g);
  out = blank(out, /(^|[^:\\])\/\/[^\n]*/g);
  out = blank(out, /`(?:[^`\\]|\\.)*`/g);
  out = blank(out, /"(?:[^"\\\n]|\\.)*"/g);
  out = blank(out, /'(?:[^'\\\n]|\\.)*'/g);
  return out;
}

function scanIdentifiers(file: string, stripped: string): CustodyViolation[] {
  const out: CustodyViolation[] = [];
  stripped.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const token = forbiddenTokenIn(m[0]);
      if (token) out.push({ file, line: i + 1, identifier: m[0], token });
    }
  });
  return out;
}

export function scanSql(file: string, sql: string): CustodyViolation[] {
  return scanIdentifiers(file, stripSql(sql));
}

export function scanTs(file: string, code: string): CustodyViolation[] {
  return scanIdentifiers(file, stripTs(code));
}

function walk(dir: string, accept: (file: string) => boolean): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, accept);
    return accept(full) ? [full] : [];
  });
}

/**
 * Scan every migration, API route and the shared validation schemas under
 * `root` for custody/draw identifiers.
 */
export function scanRepository(root: string): { files: string[]; violations: CustodyViolation[] } {
  const migrations = walk(path.join(root, "supabase", "migrations"), (f) => f.endsWith(".sql"));
  const api = walk(path.join(root, "app", "api"), (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const validation = [path.join(root, "lib", "validation.ts")].filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });
  const violations = [
    ...migrations.flatMap((f) => scanSql(path.relative(root, f), readFileSync(f, "utf8"))),
    ...[...api, ...validation].flatMap((f) => scanTs(path.relative(root, f), readFileSync(f, "utf8"))),
  ];
  return { files: [...migrations, ...api, ...validation].map((f) => path.relative(root, f)), violations };
}
