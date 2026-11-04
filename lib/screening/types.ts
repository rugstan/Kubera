// Sanctions / KYC screening contract (WS-U). Every principal on a deal and the
// borrowing entity are screened against OFAC (SDN and consolidated lists) and
// other sanctions lists before a lender sees the file, and again before
// closing. A possible match holds the deal until a reviewer dispositions it.

export type ScreeningSubject = {
  kind: "individual" | "entity";
  name: string;
  /** ISO date; narrows individual matches (sent as birth date to the provider). */
  dateOfBirth?: string | null;
  /** ISO 3166-1 alpha-2 country codes (nationality, residence or incorporation). */
  countries?: readonly string[];
};

export type ScreeningMatch = {
  /** Provider entity id (stable across list versions). */
  entryId: string;
  name: string;
  /** 0–1 similarity reported by the provider (or computed for the fake). */
  score: number;
  /** Lists/datasets the entry appears on, e.g. "us_ofac_sdn". */
  lists: string[];
  programs: string[];
  birthDates: string[];
  countries: string[];
  /** The provider's own match flag, when it has one. */
  providerMatch: boolean | null;
};

export type ScreeningResponse = {
  provider: string;
  /** Version or publication date of the list data screened against (required for the record). */
  listVersion: string;
  listsChecked: string[];
  matches: ScreeningMatch[];
  screenedAt: string;
};

export interface SanctionsClient {
  readonly name: string;
  screen(subject: ScreeningSubject): Promise<ScreeningResponse>;
}

export class ScreeningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningUnavailableError";
  }
}

export const SCREENING_RESULTS = ["clear", "potential_match", "error"] as const;
export type ScreeningResult = (typeof SCREENING_RESULTS)[number];

export const SCREENING_DISPOSITIONS = ["not_required", "pending_review", "false_positive", "confirmed_match", "escalated"] as const;
export type ScreeningDisposition = (typeof SCREENING_DISPOSITIONS)[number];

export const SCREENING_PURPOSES = ["initial", "rescreen_pre_closing", "periodic", "manual"] as const;
export type ScreeningPurpose = (typeof SCREENING_PURPOSES)[number];

export type ScreeningRecord = {
  id: string;
  dealId: string;
  principalId: string | null;
  subjectKind: ScreeningSubject["kind"];
  subjectName: string;
  purpose: ScreeningPurpose;
  provider: string;
  listVersion: string | null;
  listsChecked: string[];
  result: ScreeningResult;
  matchScore: number | null;
  matches: ScreeningMatch[];
  error: string | null;
  disposition: ScreeningDisposition;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  requestedBy: string;
  screenedAt: string;
  createdAt: string;
};
