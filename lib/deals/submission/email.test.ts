import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { licenseLine } from "@/lib/site";
import { PackageCopyError, dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import { lenderInput, toPanelEntry } from "../test-fixtures";
import { EMAIL_TEMPLATE_VERSION, buildLenderEmail, emailLenderFrom, emailSha256, fillEmailPlaceholders, formatPhone, lenderEmailFacts, renderLenderEmail, type LenderEmailInput } from "./email";
import { playbookLoanTypes } from "./playbooks";
import { evaluateReadiness } from "./readiness";
import { EmailSafetyError } from "./redaction";
import { lenderFit, tailorDealFrom } from "./tailor";
import { computeSubmissionMetrics } from "./metrics";
import { buildDealSummary } from "./summary";
import { emptyProfileContext, submissionFixture } from "./test-fixtures";
import { EMAIL_PLACEHOLDERS, submissionPlaybooks, type SubmissionContext, type SubmissionPlaybook, type TargetStage } from "./types";

const GOLDEN_DIR = path.join(__dirname, "__golden__");
const LICENSE_LINE_TOKEN = "{licenseLine()}";
const ADVISOR = { name: "Ana Ruiz", title: "Senior Advisor", dreLicense: "01234567", email: "ana@corincommercial.com", phone: "(415) 555-0100" };

export function goldenLender(playbook: SubmissionPlaybook) {
  return toPanelEntry(
    lenderInput({ name: "Harborline Capital", programs: ["PRIVATE_BRIDGE", "HARD_MONEY", "CONSTRUCTION", "BANK_LIFE_CO", "SBA_7A", "SBA_504", "HUD_232", "HUD_MULTIFAMILY", "AGENCY", "HOTEL_CMBS", "PIP_BRIDGE"], loanTypes: [...playbookLoanTypes[playbook]], minLoanCents: 50_000_000, maxLoanCents: 5_000_000_000, states: ["CA", "AZ"], assetTypes: [] }),
    "lender-golden",
    [{ id: "contact-1", fullName: "Dana Whitfield", email: "dana@harborline.example", isPrimary: true, status: "active" }],
  );
}

function input(ctx: SubmissionContext, stage: TargetStage = "term_sheet", over: Partial<LenderEmailInput> = {}): LenderEmailInput {
  const metrics = computeSubmissionMetrics(ctx);
  const panel = goldenLender(ctx.profile?.playbook ?? "bridge");
  const readiness = evaluateReadiness(ctx, metrics, stage);
  return {
    ctx,
    metrics,
    stage,
    lender: emailLenderFrom(panel),
    fit: lenderFit(panel, [], tailorDealFrom(ctx), metrics.metrics),
    documents: [dealSummaryPackageItem(ctx.deal.id, "ab".repeat(32)), ...ctx.vaultDocuments.map((d) => ({ documentId: d.id, label: d.fileName, kind: d.kind }))],
    notYetInHand: readiness.required.filter((i) => !i.met).map((i) => i.label),
    advisor: ADVISOR,
    ...over,
  };
}

describe("lender email golden files", () => {
  it.each(submissionPlaybooks.map((p) => [p] as const))("%s", (playbook) => {
    const email = buildLenderEmail(input(submissionFixture(playbook)));
    // The licence line depends on NEXT_PUBLIC_DRE_* (CI sets a placeholder), so the
    // golden files hold a token; the test below checks the real line is present.
    expect(email.text).toContain(licenseLine());
    const rendered = `Subject: ${email.subject}\n\n${email.text}`.replace(licenseLine(), LICENSE_LINE_TOKEN);
    const file = path.join(GOLDEN_DIR, `${playbook}.txt`);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(file, rendered);
    }
    expect(rendered).toBe(readFileSync(file, "utf8"));
    expect(email.sha256).toBe(emailSha256(email.subject, email.text));
  });

  it("pins the template version", () => {
    expect(EMAIL_TEMPLATE_VERSION).toBe("lender-email-v1");
  });
});

