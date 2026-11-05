# SEO, GEO and AEO audit: corincommercial.com (November 2026)

Audit date: 2026-11-05. Scope: every URL in `https://corincommercial.com/sitemap.xml` (79), checked live (release `20261105-070747-87b7525`, `main` at `87b7525`) and in code. Fixes are on branch `claude/seo-geo-aeo-audit`; nothing here is live until that branch is merged and deployed.

Nobody can promise page one or citations by answer engines. This report covers what is in the site's control and lists, at the end, what only the owner can do. The owner list matters as much as the code: links from other sites, a Google Business Profile and real reviews are what move a new domain. The site cannot supply those itself.

## Summary

| Area | Before (live) | After (this branch) |
| --- | --- | --- |
| `www.corincommercial.com` | 200, a full duplicate | 301 to the same path and query on `corincommercial.com` |
| `kubera-tau.vercel.app` and the server's bare IP | 200, indexable; robots.txt allows all | `X-Robots-Tag: noindex`; robots.txt `Disallow: /` |
| Pages sent `Cache-Control: private, no-store` | 60 of 79 (every `[slug]` page) on most visits, plus every page for Bingbot, Applebot and others | none; the cached static page is always served |
| Titles 50 to 60 characters | 24 of 79 (34 under 45) | 74 of 79 (the 4 legal pages are shorter on purpose; `/structures` is 49) |
| Titles that say "California" | 3 | 34 |
| Meta descriptions under 120 characters | 7 | 0 |
| Pages whose og:image is the generic brand card | 79 | 13 (pages without a photo of their own) |
| Pages without BreadcrumbList (other than home) | 7 | 0 |
| Sitemap `<lastmod>` | 5 of 79 | 78 of 79 (`/rates` changes daily), from content history, not the build clock |
| Articles linked only from `/insights` | 2 | 0 |
| `llms.txt` | page list | page list, entity facts, link to the new `llms-full.txt` (full text of programs, FAQs, city guides, articles and glossary) |
| Average HTML per sitemap page | 220 KB (inflated by the private, resumed responses) | 152 KB |

Already in place and verified, not redone: self-canonicals on all 79 pages pointing at `https://corincommercial.com`; robots.txt allowing all crawlers including GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot and Google-Extended, with the sitemap listed; `/llms.txt`; Organization, WebSite, FinancialService, LoanOrCredit, CollectionPage, BreadcrumbList and FAQPage on financing pages; Article with a real author and dates on insights; DefinedTermSet on the glossary; WebApplication on calculators; Service with areaServed on city pages; a branded 404 that returns status 404; every sitemap URL returns 200; no broken internal links or redirect chains (82 internal link targets crawled); every image has alt text and explicit dimensions and is served as WebP/AVIF through `next/image`, with the hero image preloaded; one H1 per page and no skipped heading levels; full-width pages with a photo on every financing page.

## Baseline issues

### 1. www returned 200 instead of redirecting

