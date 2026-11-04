// Sanctions screening policy (pure). A possible match is never cleared by
// software: it holds the deal until a broker or admin reviews it and records a
// disposition with a reason. A confirmed match stays held and goes to counsel
// (OFAC blocking and reporting questions are counsel's call). Every subject is
// rescreened shortly before closing against the current list version.

import type { ScreeningDisposition, ScreeningRecord, ScreeningResponse, ScreeningResult } from "./types";

export const SCREENING_POLICY = {
  /** Provider score at or above which a result is a possible match needing review. */
  reviewThreshold: 0.7,
  // VERIFY: lender and counsel rescreen window. Corin default: every subject screened within 7 days before closing.
  preClosingWindowDays: 7,
  /** Reviewer notes must say why a possible match is or is not the subject. */
  minReviewNoteLength: 10,
} as const;

export type Classification = { result: Exclude<ScreeningResult, "error">; matchScore: number | null; disposition: ScreeningDisposition };

export function classifyResponse(response: ScreeningResponse, threshold: number = SCREENING_POLICY.reviewThreshold): Classification {
  const top = response.matches[0]?.score ?? null;
  const hit = response.matches.some((m) => m.providerMatch === true || m.score >= threshold);
  return hit ? { result: "potential_match", matchScore: top, disposition: "pending_review" } : { result: "clear", matchScore: top, disposition: "not_required" };
}

/** Dispositions that keep the deal on hold. */
export const HOLDING_DISPOSITIONS: readonly ScreeningDisposition[] = ["pending_review", "escalated", "confirmed_match"];

const NEXT_DISPOSITIONS: Record<ScreeningDisposition, readonly ScreeningDisposition[]> = {
  not_required: [],
  pending_review: ["false_positive", "confirmed_match", "escalated"],
  escalated: ["false_positive", "confirmed_match"],
  false_positive: [],
  confirmed_match: [],
};

export function canDisposition(from: ScreeningDisposition, to: ScreeningDisposition): boolean {
  return NEXT_DISPOSITIONS[from].includes(to);
}

export type ScreeningSubjectRef = { principalId: string; name: string };

export type SubjectStatus = {
  principalId: string;
  name: string;
  latest: ScreeningRecord | null;
  state: "unscreened" | "error" | "clear" | "held" | "confirmed_match";
  /** Latest clear (or reviewed false positive) screening, if any. */
  lastCleared: ScreeningRecord | null;
};

export type ScreeningGate = {
  /** True when any possible or confirmed match is unresolved: the deal is on hold. */
  held: boolean;
  /** A confirmed match: counsel review, the deal does not proceed. */
  counselReview: boolean;
  holdReasons: string[];
  /** Ready for closing: every subject cleared within the pre-closing window, nothing held. */
  clearForClosing: boolean;
  blocking: { principalId: string; name: string; reason: string }[];
  subjects: SubjectStatus[];
};

const DAY = 86_400_000;
const isCleared = (s: ScreeningRecord) => s.result === "clear" || (s.result === "potential_match" && s.disposition === "false_positive");

export function screeningGate(input: { subjects: readonly ScreeningSubjectRef[]; screenings: readonly ScreeningRecord[]; closingDate?: Date; now: Date; windowDays?: number }): ScreeningGate {
  const windowDays = input.windowDays ?? SCREENING_POLICY.preClosingWindowDays;
  const ref = input.closingDate ?? input.now;
  const holdReasons: string[] = [];
  const blocking: ScreeningGate["blocking"] = [];
  const subjects: SubjectStatus[] = [];
  let counselReview = false;

  // Any unresolved possible match on the deal holds it, even for someone no longer on the chart.
  for (const s of input.screenings) {
    if (s.result === "potential_match" && HOLDING_DISPOSITIONS.includes(s.disposition)) {
      if (s.disposition === "confirmed_match") counselReview = true;
      holdReasons.push(
        s.disposition === "confirmed_match"
          ? `${s.subjectName}: confirmed sanctions match. Do not proceed; counsel review required.`
          : `${s.subjectName}: possible sanctions match (score ${s.matchScore ?? "n/a"}) awaiting review.`,
      );
    }
  }

  for (const subject of input.subjects) {
    const mine = input.screenings.filter((s) => s.principalId === subject.principalId).sort((a, b) => Date.parse(b.screenedAt) - Date.parse(a.screenedAt));
    const latest = mine[0] ?? null;
    const lastCleared = mine.find(isCleared) ?? null;
    const holding = mine.find((s) => s.result === "potential_match" && HOLDING_DISPOSITIONS.includes(s.disposition));
    let state: SubjectStatus["state"];
    if (holding) state = holding.disposition === "confirmed_match" ? "confirmed_match" : "held";
    else if (!latest) state = "unscreened";
    else if (lastCleared) state = "clear";
    else state = "error";
    subjects.push({ principalId: subject.principalId, name: subject.name, latest, state, lastCleared });

    if (state === "held" || state === "confirmed_match") blocking.push({ principalId: subject.principalId, name: subject.name, reason: "Possible sanctions match is unresolved." });
    else if (state === "unscreened") blocking.push({ principalId: subject.principalId, name: subject.name, reason: "Not screened yet." });
    else if (state === "error") blocking.push({ principalId: subject.principalId, name: subject.name, reason: "Screening did not complete; run it again." });
    else if (lastCleared) {
      const age = (ref.getTime() - Date.parse(lastCleared.screenedAt)) / DAY;
      if (!lastCleared.listVersion) blocking.push({ principalId: subject.principalId, name: subject.name, reason: "Screening has no list version on record; rescreen." });
      else if (age > windowDays) blocking.push({ principalId: subject.principalId, name: subject.name, reason: `Rescreen before closing (last cleared ${Math.floor(age)} days before; must be within ${windowDays}).` });
      else if (age < -1) blocking.push({ principalId: subject.principalId, name: subject.name, reason: "Screening is dated after the closing date." });
    }
  }

  const held = holdReasons.length > 0;
  return { held, counselReview, holdReasons, clearForClosing: !held && blocking.length === 0 && input.subjects.length > 0, blocking, subjects };
}
