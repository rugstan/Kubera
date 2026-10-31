import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AI_NOTICE_HREF, AiUseNotice, aiUseNoticeText, type AiUseContext } from "./AiUseNotice";
import { REQUEST_OPTIONS } from "./PrivacyRequestForm";
import { PRIVACY_REQUEST_TYPES } from "@/lib/privacy/requests";

const root = path.resolve(import.meta.dirname, "../..");
const FILES = ["components/privacy/AiUseNotice.tsx", "components/privacy/PrivacyRequestForm.tsx", "app/(site)/(legal)/privacy/ai/page.tsx"];

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

describe("AI use notice", () => {
  it.each<AiUseContext>(["chat", "qualifier", "documents"])("%s variant links to /privacy/ai and states advisor review or limits", (context) => {
    const html = renderToStaticMarkup(createElement(AiUseNotice, { context }));
    expect(html).toContain(`href="${AI_NOTICE_HREF}"`);
    expect(html).toContain('role="note"');
    expect(html).toContain("opens in a new tab");
    expect(aiUseNoticeText(context).length).toBeGreaterThan(40);
  });

  it("chat variant discloses that Kubera AI is not a person and that it makes no credit decisions", () => {
    const text = aiUseNoticeText("chat");
    expect(text).toMatch(/AI assistant, not a person/);
    expect(text).toMatch(/not a loan offer, a credit decision/);
    expect(text).toMatch(/advisor reviews/);
  });

  it("can render without the new-tab link", () => {
    expect(renderToStaticMarkup(createElement(AiUseNotice, { context: "qualifier", newTab: false }))).not.toContain("_blank");
  });
});

describe("privacy request form", () => {
  it("offers every request type the API accepts", () => {
    expect(REQUEST_OPTIONS.map((o) => o.value).sort()).toEqual([...PRIVACY_REQUEST_TYPES].sort());
  });
});

describe("copy guard", () => {
  it.each(FILES)("%s contains no forbidden claims", (file) => {
    const src = readFileSync(path.join(root, file), "utf8");
    for (const re of FORBIDDEN) expect(src, `${file} ${re}`).not.toMatch(re);
  });

  it("the AI page shows the draft notice through LegalPage and links to the privacy policy", () => {
    const src = readFileSync(path.join(root, "app/(site)/(legal)/privacy/ai/page.tsx"), "utf8");
    expect(src).toMatch(/<LegalPage/);
    expect(src).toMatch(/href="\/privacy"/);
    expect(src).toMatch(/advisor-led and AI-assisted/);
  });
});
