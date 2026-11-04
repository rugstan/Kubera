// Market intel & prospecting (WS-S): shared types.
//
// Two jobs live here:
//   1. A weekly market-intel draft written from PUBLIC signals only (rate
//      benchmarks, regulator notices, news feeds). Never borrower, partner or
//      deal data: the model routing guard enforces it (lib/ai/routing.ts).
//   2. Refinance-maturity prospecting from recorded mortgage data, scored and
//      turned into outreach drafts that wait for broker approval.
//
// Nothing here sends anything by itself (Global rule 2) and nothing models
// funds (Global rule 1): a prospect's loan is the public-record mortgage on
// the property, not money Corin handles.

// ---------------------------------------------------------------------------
// Market intel

export const SIGNAL_SOURCES = ["rates", "federal_register", "feed", "manual"] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** One public item the weekly note may cite. Plain text only; no contact details. */
export type PublicSignal = {
  /** Stable id (hash of source + url/title) the note cites. */
  id: string;
  source: SignalSource;
  title: string;
  summary: string;
  url: string | null;
  /** ISO date (YYYY-MM-DD) or null when the item carries none. */
  publishedAt: string | null;
};

export type IntelBullet = { text: string; signalIds: string[] };
export type IntelSection = { title: string; bullets: IntelBullet[] };

export const INTEL_STATUSES = ["pending_review", "approved", "rejected", "superseded"] as const;
export type IntelStatus = (typeof INTEL_STATUSES)[number];

export const INTEL_STATUS_LABELS: Record<IntelStatus, string> = {
  pending_review: "Waiting for review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
};

export type IntelSignalRef = Pick<PublicSignal, "id" | "source" | "title" | "url" | "publishedAt">;

export type IntelDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Monday (ISO date) of the week the note covers. */
  weekStart: string;
  version: number;
  status: IntelStatus;
  generatedBy: "model" | "rules";
  model: string | null;
  servedModel: string | null;
  promptId: string | null;
  promptVersion: string | null;
  promptSha256: string | null;
  headline: string;
  summary: string;
  sections: IntelSection[];
  signals: IntelSignalRef[];
  guardrailHits: string[];
  injectionCodes: string[];
  /** Why the draft was written by rules instead of the model, or other run notes. */
  note: string | null;
  createdBy: string;
  editedBy: string | null;
  editedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

export type NewIntelDraft = Omit<IntelDraft, "id" | "createdAt" | "updatedAt" | "version" | "status" | "editedBy" | "editedAt" | "reviewedBy" | "reviewedAt" | "reviewNote">;

export type IntelEdit = { headline: string; summary: string; sections: IntelSection[] };

export const INTEL_LIMITS = {
  headline: 200,
  summary: 4_000,
  bulletText: 600,
  sectionTitle: 120,
  maxSections: 8,
  maxBullets: 8,
  reviewNote: 1_000,
} as const;

// ---------------------------------------------------------------------------
// Prospecting

export const PROPERTY_TYPES = ["multifamily", "hotel", "senior_housing", "retail", "office", "industrial", "mixed_use", "self_storage", "special_purpose", "other"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  multifamily: "Multifamily",
  hotel: "Hotel",
  senior_housing: "Senior housing / healthcare",
  retail: "Retail",
  office: "Office",
  industrial: "Industrial",
  mixed_use: "Mixed use",
  self_storage: "Self storage",
  special_purpose: "Special purpose",
  other: "Other",
};

