import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_NOTICE_HREF, AiUseNotice, aiUseNoticeText, type AiUseContext } from "./AiUseNotice";
import { REQUEST_OPTIONS } from "./PrivacyRequestForm";
import { PRIVACY_REQUEST_TYPES } from "@/lib/privacy/requests";

const root = path.resolve(import.meta.dirname, "../..");
const FILES = ["components/privacy/AiUseNotice.tsx", "components/privacy/PrivacyRequestForm.tsx", "app/(site)/(legal)/privacy/page.tsx"];

// Same claims the site-wide copy guard forbids (Global rule 4).
const FORBIDDEN = [
  /\bautonomous\b/i,
  /\bpre-?approved\b/i,
  /\b(?:you(?:'|&apos;)?re|you are|is|are|been|get|getting)\s+approved\b/i,
  /\bqualified for\b/i,
  /\bfees?\s+(?:are\s+)?protected\b/i,
  /\bwill call you today\b/i,
  /\bguaranteed? (?:closing|approval|rate|terms?)\b/i,
  /\bis (?:usury[- ])?exempt\b/i,
];

describe("automated tools notice", () => {
  it.each<AiUseContext>(["qualifier", "documents"])("%s variant links to /privacy#automated-tools and states advisor review or limits", (context) => {
    const html = renderToStaticMarkup(createElement(AiUseNotice, { context }));
    expect(AI_NOTICE_HREF).toBe("/privacy#automated-tools");
    expect(html).toContain(`href="${AI_NOTICE_HREF}"`);
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="How we use automated tools"');
    expect(html).toContain(`data-automated-tools-notice="${context}"`);
    expect(html).toContain("opens in a new tab");
    expect(aiUseNoticeText(context).length).toBeGreaterThan(40);
  });

  it("qualifier variant says an advisor reviews every request and lenders decide credit", () => {
    const text = aiUseNoticeText("qualifier");
    expect(text).toMatch(/licensed advisor reviews every request/);
    expect(text).toMatch(/lenders make all credit decisions/);
  });

  it("documents variant says providers may not train on the files", () => {
    expect(aiUseNoticeText("documents")).toMatch(/may not use your files to train their products/);
  });

  it("never mentions AI", () => {
    for (const context of ["qualifier", "documents"] as const) {
      const html = renderToStaticMarkup(createElement(AiUseNotice, { context }));
      expect(html).not.toMatch(/\bAI\b/);
      expect(aiUseNoticeText(context)).not.toMatch(/\bAI\b/);
    }
  });

  it("can render without the new-tab link", () => {
    expect(renderToStaticMarkup(createElement(AiUseNotice, { context: "qualifier", newTab: false }))).not.toContain("_blank");
  });
});

describe("privacy request form", () => {
  it("offers every request type the API accepts", () => {
    expect(REQUEST_OPTIONS.map((o) => o.value).sort()).toEqual([...PRIVACY_REQUEST_TYPES].sort());
  });

  it("keeps advisor-only handling, described without naming the tools", () => {
    const option = REQUEST_OPTIONS.find((o) => o.value === "human_review");
    expect(option?.label).toBe("Advisor-only handling");
    expect(option?.hint).toMatch(/without automated scoring/);
    expect(option?.hint).not.toMatch(/\bAI\b/);
  });
});

describe("copy guard", () => {
  it.each(FILES)("%s contains no forbidden claims", (file) => {
    const src = readFileSync(path.join(root, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} ${re}`).not.toMatch(re);
  });

  it("the privacy policy shows the draft notice through LegalPage and hosts the request form", () => {
    const src = readFileSync(path.join(root, "app/(site)/(legal)/privacy/page.tsx"), "utf8");
    expect(src).toMatch(/<LegalPage/);
    expect(src).toMatch(/<PrivacyRequestForm /);
  });

  it("the separate AI-use page is gone and its old address redirects to the policy", () => {
    expect(existsSync(path.join(root, "app/(site)/(legal)/privacy/ai"))).toBe(false);
    expect(readFileSync(path.join(root, "next.config.ts"), "utf8")).toMatch(/source: "\/privacy\/ai", destination: "\/privacy", permanent: true/);
  });
});
