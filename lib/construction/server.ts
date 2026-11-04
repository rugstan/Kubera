import "server-only";
import { approvalGate } from "@/lib/approvals/server";
import { primaryStaffRole, signedInStaff } from "@/lib/auth/staff";
import type { ApprovalGate } from "@/lib/compliance/approval-gate";
import { demoDesks } from "@/lib/deals/demo";
import { SupabaseDealDeskStore } from "@/lib/deals/store-supabase";
import { dealDeskTakeoutCreator } from "@/lib/deals/takeout";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createContractorLicenseLookup } from "./cslb";
import { ConstructionError, type ConstructionDeps, type DealCreator } from "./deps";
import { MemoryConstructionStore, type ConstructionStore } from "./store";
import { createSupabaseConstructionStore } from "./store-supabase";
import type { StaffIdentity } from "./types";

// Wiring for the staff app: which store, approval gate, license lookup and deal
// creator the construction desk uses, and who counts as signed-in staff.
//
// Defaults: WS-I's approvals queue and lib/auth session, and WS-T's deal desk
// as the take-out deal creator whenever Supabase is configured. In fake-auth
// mode (local development, e2e) the desk runs on the shared in-memory demo
// desks (lib/deals/demo.ts), with a demo CSLB lookup. Tests override:
//   registerStaffGuard(...)   a staff session check
//   configureConstruction({ gate, deals, store })

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

/**
 * Signed-in staff, or null. A registered guard (tests) wins; otherwise WS-I's
 * lib/auth session (active profile, staff role, MFA). Without lib/auth
 * configured there is no session, so the desk fails closed everywhere.
 */
export async function currentStaff(): Promise<StaffIdentity | null> {
  if (guard) return guard();
  const p = await signedInStaff();
  return p ? { id: p.userId, email: p.email.toLowerCase(), role: primaryStaffRole(p) } : null;
}

export async function requireStaff(): Promise<StaffIdentity> {
  const staff = await currentStaff();
  if (!staff) throw new ConstructionError("forbidden", "Sign in as Corin staff to use the construction desk");
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

/** WS-T deal desk as the take-out deal creator; null without Supabase (take-outs are then recorded only). */
function defaultDealCreator(): DealCreator | null {
  const db = supabaseAdmin();
  return db ? dealDeskTakeoutCreator({ store: new SupabaseDealDeskStore(db), now: () => new Date() }) : null;
}

/** The desk's collaborators, or null when there is no database to keep records in. */
export function getConstructionDeps(): ConstructionDeps | null {
  const demo = overrides.store ? null : demoDesks();
  if (demo) {
    return {
      store: demo.construction,
      gate: overrides.gate ?? approvalGate(),
      licenses: demo.licenses,
      deals: overrides.deals ?? dealDeskTakeoutCreator({ store: demo.deals, now: () => new Date() }),
      now: () => new Date(),
    };
  }
  const store = overrides.store ?? defaultStore();
  if (!store) return null;
  return {
    store,
    gate: overrides.gate ?? approvalGate(),
    licenses: createContractorLicenseLookup(),
    deals: overrides.deals ?? defaultDealCreator(),
    now: () => new Date(),
  };
}
