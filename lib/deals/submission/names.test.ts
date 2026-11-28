// F2 / S2 / N1: no guarantor or principal name reaches the lender email. The
// borrower is named only when it is the org chart's borrowing entity and its
// name does not read as an individual principal's (else "the borrower"), with
// that record's formation state,
// file names never, and the name check sees through spacing, punctuation,
// order, middle names, zero-width characters and diacritics. The send gate
// re-checks with the same names.

import { describe, expect, it } from "vitest";
import { dealSummaryPackageItem } from "@/lib/agents/lenders/package";
import { PackageError, sendPackageToLender } from "../packages";
import { lenderInput, lenderReady, newDeal, noHolds, setup, testSummaries, toPanelEntry } from "../test-fixtures";
import { buildLenderEmail, emailBorrower, emailLenderFrom, emailSafetyFor, emailSha256, type LenderEmailInput } from "./email";
import { computeSubmissionMetrics } from "./metrics";
import { EmailSafetyError, entityAllowPhrases, findRestrictedText, fullNameIn, looksLikePerson, nameTokens, safeAllowPhrases } from "./redaction";
import { lenderFit, tailorDealFrom } from "./tailor";
import { submissionFixture } from "./test-fixtures";
import type { SubmissionContext, SubmissionPlaybook } from "./types";

const ADVISOR = { name: "Ana Ruiz", title: null, dreLicense: "01234567", email: "ana@corincommercial.com", phone: null };

function input(ctx: SubmissionContext, over: Partial<LenderEmailInput> = {}): LenderEmailInput {
  const metrics = computeSubmissionMetrics(ctx);
  const panel = toPanelEntry(lenderInput({ name: "Harborline Capital", programs: [ctx.deal.program], loanTypes: [], states: ["CA"], assetTypes: [] }), "lender-x", [{ id: "c1", fullName: "Dana Whitfield", email: "d@x.example", isPrimary: true, status: "active" }]);
  return { ctx, metrics, stage: "screen", lender: emailLenderFrom(panel), fit: lenderFit(panel, [], tailorDealFrom(ctx), metrics.metrics), documents: [dealSummaryPackageItem(ctx.deal.id, "ab".repeat(32))], notYetInHand: [], advisor: ADVISOR, ...over };
}

/** A desk deal with a lender and a lender-ready send input on the test summary; the gate keeps requests pending. */
async function gatedSendWorld() {
  const { store, gate, now } = setup("pending");
  const deal = await newDeal(store, now);
  const lender = await store.insertLender(lenderInput(), "broker:ana", now());
  const input = lenderReady({ dealId: deal.id, lenderId: lender.id, items: [], actor: "broker:ana" });
  return { gate, input, deps: { store, gate, now, baseUrl: "https://corincommercial.com", holds: noHolds, summaries: testSummaries } };
}

const guarantorOf = (ctx: SubmissionContext) => ctx.principals.find((p) => p.kind === "individual" && (p.isGuarantor || p.roles.includes("guarantor")))!;
const named = (text: string, names: string[], allow: string[] = []) => findRestrictedText(text, { names, allow }).some((f) => f.kind === "name");

