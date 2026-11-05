import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "./llms";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH, pageMetadata, renderedTitle } from "./metadata";

// Keep in sync with the metadata exports in app/(site)/page.tsx, partners/page.tsx and express/page.tsx.
const PAGES = [
  { title: "Commercial real estate loan broker", absoluteTitle: "Corin Commercial | Commercial Real Estate Loan Broker", path: "/" },
  { title: "60-second deal qualifier", path: "/express" },
  { title: "Partner portal", path: "/partners" },
];

describe("pageMetadata", () => {
  it("renders titles within 60 characters", () => {
    for (const p of PAGES) expect(renderedTitle(p).length, renderedTitle(p)).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it("uses one self-referencing canonical that matches openGraph.url", () => {
    for (const p of PAGES) {
      const m = pageMetadata({ ...p, description: "Description." });
      expect(m.alternates?.canonical).toMatch(/^https?:\/\//);
      expect((m.openGraph as { url: string }).url).toBe(m.alternates?.canonical);
    }
    expect(pageMetadata({ title: "x", description: "d", path: "/express" }).alternates?.canonical).toBe("https://corincommercial.com/express");
  });

  it("attaches the share image to openGraph and twitter", () => {
    const m = pageMetadata({ title: "t", description: "d", path: "/x" });
    expect((m.openGraph as { images: { url: string }[] }).images[0]!.url).toBe("/opengraph-image");
    expect((m.twitter as { images: { url: string }[] }).images[0]!.url).toBe("/opengraph-image");
  });

  it("uses an absolute title without the template when requested", () => {
    expect(pageMetadata({ title: "t", absoluteTitle: "Abs", description: "d", path: "/" }).title).toEqual({ absolute: "Abs" });
    expect(pageMetadata({ title: "t", description: "d", path: "/x" }).title).toBe("t");
  });

  it("keeps descriptions short enough for search snippets", () => {
    const d =
      "Licensed California broker arranging HUD, SBA, CMBS, agency, construction, bridge and hard money loans for senior living, hotels and multifamily. Not a lender.";
    expect(d.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });
});

describe("llms.txt", () => {
  const text = buildLlmsTxt();

  it("follows the llms.txt shape: H1 then blockquote", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Corin Commercial");
    expect(lines[2]).toMatch(/^> /);
  });

  it("states broker-not-lender and avoids prohibited claims", () => {
    expect(text).toMatch(/broker, not a lender/);
    expect(text).toContain("Real estate broker, California Department of Real Estate");
    expect(text).not.toMatch(/autonomous|guarantee[sd]? |pre-?approved|usury[- ]exempt/i);
  });

  it("does not mention AI", () => {
    expect(text).not.toMatch(/\bAI\b/);
    expect(text).toMatch(/construction and hard money/);
  });

  it("links the sitemap and the qualifier with absolute urls", () => {
    expect(text).toMatch(/\]\(https?:\/\/[^)]+\/sitemap\.xml\)/);
    expect(text).toMatch(/\]\(https?:\/\/[^)]+\/express\)/);
  });
});
