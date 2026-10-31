import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { backupVault, decryptBlob, encryptBlob, MemoryBackupSink, parseBackupKey, restoreVault, verifyVault } from "./backup";
import { DirectoryBackupSink } from "./backup-fs";
import { CSV_BYTES, LEAD_ID, PDF_BYTES, makeVault } from "./testing";
import { VAULT_BUCKET } from "./types";

const key = randomBytes(32);
const io = (v: ReturnType<typeof makeVault>) => ({ store: v.store, storage: v.storage });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A clean document as the scan worker leaves it. */
function addClean(v: ReturnType<typeof makeVault>, bytes: Uint8Array, name: string) {
  const storage_path = `${LEAD_ID}/T12/${name}`;
  v.storage.seed(VAULT_BUCKET, storage_path, bytes);
  return v.store.seedLegacy({
    lead_id: LEAD_ID,
    storage_path,
    file_name: name,
    status: "clean",
    bucket: VAULT_BUCKET,
    size_bytes: bytes.byteLength,
    sha256: sha(bytes),
    scanned_at: v.clock.now().toISOString(),
  });
}

describe("backup crypto", () => {
  it("round-trips and binds a blob to its archive name", () => {
    const blob = encryptBlob(key, "objects/a.enc", PDF_BYTES);
    expect(Buffer.from(blob).includes(Buffer.from("%PDF"))).toBe(false);
    expect(Buffer.from(decryptBlob(key, "objects/a.enc", blob))).toEqual(Buffer.from(PDF_BYTES));
    expect(() => decryptBlob(key, "objects/b.enc", blob)).toThrow(/decryption failed/);
    expect(() => decryptBlob(randomBytes(32), "objects/a.enc", blob)).toThrow(/decryption failed/);
    const tampered = Buffer.from(blob);
    tampered[20] = tampered[20]! ^ 1;
    expect(() => decryptBlob(key, "objects/a.enc", tampered)).toThrow(/decryption failed/);
    expect(() => decryptBlob(key, "x", new Uint8Array(5))).toThrow(/not a vault backup blob/);
  });

  it("requires a 32-byte base64 key", () => {
    expect(() => parseBackupKey(undefined)).toThrow(/VAULT_BACKUP_KEY/);
    expect(() => parseBackupKey("c2hvcnQ=")).toThrow(/32-byte/);
    expect(parseBackupKey(key.toString("base64"))).toEqual(key);
  });
});