export const OWNER_KINDS = ["entity", "individual", "unknown"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const PROSPECT_PROGRAMS = ["hud_223f", "hud_232", "sba_504", "sba_7a", "hotel_cmbs", "agency", "bank_life_co", "bridge", "other"] as const;
export type ProspectProgram = (typeof PROSPECT_PROGRAMS)[number];

export const PROSPECT_PROGRAM_LABELS: Record<ProspectProgram, string> = {
  hud_223f: "HUD 223(f) refinance",
  hud_232: "HUD 232 / 223(f) healthcare refinance",
  sba_504: "SBA 504",
  sba_7a: "SBA 7(a)",
  hotel_cmbs: "Hotel CMBS",
  agency: "Fannie Mae / Freddie Mac",
  bank_life_co: "Bank / life company",
  bridge: "Bridge",
  other: "To be determined",
};

export const WINDOW_BUCKETS = ["matured", "under_3_months", "months_3_6", "months_6_12", "months_12_18", "later"] as const;
export type WindowBucket = (typeof WINDOW_BUCKETS)[number];

export const WINDOW_BUCKET_LABELS: Record<WindowBucket, string> = {
  matured: "Past stated maturity",
  under_3_months: "Under 3 months",
  months_3_6: "3 to 6 months",
  months_6_12: "6 to 12 months",
  months_12_18: "12 to 18 months",
  later: "More than 18 months",
};

export const PROSPECT_STATUSES = ["new", "reviewing", "drafted", "contacted", "engaged", "not_a_fit", "do_not_contact"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  drafted: "Outreach drafted",
  contacted: "Contacted",
  engaged: "Engaged",
  not_a_fit: "Not a fit",
  do_not_contact: "Do not contact",
};

export type MailingAddress = { line1: string | null; city: string | null; state: string | null; zip: string | null };

/** One recorded mortgage on one property, as a data provider reports it. Money is in US dollars. */
export type MaturityRecord = {
  source: "attom" | "reonomy" | "fake" | "manual";
  /** The provider's id for the property or loan, when it has one. */
  sourceRef: string | null;
  address: { line1: string; city: string | null; state: string | null; zip: string | null };
  apn: string | null;
  propertyType: PropertyType;
  units: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  ownerName: string | null;
  ownerKind: OwnerKind;
  mailing: MailingAddress | null;
  loan: {
    lender: string | null;
    originalAmount: number | null;
    originationDate: string | null;
    maturityDate: string;
    ratePct: number | null;
    loanType: string | null;
  };
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  /** Date the provider's record was current (ISO date). */
  dataAsOf: string;
};

export type ScoreFactor = { factor: string; points: number; max: number; detail: string };

export type Prospect = {
  id: string;
  createdAt: string;
  updatedAt: string;
  dedupeKey: string;
  source: MaturityRecord["source"];
  sourceRef: string | null;
  scanId: string | null;
  addressLine1: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  apn: string | null;
  propertyType: PropertyType;
  units: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  ownerName: string | null;
  ownerKind: OwnerKind;
  mailing: MailingAddress | null;
  contactName: string | null;
  contactEmail: string | null;
  loanOriginalCents: number | null;
  loanLender: string | null;
  loanOriginationDate: string | null;
  loanMaturityDate: string;
  loanRatePct: number | null;
  loanType: string | null;
  lastSaleDate: string | null;
  lastSalePriceCents: number | null;
  dataAsOf: string;
  score: number;
  scoreFactors: ScoreFactor[];
  recommendedProgram: ProspectProgram | null;
  windowBucket: WindowBucket;
  status: ProspectStatus;
  assignedTo: string | null;
  notes: string | null;
  lastScannedAt: string;
  updatedBy: string | null;
};

/** What a scan writes. Staff-owned fields (contact, status, notes, assignee) are never overwritten by a re-scan. */
export type ScannedProspect = Omit<Prospect, "id" | "createdAt" | "updatedAt" | "contactName" | "contactEmail" | "status" | "assignedTo" | "notes" | "updatedBy">;

export type StaffProspectEdit = {
  contactName?: string | null;
  contactEmail?: string | null;
  status?: ProspectStatus;
  assignedTo?: string | null;
  notes?: string | null;
};

export type ProspectScan = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  provider: "attom" | "reonomy" | "fake";
  status: "running" | "completed" | "failed";
  params: Record<string, unknown>;
  found: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  error: string | null;
  startedBy: string;
};

export const OUTREACH_CHANNELS = ["email", "letter"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_STATUSES = ["pending_approval", "sent", "ready_to_mail", "mailed", "rejected", "expired", "failed", "blocked", "cancelled"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  pending_approval: "Waiting for broker approval",
  sent: "Sent",
  ready_to_mail: "Approved, ready to mail",
  mailed: "Mailed",
  rejected: "Rejected by broker",
  expired: "Approval expired, not sent",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export const OUTREACH_REASONS = [
  "approval_pending",
  "approval_rejected",
  "approval_expired",
  "reauth_required",
  "already_executed",
  "sent",
  "ready_to_mail",
  "mailed",
  "send_failed",
  "provider_unconfigured",
  "suppressed",
  "no_contact",
  "consent_revoked",
  "guardrail",
  "cancelled",
] as const;
export type OutreachReason = (typeof OUTREACH_REASONS)[number];

export type ProspectOutreach = {
  id: string;
  createdAt: string;
  updatedAt: string;
  prospectId: string;
  version: number;
  channel: OutreachChannel;
  status: OutreachStatus;
  reasonCode: OutreachReason | null;
  idempotencyKey: string;
  recipient: string;
  subject: string;
  bodyText: string;
  bodySha256: string;
  generatedBy: "template" | "model";
  model: string | null;
  guardrailHits: string[];
  approvalId: string | null;
  providerMessageId: string | null;
  error: string | null;
  draftedBy: string;
  sentAt: string | null;
  mailedAt: string | null;
  mailedBy: string | null;
};

export type NewProspectOutreach = Omit<
  ProspectOutreach,
  "id" | "createdAt" | "updatedAt" | "version" | "approvalId" | "providerMessageId" | "error" | "sentAt" | "mailedAt" | "mailedBy" | "reasonCode"
> & { reasonCode?: OutreachReason | null };

export type OutreachPatch = Partial<
  Pick<ProspectOutreach, "status" | "reasonCode" | "approvalId" | "providerMessageId" | "error" | "sentAt" | "mailedAt" | "mailedBy">
>;

export const SUPPRESSION_KINDS = ["email", "domain", "owner", "address"] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const SUPPRESSION_REASONS = ["opt_out", "complaint", "bounce", "staff"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type Suppression = {
  id: string;
  createdAt: string;
  kind: SuppressionKind;
  valueHash: string;
  label: string;
  reason: SuppressionReason;
  createdBy: string;
};
