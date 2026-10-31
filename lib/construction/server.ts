import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import { resolveAuthMode } from "@/lib/auth/config";
import { primaryStaffRole, signedInStaff } from "@/lib/auth/staff";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { createContractorLicenseLookup } from "./cslb";
import { ConstructionError, type ConstructionDeps, type DealCreator } from "./deps";
import { MemoryConstructionStore, type ConstructionStore } from "./store";
import { createSupabaseConstructionStore } from "./store-supabase";
import type { StaffIdentity } from "./types";

// Wiring for the staff app: which store, approval gate, license lookup and deal
// creator the construction desk uses, and who counts as signed-in staff.
//
// Other modules plug in without this one importing them:
//   registerStaffGuard(...)   WS-I's auth session check
//   configureConstruction({ gate, deals })   WS-I's approvals queue, WS-T's deal creator

export type StaffGuard = () => Promise<StaffIdentity | null>;

type Overrides = { gate?: ApprovalGate; deals?: DealCreator; store?: ConstructionStore };

let overrides: Overrides = {};
let guard: StaffGuard | null = null;

export function configureConstruction(next: Overrides): void {
  overrides = { ...overrides, ...next };
}

export function registerStaffGuard(next: StaffGuard): void {
  guard = next;
}

/** Test hook: forget every registration. */
export function resetConstructionConfig(): void {
  overrides = {};
  guard = null;
}

const DEV_STAFF: StaffIdentity = { id: "dev-staff", email: "dev-staff@localhost", role: "broker" };

/**
 * Signed-in staff, or null. A registered guard wins; otherwise WS-I's lib/auth
 * session (MFA required) when staff auth is configured. With no staff auth at
 * all the desk fails closed in production and uses a local stand-in only under
 * `next dev` and tests, so it is never reachable unauthenticated when deployed.
 */
export async function currentStaff(): Promise<StaffIdentity | null> {
  if (guard) return guard();
  if (resolveAuthMode().mode !== "disabled") {
    const p = await signedInStaff();
    return p ? { id: p.userId, email: p.email.toLowerCase(), role: primaryStaffRole(p) } : null;
  }
  return process.env.NODE_ENV === "production" ? null : DEV_STAFF;
}

export async function requireStaff(): Promise<StaffIdentity> {
  const staff = await currentStaff();
  if (!staff) throw new ConstructionError("forbidden", "Sign in as Kubera staff to use the construction desk");
  return staff;
}

// Without Supabase, development and tests share one in-memory store per process.
const globalForStore = globalThis as unknown as { __constructionMemoryStore?: MemoryConstructionStore };
let warned = false;

function defaultStore(): ConstructionStore | null {
  const supabase = createSupabaseConstructionStore();
  if (supabase) return supabase;
  if (process.env.NODE_ENV === "production") {
    if (!warned) {
      warned = true;
      console.warn("[construction] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set; the construction desk is unavailable.");
    }
    return null;
  }
  globalForStore.__constructionMemoryStore ??= new MemoryConstructionStore();
  return globalForStore.__constructionMemoryStore;
}

/** The desk's collaborators, or null when there is no database to keep records in. */
export function getConstructionDeps(): ConstructionDeps | null {
  const store = overrides.store ?? defaultStore();
  if (!store) return null;
  return {
    store,
    gate: overrides.gate ?? approvalGate(),
    licenses: createContractorLicenseLookup(),
    deals: overrides.deals ?? null,
    now: () => new Date(),
  };
}
