import { describe, expect, it } from "vitest";
import { createKeyring, isEncrypted, PiiDecryptError, PiiKeyError } from "@/lib/privacy/crypto";
import { buildCreditAuthorization, CREDIT_AUTH_TEXTS, CURRENT_CREDIT_AUTH, sha256, signatureMatches } from "./consent";
import { InvalidSecretError, maskTaxId, openPrincipalSecrets, sealPrincipalSecrets, taxIdLookupIndex } from "./crypto-fields";
import { form1919Flags, guarantorCovenants, hud2530Flags, summarizePfs, summarizeReo } from "./financials";
import { buildForm1919Prefill } from "./form1919";
import { addPrincipal, recordCreditAuthorization, updatePrincipal } from "./service";
import { MemoryPrincipalStore } from "./store";
import { DEAL_ID, sampleChart, TEST_KEYRING } from "./test-fixtures";
import { taxIdKind, type Form1919Answers, type Pfs } from "./types";

const NOW = new Date("2026-11-03T12:00:00Z");
const PFS: Pfs = {
  asOf: "2026-10-15",
  assets: { cash: 400_000, marketableSecurities: 600_000, retirementAccounts: 900_000, realEstate: 5_000_000, businessInterests: 1_000_000, otherAssets: 100_000 },
  liabilities: { mortgages: 2_500_000, notesPayable: 100_000, creditCards: 10_000, taxesOwed: 0, otherLiabilities: 40_000 },
  contingentLiabilities: { guarantees: 3_000_000, legalClaims: 0, other: 0 },
  annualIncome: { salary: 250_000, investmentIncome: 40_000, realEstateIncome: 300_000, otherIncome: 0 },
};
const NO_1919: Form1919Answers = { answers: { subjectToCriminalCharges: false, incarceratedOrOnProbation: false, delinquentFederalDebt: false, priorGovernmentLoss: false, debarredOrSuspended: false, sbaEmployeeAffiliation: false } };

describe("tax ids", () => {
  it("accepts SSNs and ITINs and rejects invalid ones", () => {
    expect(taxIdKind("123-45-6789")).toBe("ssn");
    expect(taxIdKind("912-70-1234")).toBe("itin");
    for (const bad of ["000-12-3456", "666-12-3456", "123-00-4567", "123-45-0000", "912-10-1234", "12345678", "abc"]) expect(taxIdKind(bad)).toBeNull();
  });
});

