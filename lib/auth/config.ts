// Which identity provider runs (Global rule 3: env-gated, degrade, never crash).
//
//   supabase  SUPABASE_URL + SUPABASE_ANON_KEY (+ SUPABASE_SERVICE_ROLE_KEY for
//             profiles/roles) are set, and AUTH_PROVIDER is empty or "supabase".
//   fake      AUTH_PROVIDER=fake: in-memory accounts and demo deal data for
//             local development and the e2e suite. Refused in production
//             and whenever the Supabase service role is configured.
//   disabled  nothing configured: sign-in pages explain that staff sign-in is
//             not set up, and every staff page refuses access.

import { deploymentEnv } from "@/lib/site";

type Env = Record<string, string | undefined>;

export type AuthMode =
  | { mode: "supabase"; url: string; anonKey: string }
  | { mode: "fake" }
  | { mode: "disabled"; reason: string };

export function resolveAuthMode(env: Env = process.env): AuthMode {
  const requested = (env.AUTH_PROVIDER ?? "").trim().toLowerCase();
  const production = deploymentEnv(env) === "production";

  if (requested === "fake") {
    if (production) return { mode: "disabled", reason: "AUTH_PROVIDER=fake is not allowed in production" };
    // Fake identities must never reach real data.
    if ((env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()) return { mode: "disabled", reason: "AUTH_PROVIDER=fake cannot run with SUPABASE_SERVICE_ROLE_KEY set" };
    return { mode: "fake" };
  }
  if (requested && requested !== "supabase") return { mode: "disabled", reason: `Unknown AUTH_PROVIDER "${requested}"` };

  const url = (env.SUPABASE_URL ?? "").trim();
  const anonKey = (env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) return { mode: "disabled", reason: "SUPABASE_URL and SUPABASE_ANON_KEY are not set" };
  if (!(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()) return { mode: "disabled", reason: "SUPABASE_SERVICE_ROLE_KEY is not set (profiles and roles are read server-side)" };
  return { mode: "supabase", url, anonKey };
}
