// No-custody guard (Global rule 1). Kubera brokers loans; it never accepts,
// holds, transfers or disburses money and has no role in construction draws.
// This module finds identifiers that would model funds custody or draw
// servicing in SQL migrations and API/validation code. The same token list
// backs the database-side check in the WS-W migration
// (`public.custody_column_violations()`), so keep them in sync.
//
// Pure functions only: runtime code (the agent tool runner) imports this, so
// the filesystem scan lives in ./no-custody-scan.ts (tests and scripts).

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
