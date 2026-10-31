// Object storage operations the vault needs, behind an interface so tests run
// against an in-memory bucket. The Supabase implementation wraps the Storage
// API of the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ObjectInfo = { size: number; contentType: string | null };

export interface VaultStorage {
  /** Short-lived URL the browser PUTs the file to. Never overwrites an existing object. */
  createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string } | { error: string }>;
  /** Size and content type, or null when no object exists at the path. */
  stat(bucket: string, path: string): Promise<ObjectInfo | null>;
  /** The first `bytes` bytes (fewer if the object is shorter), or null when missing. */
  readHead(bucket: string, path: string, bytes: number): Promise<Uint8Array | null>;
  /** The whole object; throws if it is larger than `maxBytes`. Null when missing. */
  read(bucket: string, path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Server-side move between buckets (or paths); atomic, no bytes pass through us. */
  move(fromBucket: string, toBucket: string, path: string): Promise<{ error: string | null }>;
  /** Writes an object (restore only). Fails if it already exists. */
  put(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<{ error: string | null }>;
  /** Removes objects; missing paths are not an error. */
  remove(bucket: string, paths: string[]): Promise<{ error: string | null }>;
  createSignedDownloadUrl(bucket: string, path: string, ttlSeconds: number, downloadName: string): Promise<{ url: string } | { error: string }>;
}

// --- Supabase -------------------------------------------------------------------

function notFound(err: { message?: string; statusCode?: string | number; status?: number } | null): boolean {
  if (!err) return false;
  const code = String(err.statusCode ?? err.status ?? "");
  return code === "404" || /not.?found|does not exist/i.test(err.message ?? "");
}

/** Reads at most `limit` bytes of a response body, then cancels the rest. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const out = new Uint8Array(limit);
  let filled = 0;
  while (filled < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, limit - filled);
    out.set(value.subarray(0, take), filled);
    filled += take;
  }
  await reader.cancel().catch(() => {});
  return out.subarray(0, filled);
}

export function supabaseVaultStorage(db: SupabaseClient): VaultStorage {
  const stat: VaultStorage["stat"] = async (bucket, path) => {
    const { data, error } = await db.storage.from(bucket).info(path);
    if (error || !data) {
      if (error && !notFound(error as never)) {
        const exists = await db.storage.from(bucket).exists(path);
        if (exists.data) throw new Error(`storage info failed for ${bucket}/${path}: ${error.message}`);
      }
      return null;
    }
    const size = typeof data.size === "number" ? data.size : Number((data.metadata as { size?: number } | undefined)?.size ?? NaN);
    if (!Number.isFinite(size)) throw new Error(`storage info for ${bucket}/${path} has no size`);
    return { size, contentType: data.contentType ?? null };
  };

  return {
    async createSignedUploadUrl(bucket, path) {
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      return error || !data ? { error: error?.message ?? "no upload URL" } : { url: data.signedUrl };
    },
    stat,
    async readHead(bucket, path, bytes) {
      const signed = await db.storage.from(bucket).createSignedUrl(path, 30);
      if (signed.error || !signed.data) {
        if (notFound(signed.error as never)) return null;
        throw new Error(`could not sign ${bucket}/${path}: ${signed.error?.message}`);
      }
      const res = await fetch(signed.data.signedUrl, { headers: { range: `bytes=0-${bytes - 1}` }, cache: "no-store" });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`storage read failed for ${bucket}/${path}: HTTP ${res.status}`);
      // 206 carries just the range; a server that ignores Range sends 200 and we stop early.
      return readCapped(res, bytes);
    },
    async read(bucket, path, maxBytes) {
      const info = await stat(bucket, path);
      if (!info) return null;
      if (info.size > maxBytes) throw new Error(`${bucket}/${path} is ${info.size} bytes, over the ${maxBytes} byte read limit`);
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) {
        if (notFound(error as never)) return null;
        throw new Error(`storage download failed for ${bucket}/${path}: ${error?.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async move(fromBucket, toBucket, path) {
      const { error } = await db.storage.from(fromBucket).move(path, path, { destinationBucket: toBucket });
      return { error: error ? error.message : null };
    },
    async put(bucket, path, bytes, contentType) {
      const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      return { error: error ? error.message : null };
    },
    async remove(bucket, paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) return { error: error.message };
      }
      return { error: null };
    },
    async createSignedDownloadUrl(bucket, path, ttlSeconds, downloadName) {
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, ttlSeconds, { download: downloadName });
      return error || !data ? { error: error?.message ?? "no download URL" } : { url: data.signedUrl };
    },
  };
}

// --- In-memory fake ----------------------------------------------------------------

type StoredObject = { bytes: Uint8Array; contentType: string };

/** In-memory buckets for tests; mimics "signed upload URLs never overwrite". */
export class MemoryVaultStorage implements VaultStorage {
  readonly buckets = new Map<string, Map<string, StoredObject>>();
  readonly signedUploads = new Set<string>();
  readonly downloadUrls: { bucket: string; path: string; ttlSeconds: number; downloadName: string }[] = [];
  /** Paths whose removal should fail (simulates a Storage outage for one file). */
  readonly failRemoveOn = new Set<string>();
  readonly failMoveOn = new Set<string>();

  private bucket(name: string): Map<string, StoredObject> {
    let b = this.buckets.get(name);
    if (!b) this.buckets.set(name, (b = new Map()));
    return b;
  }

  /** What the browser does with the signed URL. Throws if no URL was minted for the path or the object exists. */
  upload(bucket: string, path: string, bytes: Uint8Array | string, contentType = "application/octet-stream"): void {
    if (!this.signedUploads.has(`${bucket}/${path}`)) throw new Error(`no signed upload URL for ${bucket}/${path}`);
    const b = this.bucket(bucket);
    if (b.has(path)) throw new Error(`${bucket}/${path} already exists`);
    b.set(path, { bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, contentType });
  }

  seed(bucket: string, path: string, bytes: Uint8Array | string, contentType = "application/octet-stream"): void {
    this.bucket(bucket).set(path, { bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, contentType });
  }

  has(bucket: string, path: string): boolean {
    return this.buckets.get(bucket)?.has(path) ?? false;
  }

  bytes(bucket: string, path: string): Uint8Array | undefined {
    return this.buckets.get(bucket)?.get(path)?.bytes;
  }

  paths(bucket: string): string[] {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }

  async createSignedUploadUrl(bucket: string, path: string): Promise<{ url: string } | { error: string }> {
    this.signedUploads.add(`${bucket}/${path}`);
    return { url: `https://storage.test/upload/${bucket}/${path}?token=t` };
  }

  async stat(bucket: string, path: string) {
    const o = this.buckets.get(bucket)?.get(path);
    return o ? { size: o.bytes.byteLength, contentType: o.contentType } : null;
  }

  async readHead(bucket: string, path: string, bytes: number) {
    const o = this.buckets.get(bucket)?.get(path);
    return o ? o.bytes.slice(0, bytes) : null;
  }

  async read(bucket: string, path: string, maxBytes: number) {
    const o = this.buckets.get(bucket)?.get(path);
    if (!o) return null;
    if (o.bytes.byteLength > maxBytes) throw new Error(`${bucket}/${path} is over the read limit`);
    return o.bytes.slice();
  }

  async move(fromBucket: string, toBucket: string, path: string) {
    if (this.failMoveOn.has(path)) return { error: `simulated move failure for ${path}` };
    const from = this.buckets.get(fromBucket);
    const o = from?.get(path);
    if (!o) return { error: "Object not found" };
    if (this.bucket(toBucket).has(path)) return { error: "The resource already exists" };
    this.bucket(toBucket).set(path, o);
    from!.delete(path);
    return { error: null };
  }

  async put(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    const b = this.bucket(bucket);
    if (b.has(path)) return { error: "The resource already exists" };
    b.set(path, { bytes: bytes.slice(), contentType });
    return { error: null };
  }

  async remove(bucket: string, paths: string[]) {
    const failing = paths.find((p) => this.failRemoveOn.has(p));
    if (failing) return { error: `simulated storage failure for ${failing}` };
    const b = this.buckets.get(bucket);
    for (const p of paths) b?.delete(p);
    return { error: null };
  }

  async createSignedDownloadUrl(bucket: string, path: string, ttlSeconds: number, downloadName: string): Promise<{ url: string } | { error: string }> {
    if (!this.has(bucket, path)) return { error: "Object not found" };
    this.downloadUrls.push({ bucket, path, ttlSeconds, downloadName });
    return { url: `https://storage.test/download/${bucket}/${path}?ttl=${ttlSeconds}` };
  }
}
