// Closed-transaction record for /track-record. Ships empty on purpose: an entry
// is added only after the transaction closed, the client gave written
// permission to be named or described, and a broker verified every field
// against the closing file. Never add illustrative or estimated deals here;
// those live in `content/deal-structures.ts` and are labeled illustrative.

export interface TrackRecordEntry {
  id: string;
  /** Year the loan funded. */
  closedYear: number;
  /** Property type, e.g. "Assisted living". */
  assetType: string;
  /** Program, e.g. "HUD 223(f)". Must be a program Corin actually arranged. */
  program: string;
  /** Loan amount in USD as closed. */
  loanAmountUsd: number;
  /** City and state or a region; omit street address unless the client agreed. */
  location: string;
  /** One or two factual sentences about the structure. */
  summary: string;
  /** Lender that funded as lender of record, if the client allows naming it. */
  lender?: string;
  /** Set only when the client gave written permission to publish this entry. */
  clientPermission: boolean;
  /** ISO date a broker checked this entry against the closing file. */
  verifiedOn: string;
}

export const TRACK_RECORD: readonly TrackRecordEntry[] = [];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An entry is publishable only with permission, a verification date and sane values. */
export function isPublishable(entry: TrackRecordEntry): boolean {
  return (
    entry.clientPermission === true &&
    ISO_DATE.test(entry.verifiedOn) &&
    Number.isFinite(entry.loanAmountUsd) &&
    entry.loanAmountUsd > 0 &&
    Number.isInteger(entry.closedYear) &&
    entry.summary.trim().length > 0
  );
}

export function publishableRecords(entries: readonly TrackRecordEntry[] = TRACK_RECORD): TrackRecordEntry[] {
  return entries.filter(isPublishable).sort((a, b) => b.closedYear - a.closedYear || b.loanAmountUsd - a.loanAmountUsd);
}
