import { expect, test, type APIRequestContext } from "@playwright/test";

// Every URL in the sitemap, checked the way a crawler and a rich-result
// validator would see it: status, canonical, robots, one H1, title and meta
// description length and uniqueness, the share image, and every JSON-LD block
// (parses, has the properties its type needs, matches what is on the page).

type Page = { path: string; loc: string; html: string; headers: Record<string, string> };
type Node = Record<string, unknown>;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** Whitespace-insensitive containment, since inline tags add spaces ("( ADR )"). Keeps failure output short. */
const squash = (s: string) => s.replace(/\s+/g, "");
const shows = (visible: string, text: string, what: string) => expect(squash(visible).includes(squash(text)), what).toBe(true);
const head = (html: string) => html.slice(0, html.indexOf("</head>"));
const meta = (html: string, attr: "name" | "property", key: string) => {
  const tag = head(html).match(new RegExp(`<meta [^>]*${attr}="${key.replace(/[:]/g, "\\$&")}"[^>]*>`));
  return tag ? decode(tag[0].match(/content="([^"]*)"/)?.[1] ?? "") : null;
};
const flatten = (x: unknown): Node[] => (Array.isArray(x) ? x.flatMap(flatten) : x && typeof x === "object" ? ((x as Node)["@graph"] ? flatten((x as Node)["@graph"]) : [x as Node]) : []);
const types = (n: Node) => [n["@type"]].flat() as string[];

async function loadSitemapPages(request: APIRequestContext): Promise<Page[]> {
  const xml = await (await request.get("/sitemap.xml")).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const pages: Page[] = [];
  for (const loc of locs) {
    const path = new URL(loc).pathname;
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), `${path} status`).toBe(200);
    pages.push({ path, loc, html: await res.text(), headers: res.headers() });
  }
  return pages;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let pages: Page[] = [];
test.beforeAll(async ({ request }) => {
  pages = await loadSitemapPages(request);
});