describe("buildLenderEmail", () => {
  it("leads with the ask, says Corin is the broker, and carries the placeholders and the license line", () => {
    const { subject, text } = buildLenderEmail(input(submissionFixture("bridge"), "screen"));
    expect(subject).toBe("Loan request: $8,400,000 bridge | 42-unit multifamily, Oakland CA | 68% LTV, 0.96x DSCR | Corin Commercial");
    expect(text.startsWith("Dana,\n\nCorin Commercial, Inc. is the broker on this request, not the lender. We are asking Harborline Capital for a soft quote")).toBe(true);
    expect(text).toContain(`(expires ${EMAIL_PLACEHOLDERS.linkExpires}):\n${EMAIL_PLACEHOLDERS.shareLink}\n`);
    expect(text).toMatch(/Real estate broker, California Department of Real Estate/);
    expect(text).toContain("an assumption, not a quote");
    expect(buildLenderEmail(input(submissionFixture("bridge"), "underwrite")).text).toContain("for full underwriting on the loan below");
  });

  it("is deterministic", () => {
    const a = buildLenderEmail(input(submissionFixture("cmbs")));
    const b = buildLenderEmail(input(submissionFixture("cmbs")));
    expect(b).toEqual(a);
  });

  it("states the fit and every exception from LenderFit", () => {
    const ctx = submissionFixture("bridge");
    const fit = { lenderId: "lender-golden", matches: ["Bridge"], exceptions: ["LTV 68% vs 65% maximum", "CA is outside your recorded states (AZ)"], unknown: [], staleness: { stale: false, ageDays: 10, reason: null }, score: null };
    const { text } = buildLenderEmail(input(ctx, "screen", { fit }));
    expect(text).toContain("Your recorded box: Bridge, $500K–$50M, CA and AZ. This request: Bridge, $8.4M, CA.");
    expect(text).toContain("Outside your recorded box: LTV 68% vs 65% maximum; CA is outside your recorded states (AZ).");
    const clean = buildLenderEmail(input(ctx, "screen")).text;
    expect(clean).not.toContain("Outside your recorded box");
  });

  it("greets with Hello when no contact is named and tailors only the greeting, fit and name", () => {
    const ctx = submissionFixture("bridge");
    const a = input(ctx);
    const b = { ...a, lender: { ...a.lender, name: "Northgate Bank", contactFirstName: null } };
    const ta = buildLenderEmail(a).text;
    const tb = buildLenderEmail(b).text;
    expect(tb.startsWith("Hello,\n")).toBe(true);
    const strip = (t: string, name: string, greet: string) => t.replace(greet, "").split(name).join("LENDER");
    expect(strip(tb, "Northgate Bank", "Hello,")).toBe(strip(ta, "Harborline Capital", "Dana,"));
  });

  it("drops a missing metric from the subject and its line from the body", () => {
    const ctx = submissionFixture("bridge");
    ctx.profile!.assumedRatePct = null;
    const { subject, text } = buildLenderEmail(input(ctx));
    expect(subject).toBe("Loan request: $8,400,000 bridge | 42-unit multifamily, Oakland CA | 68% LTV | Corin Commercial");
    expect(text).not.toMatch(/^\s+DSCR:/m);
    ctx.profile!.asIsValueCents = null;
    ctx.profile!.purchasePriceCents = null;
    const none = buildLenderEmail(input(ctx));
    expect(none.subject).toBe("Loan request: $8,400,000 bridge | 42-unit multifamily, Oakland CA | Corin Commercial");
  });

  it("fabricates no figure for an empty profile: no N/A, no digits beyond the template's own", () => {
    for (const playbook of submissionPlaybooks) {
      const ctx = emptyProfileContext(playbook);
      const { subject, text } = buildLenderEmail(input(ctx, "screen", { documents: [], notYetInHand: [] }));
      expect(subject).toMatch(/^Loan request: [^|$\d]+ \| Corin Commercial$|^Loan request: SBA \d\(a\) \| Corin Commercial$|^Loan request: SBA 504 \| Corin Commercial$|^Loan request: HUD 232 \| Corin Commercial$/);
      // The lender's own recorded box is the only line with figures in it.
      const body = text.split("Secure link")[0]!.replace(/^Your recorded box: .*$/m, "");
      expect(body).not.toMatch(/N\/A|\$\d|\d%|\d\.\d+x/);
      expect(body.replace(/\(\d+ documents?\)/, "").replace(/SBA 7\(a\)|SBA 504|HUD 232/g, ""), playbook).not.toMatch(/\d/);
    }
  });

  it("keeps sponsor dollar figures out by default and prints only rounded figures in rounded mode", () => {
    const ctx = submissionFixture("bridge");
    const { text } = buildLenderEmail(input(ctx));
    expect(text).toContain("Guarantor net worth at or above the loan amount: yes. Liquidity at or above 10% of the loan: yes.");
    expect(text).toContain("(from personal financial statements dated October 15, 2026; figures are in the summary)");
    for (const figure of ["$19,000,000", "$2,550,000", "$18,500,000", "$2,400,000", "$12,100,000"]) expect(text).not.toContain(figure);
    ctx.sponsor!.emailFinancialsMode = "rounded";
    const rounded = buildLenderEmail(input(ctx)).text;
    expect(rounded).toContain("Combined guarantor net worth about $19,000,000; liquidity about $2,500,000 (rounded down to the nearest $500,000).");
    expect(rounded).not.toContain("$2,550,000");
    ctx.sponsor!.emailFinancialsMode = "none";
    const none = buildLenderEmail(input(ctx)).text;
    expect(none).not.toMatch(/net worth|liquidity/i);
  });

  it("never names a principal and masks the address on request", () => {
    const ctx = submissionFixture("bridge");
    const { text } = buildLenderEmail(input(ctx));
    for (const p of ctx.principals.filter((x) => x.kind === "individual")) expect(text).not.toContain(p.legalName);
    expect(text).toContain("4100 Brindlewood Court");
    ctx.profile!.maskAddress = true;
    const masked = buildLenderEmail(input(ctx)).text;
    expect(masked).not.toContain("Brindlewood Court, Oakland");
    expect(masked).toContain("Brindlewood Court Apartments, Oakland, CA — 42-unit multifamily");
  });

  it("refuses unsafe or overclaiming staff text", () => {
    const named = submissionFixture("bridge");
    named.profile!.businessPlan = `${named.profile!.businessPlan} Rowan Ellingsworth will guarantee.`;
    expect(() => buildLenderEmail(input(named))).toThrow(EmailSafetyError);
    const ssn = submissionFixture("bridge");
    ssn.profile!.risks = [{ risk: "Credit", mitigant: "Guarantor SSN 123-45-6789 is clean" }];
    expect(() => buildLenderEmail(input(ssn))).toThrow(EmailSafetyError);
    const overclaim = submissionFixture("bridge");
    overclaim.profile!.exitDetail = "The take-out lender has already approved the refinance.";
    expect(() => buildLenderEmail(input(overclaim))).toThrow(PackageCopyError);
  });

  it("names personal documents only by kind and count", () => {
    const ctx = submissionFixture("sba_7a");
    const { text } = buildLenderEmail(input(ctx));
    expect(text).toContain("2 sponsor financial statements; 3 sets of tax returns");
    expect(text).not.toContain("Personal financial statement 1");
    expect(text).not.toContain("Owner personal tax returns");
  });

  it("fills the placeholders only after approval", () => {
    const { text } = buildLenderEmail(input(submissionFixture("bridge")));
    const filled = fillEmailPlaceholders(text, { shareUrl: "https://corincommercial.com/api/deals/share/tok", expiresAt: "2026-12-04T17:00:00.000Z" });
    expect(filled).toContain("(expires December 4, 2026):\nhttps://corincommercial.com/api/deals/share/tok\n");
    expect(filled).not.toContain("{{");
  });

  it("formats phone numbers without long digit runs", () => {
    expect(formatPhone("(415) 555-0100")).toBe("415-555-0100");
    expect(formatPhone("+1 415 555 0100")).toBe("415-555-0100");
    expect(formatPhone("4155550100")).toBe("415-555-0100");
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("0044207946095812")).toBeNull();
    expect(formatPhone(null)).toBeNull();
  });

  it("renders from EmailFacts alone, with no field for a restricted value", () => {
    const facts = lenderEmailFacts(input(submissionFixture("hud_232")));
    expect(Object.keys(facts.sponsor!).sort()).toEqual(["borrowerEntity", "covenants", "creditBand", "creditEventsReported", "emailFinancialsMode", "experienceSummary", "managementCompany", "portfolioCount", "portfolioSizeNote", "similarProjectsCount", "yearsExperience"]);
    const json = JSON.stringify(facts);
    expect(json).not.toMatch(/"(netWorthCents|liquidityCents)":\d|legalName|principals|guarantorTotals|statedNetWorth/);
    expect(facts.sponsor!.covenants!.rounded).toBeNull();
    expect(renderLenderEmail(facts).text).toContain("Key principal net worth at or above the loan amount: yes.");
  });
});

// F6: on mezz and C-PACE the coverage figures are the combined ones, and the assumption names both rates.
describe("mezz and C-PACE coverage lines", () => {
  it.each(["mezz_pref", "c_pace"] as const)("%s prints combined debt yield and DSCR with the metric's own note", (pb) => {
    const ctx = submissionFixture(pb);
    const { text } = buildLenderEmail(input(ctx));
    const lines = text.split("\n");
    expect(lines.some((l) => /^ {2}Combined debt yield: .* on the senior loan plus this loan$/.test(l))).toBe(true);
    const dscr = lines.find((l) => l.startsWith("  Combined DSCR:"))!;
    expect(dscr).toMatch(/\(senior loan at its [\d.]+% rate and this loan at an assumed [\d.]+%, both on a \d+-year amortization; an assumption, not a quote\)$/);
    expect(lines.some((l) => /^ {2}(Debt yield|DSCR):/.test(l))).toBe(false);
    const summary = buildDealSummary(ctx, computeSubmissionMetrics(ctx), "term_sheet");
    expect(summary.headline.map((t) => t.label)).not.toContain("DSCR");
    expect(summary.headline.map((t) => t.label)).toEqual(expect.arrayContaining(["Combined DSCR"]));
  });
});
