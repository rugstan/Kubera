// Deployment environment detection, kept free of import-time side effects so
// standalone processes (the container scan worker, CLIs) can use it without
// pulling in lib/site.ts and its build-time license guard.

type Env = Record<string, string | undefined>;

export type DeploymentEnv = "production" | "preview" | "development";

/**
 * Where this build will be served. Vercel sets VERCEL_ENV; other hosts set
 * DEPLOY_ENV=production. A plain `next build` (CI, local) is treated as a
 * preview so the license guard in lib/site.ts does not block test builds.
 */
export function deploymentEnv(env: Env = process.env): DeploymentEnv {
  const declared = env.VERCEL_ENV || env.DEPLOY_ENV;
  if (declared === "production") return "production";
  if (declared === "preview") return "preview";
  if (env.NODE_ENV === "production") return "preview";
  return "development";
}

/**
 * Why an in-memory fake (`<variable>=fake`) must not run here, or null when it
 * may. Fakes are refused in production and whenever the Supabase service role
 * is configured: a fake wired to real data can forge state that real users
 * rely on (identities, signed disclosures, clean malware verdicts).
 */
export function fakeProviderRefusal(variable: string, env: Env = process.env): string | null {
  if (deploymentEnv(env) === "production") return `${variable}=fake is not allowed in production`;
  if ((env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()) return `${variable}=fake cannot run with SUPABASE_SERVICE_ROLE_KEY set`;
  return null;
}