describe("the borrower name in the email", () => {
  it("is 'the borrower' when the deal's borrower is an individual guarantor, with no formation state", () => {
    for (const pb of ["dscr_rental", "bridge"] as SubmissionPlaybook[]) {
      const ctx = submissionFixture(pb);
      const g = guarantorOf(ctx);
      // The guarantor borrows in their own name: the org chart marks the individual, not an entity.
      ctx.principals = ctx.principals.map((p) => (p.roles.includes("borrower_entity") ? { ...p, roles: p.roles.filter((r) => r !== "borrower_entity") } : p.id === g.id ? { ...p, roles: [...p.roles, "borrower_entity"] } : p));
      ctx.deal = { ...ctx.deal, borrowerName: g.legalName };
      const email = buildLenderEmail(input(ctx));
      expect(email.text, pb).not.toContain(g.legalName);
      for (const t of nameTokens(g.legalName)) expect(email.text.toLowerCase(), `${pb} ${t}`).not.toMatch(new RegExp(`\\b${t}\\b`));
      expect(email.text).toContain("The borrower (named in the summary).");
      expect(email.text).not.toMatch(/, a CA\b/);
      expect(emailSafetyFor(ctx).allow).not.toContain(g.legalName);
    }
  });

  it("prints only the org chart's borrowing entity, by that record's name and formation state, never the deal's free-text borrower name", () => {
    const ctx = submissionFixture("bridge");
    const entity = ctx.principals.find((p) => p.roles.includes("borrower_entity"))!;
    expect(emailBorrower(ctx)).toEqual({ name: entity.legalName, formationState: entity.formationState });
    ctx.deal = { ...ctx.deal, borrowerName: "Different Borrower Holdings LLC" };
    expect(emailBorrower(ctx)).toEqual({ name: entity.legalName, formationState: entity.formationState });
    const text = buildLenderEmail(input(ctx)).text;
    expect(text).toContain(`${entity.legalName}, a ${entity.formationState} LLC.`);
    expect(text).not.toContain("Different Borrower Holdings LLC");
    expect(emailSafetyFor(ctx).allow).not.toContain("Different Borrower Holdings LLC");
  });
  it("refuses free text naming the guarantor when the borrower is that guarantor (borrowerName no longer switches the check off)", () => {
    const ctx = submissionFixture("bridge");
    ctx.deal = { ...ctx.deal, borrowerName: "Rowan Ellingsworth" };
    ctx.principals = ctx.principals.filter((p) => !p.roles.includes("borrower_entity"));
    ctx.profile!.businessPlan = "Rowan Ellingsworth personally guarantees and will manage the renovation.";
    expect(() => buildLenderEmail(input(ctx))).toThrow(EmailSafetyError);
  });

  it("allows an entity or borrower name only when it names no individual, and never one made of their name alone", () => {
    const people = ["Rowan Ellingsworth", "Jules Marrowind"];
    expect(safeAllowPhrases(["Ellingsworth Holdings LLC", "Rowan Ellingsworth", "Ellingsworth", "Ellingsworth, Rowan", "Marrowind Ellingsworth", null, ""], people)).toEqual(["Ellingsworth Holdings LLC"]);
    // The allowed entity name is skipped as a whole phrase: the surname elsewhere is still caught.
    expect(named("Ellingsworth Holdings LLC requests a bridge loan.", people, ["Ellingsworth Holdings LLC"])).toBe(false);
    expect(named("Ellingsworth Holdings LLC; Mr. Ellingsworth signs.", people, ["Ellingsworth Holdings LLC"])).toBe(true);
  });
});

