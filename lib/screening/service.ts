// Screening workflow: screen every principal on a deal, hold the deal on any
// possible match, record reviewer dispositions, and answer "may this deal
// close?" for the pipeline. Screening is a lookup, not an outbound message,
// so it does not go through the approval gate; holds and releases are
// recorded in deal_holds and announced to the deal record through a sink.

import type { StaffIdentity } from "@/lib/checklists/staff";
import { openPrincipalSecrets } from "@/lib/principals/crypto-fields";
import type { PrincipalStore } from "@/lib/principals/store";
import type { PrincipalRow } from "@/lib/principals/types";
import type { PiiKeyring } from "@/lib/privacy/crypto";
import { canDisposition, classifyResponse, screeningGate, SCREENING_POLICY, type ScreeningGate } from "./policy";
import type { DealHold, DealHoldStore, ScreeningStore } from "./store";
import type { SanctionsClient, ScreeningDisposition, ScreeningPurpose, ScreeningRecord, ScreeningSubject } from "./types";

/** Notified when a deal goes on or comes off hold (WS-I/T wire this to the deal's pipeline status). */
export interface DealHoldSink {
  held(hold: DealHold): Promise<void>;
  released(dealId: string, sourceId: string): Promise<void>;
}

export const noopHoldSink: DealHoldSink = { async held() {}, async released() {} };

export type ScreeningDeps = {
  client: SanctionsClient | null;
  screenings: ScreeningStore;
  holds: DealHoldStore;
  principals: PrincipalStore;
  keyring?: PiiKeyring | null;
  sink?: DealHoldSink;
  now?: () => Date;
};

export class ScreeningReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningReviewError";
  }
}

const COUNTRY: Record<string, string[]> = { us_citizen: ["us"], lawful_permanent_resident: ["us"] };

function subjectFor(p: PrincipalRow, keyring?: PiiKeyring | null): ScreeningSubject {
  let dob: string | null = null;
  if (p.kind === "individual" && p.dobEnc) {
    try {
      dob = openPrincipalSecrets(p, { keyring, fields: ["dob"] }).dob;
    } catch {
      dob = null; // Screen on the name alone rather than not at all.
    }
  }
  return { kind: p.kind, name: p.legalName, dateOfBirth: dob, countries: p.kind === "individual" && p.citizenship ? COUNTRY[p.citizenship] : undefined };
}

/** Screens one principal and records the result (holding the deal on a possible match). */
export async function screenPrincipal(deps: ScreeningDeps, p: PrincipalRow, input: { purpose: ScreeningPurpose; requestedBy: string }): Promise<ScreeningRecord> {
  const now = deps.now?.() ?? new Date();
  const base = { dealId: p.dealId, principalId: p.id, subjectKind: p.kind, subjectName: p.legalName, purpose: input.purpose, requestedBy: input.requestedBy, reviewer: null, reviewedAt: null, reviewNote: null } as const;

  if (!deps.client) {
    return deps.screenings.insert({ ...base, provider: "none", listVersion: null, listsChecked: [], result: "error", matchScore: null, matches: [], error: "Sanctions screening is not configured (OPENSANCTIONS_API_KEY).", disposition: "not_required", screenedAt: now.toISOString() }, now);
  }
  try {
    const response = await deps.client.screen(subjectFor(p, deps.keyring));
    const c = classifyResponse(response);
    const record = await deps.screenings.insert({ ...base, provider: response.provider, listVersion: response.listVersion, listsChecked: response.listsChecked, result: c.result, matchScore: c.matchScore, matches: response.matches.slice(0, 10), error: null, disposition: c.disposition, screenedAt: response.screenedAt }, now);
    if (record.result === "potential_match") {
      const hold = await deps.holds.open({ dealId: p.dealId, reason: "sanctions_potential_match", sourceKind: "screening", sourceId: record.id, detail: `Possible sanctions match for ${p.legalName} (score ${record.matchScore ?? "n/a"}, ${response.listVersion}).`, createdBy: input.requestedBy }, now);
      await (deps.sink ?? noopHoldSink).held(hold);
    }
    return record;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return deps.screenings.insert({ ...base, provider: deps.client.name, listVersion: null, listsChecked: [], result: "error", matchScore: null, matches: [], error: message.slice(0, 500), disposition: "not_required", screenedAt: now.toISOString() }, now);
  }
}

/** Screens (or rescreens) every principal on the deal, including the borrowing entity. */
export async function screenDeal(deps: ScreeningDeps, input: { dealId: string; purpose: ScreeningPurpose; requestedBy: string; closingDate?: Date }): Promise<{ records: ScreeningRecord[]; gate: ScreeningGate }> {
  const principals = await deps.principals.forDeal(input.dealId);
  const records: ScreeningRecord[] = [];
  for (const p of principals) records.push(await screenPrincipal(deps, p, input));
  return { records, gate: await dealScreeningGate(deps, input.dealId, input.closingDate) };
}

export async function dealScreeningGate(deps: Pick<ScreeningDeps, "screenings" | "principals" | "now">, dealId: string, closingDate?: Date): Promise<ScreeningGate> {
  const [principals, screenings] = await Promise.all([deps.principals.forDeal(dealId), deps.screenings.forDeal(dealId)]);
  return screeningGate({ subjects: principals.map((p) => ({ principalId: p.id, name: p.legalName })), screenings, closingDate, now: deps.now?.() ?? new Date() });
}

/**
 * Records a reviewer's decision on a possible match. Brokers and admins can
 * clear (false positive) or confirm; analysts can only escalate. Clearing
 * releases the hold; confirming keeps it and adds a counsel-review hold.
 */
export async function dispositionScreening(deps: ScreeningDeps, input: { screeningId: string; to: ScreeningDisposition; reviewer: StaffIdentity; note: string }): Promise<ScreeningRecord> {
  const now = deps.now?.() ?? new Date();
  const current = await deps.screenings.get(input.screeningId);
  if (!current) throw new ScreeningReviewError("Screening not found.");
  if (current.result !== "potential_match") throw new ScreeningReviewError("Only possible matches are reviewed.");
  if (!canDisposition(current.disposition, input.to)) throw new ScreeningReviewError(`A ${current.disposition.replace(/_/g, " ")} screening cannot be marked ${input.to.replace(/_/g, " ")}.`);
  if (input.to !== "escalated" && input.reviewer.role === "analyst") throw new ScreeningReviewError("Only a broker or admin can clear or confirm a possible match; escalate it instead.");
  const note = input.note.trim();
  if (note.length < SCREENING_POLICY.minReviewNoteLength) throw new ScreeningReviewError(`Explain the decision (at least ${SCREENING_POLICY.minReviewNoteLength} characters), e.g. which identifiers differ.`);

  const updated = await deps.screenings.setDisposition(current.id, current.disposition, { disposition: input.to, reviewer: input.reviewer.email, reviewedAt: now.toISOString(), reviewNote: note });
  const sink = deps.sink ?? noopHoldSink;
  if (input.to === "false_positive") {
    await deps.holds.release("screening", current.id, input.reviewer.email, note, now);
    await sink.released(current.dealId, current.id);
  } else if (input.to === "confirmed_match") {
    const hold = await deps.holds.open({ dealId: current.dealId, reason: "sanctions_confirmed_match", sourceKind: "screening", sourceId: current.id, detail: `Confirmed sanctions match for ${current.subjectName}. Do not proceed; counsel review required.`, createdBy: input.reviewer.email }, now);
    await sink.held(hold);
  }
  return updated;
}
