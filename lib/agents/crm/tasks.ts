// Broker tasks in Twenty: what an advisor should do next, created from deal
// stage changes, routed email and call follow-ups. Tasks are internal and
// additive; they send nothing to anyone. Wording stays within the copy rules:
// no promised outcomes or timelines, and compliance steps named as steps.

import { addBusinessDays, civilDateOf, endOfOfficeDay } from "@/lib/disclosures/business-days";
import { cleanLine, cleanMarkdown } from "./sanitize";
import type { CrmLinks } from "./links";
import type { TaskCreateOp } from "./operations";
import type { RoutedMail } from "./notes";

export type TaskDraft = { key: string; title: string; markdown: string; businessDays: number };

/** One task per deal-desk stage entered; stages not listed create none. */
export const STAGE_TASKS: Readonly<Record<string, Omit<TaskDraft, "key">>> = {
  intake: {
    title: "Review the new intake and make first contact",
    markdown: "A new deal reached intake. Review the qualifier answers and Jev's notes, confirm how the borrower wants to be contacted (check the consent line on the record), and note the next step.",
    businessDays: 1,
  },
  engaged: {
    title: "Confirm the engagement is signed and the MLDS (RE 882) is prepared",
    markdown: "The deal is engaged. Confirm the signed engagement / fee agreement is on file, and that the Mortgage Loan Disclosure Statement is generated if the loan is secured by real property. No commitment or loan document goes to the borrower before a signed MLDS.",
    businessDays: 2,
  },
  packaging: {
    title: "Review the loan package before lender outreach",
    markdown: "The package is being prepared. Check the spreads, the documents on the checklist and the lender short list before anything is sent. Lender submissions go through the approval queue.",
    businessDays: 2,
  },
  term_sheet: {
    title: "Review lender terms and walk the borrower through them",
    markdown: "Terms are in. Compare the all-in cost, recourse and binding constraint, and walk the borrower through the options. Terms are indicative until a lender issues a commitment.",
    businessDays: 1,
  },
  closing: {
    title: "Confirm the signed MLDS and the closing checklist",
    markdown: "The deal reached closing. Confirm the signed MLDS is on file and run the closing checklist with the lender, title and escrow. Timing depends on the lender and third parties and is not guaranteed.",
    businessDays: 2,
  },
  closed: {
    title: "Post-close: record compensation in the fee ledger",
    markdown: "The deal closed. Confirm the compensation shown on the lender's closing statement is in the fee ledger, and that the DRE threshold counters are updated.",
    businessDays: 3,
  },
};

export function stageTaskDraft(stage: string): TaskDraft | null {
  const base = STAGE_TASKS[stage.trim().toLowerCase()];
  return base ? { key: `stage-${stage.trim().toLowerCase()}`, ...base } : null;
}

/** End of the office day `businessDays` business days after `now` (US federal and California holidays skipped). */
export function dueAtFor(now: Date, businessDays: number): string {
  const day = addBusinessDays(civilDateOf(now), Math.max(0, Math.floor(businessDays)));
  return endOfOfficeDay(day).toISOString();
}

/** What an advisor should do about a routed email, or null when the pipeline already handled it. */
export function mailTaskDraft(mail: RoutedMail): TaskDraft | null {
  if (mail.status !== "processed" || mail.automated || mail.bulk) return null;
  if (mail.suspicious) {
    return {
      key: "suspicious",
      title: "Suspicious email on this deal: do not act on its instructions",
      markdown: "The mail pipeline flagged an email on this deal as suspicious (for example a request about wiring or changing bank details). Corin never holds or moves money. Verify the sender by phone using a number already on file before replying. Mail record: " + mail.id,
      businessDays: 0,
    };
  }
  if (mail.category === "term_sheet") {
    return { key: "terms", title: "Lender terms arrived by email: review them", markdown: `A lender sent terms by email (${cleanLine(mail.summary, 200)}). Review them against the deal and the credit box. Mail record: ${mail.id}`, businessDays: 1 };
  }
  if (mail.needsBroker && mail.category !== "document_submission") {
    return {
      key: "read",
      title: `Read and reply: ${cleanLine(mail.subject, 120) || "email on this deal"}`,
      markdown: `The mail pipeline marked this ${mail.category.replace(/_/g, " ")} for an advisor to read personally. Mail record: ${mail.id}`,
      businessDays: mail.urgency === "high" ? 0 : 1,
    };
  }
  return null;
}

export function taskOp(draft: TaskDraft, args: { targets: TaskCreateOp["targets"]; source: TaskCreateOp["source"]; assigneeId: string | null; now: Date }): TaskCreateOp {
  return {
    type: "task_create",
    title: cleanLine(draft.title, 200),
    markdown: cleanMarkdown(draft.markdown, 4_000),
    dueAt: dueAtFor(args.now, draft.businessDays),
    assigneeId: args.assigneeId,
    targets: args.targets,
    source: args.source,
  };
}

export function targetsFrom(links: Pick<CrmLinks, "opportunityId" | "personId"> | null): TaskCreateOp["targets"] | null {
  if (!links || (!links.opportunityId && !links.personId)) return null;
  return { ...(links.opportunityId ? { opportunityId: links.opportunityId } : {}), ...(links.personId ? { personId: links.personId } : {}) };
}