// N1: a guarantor's name with one extra token (an initial, a nickname, a
// co-owner) used to pass as the borrower's name and switch the check off.
describe("the borrower by type (N1)", () => {
  const guarantorForms = ["Rowan J. Ellingsworth", "R. Ellingsworth", "R. J. Ellingsworth", "Rowan (Ro) Ellingsworth", "Rowan and Dana Ellingsworth", "Ellingsworth Ventures", "Mr. R. J. Ellingsworth"];

  /** The bridge fixture with the guarantor named Rowan Ellingsworth and the borrowing entity renamed. */
  function withBorrowingEntity(legalName: string, over: Partial<SubmissionContext["principals"][number]> = {}) {
    const ctx = submissionFixture("bridge");
    const g = guarantorOf(ctx);
    ctx.principals = ctx.principals.map((p) => (p.roles.includes("borrower_entity") ? { ...p, legalName, ...over } : p.id === g.id ? { ...p, legalName: "Rowan Ellingsworth" } : p));
    return ctx;
  }

  it.each(guarantorForms)("an entity principal named %j is 'the borrower', and its name is not allowed", (legalName) => {
    const ctx = withBorrowingEntity(legalName);
    expect(emailBorrower(ctx)).toEqual({ name: null, formationState: null });
    expect(emailSafetyFor(ctx).allow).not.toContain(legalName);
    const text = buildLenderEmail(input(ctx)).text;
    expect(text).toContain("The borrower (named in the summary).");
    expect(text.toLowerCase()).not.toContain("ellingsworth");
  });

  it.each(["Rowan Ellingsworth", ...guarantorForms, "Halvorsen, Noor A.", "Noor & Sam Halvorsen"])("the deal's borrower name %j is never printed nor allowed, and still refused in free text", (borrowerName) => {
    const ctx = withBorrowingEntity("Brindlewood Court Partners LLC");
    ctx.principals = [...ctx.principals, { ...guarantorOf(ctx), id: "p-noor", legalName: "Noor A. Halvorsen" }];
    ctx.deal = { ...ctx.deal, borrowerName };
    expect(emailBorrower(ctx)?.name).toBe("Brindlewood Court Partners LLC");
    const safety = emailSafetyFor(ctx);
    expect(safety.allow).toEqual(["Brindlewood Court Partners LLC"]);
    expect(findRestrictedText(`${borrowerName} guarantees the loan`, safety).map((f) => f.kind)).toContain("name");
    expect(buildLenderEmail(input(ctx)).text).not.toContain(borrowerName);
  });

  it("treats a principal's surname without an entity word as a person, and with one as an entity", () => {
    const people = ["Noor A. Halvorsen", "Rowan Ellingsworth"];
    for (const n of ["Noor A. Halvorsen", "Noor & Sam Halvorsen", "Halvorsen Ventures", "The Halvorsens", "R. Ellingsworth LLC", "Rowan J. Ellingsworth Revocable Trust"]) expect(looksLikePerson(n, people), n).toBe(true);
    for (const n of ["Halvorsen Holdings LLC", "Halvorsen Family Trust", "Ellingsworth Partners, L.P.", "Ellingsworth Capital Fund", "Brindlewood Court Partners LLC", "Ellingsworth & Co."]) expect(looksLikePerson(n, people), n).toBe(false);
    expect(entityAllowPhrases(["Halvorsen Holdings LLC", "Noor & Sam Halvorsen", "R. Ellingsworth", null, ""], people)).toEqual(["Halvorsen Holdings LLC"]);
  });

  it("an allowed entity phrase suppresses a match only inside that exact phrase", () => {
    const ctx = withBorrowingEntity("Ellingsworth Holdings LLC");
    expect(emailBorrower(ctx)?.name).toBe("Ellingsworth Holdings LLC");
    const safety = emailSafetyFor(ctx);
    expect(findRestrictedText("Ellingsworth Holdings LLC requests a bridge loan.", safety)).toEqual([]);
    for (const t of ["Ellingsworth Holdings LLC; Mr. Ellingsworth signs.", "Ellingsworth Holdings, managed by Ellingsworth", "Ellingsworth Holdings LLC and Rowan Ellingsworth"]) {
      expect(findRestrictedText(t, safety).map((f) => f.kind), t).toContain("name");
    }
  });

  it("is 'the borrower' when the org chart marks no single entity", () => {
    const two = withBorrowingEntity("Brindlewood Court Partners LLC");
    two.principals = [...two.principals, { ...two.principals.find((p) => p.roles.includes("borrower_entity"))!, id: "p-second", legalName: "Second Borrower LLC" }];
    expect(emailBorrower(two)).toEqual({ name: null, formationState: null });
    const none = withBorrowingEntity("Brindlewood Court Partners LLC");
    none.principals = none.principals.filter((p) => !p.roles.includes("borrower_entity"));
    expect(emailBorrower(none)).toEqual({ name: null, formationState: null });
  });

  it("catches the plural surname and first and last name glued together", () => {
    expect(named("The Ellingsworths will manage.", ["Rowan Ellingsworth"])).toBe(true);
    expect(named("RowanEllingsworth will manage.", ["Rowan Ellingsworth"])).toBe(true);
    expect(named("The Wells Fargo loan.", ["Dana Wells"])).toBe(false);
  });
});

