import { describe, expect, it } from "vitest";
import { dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import { lenderInput, toPanelEntry } from "../test-fixtures";
import { buildLenderEmail, emailLenderFrom } from "./email";
import { EmailSafetyError, assertEmailSafe, checkNeutralCopy, findRestrictedText, guarantorCovenantLine, isFreeTextSafe, restrictedTextMessage } from "./redaction";
import { fmt } from "./summary";
import { lenderFit, tailorDealFrom } from "./tailor";
import { stubSubmissionMetrics } from "./test-metrics";
import { allSubmissionFixtures, submissionFixture } from "./test-fixtures";
import { emailFinancialsModes, submissionPlaybooks, type SponsorStrength, type SubmissionContext } from "./types";

const kinds = (text: string, names?: string[]) => findRestrictedText(text, { names }).map((f) => f.kind);

describe("assertEmailSafe", () => {
  it("rejects SSN and ITIN shapes, with any separator", () => {
    for (const t of ["SSN 123-45-6789", "guarantor 987-65-4321 on file", "ITIN 912 78 1234", "id 123.45.6789", "the guarantor's social security number is on file", "SSN on request"]) {
      expect(kinds(t), t).toContain("ssn");
    }
  });

  it("rejects EINs and every run of nine or more digits", () => {
    expect(kinds("Borrower EIN 12-3456789")).toContain("ein");
    for (const t of ["acct 123456789", "routing 021000021", "ref 4111111111111111"]) expect(kinds(t), t).toContain("digit_run");
  });

  it("rejects date-of-birth phrasing and account wording", () => {
    for (const t of ["DOB 01/02/1970", "D.O.B.: on file", "date of birth", "birthdate", "born in 1961"]) expect(kinds(t), t).toContain("dob");
    for (const t of ["routing number to follow", "Account # ending 4411", "account number 4411", "acct. # 12", "account no. 7", "IBAN on file", "two account numbers"]) {
      expect(kinds(t), t).toContain("account");
    }
  });

  it("rejects a principal's legal name, case- and spacing-insensitive, but not the borrowing entity's own name", () => {
    expect(kinds("Guaranteed personally by rowan  ELLINGSWORTH.", ["Rowan Ellingsworth"])).toEqual(["name"]);
    expect(kinds("The guarantors have 14 years of experience.", ["Rowan Ellingsworth"])).toEqual([]);
    // A name inside a longer word is not a match.
    expect(kinds("Holtsville Partners", ["Holt"])).toEqual([]);
    expect(findRestrictedText("Pat Owner Holdings LLC requests a loan", { names: ["Pat Owner"], allow: ["Pat Owner Holdings LLC"] })).toEqual([]);
    expect(findRestrictedText("Pat Owner Holdings LLC; Pat Owner guarantees", { names: ["Pat Owner"], allow: ["Pat Owner Holdings LLC"] }).map((f) => f.kind)).toEqual(["name"]);
  });

  it("accepts formatted money, phone numbers, dates, APNs, percentages and ordinary account talk", () => {
    const ok = [
      "Loan request: $8,400,000 bridge | 42-unit multifamily, Oakland CA | 68% LTV, 1.10x DSCR",
      "$120,000,000 portfolio; $1,234,567.89 of reserves",
      "Call 415-555-0100 or (415) 555-0100",
      "Target close January 15, 2027 (2027-01-15)",
      "APN 048A-7012-015-00, 006-0123-004-0000, 331-030-19-00-5",
      "CA DRE Corp. License #01522444",
      "Sponsor offers an operating account and deposits; dental, therapy and accounting tenants",
      "Reborn? No: newborn, adobe and itinerary are fine words.",
    ];
    for (const t of ok) {
      expect(findRestrictedText(t), t).toEqual([]);
      expect(() => assertEmailSafe(t)).not.toThrow();
    }
    expect(isFreeTextSafe("NOI $765,000")).toBe(true);
    expect(isFreeTextSafe("SSN 123-45-6789")).toBe(false);
  });

  it("throws EmailSafetyError naming the kind of data, never the value", () => {
    try {
      assertEmailSafe("Guarantor SSN 123-45-6789, DOB 1970-01-02", { names: ["Pat Owner"] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EmailSafetyError);
      const e = err as EmailSafetyError;
      expect(e.reason).toBe("email_unsafe");
      expect(e.findings.map((f) => f.kind)).toEqual(["ssn", "dob"]);
      expect(e.message).not.toContain("6789");
      expect(e.message).toContain("Social Security");
    }
    expect(restrictedTextMessage([{ kind: "digit_run", label: "a run of nine or more digits" }])).toMatch(/vault/);
  });

  it("passes every fixture's free text and file names", () => {
    for (const [, ctx] of allSubmissionFixtures()) {
      const names = ctx.principals.filter((p) => p.kind === "individual").map((p) => p.legalName);
      const p = ctx.profile!;
      const texts = [p.businessPlan, p.exitDetail, p.closeDriver, p.cashOutUse, ...p.highlights, ...p.risks.flatMap((r) => [r.risk, r.mitigant]), ctx.sponsor!.experienceSummary, ...ctx.vaultDocuments.map((d) => d.fileName)];
      for (const t of texts) if (t) expect(findRestrictedText(t, { names, allow: [ctx.deal.borrowerName!] }), t).toEqual([]);
    }
  });
});

describe("property: no restricted value reaches a lender email", () => {
  /** Deterministic PRNG (mulberry32) so a failure reproduces. */
  function prng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const FIRST = ["Avery", "Mireille", "Thaddeus", "Oona", "Bartholomew", "Saoirse", "Ignatius", "Perpetua", "Lucan", "Wilhelmina"];
  const LAST = ["Quarrington", "Featherstonehaugh", "Ellsworth-Pike", "Vandermolen", "Okonkwo-Reyes", "Thistlethwaite", "Abernathy", "Castellanos", "Lindqvist", "Marchetti"];

  function emailFor(ctx: SubmissionContext) {
    const metrics = stubSubmissionMetrics(ctx);
    const panel = toPanelEntry(lenderInput({ name: "Harborline Capital", programs: [ctx.deal.program] }), "lender-p", [{ id: "c1", fullName: "Dana Whitfield", email: "dana@harborline.example", isPrimary: true, status: "active" }]);
    return buildLenderEmail({
      ctx,
      metrics,
      stage: "term_sheet",
      lender: emailLenderFrom(panel),
      fit: lenderFit(panel, [], tailorDealFrom(ctx), metrics.metrics),
      documents: [dealSummaryPackageItem(ctx.deal.id, "cd".repeat(32)), ...ctx.vaultDocuments.map((d) => ({ documentId: d.id, label: d.fileName, kind: d.kind }))],
      notYetInHand: [],
      advisor: { name: "Ana Ruiz", title: null, dreLicense: "01234567", email: "ana@corincommercial.com", phone: "415-555-0100" },
    });
  }

  it("for random principals, PFS totals, stated figures and personal identifiers, across every playbook and mode", () => {
    const rand = prng(20261127);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
    for (let run = 0; run < 120; run++) {
      const playbook = submissionPlaybooks[run % submissionPlaybooks.length]!;
      const ctx = submissionFixture(playbook);
      const restricted: string[] = [];
      for (const p of ctx.principals.filter((x) => x.kind === "individual")) {
        p.legalName = `${pick(FIRST)} ${pick(LAST)}`;
        restricted.push(p.legalName);
        // Fields the submission types do not carry; smuggled in to prove nothing reads them.
        const ssn = `${int(100, 899)}-${int(10, 99)}-${int(1000, 9999)}`;
        const dob = `19${int(40, 99)}-0${int(1, 9)}-1${int(0, 9)}`;
        const home = `${int(10, 9999)} Private Lane`;
        Object.assign(p, { taxId: ssn, dateOfBirth: dob, homeAddress: home, citizenship: "other", pfs: { cash: int(1, 9) * 1_000_003 } });
        restricted.push(ssn, dob, home);
      }
      // Sponsor dollar figures that are not multiples of $500,000, so a rounded figure never equals them.
      const nw = int(2_000, 90_000) * 1_000_00 + 37_00;
      const liq = int(300, 9_000) * 1_000_00 + 41_00;
      ctx.guarantorTotals = { ...ctx.guarantorTotals!, netWorthCents: nw, liquidityCents: liq };
      ctx.sponsor!.statedNetWorthCents = nw + 123_456_00;
      ctx.sponsor!.statedLiquidityCents = liq + 7_891_00;
      ctx.sponsor!.emailFinancialsMode = pick(emailFinancialsModes);
      ctx.sponsor!.notes = `Guarantor SSN ${restricted[1] ?? "000-00-0000"}; routing 021000021`;
      ctx.sponsor!.creditEvents = { ...ctx.sponsor!.creditEvents, litigation: { occurred: rand() < 0.5, explanation: `Settled; DOB on file ${restricted[2] ?? ""}` } };
      for (const cents of [nw, liq, ctx.sponsor!.statedNetWorthCents, ctx.sponsor!.statedLiquidityCents]) restricted.push(fmt.usd(cents), String(cents), String(Math.round(cents / 100)));

      const { subject, text } = emailFor(ctx);
      const all = `${subject}\n${text}`;
      for (const value of restricted.filter(Boolean)) expect(all, `run ${run} (${playbook}): ${value}`).not.toContain(value);
      expect(all).not.toMatch(/Private Lane|routing|\d{9,}|(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/);
      expect(() => assertEmailSafe(all)).not.toThrow();
      if (ctx.sponsor!.emailFinancialsMode !== "rounded") expect(all).not.toMatch(/net worth (about|of) \$|liquidity (about|of) \$/i);
    }
  });
});

describe("guarantorCovenantLine", () => {
  const strength = (over: Partial<SponsorStrength> = {}): SponsorStrength => ({
    basis: "pfs",
    asOf: "2026-10-15",
    netWorthCents: 1_900_000_000,
    liquidityCents: 255_000_000,
    guarantorCount: 2,
    pfsCount: 2,
    covenants: { netWorthMultiple: 1, liquidityPct: 0.1, requiredNetWorthCents: 840_000_000, requiredLiquidityCents: 84_000_000, netWorthOk: true, liquidityOk: true },
    ...over,
  });

  it("gives booleans and no figures by default", () => {
    const line = guarantorCovenantLine(strength(), "covenant_only")!;
    expect(line).toEqual({ basis: "pfs", asOf: "2026-10-15", netWorthAtLeastLoan: true, liquidityAtLeastPct: true, thresholds: { netWorthMultiple: 1, liquidityPct: 0.1 }, rounded: null });
  });

  it("rounds combined figures down to $500,000 in rounded mode, never below zero", () => {
    expect(guarantorCovenantLine(strength(), "rounded")!.rounded).toEqual({ netWorthCents: 1_900_000_000, liquidityCents: 250_000_000 });
    expect(guarantorCovenantLine(strength({ netWorthCents: -5_000_000, liquidityCents: 31_000_000 }), "rounded")!.rounded).toEqual({ netWorthCents: 0, liquidityCents: 0 });
  });

  it("says nothing in none mode or without figures", () => {
    expect(guarantorCovenantLine(strength(), "none")).toBeNull();
    expect(guarantorCovenantLine(null, "covenant_only")).toBeNull();
    expect(guarantorCovenantLine(strength({ covenants: { ...strength().covenants, netWorthOk: null, liquidityOk: null } }), "covenant_only")).toBeNull();
  });
});

describe("checkNeutralCopy", () => {
  it("flags protected-characteristic topics in staff-typed text", () => {
    const flags = checkNeutralCopy(["The sponsor and his wife own the building.", "The 62-year-old guarantor", "Recent immigrant family business", "Run by a Catholic order", "The borrower receives food stamps", "Divorced last year"]);
    expect(flags.map((f) => [f.textIndex, f.topic])).toEqual([
      [0, "sex"],
      [1, "age"],
      [2, "national_origin"],
      [3, "religion"],
      [4, "public_assistance"],
      [5, "marital_status"],
    ]);
    expect(flags[0]!.term.toLowerCase()).toBe("wife");
  });

  it("passes neutral deal copy, including every fixture", () => {
    expect(checkNeutralCopy(["Senior housing with 82% private pay and 7% veterans benefits.", "Student housing near campus", "Church conversion to offices", "An 11-year-old bakery in a building that is 40 years old"])).toEqual([]);
    for (const [, ctx] of allSubmissionFixtures()) {
      const p = ctx.profile!;
      const texts = [p.businessPlan, p.exitDetail, ...p.highlights, ...p.risks.flatMap((r) => [r.risk, r.mitigant]), ctx.sponsor!.experienceSummary].filter((t): t is string => Boolean(t));
      expect(checkNeutralCopy(texts), ctx.deal.title).toEqual([]);
    }
  });
});
