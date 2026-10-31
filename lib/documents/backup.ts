// Backup, restore and verification of the vault's FILES.
//
// Supabase backs up Postgres (daily backups / PITR) but not Storage objects, so a
// restored database would point at files that are gone. This module copies every
// `clean` document into an encrypted archive and can put them back. The archive
// is encrypted (AES-256-GCM, key VAULT_BACKUP_KEY) because it holds borrower
// financials; each blob is bound to its archive name so blobs cannot be swapped.
//
// Layout of an archive:
//   manifest.enc            encrypted JSON: entries {id, lead_id, storage_path, size, sha256, ...}
//   objects/<document id>.enc
//
// Restore never resurrects data: it only writes objects for documents whose ROW
// exists in the (restored) database with status `clean` and the same path. A
// document deleted since the backup (retention, a deletion request) therefore
// stays deleted. Rows are not recreated here; they come from the database restore.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { VaultStorage } from "./storage";
import type { DocumentStore } from "./store";
import { VAULT_BUCKET, type Clock, type DocumentRow, systemClock } from "./types";

const MAGIC = Buffer.from("KVB1");
const MANIFEST = "manifest.enc";
const objectName = (id: string) => `objects/${id}.enc`;

export interface BackupSink {
  has(name: string): Promise<boolean>;
  put(name: string, bytes: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array | null>;
}

export class MemoryBackupSink implements BackupSink {
  readonly files = new Map<string, Uint8Array>();
  async has(name: string) {
    return this.files.has(name);
  }
  async put(name: string, bytes: Uint8Array) {
    this.files.set(name, bytes.slice());
  }
  async get(name: string) {
    return this.files.get(name)?.slice() ?? null;
  }
}

// --- Crypto -------------------------------------------------------------------------

export function parseBackupKey(value: string | undefined): Buffer {
  const key = Buffer.from((value ?? "").trim(), "base64");
  if (key.length !== 32) throw new Error("VAULT_BACKUP_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32)");
  return key;
}

export function encryptBlob(key: Buffer, name: string, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptBlob(key: Buffer, name: string, blob: Uint8Array): Uint8Array {
  const buf = Buffer.from(blob);
  if (buf.length < MAGIC.length + 12 + 16 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${name}: not a vault backup blob`);
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(buf.length - 16);
  const body = buf.subarray(MAGIC.length + 12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(name));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new Error(`${name}: decryption failed (wrong key or tampered archive)`);
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// --- Manifest -----------------------------------------------------------------------

export type ManifestEntry = {
  id: string;
  lead_id: string;
  kind: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size: number;
  sha256: string;
};

export type Manifest = { version: 1; createdAt: string; bucket: string; entries: ManifestEntry[] };

async function readManifest(sink: BackupSink, key: Buffer): Promise<Manifest> {
  const blob = await sink.get(MANIFEST);
  if (!blob) throw new Error("archive has no manifest");
  const manifest = JSON.parse(new TextDecoder().decode(decryptBlob(key, MANIFEST, blob))) as Manifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error("unsupported manifest version");
  return manifest;
}

// --- Backup -------------------------------------------------------------------------

export type BackupReport = {
  documents: number;
  copied: number;
  alreadyArchived: number;
  /** Rows whose file is missing from storage (data loss to investigate). */
  missing: string[];
  /** Rows whose stored bytes no longer match the recorded SHA-256. */
  corrupt: string[];
};

export async function backupVault(args: {
  store: DocumentStore;
  storage: VaultStorage;
  sink: BackupSink;
  key: Buffer;
  clock?: Clock;
  maxFileBytes?: number;
}): Promise<BackupReport> {
  const { store, storage, sink, key } = args;
  const maxBytes = args.maxFileBytes ?? 50 * 1024 * 1024;
  const report: BackupReport = { documents: 0, copied: 0, alreadyArchived: 0, missing: [], corrupt: [] };
  const entries: ManifestEntry[] = [];

  let after: string | undefined;
  for (;;) {
    const page = await store.listClean(100, after);
    if (page.length === 0) break;
    after = page[page.length - 1]!.id;
    for (const row of page) {
      report.documents++;
      const name = objectName(row.id);
      const known = row.sha256 && row.size_bytes != null ? { sha: row.sha256, size: Number(row.size_bytes) } : null;
      if (known && (await sink.has(name))) {
        // Objects are immutable once clean (sha256 pinned), so an archived blob is still right.
        entries.push(entryFor(row, known.size, known.sha));
        report.alreadyArchived++;
        continue;
      }
      const bytes = await storage.read(VAULT_BUCKET, row.storage_path, maxBytes);
      if (!bytes) {
        report.missing.push(row.id);
        continue;
      }
      const digest = sha256(bytes);
      if (row.sha256 && digest !== row.sha256) {
        report.corrupt.push(row.id);
        continue;
      }
      await sink.put(name, encryptBlob(key, name, bytes));
      entries.push(entryFor(row, bytes.byteLength, digest));
      report.copied++;
    }
  }

  const manifest: Manifest = { version: 1, createdAt: (args.clock ?? systemClock)().toISOString(), bucket: VAULT_BUCKET, entries };
  await sink.put(MANIFEST, encryptBlob(key, MANIFEST, new TextEncoder().encode(JSON.stringify(manifest))));
  return report;
}

function entryFor(row: DocumentRow, size: number, digest: string): ManifestEntry {
  return { id: row.id, lead_id: row.lead_id, kind: row.kind, storage_path: row.storage_path, file_name: row.file_name, content_type: row.content_type, size, sha256: digest };
}

// --- Restore ------------------------------------------------------------------------

export type RestoreReport = {
  restored: string[];
  alreadyPresent: string[];
  /** In the archive but not (or no longer) a clean row in the database: left deleted on purpose. */
  skippedNoRow: string[];
  skippedChangedRow: string[];
  /** Object exists at the path with a different size; kept unless overwrite is set. */
  conflicts: string[];
  failed: { id: string; error: string }[];
  dryRun: boolean;
};

export async function restoreVault(args: {
  store: DocumentStore;
  storage: VaultStorage;
  sink: BackupSink;
  key: Buffer;
  dryRun?: boolean;
  overwrite?: boolean;
}): Promise<RestoreReport> {
  const { store, storage, sink, key } = args;
  const manifest = await readManifest(sink, key);
  const report: RestoreReport = { restored: [], alreadyPresent: [], skippedNoRow: [], skippedChangedRow: [], conflicts: [], failed: [], dryRun: Boolean(args.dryRun) };

  for (const entry of manifest.entries) {
    try {
      const row = await store.get(entry.id);
      if (!row) {
        report.skippedNoRow.push(entry.id);
        continue;
      }
      if (row.status !== "clean" || row.storage_path !== entry.storage_path || row.lead_id !== entry.lead_id) {
        report.skippedChangedRow.push(entry.id);
        continue;
      }
      const existing = await storage.stat(VAULT_BUCKET, entry.storage_path);
      if (existing && existing.size === entry.size) {
        report.alreadyPresent.push(entry.id);
        continue;
      }
      if (existing && !args.overwrite) {
        report.conflicts.push(entry.id);
        continue;
      }
      const name = objectName(entry.id);
      const blob = await sink.get(name);
      if (!blob) throw new Error("blob missing from archive");
      const bytes = decryptBlob(key, name, blob);
      if (sha256(bytes) !== entry.sha256) throw new Error("archived bytes do not match the manifest SHA-256");
      if (args.dryRun) {
        report.restored.push(entry.id);
        continue;
      }
      if (existing) {
        const removed = await storage.remove(VAULT_BUCKET, [entry.storage_path]);
        if (removed.error) throw new Error(removed.error);
      }
      const put = await storage.put(VAULT_BUCKET, entry.storage_path, bytes, entry.content_type);
      if (put.error) throw new Error(put.error);
      report.restored.push(entry.id);
    } catch (err) {
      report.failed.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

// --- Verification -----------------------------------------------------------------------

export type VerifyReport = { checked: number; missing: string[]; sizeMismatch: string[]; hashMismatch: string[] };

/** Confirms every clean row has its file (and, with `deep`, that the bytes still match the recorded SHA-256). */
export async function verifyVault(args: { store: DocumentStore; storage: VaultStorage; deep?: boolean; maxFileBytes?: number }): Promise<VerifyReport> {
  const report: VerifyReport = { checked: 0, missing: [], sizeMismatch: [], hashMismatch: [] };
  let after: string | undefined;
  for (;;) {
    const page = await args.store.listClean(100, after);
    if (page.length === 0) break;
    after = page[page.length - 1]!.id;
    for (const row of page) {
      report.checked++;
      const info = await args.storage.stat(VAULT_BUCKET, row.storage_path);
      if (!info) {
        report.missing.push(row.id);
        continue;
      }
      if (row.size_bytes != null && Number(row.size_bytes) !== info.size) {
        report.sizeMismatch.push(row.id);
        continue;
      }
      if (args.deep && row.sha256) {
        const bytes = await args.storage.read(VAULT_BUCKET, row.storage_path, args.maxFileBytes ?? 50 * 1024 * 1024);
        if (!bytes || sha256(bytes) !== row.sha256) report.hashMismatch.push(row.id);
      }
    }
  }
  return report;
}
