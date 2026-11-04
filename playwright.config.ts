import { defineConfig, devices } from "@playwright/test";

// E2E runs against a production build (`next build && next start`) with every
// external integration unset, so the suite exercises the env-free path
// (Global rule 3) and never touches Supabase, Twenty, Anthropic or FRED
// credentials. Chromium comes preinstalled locally; CI installs it with
// `npx playwright install --with-deps chromium`.
const port = Number(process.env.E2E_PORT ?? 3999);
const baseURL = `http://localhost:${port}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  // Artifacts land in the gitignored coverage/ directory so runs leave the tree clean.
  outputDir: "coverage/e2e/results",
  reporter: ci ? [["github"], ["html", { open: "never", outputFolder: "coverage/e2e/report" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${port}`,
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 600_000,
    stdout: "pipe",
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Stable, obviously fake value so the production license guard passes.
      NEXT_PUBLIC_DRE_CORPORATE_LICENSE: process.env.NEXT_PUBLIC_DRE_CORPORATE_LICENSE || "E2E-TEST-0000000",
      NEXT_PUBLIC_SITE_URL: baseURL,
      // Blank on purpose: a developer's .env.local must not leak into the suite.
      ANTHROPIC_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      TWENTY_API_URL: "",
      TWENTY_API_KEY: "",
      SENTRY_DSN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      JEV_API_URL: "",
      // 127.0.0.1 stands in for kubera.loans in e2e/express-host.spec.ts.
      EXPRESS_HOSTS: "kubera.loans,www.kubera.loans,127.0.0.1",
      // next start runs with NODE_ENV=production, so the API Origin allowlist
      // must name the e2e host or real (unmocked) POSTs get 403.
      ALLOWED_ORIGINS: baseURL,
      // Bot verification off: the forms send no token and the server skips the check.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      // In-memory staff and portal accounts (lib/auth/fake-provider.ts) so
      // e2e/staff.spec.ts reuses this server; refused in production deploys.
      AUTH_PROVIDER: "fake",
      SUPABASE_ANON_KEY: "",
      // Portal secret stays blank so .env.local cannot change results.
      PORTAL_SESSION_SECRET: "",
    },
  },
});