describe("principal field encryption", () => {
  it("seals SSN, DOB, PFS and Form 1919 answers and opens them only in the same row", () => {
    const sealed = sealPrincipalSecrets("p1", { ssn: "123-45-6789", dob: "1970-04-01", pfs: PFS, form1919: NO_1919 }, { keyring: TEST_KEYRING, now: NOW });
    for (const v of [sealed.ssnEnc, sealed.dobEnc, sealed.pfsEnc, sealed.form1919Enc]) {
      expect(isEncrypted(v)).toBe(true);
      expect(v).not.toContain("6789");
    }
    expect(sealed).toMatchObject({ hasSsn: true, hasDob: true, hasPfs: true, hasForm1919: true, pfsAsOf: "2026-10-15" });
    const row = { id: "p1", ssnEnc: sealed.ssnEnc!, dobEnc: sealed.dobEnc!, pfsEnc: sealed.pfsEnc!, form1919Enc: sealed.form1919Enc! };
    const open = openPrincipalSecrets(row, { keyring: TEST_KEYRING });
    expect(open).toEqual({ ssn: "123456789", dob: "1970-04-01", pfs: PFS, form1919: NO_1919 });
    expect(maskTaxId(open.ssn!)).toBe("•••-••-6789");
    // Copying the ciphertext to another principal fails authentication.
    expect(() => openPrincipalSecrets({ ...row, id: "p2" }, { keyring: TEST_KEYRING, fields: ["ssn"] })).toThrow(PiiDecryptError);
    expect(openPrincipalSecrets(row, { keyring: TEST_KEYRING, fields: ["dob"] })).toEqual({ ssn: null, dob: "1970-04-01", pfs: null, form1919: null });
  });

  it("indexes the tax id for duplicate lookups without revealing it", () => {
    const a = sealPrincipalSecrets("p1", { ssn: "123456789" }, { keyring: TEST_KEYRING });
    const b = sealPrincipalSecrets("p2", { ssn: "123-45-6789" }, { keyring: TEST_KEYRING });
    expect(a.taxIdIndex).toBe(b.taxIdIndex);
    expect(a.taxIdIndex).toMatch(/^bi1\.1\.[0-9a-f]{64}$/);
    expect(taxIdLookupIndex("123 45 6789", TEST_KEYRING)).toBe(a.taxIdIndex);
    const other = createKeyring({ version: 2, key: Buffer.alloc(32, 9) });
    expect(sealPrincipalSecrets("p1", { ssn: "123456789" }, { keyring: other }).taxIdIndex).not.toBe(a.taxIdIndex);
  });

  it("refuses invalid values and refuses to store anything without a key", () => {
    expect(() => sealPrincipalSecrets("p1", { ssn: "000-00-0000" }, { keyring: TEST_KEYRING })).toThrow(InvalidSecretError);
    expect(() => sealPrincipalSecrets("p1", { dob: "2015-01-01" }, { keyring: TEST_KEYRING, now: NOW })).toThrow(/18 or older/);
    expect(() => sealPrincipalSecrets("p1", { dob: "1970-02-30" }, { keyring: TEST_KEYRING, now: NOW })).toThrow(InvalidSecretError);
    expect(() => sealPrincipalSecrets("p1", { ssn: "123456789" }, { keyring: null })).toThrow(PiiKeyError);
    expect(sealPrincipalSecrets("p1", { ssn: null, pfs: null }, { keyring: TEST_KEYRING })).toEqual({ ssnEnc: null, taxIdIndex: null, hasSsn: false, pfsEnc: null, pfsAsOf: null, hasPfs: false });
  });
});

