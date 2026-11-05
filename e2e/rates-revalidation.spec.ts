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

// After the rates job a visit used to be answered from the [slug] route's
// generic fallback shell plus a per-request resume: 200, but sent as
// `Cache-Control: private, no-store` with the page body streamed twice. The
// job now marks the ticker stale, so the cached static page is served while it
// regenerates. Bots Next calls "HTML-limited" (Bingbot and others) used to get
// a per-request render of every page too; next.config.ts turns that off.
const isPrivate = (cacheControl: string | undefined) => /private|no-store/.test(cacheControl ?? "");

test("pages stay cacheable static HTML after the rates job runs", async ({ request }) => {
  for (const p of PAGES) await request.get(p);
  const cron = await request.get("/api/cron/rates", { headers: CRON_AUTH });
  expect(cron.status(), "rates job").toBe(200);
  for (const p of PAGES) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(200);
    expect(res.headers()["x-nextjs-postponed"], `${p} resumed from a fallback shell`).toBeUndefined();
    expect(isPrivate(res.headers()["cache-control"]), `${p} cache-control: ${res.headers()["cache-control"]}`).toBe(false);
  }
});

test("Bingbot gets the same cacheable static page as everyone else", async ({ request }) => {
  const bingbot = { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" };
  for (const p of ["/", "/about", "/financing/hud-232"]) {
    const res = await request.get(p, { headers: bingbot });
    expect(res.status(), p).toBe(200);
    expect(isPrivate(res.headers()["cache-control"]), `${p} cache-control: ${res.headers()["cache-control"]}`).toBe(false);
    expect(await res.text(), p).toMatch(/<head>[\s\S]*<title>[^<]+<\/title>[\s\S]*<\/head>/);
  }
});