describe("the principal-name check", () => {
  const names = ["John Michael Smith"];
  it.each([
    ["the full name", "John Michael Smith will guarantee"],
    ["first and last without the middle name", "John Smith will guarantee"],
    ["the surname alone", "Mr. Smith will guarantee"],
    ["initials and the surname", "J. M. Smith will guarantee"],
    ["reversed with a comma", "Smith, John Michael guarantees"],
    ["a zero-width character inside", "John​ Michael Smith guarantees"],
    ["a hyphen line split", "John Mi-\nchael Smith"],
    ["underscores and dashes as separators", "Smith_John-credit-report.pdf"],
    ["upper case", "JOHN SMITH GUARANTEES"],
  ])("catches %s", (_label, text) => {
    expect(named(text, names)).toBe(true);
  });

  it("catches diacritics either way", () => {
    expect(named("José García guarantees", ["Jose Garcia"])).toBe(true);
    expect(named("Jose Garcia guarantees", ["José García"])).toBe(true);
    expect(named("Mr. García signs", ["José García"])).toBe(true);
  });

  it("does not block on a surname that is an everyday word unless it comes with the first name or an honorific", () => {
    expect(named("Purchase price: $12,000,000, closing May 1, 2027", ["Ellen Price", "Theresa May"])).toBe(false);
    expect(named("Ellen Price guarantees", ["Ellen Price"])).toBe(true);
    expect(named("Ms. Price guarantees", ["Ellen Price"])).toBe(true);
    expect(named("Two years in, the sponsor sold one of the two buildings.", ["Demo Guarantor Two", "Demo Guarantor One"])).toBe(false);
    // Inside a longer word is never a match.
    expect(named("Holtsville Partners", ["Holt"])).toBe(false);
  });

  it("fullNameIn ignores the surname alone (used to vet borrower names)", () => {
    expect(fullNameIn("Smith Family Holdings LLC", ["John Smith"])).toBe(false);
    expect(fullNameIn("John Smith Holdings LLC", ["John Smith"])).toBe(true);
  });
});

describe("file names never reach the email", () => {
  it("counts OTHER documents (and every kind without a label) instead of printing their names", () => {
    const ctx = submissionFixture("bridge");
    const documents = [
      dealSummaryPackageItem(ctx.deal.id, "ab".repeat(32)),
      { documentId: "d1", kind: "OTHER", label: "Rowan_Ellingsworth_drivers_license_DOB-1971.pdf" },
      { documentId: "d2", kind: "OTHER", label: "Ellingsworth, Rowan - Chase checking x4821 stmt.pdf" },
      { documentId: "d3", kind: "BANK_STATEMENT", label: "Jules-Marrowind-statement-712.pdf" },
      { documentId: "d4", kind: "T12", label: "T-12 Jules Marrowind.pdf" },
    ];
    const e = buildLenderEmail(input(ctx, { documents }));
    const line = e.text.split("\n").find((l) => l.startsWith("  Deal summary (PDF)"))!;
    expect(line).toBe("  Deal summary (PDF); T-12 operating statement; 3 other borrower documents");
    for (const leak of ["Ellingsworth", "Marrowind", "4821", "drivers", "DOB"]) expect(e.text).not.toContain(leak);
  });
});

describe("the send gate re-checks with the names", () => {
  it("refuses an email naming a principal even when its hash matches", async () => {
    const w = await gatedSendWorld();
    const subject = "Loan request | Corin Commercial";
    const text = "Hello,\n\nMr. Owner's partner, Pat, signs.\nPat Owner guarantees.\n{{SHARE_LINK}}\n";
    const err = await sendPackageToLender(w.deps, { ...w.input, submission: { ...w.input.submission, email: { subject, text, sha256: emailSha256(subject, text) }, nameCheck: { names: ["Pat Owner"], allow: [] } } }).catch((e) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err.reason).toBe("email_unsafe");
    expect(err.message).toMatch(/principal's name/);
    expect(w.gate.requests).toHaveLength(0);
  });

  it("refuses a submission that carries no name check", async () => {
    const w = await gatedSendWorld();
    const { nameCheck: _n, ...rest } = w.input.submission;
    await expect(sendPackageToLender(w.deps, { ...w.input, submission: rest as typeof w.input.submission })).rejects.toMatchObject({ reason: "email_unsafe" });
    expect(w.gate.requests).toHaveLength(0);
  });
});