- Evidence: `curl -I https://www.corincommercial.com/financing?x=1` returned `200 OK` with the full page.
- Fix: `proxy.ts` (this Next.js version's middleware) classifies the request host against `NEXT_PUBLIC_SITE_URL` (`lib/seo/hosts.ts`: `classifyHost`, `aliasRedirect`). The www twin 301s to the same path and query on the canonical host; non-GET methods get 308 so a form POST is not turned into a GET. robots.txt and sitemap.xml are now covered by the proxy matcher, so they redirect on www too.
- Tests: `proxy.test.ts` (301 with path and query, robots.txt and sitemap.xml, 308 for POST, `X-Forwarded-Host` from nginx), `lib/seo/hosts.test.ts`.

### 2. The Vercel copy was an indexable duplicate

- Evidence: `https://kubera-tau.vercel.app/` returned 200 with no `X-Robots-Tag`, and its robots.txt allowed everything.
- Fix: any host that is not the configured site URL, its www twin or the express domain (the Vercel copy, the VPS's bare IP) gets `X-Robots-Tag: noindex, follow` from the proxy and `User-Agent: * / Disallow: /` from `app/robots.ts`. Keyed off the site URL, so local dev and e2e (site URL `http://localhost:3999`) stay indexable and preview deployments stay noindex as before. With no site URL set, local dev on `localhost` is treated as "other" and gets noindex, which is harmless.
- Tests: `lib/seo/robots.test.ts`, `proxy.test.ts`; checked on the production build with `curl -H "Host: kubera-tau.vercel.app"`.
- The cleaner fix is to turn the Vercel project off or redirect it (owner action below).

### 3. Every page shared the generic og:image

- Evidence: all 79 pages had `og:image` = `/opengraph-image`.
- Fix: `scripts/og-images.mjs` crops every photo in `assets/images/` to a 1200x630 JPEG (`public/og/*.jpg`, 50 to 150 KB each). `pageMetadata()` takes the page's `SiteImage` and emits og:image and twitter:image with width, height, type and the photo's alt text (`lib/seo/og.ts`). Financing and structure pages use their own photo; insights, calculators and city pages use the photo of their first related financing page; home, `/about`, `/financing`, `/structures` and `/california` use their hero photo. Pages with no photo (legal, rates, glossary and a few others) keep the brand card. LoanOrCredit, hub CollectionPage and Article markup now carry the same image.
- Tests: `lib/seo/og.test.ts` (every photo has a 1200x630 JPEG under 300 KB; every financing, structure, insight, calculator and city page has a photo with alt text), and `e2e/seo-sitemap.spec.ts` (every page's share image loads).

### 4. Uncacheable, heavier responses on most pages

- Evidence: 60 of 79 sitemap URLs (every `[slug]` route) answered with `Cache-Control: private, no-cache, no-store` and `x-nextjs-postponed: 1`, and about 240 to 260 KB of HTML instead of about 150 KB. Bingbot, Applebot, DuckDuckBot, Google-Extended and link-preview bots got the same treatment on every page (for example `/about`: 218 KB private for Bingbot, 134 KB cached for Googlebot).
- Cause, reproduced with `next build && next start`: two things in code, not the server.
  1. The rates job (`/api/cron/rates`, every 15 minutes on the VPS) expired the `rates` cache tag with `revalidateTag("rates", { expire: 0 })`. The rate ticker in the site layout uses that tag, so every page became stale. On the next visit a `[slug]` page was answered from the route's generic fallback shell plus a per-request resume (Partial Prerendering), marked private and carrying the page body twice. The visit after that was static again, so with low traffic most crawler visits saw the slow version. It was not a fixed date or an RSC payload; it was the tag expiry.
  2. Next renders every request from user agents it calls "HTML-limited" dynamically, so streamed metadata lands in `<head>`. Every public page here is fully prerendered with its metadata already in `<head>`, so that only cost cacheability.
- Fix: `revalidateTag("rates", "max")` (serve the cached page while it regenerates), `export const ensureStatic = "navigation"` on the five `[slug]` routes (a regeneration is a blocking static render, never the fallback shell; the build also now proves these pages are fully static), and `htmlLimitedBots: /(?!)/` in `next.config.ts`. After the fix the first visit after the job is `x-nextjs-cache: STALE` with `s-maxage`, then `HIT`.
- Tests: `e2e/rates-revalidation.spec.ts` now asserts that pages are not private or postponed after the rates job, and that a Bingbot user agent gets a cacheable page with its title in `<head>`.
- One side effect: the rates job stores a snapshot in Supabase right after marking the tag stale, so the stored snapshot can lag one 15-minute cycle. The next run records the fresh one.
- Nothing on the server needs to change for this.

## Full audit

### Technical

| Check | Finding | Action |
| --- | --- | --- |
| Status | All 79 URLs return 200 on the canonical host; unknown URLs return a branded 404 with `noindex` | none needed |
| Canonical / noindex | All 79 self-canonical; no noindex on any sitemap URL. `/track-record` is linked from the footer but is `noindex` and not in the sitemap until real closed transactions can be published, which is correct | none |
| Sitemap | Only canonical 200 URLs, but `<lastmod>` on 5 of 79 | `lib/seo/content-dates.ts` records when each section's content last changed (from repository history). Every URL but `/rates` now has a `<lastmod>`; articles use their own `updated` date. Update the entry when a section's copy changes |
| Titles | All unique, but 34 under 45 characters and only 3 mentioned California | Rewritten (table below). 74 of 79 now render 50 to 60 characters |
| Descriptions | All unique; 7 under 120 characters (6 structures used the card summary) | Structures get their own 148 to 158 character description; `/team`, `/partners` and two calculators expanded |
| H1 / headings | Exactly one H1 per page; no skipped levels | none |
| Internal links | No broken links or redirect chains; no orphans; descriptive anchors (no "click here"); breadcrumbs on every page except home. Two articles had one inbound link | Program, calculator and city pages list "Related reading" (articles that link to them); the licensing page links the RE 882 article |
| Images | Alt text and dimensions on every image; WebP/AVIF via `next/image`; hero preloaded; responsive `srcset` | none |
| HTTP/2 | Lighthouse flags HTTP/1.1 on every page | Server setting (nginx `listen 443 ssl http2`), not changed here; see owner/ops actions |

### Structured data

Every JSON-LD block on all 79 pages was parsed and checked. All were valid. Gaps filled:

- BreadcrumbList added to `/express`, `/partners`, `/newsletter`, `/privacy`, `/terms`, `/licensing` and `/accessibility`.
- CollectionPage with an ItemList added to `/financing`, `/calculators` and `/california`.
- Organization: `areaServed` California and the DRE licensed address when it is configured. The DRE license identifier was already there. `sameAs` is wired to `SAME_AS` in `components/seo/schemas.ts`, which is empty with a TODO because no public profiles are known.
- `/express` (outside the site layout) gains the Organization, FinancialService and WebSite graph.
- LoanOrCredit gains `image` and `areaServed`; Corin stays `broker` and is never `provider`.
- Article image is the article's own photo.
- Nothing invented: no AggregateRating, Review, testimonials or counts. The only named person is the designated officer, who is already on `/team` and is the article author on the live site.

`e2e/seo-sitemap.spec.ts` now enforces this on every sitemap page: each block parses and has `@context`; Organization has its name, logo and license identifier; BreadcrumbList is on every page but home, with positions 1..n and the last item being the page; every FAQPage question and answer is visible on the page; Article has headline, dates, author, image and publisher and its headline is visible; LoanOrCredit has no `provider`; WebApplication and DefinedTermSet have their required fields; and no review or rating markup exists.

### GEO / AEO

- Lead answers: financing, calculator and city pages already open with a definition-first lead. Six ran 32 to 39 words (hotels hub, HUD 221(d)(4), HUD 223(f), multifamily bridge, self-storage, life company); they now say who the loan is for and give typical terms that the page already states. All financing leads are now 40 to 60 words, calculator and city leads 52 to 63.
- Comparison: each financing hub (and hard money, which doubles as a hub) has a "How do these ... programs compare?" table with each program, what it is and its first two key figures, dated with the as-of date.
- Question-shaped headings: every page already has an FAQ (visible, in `<details>`), and the new comparison heading is a question. Section headings were left as they are ("How the 504 stack is built", "What a hotel needs to qualify"); they already read as answers.
- Dates: financing, structure, calculator and city pages show "Updated <date>", the same date as the sitemap `<lastmod>`. Key-facts tables already show "Figures as of".
- Entity facts: `llms.txt` now states where Corin works (California; city guides for Los Angeles, Orange County and the Bay Area), how it is paid (as `/licensing` says) and how to verify the DRE license. `/llms-full.txt` is new: each financing page's definition, dated key figures, sections and FAQ; city guides with their facts and FAQ; calculators; illustrative structures (labelled as not closed transactions); articles with key takeaways; the glossary; and the broker-not-lender and indicative-terms disclosures.
- Authors: articles already name the designated officer as author. No other people were added; `/team` has one member whose bio is still a placeholder (owner action).

### Local (California)

- City pages (`/california/los-angeles`, `/orange-county`, `/bay-area`) target "commercial real estate loans in <city>" in the H1 and now in the title. Their text overlaps by only 13 to 15% (8-word shingles), almost all of it the shared disclosures, so they are local content rather than doorway pages: rent ordinances, licensing, seismic and transfer-tax rules per market.
- Schema: each city page has a Service with `areaServed` naming the places it covers; Organization and FinancialService name California.
- Not done: no street address or phone is published (`NEXT_PUBLIC_DRE_LICENSED_ADDRESS` and `NEXT_PUBLIC_CONTACT_PHONE` are empty in production), so there is no LocalBusiness address markup. See owner actions.

### Performance and accessibility (Lighthouse, mobile)

Lighthouse 12.8.2, mobile form factor, simulated throttling. "Live" is the current site; "local" is `next build && next start` on this machine, run twice so the image cache was warm, for `main` and for this branch.

| Page | Live before (perf / a11y / BP / SEO, LCP) | Local `main` | Local branch |
| --- | --- | --- | --- |
| `/` | 98 / 97 / 100 / 100, LCP 1.2 s | 92 / 97 / 100 / 100, LCP 3.1 s | 92 / 97 / 100 / 100, LCP 3.1 s |
| `/financing` | 100 / 100 / 100 / 100, LCP 1.3 s | 99 / 100 / 100 / 100, LCP 2.0 s | 97 / 100 / 100 / 100, LCP 2.6 s |
| `/financing/hud-232` | 100 / 100 / 100 / 100, LCP 1.2 s | 94 / 100 / 100 / 100, LCP 3.1 s | 97 / 100 / 100 / 100, LCP 2.5 s |
| `/financing/sba-504-hotel` | 100 / 100 / 100 / 100, LCP 1.2 s | 94 / 100 / 100 / 100, LCP 3.0 s | 94 / 100 / 100 / 100, LCP 3.0 s |
| `/financing/hard-money` | 100 / 100 / 100 / 100, LCP 1.2 s | 97 / 100 / 100 / 100, LCP 2.5 s | 97 / 100 / 100 / 100, LCP 2.5 s |
| `/insights/dscr-vs-debt-yield` | 99 / 100 / 96 / 100, LCP 1.1 s | 95 / 100 / 96 / 100, LCP 2.9 s | 94 / 100 / 96 / 100, LCP 3.0 s |
| `/calculators/dscr` | 100 / 100 / 100 / 100, LCP 1.2 s | 96 / 100 / 100 / 100, LCP 2.6 s | 97 / 100 / 100 / 100, LCP 2.4 s |
| `/california/los-angeles` | 93 / 100 / 100 / 100, LCP 1.1 s | 97 / 100 / 100 / 100, LCP 2.5 s | 97 / 100 / 100 / 100, LCP 2.6 s |
What this shows:

- SEO is 100 on every sampled page before and after; accessibility 97 to 100; CLS 0 everywhere.
- Local `main` and the local branch score the same within run-to-run noise (±3 performance points), so the content added here (comparison tables, "Updated" lines, related reading) did not cost performance. The local LCP of 2 to 3 s is Lighthouse's simulated estimate on this machine; the observed LCP element on every page is the lead paragraph, with a time to first byte under 10 ms and a render delay of about 125 ms. Live LCP was 1.1 to 1.3 s.
- The live "before" runs were themselves affected by issue 4: Lighthouse's user agent is on Next's HTML-limited list, so they measured the per-request render. After deploy, re-run against live to get the true "after".
- Remaining Lighthouse flags, none fixed here: HTTP/1.1 (server), unused and legacy JavaScript in the shared client bundles (no single quick win was found), render-blocking CSS (one stylesheet), and on the home page `color-contrast`, which fires on text captured mid fade-in by the scroll-reveal animation (the settled colours pass). The insight page's best-practices 96 is a Chrome "Content security policy" inspector issue with no detail; no CSP violation appears in a normal browser session, and the CSP was left unchanged.

## Not fixed, and why

| Item | Why |
| --- | --- |
| HTTP/2 on nginx | Server configuration; out of scope for this change (no server settings were changed). `ops/vps/nginx-corin.conf` would need `http2` on the TLS listener that certbot adds. |
| Vercel copy still serves the site | It is now noindex with a disallow-all robots.txt. Turning it off or redirecting it to `corincommercial.com` is a Vercel project setting. |
| `sameAs` profiles, address, phone, LocalBusiness | No public profiles are known, and the licensed address and phone are not configured in production. Nothing was invented; `SAME_AS` is empty with a TODO. |
| More authors or reviewers | `/team` lists only the designated officer, with a placeholder bio. No people were added. |
| Reviews, ratings, testimonials, client counts, deal stats | None exist on the site, so none were added. `/track-record` stays noindex until approved records exist. |
| Rewriting section headings as questions on 43 financing pages | Existing headings already read as answers and every page has a visible FAQ; a mass rewrite would add risk to reviewed compliance copy for little gain. |
| Legal page titles (31 to 44 characters) | "Privacy policy · Corin Commercial" is the right title for a legal page. |

## Owner actions

These are the things that most affect ranking and citations, and only the owner can do them.

1. **Deploy this branch** after review, then verify:
   - `curl -I https://www.corincommercial.com/financing?x=1` returns `301` with `Location: https://corincommercial.com/financing?x=1`.
   - `curl -sI https://kubera-tau.vercel.app/ | grep -i x-robots-tag` shows `noindex`, and `https://kubera-tau.vercel.app/robots.txt` shows `Disallow: /`.
   - `curl -sI https://corincommercial.com/financing/hud-232 | grep -i cache-control` shows `s-maxage`, never `private`, including right after the 15-minute rates job and with a Bingbot user agent.
   - Share a financing page URL in Slack or LinkedIn and confirm the page's own photo appears.
   - Re-run Lighthouse (mobile) on the sample pages above for the live "after".
2. **Google Search Console**: add a Domain property for `corincommercial.com` (DNS TXT verification), submit `https://corincommercial.com/sitemap.xml`, then use URL Inspection to request indexing of the home page, `/financing` and the six financing hubs. Check Page indexing a week later for duplicates or "Crawled, currently not indexed".
3. **Bing Webmaster Tools**: import the site from Search Console (or verify with DNS), submit the sitemap, and turn on IndexNow if offered. Bing's index is also used by some AI answer engines.
4. **Vercel copy**: turn off the `kubera-tau` project's production domain, or add a redirect from `kubera-tau.vercel.app` to `https://corincommercial.com`. It is already noindex after this deploy, but removing it is cleaner.
5. **Google Business Profile**: create a profile for Corin Commercial, Inc. as a service-area business (California) using the DRE licensed address, a real phone number and the website. Use the category "Mortgage broker" or "Loan agency" as fits. Do not create one at an address the business does not occupy.
6. **Address and phone on the site**: set `NEXT_PUBLIC_DRE_LICENSED_ADDRESS` and `NEXT_PUBLIC_CONTACT_PHONE` in the production build environment. The site already renders them on `/contact` and `/licensing` and in Organization and FinancialService markup when set, which is needed for local results.
7. **Real reviews**: after closings, ask borrowers to review the Google Business Profile. Do not add review or rating markup to the site for reviews collected elsewhere.
8. **Backlinks and listings** (real ones only), for example: California Mortgage Bankers Association; California Association of Mortgage Professionals; the National Association of Mortgage Brokers; local chambers of commerce (Los Angeles, Orange County, San Francisco); senior-living and hotel industry groups such as the California Assisted Living Association, Argentum, the California Hotel & Lodging Association and AAHOA as a vendor or member where eligible; CDC partners for SBA 504; HUD 232 and HUD multifamily lender partner pages; and the DRE license lookup itself. Guest articles or quotes in industry publications that link to the insights pages help both search and answer engines.
9. **Social profiles for `sameAs`**: create (or share the URLs of) a LinkedIn company page and any other profiles the firm controls, then add them to `SAME_AS` in `components/seo/schemas.ts`. LinkedIn is the most useful for a commercial lending broker.
10. **Team**: replace the placeholder bio on `/team` with one Neeli Khanna writes or approves, set `NEXT_PUBLIC_DRE_OFFICER_LICENSE`, and add other licensed advisors as they join. Named, licensed people help answer engines trust the content.
11. **Track record**: when closed transactions are approved for publication, `/track-record` stops being noindex automatically; add it to the sitemap then.
12. **Keep dates honest**: when a section's copy changes, update its entry in `lib/seo/content-dates.ts` in the same change, and bump an article's `updated` date when it is revised.
13. **Ops**: enable HTTP/2 on the nginx TLS listener.

## Title changes

Rendered `<title>` before and after (characters in brackets). The brand suffix " · Corin Commercial" is omitted from both columns except on the home page.

| Page | Before | After |
| --- | --- | --- |
| `/` | Corin Commercial \| Commercial Real Estate Loan Broker (53) | Corin Commercial \| California Commercial Real Estate Loans (58) |
| `/express` | 60-second deal qualifier (43) | 60-second commercial loan deal qualifier (59) |
| `/partners` | Partner portal (33) | Lender, broker and vendor partner portal (59) |
| `/financing` | Financing programs (37) | Commercial real estate financing programs (60) |
| `/financing/senior-living` | Senior living financing (42) | Senior living financing in California (56) |
| `/financing/hotels` | Hotel financing (34) | Hotel loans in California: SBA, CMBS, PIP (60) |
| `/financing/multifamily` | Multifamily financing (40) | Multifamily loans in California (50) |
| `/financing/commercial` | Commercial property financing (48) | Commercial property loans in California (58) |
| `/financing/construction` | Construction financing (41) | Construction financing in California (55) |
| `/financing/hud-232` | HUD 232 senior housing loans (47) | HUD 232 senior living loans in California (60) |
| `/financing/assisted-living` | Assisted living facility loans (49) | Assisted living loans in California (54) |
| `/financing/rcfe` | California RCFE loans (40) | RCFE loans for California care homes (55) |
| `/financing/memory-care` | Memory care facility financing (49) | Memory care facility loans in California (59) |
| `/financing/skilled-nursing` | Skilled nursing facility loans (49) | Skilled nursing loans in California (54) |
| `/financing/sba-504-hotel` | SBA 504 hotel loans (38) | SBA 504 hotel loans in California (52) |
| `/financing/sba-7a-504-hotel-stack` | SBA 7(a) + 504 hotel stack (45) | SBA 7(a) + 504 hotel loan stack (50) |
| `/financing/hotel-cmbs` | Hotel CMBS loans (35) | Hotel CMBS conduit loans in California (57) |
| `/financing/pip-bridge` | Hotel PIP bridge loans (41) | Hotel PIP bridge loans in California (55) |
| `/financing/fannie-mae-multifamily` | Fannie Mae multifamily loans (47) | Fannie Mae apartment loans in California (59) |
| `/financing/freddie-mac-multifamily` | Freddie Mac multifamily loans (48) | Freddie Mac apartment loans in California (60) |
| `/financing/multifamily-bridge` | Multifamily bridge loans (43) | Multifamily bridge loans in California (57) |
| `/financing/dscr-investor` | DSCR investor loans (38) | DSCR rental property loans in California (59) |
| `/financing/office-loans` | Office building loans (40) | Office building loans in California (54) |
| `/financing/industrial-loans` | Industrial and warehouse loans (49) | Industrial property loans in California (58) |
| `/financing/retail-loans` | Retail property loans (40) | Retail property loans in California (54) |
| `/financing/self-storage-loans` | Self-storage loans (37) | Self-storage loans in California (51) |
| `/financing/medical-office-loans` | Medical office building loans (48) | Medical office loans in California (53) |
| `/financing/mixed-use-loans` | Mixed-use property loans (43) | Mixed-use property loans in California (57) |
| `/financing/mobile-home-park-loans` | Mobile home park and MHC loans (49) | Mobile home park loans in California (55) |
| `/financing/mezzanine-preferred-equity` | Mezzanine and preferred equity (49) | Mezzanine loans and preferred equity (55) |
| `/financing/life-company-loans` | Life insurance company loans (47) | Life insurance company commercial loans (58) |
| `/financing/cmbs-loans` | CMBS conduit loans (37) | CMBS conduit loans in California (51) |
| `/financing/debt-fund-bridge-loans` | Debt fund bridge loans (41) | Debt fund bridge loans in California (55) |
| `/financing/construction-loans` | Commercial construction loans (48) | Ground-up commercial construction loans (58) |
| `/financing/c-pace` | C-PACE commercial financing (46) | California C-PACE commercial financing (57) |
| `/financing/hard-money` | Hard money and bridge loans (46) | Hard money and bridge loans in California (60) |
| `/financing/fix-and-flip` | Fix-and-flip loans (37) | Fix-and-flip loans in California (51) |
| `/financing/private-bridge` | Private bridge loans (39) | Private bridge loans in California (53) |
| `/about` | About us (27) | About us: licensed California loan broker (60) |
| `/team` | Our advisors (31) | Our licensed commercial loan advisors (56) |
| `/contact` | Contact (26) | Contact a commercial loan advisor (52) |
| `/insights` | Insights (27) | Commercial real estate loan insights (55) |
| `/calculators` | Commercial loan calculators (46) | Commercial real estate loan calculators (58) |
| `/calculators/dscr` | DSCR calculator (34) | DSCR calculator for commercial loans (55) |
| `/calculators/hud-mip` | HUD MIP calculator (37) | HUD mortgage insurance (MIP) calculator (58) |
| `/calculators/sba-504` | SBA 504 calculator (37) | SBA 504 loan and debenture calculator (56) |
| `/calculators/hotel-debt-yield` | Hotel debt yield calculator (46) | Hotel debt yield and loan size calculator (60) |
| `/california/los-angeles` | Los Angeles commercial loans (47) | Los Angeles commercial real estate loans (59) |
| `/california/orange-county` | Orange County commercial loans (49) | Orange County commercial property loans (58) |
| `/california/bay-area` | Bay Area commercial loans (44) | Bay Area commercial real estate loans (56) |
| `/newsletter` | Newsletter (29) | Commercial real estate debt newsletter (57) |

## Description changes

| Page | Before (characters) | After |
| --- | --- | --- |
| `/partners` | 102 | 151 |
| `/team` | 108 | 156 |
| `/structures/assisted-living-sba-504-refinance` | 94 | 158 |
| `/structures/flagged-hotel-sba-504-green-pip` | 96 | 155 |
| `/structures/memory-care-bridge-to-hud` | 96 | 149 |
| `/structures/hotel-to-assisted-living-conversion-bridge` | 94 | 148 |
| `/structures/multifamily-construction-bank-cpace` | 122 | 155 |
| `/structures/investor-rehab-hard-money` | 119 | 148 |
| `/calculators/dscr` | 127 | 149 |
| `/calculators/hud-mip` | 139 | 156 |

## Changed files

- Hosts: `proxy.ts`, `lib/seo/hosts.ts`, `lib/seo/robots.ts` (+ `proxy.test.ts`, `lib/seo/hosts.test.ts`, `lib/seo/robots.test.ts`)
- Caching: `app/api/cron/rates/route.ts`, `next.config.ts`, the five `[slug]` pages (+ `e2e/rates-revalidation.spec.ts`)
- Share images: `scripts/og-images.mjs`, `public/og/`, `lib/seo/og.ts`, `lib/seo/metadata.ts`, page metadata calls (+ `lib/seo/og.test.ts`)
- Titles and descriptions: `content/programs/*`, `content/trust-pages.ts`, `content/calculators.ts`, `content/markets/california.ts`, `content/insights/index.ts`, `content/newsletter.ts`, `content/deal-structures.ts`, home, `/financing`, `/partners`, `/express`
- Structured data: `components/seo/schemas.ts`, `components/program/schema.ts`, `lib/growth/schemas.ts`, `components/insights/InsightPage.tsx`, `components/legal/LegalPage.tsx`, hub and legal pages
- Content and dates: `components/program/ProgramPage.tsx` (comparison table), `components/seo/UpdatedLine.tsx`, `lib/seo/content-dates.ts`, `lib/seo/sitemap-routes.ts`
- Internal links: `components/insights/RelatedInsights.tsx`, `content/insights/index.ts`, licensing page
- llms: `lib/seo/llms.ts`, `app/llms-full.txt/route.ts`
- Whole-site check: `e2e/seo-sitemap.spec.ts`

Checks run before pushing: `npm run typecheck`, `npm run lint`, `npm test` (280 files, 4,172 tests) and the full Playwright suite (374 tests, including `e2e/layout-width.spec.ts`, `e2e/rates-revalidation.spec.ts` and the new `e2e/seo-sitemap.spec.ts`), all passing.
