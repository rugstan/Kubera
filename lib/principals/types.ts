// Principals, guarantors and the borrower's ownership chain (WS-U).
//
// Restricted fields (SSN/ITIN, date of birth, the personal financial statement
// and the SBA Form 1919 answers) never exist in plaintext outside a request:
// lib/principals/crypto-fields.ts seals them with lib/privacy/crypto.ts before
// any store sees them, and the migration rejects anything that is not an
// encrypted envelope. Confidential fields (name, contact, REO schedule,
// previous participation) are stored as-is behind service-role RLS.

import { z } from "zod";

export const PRINCIPAL_KINDS = ["individual", "entity"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const PRINCIPAL_ROLES = [
  "borrower_entity",
  "managing_member",
  "general_partner",
  "member",
  "limited_partner",
  "shareholder",
  "officer",
  "director",
  "trustee",
  "guarantor",
  "key_principal",
  "operator",
  "management_agent",
] as const;
export type PrincipalRole = (typeof PRINCIPAL_ROLES)[number];

export const ROLE_LABEL: Record<PrincipalRole, string> = {
  borrower_entity: "Borrower",
  managing_member: "Managing member",
  general_partner: "General partner",
  member: "Member",
  limited_partner: "Limited partner",
  shareholder: "Shareholder",
  officer: "Officer",
  director: "Director",
  trustee: "Trustee",
  guarantor: "Guarantor",
  key_principal: "Key principal",
  operator: "Operator",
  management_agent: "Management agent",
};

/** Roles that control the borrower regardless of ownership share. */
export const CONTROL_ROLES: readonly PrincipalRole[] = ["managing_member", "general_partner", "officer", "director", "trustee"];

export const CITIZENSHIP = ["us_citizen", "lawful_permanent_resident", "other"] as const;
export type Citizenship = (typeof CITIZENSHIP)[number];

// --- Personal financial statement (restricted; encrypted as one JSON value) -----------

const money = z.number().finite().min(0).max(1e11);

export const pfsSchema = z.object({
  asOf: z.iso.date(),
  assets: z.object({
    cash: money,
    marketableSecurities: money,
    retirementAccounts: money,
    realEstate: money,
    businessInterests: money,
    otherAssets: money,
  }),
  liabilities: z.object({
    mortgages: money,
    notesPayable: money,
    creditCards: money,
    taxesOwed: money,
    otherLiabilities: money,
  }),
  contingentLiabilities: z.object({
    guarantees: money,
    legalClaims: money,
    other: money,
  }),
  annualIncome: z.object({
    salary: money,
    investmentIncome: money,
    realEstateIncome: money,
    otherIncome: money,
  }),
  notes: z.string().max(2000).optional(),
});
export type Pfs = z.infer<typeof pfsSchema>;

// --- Schedule of real estate owned (confidential) -------------------------------------

export const reoEntrySchema = z.object({
  address: z.string().trim().min(3).max(300),
  propertyType: z.string().trim().min(2).max(80),
  ownershipPct: z.number().min(0).max(100),
  status: z.enum(["owned", "in_contract", "sold_last_3_years"]),
  acquiredYear: z.number().int().min(1900).max(2100).optional(),
  marketValue: money,
  loanBalance: money,
  lender: z.string().trim().max(200).optional(),
  monthlyDebtService: money,
  annualNoi: z.number().finite().min(-1e10).max(1e10),
  maturityDate: z.iso.date().optional(),
  inDefault: z.boolean().default(false),
});
export type ReoEntry = z.infer<typeof reoEntrySchema>;
export const reoScheduleSchema = z.array(reoEntrySchema).max(500);

// --- HUD-2530 previous participation (confidential) ------------------------------------

export const hud2530ProjectSchema = z.object({
  projectName: z.string().trim().min(2).max(200),
  fhaOrContractNumber: z.string().trim().max(40).optional(),
  role: z.string().trim().min(2).max(120),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  status: z.enum(["active", "completed", "terminated"]),
  defaultOrClaim: z.boolean(),
  explanation: z.string().max(2000).optional(),
});
export const hud2530Schema = z.object({
  noPriorParticipation: z.boolean(),
  projects: z.array(hud2530ProjectSchema).max(200),
  certifications: z.object({
    /** No mortgage default, assignment or foreclosure on a HUD-insured or assisted project in the last 10 years. */
    noDefaultsLast10Years: z.boolean(),
    /** Not suspended, debarred or under a limited denial of participation. */
    notDebarredOrSuspended: z.boolean(),
    /** No unresolved HUD audit or management review findings. */
    noUnresolvedFindings: z.boolean(),
  }),
});
export type Hud2530 = z.infer<typeof hud2530Schema>;

// --- SBA Form 1919 eligibility answers (restricted; encrypted) -------------------------
// VERIFY: question wording against the current SBA Form 1919 before relying on the prefill.

export const FORM_1919_QUESTIONS = {
  subjectToCriminalCharges: "Are you presently subject to an indictment, criminal information, arraignment or other formal criminal charge?",
  incarceratedOrOnProbation: "Are you currently incarcerated, on probation or on parole?",
  delinquentFederalDebt: "Are you delinquent on any federal debt, including a federal student loan or a tax lien?",
  priorGovernmentLoss: "Have you, or a business you controlled, ever caused a loss to the government on a federal loan or loan guaranty?",
  debarredOrSuspended: "Are you suspended, debarred or otherwise excluded from federal programs?",
  sbaEmployeeAffiliation: "Is any owner, officer or their household member an SBA employee, SCORE volunteer or member of Congress?",
} as const;
export type Form1919Question = keyof typeof FORM_1919_QUESTIONS;

export const form1919Schema = z.object({
  answers: z.object(Object.fromEntries(Object.keys(FORM_1919_QUESTIONS).map((k) => [k, z.boolean()])) as Record<Form1919Question, z.ZodBoolean>),
  veteranStatus: z.enum(["not_veteran", "veteran", "service_disabled_veteran", "spouse_of_veteran", "prefer_not_to_say"]).optional(),
  explanation: z.string().max(4000).optional(),
});
export type Form1919Answers = z.infer<typeof form1919Schema>;

// --- Credit authorization (consent record; confidential) --------------------------------

export type CreditAuthorization = {
  textVersion: string;
  textSha256: string;
  consentedAt: string;
  /** Name typed as the electronic signature. */
  signatureName: string;
  ip: string | null;
  userAgent: string | null;
  capturedVia: "portal" | "staff_upload";
};

// --- Tax id ----------------------------------------------------------------------------------

/** SSA rules: no 000/666/9xx area, no 00 group, no 0000 serial. ITINs start with 9 and use groups 50–65, 70–88, 90–92, 94–99. */
export function taxIdKind(raw: string): "ssn" | "itin" | null {
  const d = raw.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(d)) return null;
  const area = d.slice(0, 3);
  const group = Number(d.slice(3, 5));
  const serial = d.slice(5);
  if (d.startsWith("9")) {
    const ok = (group >= 50 && group <= 65) || (group >= 70 && group <= 88) || (group >= 90 && group <= 92) || (group >= 94 && group <= 99);
    return ok ? "itin" : null;
  }
  if (area === "000" || area === "666" || group === 0 || serial === "0000") return null;
  return "ssn";
}

