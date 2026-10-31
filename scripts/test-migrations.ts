// Applies every file in supabase/migrations/ to an in-process Postgres (PGlite)
// with stubs for the Supabase-managed `auth`, `storage` and `extensions`
// schemas, then checks repo-wide invariants (Global rule 8).
//
//   npm run test:migrations
//
// The same functions back scripts/test-migrations.test.ts so `npm test` also
// proves the migrations apply. Self-contained on purpose: it runs under plain
// `node --experimental-strip-types`, so no path aliases.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

/** `<14-digit timestamp>_<snake_case_name>.sql`; Phase 0 slots are `2026110100MM00`. */
const FILENAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/**
 * Stand-ins for what Supabase provisions before any user migration runs:
 * API roles, the `extensions` schema, `auth.users` + JWT helpers, and
 * `storage.buckets` / `storage.objects`.
 */
export const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema extensions;
  create schema auth;
  create schema storage;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    phone text,
    raw_user_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now()
  );

  -- Mirrors Supabase: claims arrive through the request.jwt.claims GUC.
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(auth.jwt() ->> 'role', 'anon')
  $$;

  create table storage.buckets (
    id text primary key,
    name text not null unique,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner uuid,
    created_at timestamptz not null default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    metadata jsonb,
    created_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;

  grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
`;

export type MigrationFile = { name: string; timestamp: string; sql: string };

export type MigrationReport = {
  applied: string[];
  publicTables: string[];
  tablesWithoutRls: string[];
  problems: string[];
};

export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      const m = FILENAME.exec(name);
      return { name, timestamp: m?.[1] ?? "", sql: readFileSync(path.join(dir, name), "utf8") };
    });
}

/** Filename convention and ordering rules; returns human-readable problems. */
export function lintMigrationNames(files: Pick<MigrationFile, "name" | "timestamp">[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!FILENAME.test(f.name)) problems.push(`${f.name}: must match <14-digit timestamp>_<snake_case>.sql`);
    else if (seen.has(f.timestamp)) problems.push(`${f.name}: duplicate timestamp ${f.timestamp}`);
    seen.add(f.timestamp);
  }
  return problems;
}

export async function createStubbedDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(SUPABASE_STUBS);
  // Supabase default search_path, so unqualified `vector` etc. resolve as in production.
  await db.exec(`set search_path to "$user", public, extensions`);
  return db;
}

export async function applyMigrations(db: PGlite, files: MigrationFile[]): Promise<string[]> {
  const applied: string[] = [];
  for (const f of files) {
    try {
      await db.exec(f.sql);
    } catch (err) {
      throw new Error(`Migration ${f.name} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    applied.push(f.name);
  }
  return applied;
}

/** Global rule 8: every table in `public` has row level security enabled. */
export async function publicTableRls(db: PGlite): Promise<{ table: string; rls: boolean }[]> {
  const res = await db.query<{ table: string; rls: boolean }>(`
    select c.relname as "table", c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `);
  return res.rows;
}

/**
 * Global rule 1: no funds or draw columns anywhere in `public`. Uses the
 * custody guard function from the disclosures migration when it exists.
 */
export async function custodyViolations(db: PGlite): Promise<{ table_name: string; column_name: string }[]> {
  const exists = await db.query<{ ok: boolean }>(`select to_regprocedure('public.custody_column_violations()') is not null as ok`);
  if (!exists.rows[0]?.ok) return [];
  const res = await db.query<{ table_name: string; column_name: string }>(`select * from public.custody_column_violations()`);
  return res.rows;
}

export async function runMigrationTests(dir: string = MIGRATIONS_DIR): Promise<MigrationReport> {
  const files = listMigrations(dir);
  const problems = lintMigrationNames(files);
  if (files.length === 0) problems.push(`no migrations found in ${dir}`);

  const db = await createStubbedDb();
  try {
    const applied = await applyMigrations(db, files);
    const tables = await publicTableRls(db);
    const tablesWithoutRls = tables.filter((t) => !t.rls).map((t) => t.table);
    for (const t of tablesWithoutRls) problems.push(`public.${t}: row level security is not enabled`);
    for (const v of await custodyViolations(db)) problems.push(`public.${v.table_name}.${v.column_name}: funds/draw column (no-custody guard)`);
    return { applied, publicTables: tables.map((t) => t.table), tablesWithoutRls, problems };
  } finally {
    await db.close();
  }
}

async function main(): Promise<void> {
  const report = await runMigrationTests();
  console.log(`Applied ${report.applied.length} migration(s) to PGlite:`);
  for (const name of report.applied) console.log(`  ok  ${name}`);
  console.log(`public tables (${report.publicTables.length}): ${report.publicTables.join(", ")}`);
  if (report.problems.length > 0) {
    console.error("\nProblems:");
    for (const p of report.problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log("All migrations apply cleanly and every public table has RLS enabled.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
