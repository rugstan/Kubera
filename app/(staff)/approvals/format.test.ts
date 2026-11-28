import { describe, expect, it } from "vitest";
import { lenderSubmissionDetails } from "./format";

const DEAL = "10000000-0000-4000-8000-000000000007";
const LENDER = "20000000-0000-4000-8000-000000000002";

describe("lenderSubmissionDetails", () => {
  it("shows the missing items by label, the reason, the fit exceptions and a link to the current draft", () => {
    const d = lenderSubmissionDetails(
      {
        kind: "lender_submission",
        dealId: DEAL,
        payload: { dealId: DEAL, lenderId: LENDER, targetStage: "term_sheet", readinessMissing: ["value.basis", "plan.risks"], overrideReason: "Lender asked to see it before the appraisal lands", lenderFit: { exceptions: ["LTV 78% vs 75% maximum"] } },
      },
      (id) => ({ "value.basis": "Purchase price, or as-is value with its source and date" })[id] ?? id,
    );
    expect(d).toEqual({
      stageLabel: "Term sheet",
      readinessChecked: true,
      missing: ["Purchase price, or as-is value with its source and date", "plan.risks"],
      overrideReason: "Lender asked to see it before the appraisal lands",
      fitExceptions: ["LTV 78% vs 75% maximum"],
      draftHref: `/deals/${DEAL}/submission/preview?lender=${LENDER}&stage=term_sheet`,
    });
  });

  it("does not claim readiness on a submission requested before the gate, and ignores other kinds", () => {
    const d = lenderSubmissionDetails({ kind: "lender_submission", dealId: DEAL, payload: { dealId: DEAL, lenderId: LENDER, packageVersion: 1 } });
    expect(d).toMatchObject({ readinessChecked: false, missing: [], overrideReason: null, fitExceptions: [], stageLabel: null, draftHref: `/deals/${DEAL}/submission/preview?lender=${LENDER}` });
    expect(lenderSubmissionDetails({ kind: "email", dealId: DEAL, payload: {} })).toBeNull();
    expect(lenderSubmissionDetails({ kind: "lender_submission", dealId: null, payload: { dealId: "../../etc" } })?.draftHref).toBeNull();
  });
});