test("the sitemap lists only indexable, self-canonical pages", async () => {
  expect(pages.length).toBeGreaterThan(70);
  for (const p of pages) {
    expect(p.headers["x-robots-tag"] ?? "", `${p.path} X-Robots-Tag`).not.toMatch(/noindex/);
    expect(meta(p.html, "name", "robots") ?? "", `${p.path} meta robots`).not.toMatch(/noindex/);
    const canonical = head(p.html).match(/<link [^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
    expect(canonical && new URL(canonical).href, `${p.path} canonical`).toBe(new URL(p.loc).href);
  }
});

test("titles and descriptions are unique and sized for search snippets", async () => {
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const p of pages) {
    const title = decode(head(p.html).match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
    const description = meta(p.html, "name", "description") ?? "";
    expect(title.length, `${p.path} title "${title}"`).toBeGreaterThanOrEqual(25);
    expect(title.length, `${p.path} title "${title}"`).toBeLessThanOrEqual(60);
    expect(description.length, `${p.path} description`).toBeGreaterThanOrEqual(80);
    expect(description.length, `${p.path} description`).toBeLessThanOrEqual(160);
    expect(titles.get(title), `${p.path} repeats the title of ${titles.get(title)}`).toBeUndefined();
    expect(descriptions.get(description), `${p.path} repeats the description of ${descriptions.get(description)}`).toBeUndefined();
    titles.set(title, p.path);
    descriptions.set(description, p.path);
  }
});

test("every page has exactly one H1", async () => {
  for (const p of pages) {
    const body = p.html.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(body.match(/<h1[\s>]/g)?.length ?? 0, p.path).toBe(1);
  }
});

test("every page has a 1200x630 share image with alt text that loads", async ({ request }) => {
  const checked = new Set<string>();
  for (const p of pages) {
    const og = meta(p.html, "property", "og:image");
    expect(og, `${p.path} og:image`).toBeTruthy();
    expect(meta(p.html, "property", "og:image:width"), p.path).toBe("1200");
    expect(meta(p.html, "property", "og:image:height"), p.path).toBe("630");
    expect(meta(p.html, "property", "og:image:alt")?.length ?? 0, `${p.path} og:image:alt`).toBeGreaterThan(10);
    expect(meta(p.html, "name", "twitter:image"), `${p.path} twitter:image`).toBe(og);
    const path = new URL(og!).pathname;
    if (checked.has(path)) continue;
    checked.add(path);
    const res = await request.get(path);
    expect(res.status(), `${p.path} share image ${path}`).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(/^image\//);
  }
  // Pages with their own photo use it, not the brand card.
  for (const p of pages.filter((x) => /^\/(financing|structures|insights|calculators|california)\/[^/]+$/.test(x.path))) {
    expect(meta(p.html, "property", "og:image"), p.path).toMatch(/\/og\/[a-z0-9-]+\.jpg$/);
  }
});

test("every JSON-LD block is valid and matches the page", async () => {
  for (const p of pages) {
    const blocks = [...p.html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(blocks.length, `${p.path} has JSON-LD`).toBeGreaterThan(0);
    const roots = blocks.map((b) => {
      try {
        return JSON.parse(b) as unknown;
      } catch (e) {
        throw new Error(`${p.path}: JSON-LD does not parse: ${String(e)}`);
      }
    });
    for (const root of roots.flat()) expect((root as Node)["@context"], `${p.path} @context`).toBe("https://schema.org");
    const nodes = roots.flatMap(flatten);
    const visible = textOf(p.html);
    const ofType = (t: string) => nodes.filter((n) => types(n).includes(t));

    for (const n of nodes) {
      expect(n["@type"], `${p.path} node without @type`).toBeTruthy();
      // Nothing that would need real reviews or ratings.
      expect(types(n), p.path).not.toEqual(expect.arrayContaining(["AggregateRating", "Review"]));
      expect(n, p.path).not.toHaveProperty("aggregateRating");
      expect(n, p.path).not.toHaveProperty("review");
    }

    const org = ofType("Organization")[0];
    expect(org, `${p.path} Organization`).toBeTruthy();
    expect(org).toMatchObject({ name: "Corin Commercial", legalName: "Corin Commercial, Inc." });
    expect(org!.logo, p.path).toBeTruthy();
    expect((org!.identifier as Node)?.propertyID).toBe("California DRE corporate license");

    // Breadcrumbs everywhere but the home page: positions 1..n, absolute URLs, last item is this page.
    const crumbs = ofType("BreadcrumbList");
    if (p.path !== "/") {
      expect(crumbs.length, `${p.path} BreadcrumbList`).toBe(1);
      const items = crumbs[0]!.itemListElement as Node[];
      expect(items.length, p.path).toBeGreaterThanOrEqual(2);
      items.forEach((it, i) => {
        expect(it.position, p.path).toBe(i + 1);
        expect(String(it.item), p.path).toMatch(/^https?:\/\//);
        expect(String(it.name).length, p.path).toBeGreaterThan(0);
      });
      expect(new URL(String(items.at(-1)!.item)).pathname.replace(/\/$/, "") || "/", p.path).toBe(p.path);
    }

    // FAQPage only where every question and answer is on the page.
    for (const faq of ofType("FAQPage")) {
      const qs = faq.mainEntity as Node[];
      expect(qs.length, p.path).toBeGreaterThan(0);
      for (const q of qs) {
        shows(visible, String(q.name), `${p.path} FAQ question not visible: ${String(q.name)}`);
        shows(visible, String((q.acceptedAnswer as Node).text), `${p.path} FAQ answer not visible: ${String(q.name)}`);
      }
    }

    for (const a of ofType("Article")) {
      for (const key of ["headline", "datePublished", "dateModified", "author", "image", "publisher"]) expect(a[key], `${p.path} Article.${key}`).toBeTruthy();
      shows(visible, String(a.headline), `${p.path} headline`);
      expect(String(a.dateModified) >= String(a.datePublished), p.path).toBe(true);
    }

    for (const loan of ofType("LoanOrCredit")) {
      for (const key of ["name", "url", "description", "broker"]) expect(loan[key], `${p.path} LoanOrCredit.${key}`).toBeTruthy();
      // A broker is never presented as the lender.
      expect(loan, p.path).not.toHaveProperty("provider");
      shows(visible, String(loan.name), `${p.path} loan name`);
    }

    for (const app of ofType("WebApplication")) {
      for (const key of ["name", "url", "applicationCategory"]) expect(app[key], `${p.path} WebApplication.${key}`).toBeTruthy();
    }

    for (const set of ofType("DefinedTermSet")) {
      const terms = set.hasDefinedTerm as Node[];
      expect(terms.length, p.path).toBeGreaterThan(10);
      for (const t of terms) shows(visible, String(t.name), `${p.path} term ${String(t.name)}`);
    }
  }
});
