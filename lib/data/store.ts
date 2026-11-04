import type { PropertyFacts } from "./types";

/**
 * Cache for merged property facts, keyed by normalized address. Implementations
 * return only unexpired entries; `get` never throws (a cache miss is always safe).
 */
export interface PropertyFactsStore {
  get(addressKey: string, now: Date): Promise<PropertyFacts | null>;
  put(facts: PropertyFacts): Promise<void>;
}

/** In-memory store for tests and local development. */
export class InMemoryPropertyFactsStore implements PropertyFactsStore {
  readonly rows = new Map<string, PropertyFacts>();
  puts = 0;

  async get(addressKey: string, now: Date): Promise<PropertyFacts | null> {
    const row = this.rows.get(addressKey);
    if (!row || new Date(row.expiresAt).getTime() <= now.getTime()) return null;
    return structuredClone(row);
  }

  async put(facts: PropertyFacts): Promise<void> {
    this.puts += 1;
    this.rows.set(facts.addressKey, structuredClone({ ...facts, fromCache: false }));
  }
}
