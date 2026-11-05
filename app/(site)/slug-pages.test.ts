import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every prerendered dynamic page (one with generateStaticParams) that awaits
// `params` outside <Suspense> must export `instant = false`. Without it, the
// first visit after the rates job expires the "rates" cache tag returns 500
// (NEXT_STATIC_GEN_BAILOUT), and it keeps doing so. See e2e/rates-revalidation.spec.ts.

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

const root = path.resolve(import.meta.dirname, "..");
const prerenderedDynamic = pages(root).filter((f) => /\[[^\]]+\]/.test(path.relative(root, f)) && /export (async )?function generateStaticParams/.test(readFileSync(f, "utf8")));

describe("prerendered dynamic pages", () => {
  it("covers the public [slug] pages", () => {
    const names = prerenderedDynamic.map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
    expect(names).toEqual(expect.arrayContaining(["(site)/calculators/[slug]/page.tsx", "(site)/california/[slug]/page.tsx", "(site)/financing/[slug]/page.tsx", "(site)/insights/[slug]/page.tsx", "(site)/structures/[slug]/page.tsx"]));
  });

  it.each(prerenderedDynamic.map((f) => [path.relative(root, f), f]))("%s may block on its params (instant = false)", (_name, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/^export const instant = false;$/m);
  });
});