export const taxIdSchema = z
  .string()
  .trim()
  .refine((v) => taxIdKind(v) !== null, "Enter a valid 9-digit SSN or ITIN.")
  .transform((v) => v.replace(/[\s-]/g, ""));

// --- Principal records ------------------------------------------------------------------------

/** The restricted values, in plaintext, only ever held in memory. */
export type PrincipalSecrets = {
  ssn?: string | null;
  dob?: string | null;
  pfs?: Pfs | null;
  form1919?: Form1919Answers | null;
};

export type Principal = {
  id: string;
  dealId: string;
  leadId: string | null;
  parentId: string | null;
  kind: PrincipalKind;
  legalName: string;
  roles: PrincipalRole[];
  title: string | null;
  /** Share of the parent entity this principal owns (0–100); null for the borrower itself. */
  ownershipPct: number | null;
  isGuarantor: boolean;
  email: string | null;
  phone: string | null;
  homeAddress: string | null;
  /** Entities: state of formation. */
  formationState: string | null;
  citizenship: Citizenship | null;
  reoSchedule: ReoEntry[] | null;
  hud2530: Hud2530 | null;
  creditAuthorization: CreditAuthorization | null;
  /** Presence flags for the encrypted fields (never the values). */
  hasSsn: boolean;
  hasDob: boolean;
  hasPfs: boolean;
  hasForm1919: boolean;
  pfsAsOf: string | null;
  /** Blind index of the tax id for duplicate detection across deals. */
  taxIdIndex: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Row shape persisted by stores: restricted columns hold `pii1.` envelopes only. */
export type PrincipalRow = Principal & {
  ssnEnc: string | null;
  dobEnc: string | null;
  pfsEnc: string | null;
  form1919Enc: string | null;
};

export const principalInputSchema = z
  .object({
    dealId: z.uuid(),
    leadId: z.uuid().nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    kind: z.enum(PRINCIPAL_KINDS),
    legalName: z.string().trim().min(2).max(200),
    roles: z.array(z.enum(PRINCIPAL_ROLES)).min(1).max(8),
    title: z.string().trim().max(120).nullable().optional(),
    ownershipPct: z.number().min(0).max(100).nullable().optional(),
    isGuarantor: z.boolean().default(false),
    email: z.email().max(200).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    homeAddress: z.string().trim().max(300).nullable().optional(),
    formationState: z.string().trim().length(2).toUpperCase().nullable().optional(),
    citizenship: z.enum(CITIZENSHIP).nullable().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.roles.includes("borrower_entity")) {
      if (p.kind !== "entity") ctx.addIssue({ code: "custom", path: ["kind"], message: "The borrower must be an entity." });
      if (p.parentId) ctx.addIssue({ code: "custom", path: ["parentId"], message: "The borrower sits at the top of the chart." });
    } else if (!p.parentId) {
      ctx.addIssue({ code: "custom", path: ["parentId"], message: "Choose the entity this principal owns or controls." });
    }
    if (p.kind === "entity" && (p.homeAddress || p.citizenship)) ctx.addIssue({ code: "custom", path: ["kind"], message: "Home address and citizenship apply to individuals only." });
  });
export type PrincipalInput = z.input<typeof principalInputSchema>;
