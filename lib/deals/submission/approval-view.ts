// What a lender-submission approval actually approves (spec 5.1 step 5, 6.7),
// read from storage, never rebuilt: the lender_outreach row's stored subject
// and text, and the locked deal_summaries row the payload names by
// summaryId, each checked against the hash in the approval payload (and the
// email re-checked for restricted identifiers) right before it is shown. The
// approvals card renders this; the live preview is only ever the current
// draft, built for whoever is looking at it.

import type { ApprovalRecord } from "@/lib/approvals/types";
import type { DealDeskStore } from "../store";
import type { LenderOutreach } from "../types";
import { emailSha256 } from "./email";
import { findRestrictedText, restrictedTextMessage, type EmailSafetyOptions } from "./redaction";
import { summarySpecSha256 } from "./summary";
import type { DealSummarySpec, SubmissionStore } from "./types";

export type ApprovalSubmissionContent = {
  /** The submission row's status; approving sends nothing unless it is pending approval. */
  outreachStatus: LenderOutreach["status"] | null;
  email: { subject: string; text: string } | null;
  /** The stored subject and text hash to the row's own hash and to the payload's emailSha256, and hold no restricted identifier. */
  emailVerified: boolean;
  /** Why the email does not verify; null when it does. */
  emailProblem: string | null;
  summaryId: string | null;
  summary: DealSummarySpec | null;
  /** The locked summary's spec hashes to the payload's summarySha256 and to its stored spec_sha256. */
  summaryVerified: boolean;
};

export type ApprovalViewDeps = {
  store: Pick<DealDeskStore, "getOutreachByKey">;
  summaries: Pick<SubmissionStore, "getSummary">;
  /** The deal's principals' names (the email must not print them); none when the reader is not wired. */
  names?: (dealId: string) => Promise<EmailSafetyOptions>;
};

const payloadText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const EMAIL_HASH_MISMATCH = "This email does not match the SHA-256 in the approval request. Reject it and ask for the submission to be prepared again.";
export const EMAIL_NOT_FOUND = "The stored email for this request was not found. Reject it and ask for the submission to be prepared again.";

export async function loadApprovalSubmissionContent(deps: ApprovalViewDeps, r: Pick<ApprovalRecord, "kind" | "idempotencyKey" | "payload">): Promise<ApprovalSubmissionContent | null> {
  if (r.kind !== "lender_submission") return null;
  const p = r.payload ?? {};
  const dealId = payloadText(p.dealId);
  const approvedEmailSha = payloadText(p.emailSha256);
  const approvedSummarySha = payloadText(p.summarySha256);

  let outreach: LenderOutreach | null = null;
  try {
    outreach = await deps.store.getOutreachByKey(r.idempotencyKey);
  } catch (err) {
    console.warn("[approvals] submission row unavailable", err instanceof Error ? err.message : err);
  }
  if (outreach && dealId && outreach.dealId !== dealId) outreach = null;

  const summaryId = payloadText(p.summaryId) ?? outreach?.summaryId ?? null;
  let summary: DealSummarySpec | null = null;
  let summaryVerified = false;
  if (summaryId) {
    try {
      const rec = await deps.summaries.getSummary(summaryId);
      if (rec && (!dealId || rec.dealId === dealId)) {
        summary = rec.spec;
        const actual = summarySpecSha256(rec.spec);
        summaryVerified = approvedSummarySha !== null && actual === approvedSummarySha && actual === rec.specSha256;
      }
    } catch (err) {
      console.warn("[approvals] locked summary unavailable", err instanceof Error ? err.message : err);
    }
  }

  let email: ApprovalSubmissionContent["email"] = null;
  let emailVerified = false;
  let emailProblem: string | null = null;
  if (outreach?.emailSubject && outreach.emailText) {
    email = { subject: outreach.emailSubject, text: outreach.emailText };
    const actual = emailSha256(outreach.emailSubject, outreach.emailText);
    let safety: EmailSafetyOptions = {};
    if (deps.names && dealId) {
      try {
        safety = await deps.names(dealId);
      } catch {
        emailProblem = "The deal's principals could not be read, so the name check could not run. Try again before approving.";
      }
    }
    const findings = findRestrictedText(`${outreach.emailSubject}\n${outreach.emailText}`, safety);
    if (!approvedEmailSha || actual !== approvedEmailSha || actual !== outreach.emailSha256) emailProblem = EMAIL_HASH_MISMATCH;
    else if (findings.length) emailProblem = restrictedTextMessage(findings);
    else if (!emailProblem) emailVerified = true;
  } else if (approvedEmailSha) {
    emailProblem = EMAIL_NOT_FOUND;
  }
  return { outreachStatus: outreach?.status ?? null, email, emailVerified, emailProblem, summaryId, summary, summaryVerified };
}
