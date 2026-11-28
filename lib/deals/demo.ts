// In-memory desks for fake-auth mode (AUTH_PROVIDER=fake: local development and
// the e2e suite; refused in production and whenever the Supabase service role
// is set). The deal desk, checklists and screening, the borrower portal, the
// construction desk and lender matching all share one bundle per server
// process, so a stage change on /deals/[id] shows up on /checklists and a
// sanctions hold opened on the checklist desk pauses the deal.
//
// Every record is invented. The deal ids match the demo pipeline
// (app/(staff)/pipeline/demo.ts) and the demo approvals queue, so every row on
// /pipeline opens a working deal page. The PII key and the sanctions
// list entry below (and the portal secret in lib/principals/portal.ts) are public on purpose: they only ever unlock
// in-memory demo data (like DEMO_TOTP_SECRET in lib/auth/demo.ts).

import { DEMO_DEAL_IDS } from "@/lib/approvals/demo";
import { resolveAuthMode } from "@/lib/auth/config";
import { MemoryChecklistStore } from "@/lib/checklists/store";
import { FakeLicenseLookup } from "@/lib/construction/cslb";
import { MemoryConstructionStore } from "@/lib/construction/store";
import { MemoryDisclosureStore, MemoryDocumentStorage } from "@/lib/disclosures/store";
import { MemoryLenderMatchStore, MemoryPartnerSource, MemoryTermSheetMailSource } from "@/lib/agents/lenders/store";
import { sealPrincipalSecrets } from "@/lib/principals/crypto-fields";
import { MemoryPortalInviteStore, MemoryPrincipalStore } from "@/lib/principals/store";
import type { Pfs, PrincipalRow, ReoEntry } from "@/lib/principals/types";
import { createKeyring, type PiiKeyring } from "@/lib/privacy/crypto";
import { FakeSanctionsClient } from "@/lib/screening/fake";
import { MemoryDealHoldStore, MemoryScreeningStore } from "@/lib/screening/store";
import { MemorySpreadStore } from "@/lib/spreads/store";
import { MemoryIdempotencyStore } from "@/lib/workflows/idempotency";
import { sealLenderAccountNumber } from "./lender-accounts";
import { EMPTY_LENDER_CONTACT_INFO } from "./lender-contacts";
import { stageTemplate, templateDigest } from "./stages";
import { MemoryDealDeskStore } from "./store";
import { assertProfileFields, assertSponsorFields, MemorySubmissionStore } from "./submission/store";
import { blankSponsorProfileFields, blankSubmissionProfileFields, creditEventKinds, type SponsorProfile, type SubmissionProfile } from "./submission/types";
import type { Deal, DealProgram, LenderContact, LenderRow } from "./types";

/** True when the in-memory demo desks are in use (fake-auth mode). */
export function demoDesksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return resolveAuthMode(env).mode === "fake";
}

/** Invented sanctions-list entry: screening a principal with this name opens an OFAC hold. */
export const DEMO_SANCTIONED_NAME = "Blocked Example Person";

/** Invented contractor license the demo CSLB lookup answers for. */
export const DEMO_CONTRACTOR_LICENSE = "1000001";

/** Demo deals beyond the four the approvals queue references. */
export const DEMO_EXTRA_DEAL_IDS = {
  memoryCare: "10000000-0000-4000-8000-000000000005",
  townhomes: "10000000-0000-4000-8000-000000000006",
  pipHotel: "10000000-0000-4000-8000-000000000007",
  cedarCourt: "10000000-0000-4000-8000-000000000008",
} as const;

/**
 * Demo deals for the lender-ready submission (e2e/deal-submission.spec.ts).
 * `ready` has every Screen item answered: profile, sponsor and principals with
 * personal financial statements on file. `empty` has no profile yet; its lead
 * intake gives "Start from these" values to suggest.
 */
export const DEMO_SUBMISSION_DEAL_IDS = {
  ready: "10000000-0000-4000-8000-000000000009",
  empty: "10000000-0000-4000-8000-000000000010",
} as const;