describe("principal service", () => {
  it("stores only ciphertext and flags the same tax id on another deal", async () => {
    const store = new MemoryPrincipalStore();
    const deps = { principals: store, keyring: TEST_KEYRING, now: () => NOW };
    const b = await addPrincipal(deps, { dealId: DEAL_ID, kind: "entity", legalName: "Harbor View LLC", roles: ["borrower_entity"] });
    const ana = await addPrincipal(deps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "individual", legalName: "Ana Ruiz", roles: ["managing_member"], ownershipPct: 60, email: "Ana@Example.com" }, { ssn: "123-45-6789", dob: "1970-04-01" });
    expect(ana.principal).not.toHaveProperty("ssnEnc");
    expect(ana.principal).toMatchObject({ hasSsn: true, hasDob: true, email: "ana@example.com" });
    const raw = store.rows.get(ana.principal.id)!;
    expect(JSON.stringify(raw)).not.toContain("123456789");
    expect(JSON.stringify(raw)).not.toContain("1970-04-01");

    const otherDeal = "22222222-2222-4222-8222-222222222222";
    const ob = await addPrincipal(deps, { dealId: otherDeal, kind: "entity", legalName: "Other LLC", roles: ["borrower_entity"] });
    const dup = await addPrincipal(deps, { dealId: otherDeal, parentId: ob.principal.id, kind: "individual", legalName: "Ana R.", roles: ["member"], ownershipPct: 100 }, { ssn: "123456789" });
    expect(dup.duplicates).toEqual([{ id: ana.principal.id, dealId: DEAL_ID, legalName: "Ana Ruiz" }]);

    await expect(addPrincipal(deps, { dealId: DEAL_ID, kind: "entity", legalName: "Second Borrower LLC", roles: ["borrower_entity"] })).rejects.toThrow(/already has a borrowing entity/);
    await expect(addPrincipal(deps, { dealId: DEAL_ID, parentId: ana.principal.id, kind: "individual", legalName: "Kid Owner", roles: ["member"], ownershipPct: 10 })).rejects.toThrow(/Only an entity/);
    await expect(addPrincipal(deps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "entity", legalName: "Ent LLC", roles: ["member"], ownershipPct: 10 }, { ssn: "123456789" })).rejects.toThrow(/individuals only/);
    await expect(store.insert({ ...raw, id: "x", ssnEnc: "123456789" }, NOW)).rejects.toThrow(/must be encrypted/);
  });

  it("updates PFS, REO and the credit authorization with optimistic versions and loop protection", async () => {
    const store = new MemoryPrincipalStore();
    const deps = { principals: store, keyring: TEST_KEYRING, now: () => NOW };
    const b = await addPrincipal(deps, { dealId: DEAL_ID, kind: "entity", legalName: "Harbor View LLC", roles: ["borrower_entity"] });
    const mm = await addPrincipal(deps, { dealId: DEAL_ID, parentId: b.principal.id, kind: "entity", legalName: "MM LLC", roles: ["managing_member"], ownershipPct: 100 });
    const ana = await addPrincipal(deps, { dealId: DEAL_ID, parentId: mm.principal.id, kind: "individual", legalName: "Ana Maria Ruiz", roles: ["member"], ownershipPct: 100 });
    const v2 = await updatePrincipal(deps, ana.principal.id, 1, { reoSchedule: [{ address: "1 Main St, Fresno CA", propertyType: "Multifamily", ownershipPct: 100, status: "owned", marketValue: 2e6, loanBalance: 1e6, monthlyDebtService: 7000, annualNoi: 120_000, inDefault: false }] }, { pfs: PFS });
    expect(v2).toMatchObject({ version: 2, hasPfs: true, pfsAsOf: "2026-10-15" });
    await expect(updatePrincipal(deps, ana.principal.id, 1, { phone: "555" })).rejects.toThrow(/changed by someone else/);
    await expect(updatePrincipal(deps, mm.principal.id, 1, { parentId: ana.principal.id })).rejects.toThrow();
    await expect(recordCreditAuthorization(deps, ana.principal.id, 2, { signatureName: "Someone Else" })).rejects.toThrow(/full legal name/);
    const signed = await recordCreditAuthorization(deps, ana.principal.id, 2, { signatureName: "ana ruiz", ip: "203.0.113.9", userAgent: "UA" });
    expect(signed.creditAuthorization).toMatchObject({ textVersion: CURRENT_CREDIT_AUTH, signatureName: "ana ruiz", ip: "203.0.113.9", capturedVia: "portal" });
    expect(signed.creditAuthorization!.textSha256).toBe(sha256(CREDIT_AUTH_TEXTS[CURRENT_CREDIT_AUTH]!.text));
  });
});

describe("financial exhibits", () => {
  it("summarizes the PFS and flags staleness and covenants", () => {
    const s = summarizePfs(PFS, NOW);
    expect(s).toMatchObject({ totalAssets: 8_000_000, totalLiabilities: 2_650_000, netWorth: 5_350_000, liquidity: 1_000_000, contingentLiabilities: 3_000_000, annualIncome: 590_000, stale: false });
    expect(summarizePfs(PFS, new Date("2027-02-01T00:00:00Z")).stale).toBe(true);
    expect(guarantorCovenants(s, 6_000_000)).toMatchObject({ netWorthOk: false, liquidityOk: true, requiredLiquidity: 600_000 });
  });

  it("summarizes the REO schedule at the principal's share", () => {
    const r = summarizeReo(
      [
        { address: "A", propertyType: "MF", ownershipPct: 50, status: "owned", marketValue: 4e6, loanBalance: 2e6, monthlyDebtService: 15_000, annualNoi: 240_000, maturityDate: "2027-06-01", inDefault: false },
        { address: "B", propertyType: "Retail", ownershipPct: 100, status: "owned", marketValue: 1e6, loanBalance: 1.1e6, monthlyDebtService: 8_000, annualNoi: 80_000, inDefault: true },
        { address: "C", propertyType: "MF", ownershipPct: 100, status: "sold_last_3_years", marketValue: 0, loanBalance: 0, monthlyDebtService: 0, annualNoi: 0, inDefault: false },
      ],
      NOW,
    );
    expect(r).toMatchObject({ properties: 2, marketValue: 3e6, debt: 2.1e6, equity: 0.9e6, annualNoi: 200_000, annualDebtService: 186_000, maturingWithin24Months: 1 });
    expect(r.dscr).toBeCloseTo(1.08, 2);
    expect(r.flags).toEqual(["B: debt exceeds value.", "B: income does not cover debt service.", "B: loan reported in default."]);
  });

  it("flags HUD-2530 and Form 1919 answers that need explanation", () => {
    expect(hud2530Flags({ noPriorParticipation: true, projects: [], certifications: { noDefaultsLast10Years: true, notDebarredOrSuspended: true, noUnresolvedFindings: true } })).toEqual([]);
    const flags = hud2530Flags({
      noPriorParticipation: false,
      projects: [{ projectName: "Oak Manor", role: "Managing member", startDate: "2015-01-01", status: "terminated", defaultOrClaim: true }],
      certifications: { noDefaultsLast10Years: false, notDebarredOrSuspended: true, noUnresolvedFindings: true },
    });
    expect(flags).toHaveLength(3);
    expect(form1919Flags({ ...NO_1919, answers: { ...NO_1919.answers, delinquentFederalDebt: true } })).toEqual([{ question: "delinquentFederalDebt", text: expect.stringMatching(/delinquent on any federal debt/) }]);
  });
});

