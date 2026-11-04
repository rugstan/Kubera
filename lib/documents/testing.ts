// Test fixtures for the vault: a deterministic clock, in-memory dependencies and
// sample file bytes. Imported by *.test.ts only.

import { MemoryVaultStorage } from "./storage";
import { MemoryDocumentStore, MemoryEventLog } from "./store";
import { DEFAULT_LIMITS, type VaultLimits } from "./types";
import type { VaultDeps } from "./mint";

export const LEAD_ID = "6f1b5c1e-2a8e-4c39-9a55-3d3c1b7f2a10";
export const OTHER_LEAD_ID = "0b8e2f5e-6c1d-4a37-8d52-1c9a4f6e7b21";

export const TEST_ENV = { LEAD_TOKEN_SECRET: "test-secret-test-secret" } as const;

export class TestClock {
  constructor(private ms = Date.parse("2026-11-03T12:00:00Z")) {}
  now = (): Date => new Date(this.ms);
  advance(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

export function makeVault(limits: Partial<VaultLimits> = {}) {
  const clock = new TestClock();
  const store = new MemoryDocumentStore(clock.now);
  const events = new MemoryEventLog(clock.now);
  const storage = new MemoryVaultStorage();
  const deps: VaultDeps = { store, events, storage, clock: clock.now, limits: { ...DEFAULT_LIMITS, ...limits } };
  return { clock, store, events, storage, deps };
}

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n");
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const CSV_BYTES = new TextEncoder().encode("month,revenue,expenses\n2026-01,120000,80000\n2026-02,125000,81000\n");

/** A minimal OOXML-looking ZIP: local file header for [Content_Types].xml. */
export function xlsxBytes(): Uint8Array {
  const name = new TextEncoder().encode("[Content_Types].xml");
  const header = new Uint8Array(30 + name.length + 8);
  header.set([0x50, 0x4b, 0x03, 0x04], 0);
  header[26] = name.length;
  header.set(name, 30);
  return header;
}