/** The leads behind the submission demo deals (their intakes live in DemoDesks.leadIntakes). */
export const DEMO_LEAD_IDS = {
  ready: "40000000-0000-4000-8000-000000000001",
  empty: "40000000-0000-4000-8000-000000000002",
} as const;

export const DEMO_LENDER_IDS = {
  bank: "20000000-0000-4000-8000-000000000001",
  privateFund: "20000000-0000-4000-8000-000000000002",
  /** Inactive and with no deal programs: panelForDeal, the matcher and outreach never pick it. */
  dscrFund: "20000000-0000-4000-8000-000000000003",
} as const;

export const DEMO_LENDER_CONTACT_IDS = {
  bankPrimary: "21000000-0000-4000-8000-000000000001",
  bankUnderwriter: "21000000-0000-4000-8000-000000000002",
  fundPrimary: "21000000-0000-4000-8000-000000000003",
} as const;

/** The demo bank's broker ID, sealed with the demo key (only when a keyring is passed to seedDemoDealDesk). */
export const DEMO_LENDER_ACCOUNT = { id: "30000000-0000-4000-8000-000000000001", kind: "broker_id", label: "Broker ID", value: "DEMO-BRK-48210937" } as const;

// Public demo key: it only ever encrypts invented data held in memory.
export const DEMO_PII_KEYRING: PiiKeyring = createKeyring({ version: 1, key: Buffer.alloc(32, 0x4b) });

export type DemoDesks = {
  deals: MemoryDealDeskStore;
  disclosures: MemoryDisclosureStore;
  storage: MemoryDocumentStorage;
  /** Claims e-sign sends so a retried send creates at most one envelope (workflow_effects in production). */
  effects: MemoryIdempotencyStore;
  checklists: MemoryChecklistStore;
  principals: MemoryPrincipalStore;
  invites: MemoryPortalInviteStore;
  screenings: MemoryScreeningStore;
  holds: MemoryDealHoldStore;
  sanctions: FakeSanctionsClient;
  keyring: PiiKeyring;
  construction: MemoryConstructionStore;
  licenses: FakeLicenseLookup;
  lenderStore: MemoryLenderMatchStore;
  partners: MemoryPartnerSource;
  termSheetMail: MemoryTermSheetMailSource;
  spreads: MemorySpreadStore;
  /** Deal submission profiles, sponsor profiles and locked summaries. */
  submission: MemorySubmissionStore;
  /** leads.intake and created_at by lead id (the demo has no leads table). */
  leadIntakes: Map<string, { intake: unknown; createdAt: string }>;
};

type DemoDeal = { id: string; title: string; program: DealProgram; stage: string; status?: Deal["status"]; borrowerName: string; propertyAddress: string; loanAmountCents: number; collateralRealProperty: boolean; engagementAgreementRef?: string; updatedAt: string; lockedTerms?: Record<string, unknown>; leadId?: string };

