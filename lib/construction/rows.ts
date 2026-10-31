// Row mapping between camelCase domain records and snake_case table columns.
// Only top-level keys are converted; jsonb values are stored as given.

type Row = Record<string, unknown>;

export const toSnake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const toCamel = (key: string): string => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Column values for an insert or update; `undefined` fields are left out. */
export function toRow(record: object): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[toSnake(key)] = value;
  }
  return out;
}

/** Domain record from a database row; timestamps and dates stay as returned strings. */
export function fromRow<T>(row: Row): T {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) out[toCamel(key)] = value;
  return out as T;
}

/** Postgres returns `date` as YYYY-MM-DD and `timestamptz` as an offset string; normalize timestamps to ISO. */
export function isoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

const TIMESTAMP_KEYS = ["createdAt", "updatedAt", "orderedAt", "deliveredAt", "acceptedAt", "checkedAt", "triggeredAt", "resolvedAt", "occurredAt"] as const;

export function normalizeTimestamps<T extends object>(record: T): T {
  const out = { ...record } as Record<string, unknown>;
  for (const k of TIMESTAMP_KEYS) if (k in out) out[k] = isoTimestamp(out[k]);
  return out as T;
}

/** numeric columns arrive as strings from PostgREST. */
export function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