describe("Form 1919 prefill", () => {
  it("lists 20%+ owners and controlling persons with what is missing, never the restricted values", () => {
    const s = sampleChart();
    const ana = { ...s.ana, hasSsn: true, hasDob: true, homeAddress: "1 Oak, Pasadena CA", citizenship: "us_citizen" as const, title: "Managing member" };
    const prefill = buildForm1919Prefill({
      principals: [s.borrower, s.sponsor, ana, s.ben, s.cal, s.dee],
      deal: { loanAmount: 4_500_000, useOfProceeds: "Purchase of owner-occupied building", businessAddress: "9 Bay St, Oakland CA", entityType: "llc" },
      answers: new Map([[ana.id, { ...NO_1919, veteranStatus: "not_veteran" as const }]]),
    });
    expect(prefill.applicant).toMatchObject({ legalName: "Harbor View Senior Living LLC", formationState: "CA", loanAmount: 4_500_000 });
    expect(prefill.owners.map((o) => o.name)).toEqual(["Sponsor Holdings LLC", "Ana Ruiz", "Ben Ode", "Cal Pine"]);
    const anaOwner = prefill.owners.find((o) => o.name === "Ana Ruiz")!;
    expect(anaOwner).toMatchObject({ taxIdOnFile: true, dateOfBirthOnFile: true, missing: [], ownershipPct: 30, veteranStatus: "not_veteran" });
    expect(JSON.stringify(prefill)).not.toMatch(/"(ssn|dob|dateOfBirth|taxId|ssnEnc|dobEnc)"\s*:/);
    expect(prefill.missing).toEqual(expect.arrayContaining(["Ben Ode: SSN or ITIN", "Cal Pine: Eligibility questions"]));
    expect(prefill.complete).toBe(false);
  });
});

describe("credit authorization", () => {
  it("pins the text hash so edits need a new version", () => {
    expect(sha256(CREDIT_AUTH_TEXTS["credit-auth-2026-11-01"]!.text)).toBe(buildCreditAuthorization({ signatureName: "A B", capturedVia: "portal", now: NOW }).textSha256);
    expect(sha256(CREDIT_AUTH_TEXTS["credit-auth-2026-11-01"]!.text)).toMatchInlineSnapshot(`"cc80aadb9f10e64f44567c2c527fd3914ffbf5a81b14d2b4135dd3477f533ca1"`);
  });

  it("matches typed signatures on first and last name", () => {
    expect(signatureMatches("Ana Ruiz", "Ana Maria Ruiz")).toBe(true);
    expect(signatureMatches("  ANA   RUIZ ", "Ana Ruiz")).toBe(true);
    expect(signatureMatches("Ana", "Ana Ruiz")).toBe(false);
    expect(signatureMatches("Bob Ruiz", "Ana Ruiz")).toBe(false);
  });
});