describe("backup and restore", () => {
  it("backs up clean documents encrypted, skips already-archived blobs, and restores into an empty bucket", async () => {
    const v = makeVault();
    const a = addClean(v, PDF_BYTES, "a.pdf");
    const b = addClean(v, CSV_BYTES, "b.csv");
    // Not clean: never backed up.
    v.store.seedLegacy({ lead_id: LEAD_ID, storage_path: `${LEAD_ID}/T12/q.pdf`, status: "quarantined" });
    const sink = new MemoryBackupSink();

    const first = await backupVault({ ...io(v), sink, key, clock: v.clock.now });
    expect(first).toMatchObject({ documents: 2, copied: 2, alreadyArchived: 0, missing: [], corrupt: [] });
    expect([...sink.files.keys()].sort()).toEqual([`objects/${a.id}.enc`, `objects/${b.id}.enc`, "manifest.enc"].sort());
    for (const blob of sink.files.values()) expect(Buffer.from(blob).includes(Buffer.from("revenue"))).toBe(false);

    const second = await backupVault({ ...io(v), sink, key });
    expect(second).toMatchObject({ copied: 0, alreadyArchived: 2 });

    // Disaster: the vault bucket is empty but the database rows survived.
    for (const p of v.storage.paths(VAULT_BUCKET)) await v.storage.remove(VAULT_BUCKET, [p]);
    expect((await verifyVault(io(v))).missing.sort()).toEqual([a.id, b.id].sort());

    const dry = await restoreVault({ ...io(v), sink, key, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true });
    expect(dry.restored).toHaveLength(2);
    expect(v.storage.paths(VAULT_BUCKET)).toEqual([]);

    const restored = await restoreVault({ ...io(v), sink, key });
    expect(restored.restored.sort()).toEqual([a.id, b.id].sort());
    expect(Buffer.from(v.storage.bytes(VAULT_BUCKET, a.storage_path)!)).toEqual(Buffer.from(PDF_BYTES));
    expect(await verifyVault({ ...io(v), deep: true })).toMatchObject({ checked: 2, missing: [], sizeMismatch: [], hashMismatch: [] });

    // Running it again changes nothing.
    expect(await restoreVault({ ...io(v), sink, key })).toMatchObject({ restored: [], alreadyPresent: expect.arrayContaining([a.id, b.id]) });
  });

  it("does not resurrect documents that were deleted after the backup", async () => {
    const v = makeVault();
    const kept = addClean(v, PDF_BYTES, "kept.pdf");
    const erased = addClean(v, CSV_BYTES, "erased.csv");
    const sink = new MemoryBackupSink();
    await backupVault({ ...io(v), sink, key });

    // A deletion request is honored after the backup: row and file are gone.
    await v.store.remove(erased.id);
    await v.storage.remove(VAULT_BUCKET, [erased.storage_path]);
    await v.storage.remove(VAULT_BUCKET, [kept.storage_path]);

    const report = await restoreVault({ ...io(v), sink, key });
    expect(report.restored).toEqual([kept.id]);
    expect(report.skippedNoRow).toEqual([erased.id]);
    expect(v.storage.has(VAULT_BUCKET, erased.storage_path)).toBe(false);
  });

  it("skips rows whose status or path changed, and reports conflicts instead of overwriting", async () => {
    const v = makeVault();
    const a = addClean(v, PDF_BYTES, "a.pdf");
    const b = addClean(v, CSV_BYTES, "b.csv");
    const sink = new MemoryBackupSink();
    await backupVault({ ...io(v), sink, key });

    await v.store.update(a.id, { status: "infected" });
    v.storage.seed(VAULT_BUCKET, b.storage_path, "different content here");
    const report = await restoreVault({ ...io(v), sink, key });
    expect(report.skippedChangedRow).toEqual([a.id]);
    expect(report.conflicts).toEqual([b.id]);
    expect(Buffer.from(v.storage.bytes(VAULT_BUCKET, b.storage_path)!).toString()).toBe("different content here");

    const forced = await restoreVault({ ...io(v), sink, key, overwrite: true });
    expect(forced.restored).toEqual([b.id]);
    expect(Buffer.from(v.storage.bytes(VAULT_BUCKET, b.storage_path)!)).toEqual(Buffer.from(CSV_BYTES));
  });

  it("flags missing and corrupt files during backup instead of archiving them", async () => {
    const v = makeVault();
    const missing = addClean(v, PDF_BYTES, "gone.pdf");
    const corrupt = addClean(v, CSV_BYTES, "bad.csv");
    await v.storage.remove(VAULT_BUCKET, [missing.storage_path]);
    v.storage.seed(VAULT_BUCKET, corrupt.storage_path, "bit rot");
    const sink = new MemoryBackupSink();
    const report = await backupVault({ ...io(v), sink, key });
    expect(report).toMatchObject({ copied: 0, missing: [missing.id], corrupt: [corrupt.id] });
    expect(await verifyVault({ ...io(v), deep: true })).toMatchObject({ missing: [missing.id], sizeMismatch: [corrupt.id] });
  });

  it("fails an item whose archived bytes were tampered with, and refuses the wrong key", async () => {
    const v = makeVault();
    const a = addClean(v, PDF_BYTES, "a.pdf");
    const sink = new MemoryBackupSink();
    await backupVault({ ...io(v), sink, key });
    await v.storage.remove(VAULT_BUCKET, [a.storage_path]);

    const blob = sink.files.get(`objects/${a.id}.enc`)!;
    blob[blob.length - 20] = blob[blob.length - 20]! ^ 0xff;
    expect((await restoreVault({ ...io(v), sink, key })).failed).toEqual([{ id: a.id, error: expect.stringContaining("decryption failed") }]);
    await expect(restoreVault({ ...io(v), sink, key: randomBytes(32) })).rejects.toThrow(/decryption failed/);
  });
});

describe("DirectoryBackupSink", () => {
  it("stores blobs under the archive directory with owner-only permissions and refuses path escapes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vault-backup-"));
    try {
      const v = makeVault();
      const a = addClean(v, PDF_BYTES, "a.pdf");
      const sink = new DirectoryBackupSink(dir);
      await backupVault({ ...io(v), sink, key });
      expect((await readdir(dir)).sort()).toEqual(["manifest.enc", "objects"]);
      expect(await readdir(path.join(dir, "objects"))).toEqual([`${a.id}.enc`]);
      expect(await sink.has(`objects/${a.id}.enc`)).toBe(true);
      expect(await sink.get("objects/nope.enc")).toBeNull();
      await expect(sink.put("../escape.enc", new Uint8Array(1))).rejects.toThrow(/outside the archive/);

      await v.storage.remove(VAULT_BUCKET, [a.storage_path]);
      expect((await restoreVault({ ...io(v), sink, key })).restored).toEqual([a.id]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
