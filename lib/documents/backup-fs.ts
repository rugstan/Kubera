// Directory-backed archive for lib/documents/backup.ts (local disk or a mounted volume).

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BackupSink } from "./backup";

/** Archive on a local (or mounted) directory. */
export class DirectoryBackupSink implements BackupSink {
  constructor(private readonly root: string) {}

  private resolve(name: string): string {
    const full = path.resolve(this.root, name);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`refusing path outside the archive: ${name}`);
    return full;
  }

  async has(name: string) {
    try {
      await stat(this.resolve(name));
      return true;
    } catch {
      return false;
    }
  }

  async put(name: string, bytes: Uint8Array) {
    const full = this.resolve(name);
    await mkdir(path.dirname(full), { recursive: true });
    // Write-then-rename keeps a crashed run from leaving a half-written blob that looks archived.
    await writeFile(`${full}.tmp`, bytes, { mode: 0o600 });
    await rename(`${full}.tmp`, full);
  }

  async get(name: string) {
    try {
      return new Uint8Array(await readFile(this.resolve(name)));
    } catch {
      return null;
    }
  }
}