const DEMO_DEALS: DemoDeal[] = [
  { id: DEMO_DEAL_IDS.seniorLiving, title: "Sunrise Senior Living (demo)", program: "HUD_232", stage: "packaging", borrowerName: "Sunrise Care Example LLC", propertyAddress: "100 Example Way, Sacramento", loanAmountCents: 1_850_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/sunrise.pdf", updatedAt: "2026-10-30T18:20:00.000Z" },
  { id: DEMO_DEAL_IDS.hotel, title: "Harbor Inn (demo)", program: "SBA_504", stage: "lender_outreach", borrowerName: "Harbor Inn Example LLC", propertyAddress: "200 Sample Pier Rd, San Diego", loanAmountCents: 920_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/harbor-inn.pdf", updatedAt: "2026-10-29T16:05:00.000Z" },
  { id: DEMO_DEAL_IDS.multifamily, title: "Oak Terrace Apartments (demo)", program: "AGENCY", stage: "term_sheet", borrowerName: "Oak Terrace Example LP", propertyAddress: "300 Placeholder Ave, Fresno", loanAmountCents: 640_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/oak-terrace.pdf", updatedAt: "2026-10-28T21:40:00.000Z" },
  { id: DEMO_DEAL_IDS.hardMoney, title: "Maple Street fix-and-flip (demo)", program: "HARD_MONEY", stage: "underwriting", borrowerName: "Maple Example Homes LLC", propertyAddress: "400 Maple Example St, Oakland", loanAmountCents: 78_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/maple.pdf", updatedAt: "2026-10-27T15:00:00.000Z", lockedTerms: { lenderName: "Sample Private Fund (demo)", noteRatePct: 10.5, termMonths: 12 } },
  { id: DEMO_EXTRA_DEAL_IDS.memoryCare, title: "Valley Memory Care (demo)", program: "PRIVATE_BRIDGE", stage: "intake", borrowerName: "Valley Care Example LLC", propertyAddress: "500 Sample Blvd, Riverside", loanAmountCents: 1_200_000_000, collateralRealProperty: true, updatedAt: "2026-10-31T09:10:00.000Z" },
  { id: DEMO_EXTRA_DEAL_IDS.townhomes, title: "Coastal Ground-up Townhomes (demo)", program: "CONSTRUCTION", stage: "engaged", borrowerName: "Coastal Example Builders LLC", propertyAddress: "600 Demo Coast Hwy, Ventura", loanAmountCents: 1_475_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/coastal.pdf", updatedAt: "2026-10-26T19:30:00.000Z" },
  { id: DEMO_EXTRA_DEAL_IDS.pipHotel, title: "Desert Palms Hotel PIP (demo)", program: "PIP_BRIDGE", stage: "closing", borrowerName: "Desert Palms Example LLC", propertyAddress: "700 Illustration Dr, Palm Springs", loanAmountCents: 710_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/desert-palms.pdf", updatedAt: "2026-10-25T17:45:00.000Z", lockedTerms: { lenderName: "Sample Bridge Lender (demo)", noteRatePct: 9.25, termMonths: 24 } },
  { id: DEMO_EXTRA_DEAL_IDS.cedarCourt, title: "Cedar Court Refinance (demo)", program: "HUD_MULTIFAMILY", stage: "lost", status: "lost", borrowerName: "Cedar Court Example LP", propertyAddress: "800 Sample Ct, Stockton", loanAmountCents: 2_200_000_000, collateralRealProperty: true, updatedAt: "2026-10-10T12:00:00.000Z" },
  { id: DEMO_SUBMISSION_DEAL_IDS.ready, title: "Brindle Example Apartments (demo)", program: "PRIVATE_BRIDGE", stage: "packaging", borrowerName: "Brindle Example Partners LLC", propertyAddress: "900 Example Court, Oakland, CA 94611", loanAmountCents: 840_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/brindle.pdf", updatedAt: "2026-11-18T19:30:00.000Z", leadId: DEMO_LEAD_IDS.ready },
  { id: DEMO_SUBMISSION_DEAL_IDS.empty, title: "Larkspur Example Terrace (demo)", program: "PRIVATE_BRIDGE", stage: "engaged", borrowerName: "Larkspur Example Holdings LLC", propertyAddress: "1200 Example Terrace, San Jose, CA 95112", loanAmountCents: 520_000_000, collateralRealProperty: true, engagementAgreementRef: "demo://engagement/larkspur.pdf", updatedAt: "2026-11-02T17:00:00.000Z", leadId: DEMO_LEAD_IDS.empty },
];

// Contact info uses only fictional .example domains and 555-01xx numbers.
const DEMO_LENDERS: LenderRow[] = [
  {
    id: DEMO_LENDER_IDS.bank,
    partnerId: null,
    name: "Example Community Bank (demo)",
    category: "STATE_BANK",
    categoryEvidenceRef: "demo://charter/example-bank",
    programs: ["HUD_232", "SBA_7A", "SBA_504", "BANK_LIFE_CO", "CONSTRUCTION", "AGENCY"],
    // Each demo lender's loan types equal deriveLenderLoanTypes() of its own fields (lib/deals/demo.test.ts).
    loanTypes: ["construction", "sba", "hud_fha", "agency", "bank"],
    minLoanCents: 100_000_000,
    maxLoanCents: 5_000_000_000,
    states: ["CA"],
    assetTypes: [],
    appetiteNotes: "Invented lender for the demo desk.",
    brokerFriendly: true,
    feeSplitKind: "percent_of_lender_fee",
    feeSplitValue: 50,
    feeAgreementRef: "demo://agreements/example-bank.pdf",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    verifiedBy: "staff:broker@corin.test",
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "staff:broker@corin.test",
    ...EMPTY_LENDER_CONTACT_INFO,
    mainPhone: "+13105550100",
    submissionEmail: "submissions@bank.example",
    websiteUrl: "https://bank.example/",
    addressLine1: "100 Example Way",
    city: "Los Angeles",
    addressState: "CA",
    postalCode: "90012",
    contactInfoVersion: 1,
  },
  {
    id: DEMO_LENDER_IDS.privateFund,
    partnerId: null,
    name: "Sample Private Fund (demo)",
    category: "CFL_LICENSEE",
    categoryEvidenceRef: "demo://cfl/sample-fund",
    programs: ["PRIVATE_BRIDGE", "HARD_MONEY", "PIP_BRIDGE"],
    loanTypes: ["bridge", "private_money", "hotel"],
    minLoanCents: 25_000_000,
    maxLoanCents: 2_500_000_000,
    states: [],
    assetTypes: [],
    appetiteNotes: "Invented lender for the demo desk.",
    brokerFriendly: true,
    feeSplitKind: "none",
    feeSplitValue: 0,
    feeAgreementRef: null,
    verifiedAt: "2026-10-01T00:00:00.000Z",
    verifiedBy: "staff:broker@corin.test",
    active: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "staff:broker@corin.test",
    ...EMPTY_LENDER_CONTACT_INFO,
    websiteUrl: "https://fund.example/",
    contactInfoVersion: 1,
  },
  {
    id: DEMO_LENDER_IDS.dscrFund,
    partnerId: null,
    name: "Sample DSCR Lender (demo)",
    category: "CFL_LICENSEE",
    categoryEvidenceRef: null,
    programs: [],
    loanTypes: ["fix_flip", "dscr"],
    minLoanCents: 10_000_000,
    maxLoanCents: 300_000_000,
    states: [],
    assetTypes: ["SFR 1-4 (investor)"],
    appetiteNotes: "Invented lender for the demo desk: DSCR rental and fix & flip loans for investors. | Lends in CA: Unconfirmed",
    brokerFriendly: false,
    feeSplitKind: "none",
    feeSplitValue: 0,
    feeAgreementRef: null,
    verifiedAt: null,
    verifiedBy: null,
    active: false,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    updatedBy: "staff:broker@corin.test",
    ...EMPTY_LENDER_CONTACT_INFO,
    contactInfoVersion: 1,
  },
];

const demoContact = (c: Pick<LenderContact, "id" | "lenderId" | "fullName" | "email" | "role" | "isPrimary"> & Partial<LenderContact>): LenderContact => ({
  title: null,
  phoneDirect: null,
  phoneExt: null,
  phoneMobile: null,
  preferredChannel: null,
  territory: null,
  notes: null,
  status: "active",
  leftAt: null,
  source: "staff",
  verifiedAt: null,
  verifiedBy: null,
  recordVersion: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "staff:broker@corin.test",
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: null,
  ...c,
});

// The primaries' emails are the submission recipients the demo flows used before contacts existed.
const DEMO_LENDER_CONTACTS: LenderContact[] = [
  demoContact({ id: DEMO_LENDER_CONTACT_IDS.bankPrimary, lenderId: DEMO_LENDER_IDS.bank, fullName: "Demo Lender Contact", email: "lending@bank.example", role: "account_executive", isPrimary: true, phoneDirect: "+13105550123" }),
  demoContact({ id: DEMO_LENDER_CONTACT_IDS.bankUnderwriter, lenderId: DEMO_LENDER_IDS.bank, fullName: "Demo Underwriter", email: "underwriting@bank.example", role: "underwriter", isPrimary: false }),
  demoContact({ id: DEMO_LENDER_CONTACT_IDS.fundPrimary, lenderId: DEMO_LENDER_IDS.privateFund, fullName: "Demo Fund Contact", email: "deals@fund.example", role: "other", isPrimary: true }),
];

const POST_TERM_SHEET_STAGES = new Set(["application", "third_party_reports", "plan_and_cost_review", "hud_review", "firm_commitment", "lender_underwriting", "sba_authorization", "underwriting", "commitment", "closing", "closed"]);

/**
 * Writes the demo deals and lender panel into `store` (synchronously, so the
 * first request sees them). With a keyring, the demo bank also gets a sealed
 * broker ID.
 */
export function seedDemoDealDesk(store: MemoryDealDeskStore = new MemoryDealDeskStore(), keyring?: PiiKeyring | null): MemoryDealDeskStore {
  for (const d of DEMO_DEALS) {
    const template = stageTemplate(d.program);
    const key = `${template.program}:${template.version}`;
    if (!store.templates.has(key)) store.templates.set(key, { template: structuredClone(template), digest: templateDigest(template) });
    const locked = POST_TERM_SHEET_STAGES.has(d.stage);
    const deal: Deal = {
      id: d.id,
      title: d.title,
      program: d.program,
      stage: d.stage,
      status: d.status ?? "active",
      stageTemplateVersion: template.version,
      stageEnteredAt: d.updatedAt,
      leadId: d.leadId ?? null,
      twentyOpportunityId: null,
      ownerId: null,
      borrowerName: d.borrowerName,
      propertyAddress: d.propertyAddress,
      propertyState: "CA",
      loanAmountCents: d.loanAmountCents,
      collateralRealProperty: d.collateralRealProperty,
      engagementAgreementRef: d.engagementAgreementRef ?? null,
      termSheetAcceptedAt: locked ? d.updatedAt : null,
      lockedFields: locked ? [...template.lockedFields] : [],
      lockedTerms: locked ? (d.lockedTerms ?? null) : null,
      lockOverrideRef: null,
      closedOn: null,
      originKey: null,
      recordVersion: 1,
      createdAt: d.updatedAt,
      updatedAt: d.updatedAt,
      updatedBy: "staff:broker@corin.test",
    };
    store.deals.set(deal.id, deal);
  }
  for (const l of DEMO_LENDERS) store.lenders.set(l.id, structuredClone(l));
  for (const c of DEMO_LENDER_CONTACTS) store.lenderContacts.set(c.id, structuredClone(c));
  if (keyring) {
    const sealed = sealLenderAccountNumber(DEMO_LENDER_ACCOUNT.id, DEMO_LENDER_ACCOUNT.value, keyring);
    store.lenderAccounts.set(DEMO_LENDER_ACCOUNT.id, {
      id: DEMO_LENDER_ACCOUNT.id,
      lenderId: DEMO_LENDER_IDS.bank,
      kind: DEMO_LENDER_ACCOUNT.kind,
      label: DEMO_LENDER_ACCOUNT.label,
      numberEnc: sealed.numberEnc,
      numberLast4: sealed.numberLast4,
      notes: null,
      recordVersion: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: "staff:admin@corin.test",
      updatedAt: "2026-10-01T00:00:00.000Z",
      updatedBy: null,
    });
  }
  return store;
}

// ---------------------------------------------------------------------------
// Lender-ready submission demo (invented figures; no principal is named in free text)

const usd = (dollars: number) => Math.round(dollars * 100);
const SUBMISSION_ACTOR = "staff:broker@corin.test";

/** The lead intakes behind the submission demo deals (dollars, as the qualifier posts them). */
export const DEMO_LEAD_INTAKES: ReadonlyMap<string, { intake: unknown; createdAt: string }> = new Map([
  [
    DEMO_LEAD_IDS.ready,
    { intake: { assetType: "MULTIFAMILY", transaction: "PURCHASE", loanAmount: 8_400_000, noi: 750_000, value: 12_000_000, unitCount: 42, occupancyPct: 88, timelineDays: 120, nonRecourseOnly: true, creditBand: "740_PLUS", source: "website" }, createdAt: "2026-09-08T16:20:00.000Z" },
  ],
  [
    DEMO_LEAD_IDS.empty,
    { intake: { assetType: "MULTIFAMILY", transaction: "REFINANCE", loanAmount: 5_200_000, noi: 410_000, value: 7_400_000, unitCount: 30, occupancyPct: 92, timelineDays: 60, nonRecourseOnly: true, creditBand: "700_739", source: "website" }, createdAt: "2026-11-02T17:00:00.000Z" },
  ],
]);

function demoReadyProfile(): SubmissionProfile {
  const fields = assertProfileFields({
    ...blankSubmissionProfileFields("bridge"),
    purpose: "acquisition",
    requestedTermMonths: 24,
    requestedIoMonths: 24,
    rateType: "floating",
    recourse: "non_recourse",
    lienPosition: "first",
    targetCloseDate: "2027-01-15",
    closeDriver: "Purchase contract closes January 15, 2027",
    prepayPreference: "Open after month 12",
    assumedRatePct: 8.75,
    assumedAmortMonths: 360,
    assetType: "MULTIFAMILY",
    propertyName: "Brindle Example Apartments",
    city: "Oakland",
    county: "Alameda",
    postalCode: "94611",
    yearBuilt: 1972,
    sizeCount: 42,
    sizeUnit: "units",
    rentableSf: 36_800,
    tenancy: "multi_tenant",
    occupancyPct: 88,
    occupancyAsOf: "2026-10-31",
    floodZone: "X",
    rentControl: true,
    seismicZone: true,
    purchasePriceCents: usd(12_000_000),
    purchaseCloseDate: "2027-01-15",
    asIsValueCents: usd(12_350_000),
    asIsValueSource: "broker_opinion",
    asIsValueAsOf: "2026-10-20",
    stabilizedValueCents: usd(16_000_000),
    stabilizedValueSource: "broker_opinion",
    revenueCents: usd(1_410_000),
    expensesCents: usd(645_000),
    noiInPlaceCents: usd(765_000),
    noiPeriodEnd: "2026-09-30",
    noiBasis: "t12",
    noiStabilizedCents: usd(1_020_000),
    stabilizationMonths: 24,
    businessPlan:
      "Buy a 42-unit 1972 garden building below replacement cost and renovate 30 units as they turn over (kitchens, baths, flooring, laundry hookups). Replace the roof, finish the city-required soft-story seismic retrofit and refresh the common areas, taking NOI from $765,000 to about $1,020,000 within two years.",
    exitStrategy: "refinance",
    exitMonths: 24,
    exitDetail: "Refinance into an agency or bank loan on stabilized NOI of about $1,020,000; at a 6.5% rate and 1.25x the take-out is about $11,500,000, well above this loan plus the exit fee.",
    highlights: ["Basis about $286,000 a unit, below recent Oakland sales", "Soft-story retrofit already permitted"],
    risks: [{ risk: "In-place DSCR is below 1.0x at the assumed bridge rate", mitigant: "A $420,000 interest reserve covers about seven months of interest; renovated units add income from month 4." }],
    sources: [
      { kind: "senior_loan", amountCents: usd(8_400_000) },
      { kind: "sponsor_equity", amountCents: usd(4_188_000) },
      { kind: "investor_equity", amountCents: usd(1_500_000) },
    ],
    uses: [
      { kind: "purchase_price", amountCents: usd(12_000_000) },
      { kind: "renovation", amountCents: usd(1_260_000) },
      { kind: "closing_costs", amountCents: usd(240_000) },
      { kind: "financing_costs", amountCents: usd(168_000) },
      { kind: "interest_reserve", amountCents: usd(420_000) },
    ],
    programDetails: {
      rehab: { budgetCents: usd(1_260_000), scopeSummary: "Interior upgrades in 30 units as they turn, new roof, soft-story seismic retrofit and common areas", months: 18, reservesRequested: { interestCents: usd(420_000), capexCents: usd(1_260_000) } },
    },
    fieldSources: {
      assetType: { source: "borrower", by: SUBMISSION_ACTOR, at: "2026-10-02T18:00:00.000Z", ref: DEMO_LEAD_IDS.ready },
    },
  });
  return { id: "50000000-0000-4000-8000-000000000001", dealId: DEMO_SUBMISSION_DEAL_IDS.ready, createdAt: "2026-10-02T18:00:00.000Z", createdBy: SUBMISSION_ACTOR, updatedAt: "2026-11-18T19:30:00.000Z", updatedBy: SUBMISSION_ACTOR, recordVersion: 3, ...fields };
}

function demoReadySponsor(): SponsorProfile {
  const fields = assertSponsorFields({
    ...blankSponsorProfileFields(),
    experienceSummary: "The sponsor has bought, renovated and held East Bay apartment buildings since 2012, completing nine value-add renovations of 20 to 80 units, and manages its own portfolio.",
    yearsExperience: 14,
    similarProjectsCount: 9,
    portfolioCount: 11,
    portfolioSizeNote: "11 properties, 612 units in the East Bay",
    statedNetWorthCents: usd(18_500_000),
    statedLiquidityCents: usd(2_400_000),
    statedAsOf: "2026-09-30",
    creditBand: "740_PLUS",
    creditEvents: Object.fromEntries(creditEventKinds.map((k) => [k, { occurred: false }])),
    managementCompany: "Brindle Example Management (sponsor affiliate)",
  });
  return { id: "50000000-0000-4000-8000-000000000002", dealId: DEMO_SUBMISSION_DEAL_IDS.ready, createdAt: "2026-10-02T18:00:00.000Z", createdBy: SUBMISSION_ACTOR, updatedAt: "2026-11-14T18:00:00.000Z", updatedBy: SUBMISSION_ACTOR, recordVersion: 2, ...fields };
}

const demoPfs = (cash: number, securities: number, realEstate: number, mortgages: number): Pfs => ({
  asOf: "2026-10-15",
  assets: { cash, marketableSecurities: securities, retirementAccounts: 400_000, realEstate, businessInterests: 0, otherAssets: 0 },
  liabilities: { mortgages, notesPayable: 0, creditCards: 0, taxesOwed: 0, otherLiabilities: 0 },
  contingentLiabilities: { guarantees: 0, legalClaims: 0, other: 0 },
  annualIncome: { salary: 0, investmentIncome: 120_000, realEstateIncome: 900_000, otherIncome: 0 },
});
const demoReo = (address: string, value: number, loan: number, noi: number, monthlyDebt: number): ReoEntry => ({ address, propertyType: "Multifamily", ownershipPct: 100, status: "owned", marketValue: value, loanBalance: loan, monthlyDebtService: monthlyDebt, annualNoi: noi, maturityDate: "2029-06-01", inDefault: false });

/** The borrowing entity and its two guarantors, PFS sealed with the demo key. */
function demoReadyPrincipals(keyring: PiiKeyring): PrincipalRow[] {
  const ts = "2026-10-05T17:00:00.000Z";
  const base = (id: string, over: Partial<PrincipalRow>): PrincipalRow => ({
    id,
    dealId: DEMO_SUBMISSION_DEAL_IDS.ready,
    leadId: DEMO_LEAD_IDS.ready,
    parentId: null,
    kind: "individual",
    legalName: "",
    roles: [],
    title: null,
    ownershipPct: null,
    isGuarantor: false,
    email: null,
    phone: null,
    homeAddress: null,
    formationState: null,
    citizenship: null,
    reoSchedule: null,
    hud2530: null,
    creditAuthorization: null,
    hasSsn: false,
    hasDob: false,
    hasPfs: false,
    hasForm1919: false,
    pfsAsOf: null,
    taxIdIndex: null,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    ssnEnc: null,
    dobEnc: null,
    pfsEnc: null,
    form1919Enc: null,
    ...over,
  });
  const entity = "60000000-0000-4000-8000-000000000001";
  const one = "60000000-0000-4000-8000-000000000002";
  const two = "60000000-0000-4000-8000-000000000003";
  return [
    base(entity, { kind: "entity", legalName: "Brindle Example Partners LLC", roles: ["borrower_entity"], formationState: "CA" }),
    base(one, {
      parentId: entity,
      legalName: "Demo Guarantor One",
      roles: ["managing_member", "guarantor"],
      title: "Managing member",
      ownershipPct: 60,
      isGuarantor: true,
      reoSchedule: [demoReo("10 Example Row, Oakland CA", 9_800_000, 5_900_000, 610_000, 33_000), demoReo("22 Example Park, Berkeley CA", 7_400_000, 4_300_000, 455_000, 24_500)],
      ...sealPrincipalSecrets(one, { pfs: demoPfs(1_000_000, 600_000, 14_000_000, 3_900_000) }, { keyring }),
    }),
    base(two, {
      parentId: entity,
      legalName: "Demo Guarantor Two",
      roles: ["member", "guarantor"],
      title: "Member",
      ownershipPct: 40,
      isGuarantor: true,
      reoSchedule: [demoReo("31 Example Lane, Alameda CA", 6_100_000, 3_700_000, 380_000, 20_500)],
      ...sealPrincipalSecrets(two, { pfs: demoPfs(550_000, 400_000, 8_200_000, 2_250_000) }, { keyring }),
    }),
  ];
}

/** Seeds the submission demo: the ready deal's profile, sponsor and principals, and both deals' lead intakes. */
export function seedDemoSubmissions(desks: Pick<DemoDesks, "submission" | "principals" | "leadIntakes" | "keyring">): void {
  for (const [id, v] of DEMO_LEAD_INTAKES) desks.leadIntakes.set(id, structuredClone(v));
  const profile = demoReadyProfile();
  desks.submission.profiles.set(profile.dealId, profile);
  const sponsor = demoReadySponsor();
  desks.submission.sponsors.set(sponsor.dealId, sponsor);
  for (const p of demoReadyPrincipals(desks.keyring)) desks.principals.rows.set(p.id, p);
}

function buildDemoDesks(): DemoDesks {
  const licenses = new FakeLicenseLookup().set(DEMO_CONTRACTOR_LICENSE, {
    licenseNumber: DEMO_CONTRACTOR_LICENSE,
    businessName: "Example Builders Inc (demo)",
    status: "ACTIVE",
    issueDate: "2012-04-01",
    expirationDate: "2028-04-30",
    classifications: ["B"],
    bondOnFile: true,
    bondExpiresOn: null,
    workersCompStatus: "active",
    disciplinaryAction: false,
  });
  const deals = seedDemoDealDesk(new MemoryDealDeskStore(), DEMO_PII_KEYRING);
  const desks: DemoDesks = {
    deals,
    disclosures: new MemoryDisclosureStore(),
    storage: new MemoryDocumentStorage(),
    effects: new MemoryIdempotencyStore(),
    checklists: new MemoryChecklistStore(),
    principals: new MemoryPrincipalStore(),
    invites: new MemoryPortalInviteStore(),
    screenings: new MemoryScreeningStore(),
    holds: new MemoryDealHoldStore(),
    sanctions: new FakeSanctionsClient([{ entryId: "demo-sdn-0001", name: DEMO_SANCTIONED_NAME, kind: "individual", programs: ["DEMO"] }], { listVersion: "demo-sdn@2026-10-31" }),
    keyring: DEMO_PII_KEYRING,
    construction: new MemoryConstructionStore(),
    licenses,
    lenderStore: new MemoryLenderMatchStore(),
    partners: new MemoryPartnerSource(),
    termSheetMail: new MemoryTermSheetMailSource(),
    spreads: new MemorySpreadStore(),
    submission: new MemorySubmissionStore({ dealExists: (id) => deals.deals.has(id) }),
    leadIntakes: new Map(),
  };
  seedDemoSubmissions(desks);
  return desks;
}

const DEMO_KEY = Symbol.for("corin.desks.demo");

/**
 * The shared demo desks in fake-auth mode, or null in every other mode. One
 * bundle per server process, shared across route bundles (like the fake auth
 * store and the demo approvals queue).
 */
export function demoDesks(env: Record<string, string | undefined> = process.env): DemoDesks | null {
  if (!demoDesksEnabled(env)) return null;
  const g = globalThis as unknown as Record<symbol, DemoDesks | undefined>;
  return (g[DEMO_KEY] ??= buildDemoDesks());
}

/** Test hook: forget the shared demo bundle so the next call reseeds it. */
export function resetDemoDesks(): void {
  const g = globalThis as unknown as Record<symbol, DemoDesks | undefined>;
  delete g[DEMO_KEY];
}
