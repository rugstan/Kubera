import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseAuditSink, MemoryAuditSink, type AuditSink } from "./audit";
import { resolveAuthMode } from "./config";
import { seedDemoAccounts } from "./demo";
import { MemoryDirectory, supabaseDirectory, type Directory } from "./directory";
import { FakeAuthProvider } from "./fake-provider";
import type { AuthProvider } from "./provider";
import { SupabaseAuthProvider } from "./supabase-provider";

// Server wiring for auth. Tests inject a bundle with setAuthServices().

export type AuthServices = {
  mode: "supabase" | "fake";
  provider: AuthProvider;
  directory: Directory;
  audit: AuditSink;
  /** Supabase client that runs as the signed-in user, so RLS applies. Null in fake mode. */
  userClient(accessToken: string): SupabaseClient | null;
};

let override: AuthServices | null | undefined;
let cached: AuthServices | null | undefined;
let warned = false;

/** Test hook: inject services (null = not configured; undefined restores env wiring). */
export function setAuthServices(services: AuthServices | null | undefined): void {
  override = services;
  cached = undefined;
}

type FakeBundle = { provider: FakeAuthProvider; directory: MemoryDirectory; audit: MemoryAuditSink };

// One fake identity store per server process. globalThis keeps it shared
// across route bundles (pages, actions and route handlers load separately).
const FAKE_KEY = Symbol.for("kubera.auth.fake");

export function fakeAuthBundle(): FakeBundle {
  const g = globalThis as unknown as Record<symbol, FakeBundle | undefined>;
  let bundle = g[FAKE_KEY];
  if (!bundle) {
    bundle = { provider: new FakeAuthProvider(), directory: new MemoryDirectory(), audit: new MemoryAuditSink() };
    seedDemoAccounts(bundle.provider, bundle.directory);
    g[FAKE_KEY] = bundle;
  }
  return bundle;
}

export function authServices(): AuthServices | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const mode = resolveAuthMode();
  if (mode.mode === "fake") {
    const b = fakeAuthBundle();
    cached = { mode: "fake", provider: b.provider, directory: b.directory, audit: b.audit, userClient: () => null };
    return cached;
  }
  if (mode.mode === "supabase") {
    const admin = supabaseAdmin();
    if (admin) {
      cached = {
        mode: "supabase",
        provider: new SupabaseAuthProvider({ url: mode.url, anonKey: mode.anonKey }),
        directory: supabaseDirectory(admin),
        audit: supabaseAuditSink(admin),
        userClient: (accessToken) =>
          createClient(mode.url, mode.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
          }),
      };
      return cached;
    }
  }
  if (!warned) {
    warned = true;
    console.warn(`[auth] Staff sign-in disabled: ${mode.mode === "disabled" ? mode.reason : "SUPABASE_SERVICE_ROLE_KEY is not set"}.`);
  }
  cached = null;
  return cached;
}

const KEY_SYMBOL = Symbol.for("kubera.auth.cookie-key");

/**
 * HMAC key for the session cookie: AUTH_COOKIE_SECRET when set, otherwise
 * derived from the service-role key (stable across instances, never sent
 * anywhere). Without either (fake or disabled mode) a per-process random key.
 */
export function sessionSigningKey(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.AUTH_COOKIE_SECRET?.trim();
  if (explicit && explicit.length >= 32) return explicit;
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (service) return createHash("sha256").update(`kubera:session-cookie:${service}`).digest("base64url");
  const g = globalThis as unknown as Record<symbol, string | undefined>;
  g[KEY_SYMBOL] ??= randomBytes(32).toString("base64url");
  return g[KEY_SYMBOL]!;
}
