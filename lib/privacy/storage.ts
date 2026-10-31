// Object storage operations the retention engine needs, behind an interface
// so tests run against an in-memory bucket. The Supabase implementation wraps
// the Storage API of the service-role client.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ObjectStorage {
  /** Removes objects; missing paths are not an error. */
  remove(bucket: string, paths: string[]): Promise<{ error: string | null }>;
  /** Every object path under `prefix` (recursive). */
  list(bucket: string, prefix: string): Promise<string[]>;
}

const REMOVE_BATCH = 100;
const LIST_PAGE = 100;
const LIST_MAX = 5_000;

export function supabaseObjectStorage(db: SupabaseClient): ObjectStorage {
  return {
    async remove(bucket, paths) {
      for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH));
        if (error) return { error: error.message };
      }
      return { error: null };
    },
    async list(bucket, prefix) {
      const out: string[] = [];
      const folders = [prefix.replace(/\/+$/, "")];
      while (folders.length && out.length < LIST_MAX) {
        const folder = folders.shift()!;
        for (let offset = 0; ; offset += LIST_PAGE) {
          const { data, error } = await db.storage.from(bucket).list(folder, { limit: LIST_PAGE, offset });
          if (error) throw new Error(`storage list failed for ${bucket}/${folder}: ${error.message}`);
          for (const item of data ?? []) {
            const full = folder ? `${folder}/${item.name}` : item.name;
            // Folders come back without an id.
            if (item.id) out.push(full);
            else folders.push(full);
          }
          if (!data || data.length < LIST_PAGE) break;
        }
      }
      return out;
    },
  };
}

/** In-memory bucket store for tests. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Set<string>>();
  readonly removed: { bucket: string; path: string }[] = [];
  /** Paths whose removal should fail (simulates a Storage outage for one file). */
  readonly failOn = new Set<string>();

  put(bucket: string, path: string): void {
    if (!this.objects.has(bucket)) this.objects.set(bucket, new Set());
    this.objects.get(bucket)!.add(path);
  }

  has(bucket: string, path: string): boolean {
    return this.objects.get(bucket)?.has(path) ?? false;
  }

  async remove(bucket: string, paths: string[]): Promise<{ error: string | null }> {
    const failing = paths.find((p) => this.failOn.has(p));
    if (failing) return { error: `simulated storage failure for ${failing}` };
    const set = this.objects.get(bucket);
    for (const p of paths) {
      if (set?.delete(p)) this.removed.push({ bucket, path: p });
    }
    return { error: null };
  }

  async list(bucket: string, prefix: string): Promise<string[]> {
    const p = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return [...(this.objects.get(bucket) ?? [])].filter((path) => path.startsWith(p)).sort();
  }
}
