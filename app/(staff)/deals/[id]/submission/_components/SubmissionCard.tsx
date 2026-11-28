import Link from "next/link";
import { Section } from "@/app/(staff)/deals/ui";
import { PLAYBOOK_LABELS } from "@/lib/deals/submission/playbooks";
import { loadSubmissionView } from "../_lib/data";
import { ReadinessMeter } from "./ReadinessMeter";

// The deal page's "Lender submission" card: the meter for each stage, the top
// five missing items, and the way into the editor. Every send goes through the
// submission flow (readiness gate, the exact email, broker approval).

export async function SubmissionCard({ dealId, write }: { dealId: string; write: boolean }) {
  const view = await loadSubmissionView(dealId);
  if (!view) return null;
  return (
    <Section description={`${PLAYBOOK_LABELS[view.playbook]} playbook. Nothing goes to a lender without broker approval, and a send with missing items needs a written reason.`} id="lender-submission" title="Lender submission">
      <ReadinessMeter headingLevel={3} limit={5} readiness={view.readiness} />
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className="pill pill-primary min-h-11 max-w-full whitespace-normal text-center" href={`/deals/${dealId}/submission`}>
          {write ? "Prepare lender submission" : "View lender submission"}
        </Link>
        <Link className="pill pill-glass min-h-11 max-w-full whitespace-normal text-center" href={`/deals/${dealId}/submission/preview`}>
          Preview the email
        </Link>
      </div>
    </Section>
  );
}
