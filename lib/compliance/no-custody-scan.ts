// Repository scan for the no-custody guard (Global rule 1): reads migrations,
// API routes and the shared validation schemas from disk. Tests and scripts
// only; runtime code imports the pure checks from ./no-custody.ts.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { scanSql, scanTs, type CustodyViolation } from "./no-custody";

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
