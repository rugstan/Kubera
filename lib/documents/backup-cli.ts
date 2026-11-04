// Command line for the vault's file backups. Run with the server-only shim:
//
//   npm run vault -- backup  --dest ./vault-backup/2026-11-03
//   npm run vault -- verify  [--deep]
//   npm run vault -- restore --src ./vault-backup/2026-11-03 [--dry-run] [--overwrite]
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and VAULT_BACKUP_KEY. See
// docs/runbooks/document-vault-backup-restore.md before running a restore.

import { backupVault, parseBackupKey, restoreVault, verifyVault } from "./backup";
import { DirectoryBackupSink } from "./backup-fs";
import { documentServices } from "./server";

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const deps = documentServices();
  if (!deps) throw new Error("Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");

  if (command === "verify") {
    const report = await verifyVault({ store: deps.store, storage: deps.storage, deep: rest.includes("--deep") });
    console.log(JSON.stringify(report, null, 2));
    if (report.missing.length || report.sizeMismatch.length || report.hashMismatch.length) process.exitCode = 1;
    return;
  }
  if (command === "backup" || command === "restore") {
    const dir = arg(rest, command === "backup" ? "--dest" : "--src");
    if (!dir) throw new Error(`usage: vault ${command} ${command === "backup" ? "--dest" : "--src"} <directory>`);
    const key = parseBackupKey(process.env.VAULT_BACKUP_KEY);
    const sink = new DirectoryBackupSink(dir);
    if (command === "backup") {
      const report = await backupVault({ ...deps, sink, key });
      console.log(JSON.stringify(report, null, 2));
      if (report.missing.length || report.corrupt.length) process.exitCode = 1;
    } else {
      const report = await restoreVault({ ...deps, sink, key, dryRun: rest.includes("--dry-run"), overwrite: rest.includes("--overwrite") });
      console.log(JSON.stringify(report, null, 2));
      if (report.failed.length || report.conflicts.length) process.exitCode = 1;
    }
    return;
  }
  throw new Error("usage: vault <backup --dest DIR | restore --src DIR [--dry-run] [--overwrite] | verify [--deep]>");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
