import { expect, test } from "@playwright/test";

// The rates job expires the "rates" cache tag (the rate ticker in the site
// layout), so every page that shows it is rendered again on its next visit.
// The prerendered [slug] pages used to fail that render with a 500 and keep
// failing until the next deploy. Each one must still load after the job runs.
const PAGES = ["/financing/multifamily", "/financing/hotels", "/structures/assisted-living-sba-504-refinance", "/california/los-angeles", "/calculators/dscr", "/financing"];

// The secret is set for the e2e server in playwright.config.ts.
const CRON_AUTH = { authorization: `Bearer ${process.env.E2E_CRON_SECRET ?? "e2e-cron-secret"}` };

test("program, structure, city and calculator pages still load after the rates job runs", async ({ request }) => {
  for (const p of PAGES) expect((await request.get(p)).status(), `${p} before the rates job`).toBe(200);

  for (let run = 1; run <= 2; run++) {
    const cron = await request.get("/api/cron/rates", { headers: CRON_AUTH });
    expect(cron.status(), "rates job").toBe(200);
    for (const visit of ["first", "second"]) {
      for (const p of PAGES) expect((await request.get(p)).status(), `${p}, ${visit} visit after rates job ${run}`).toBe(200);
    }
  }
});
