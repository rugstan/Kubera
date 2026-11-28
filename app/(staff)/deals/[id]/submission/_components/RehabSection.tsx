import Link from "next/link";
import { Section } from "@/app/(staff)/deals/ui";
import { SECTION_LABELS } from "@/lib/deals/submission/playbooks";
import { usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

// Bridge and hotel PIP bridge: the renovation budget and the reserves the
// borrower asks the lender to hold. Hard money and fix & flip keep this in the
// existing hard money file, linked here rather than rebuilt.

export function RehabSection({ view, write }: SectionProps) {
  const mode = view.sections.find((s) => s.id === "rehab")?.view;
  if (mode !== "hard_money_file") return <EditorSection description="What the renovation costs and how long it takes. Reserves are requested from the lender, which holds them." id="rehab" view={view} write={write} />;
  const hm = view.ctx.hardMoney;
  const href = `/checklists/deal?id=${encodeURIComponent(view.ctx.deal.id)}#hard-money`;
  return (
    <Section description="This playbook runs on the hard money file: scope of work, after-repair value, track record and exit." id="section-rehab" title={SECTION_LABELS.rehab}>
      {hm ? (
        <Facts
          rows={[
            { label: "Purchase price", value: usd(Math.round(hm.purchasePrice * 100)) },
            { label: "After-repair value", value: usd(Math.round(hm.arv * 100)) },
            { label: "Rehab budget (with contingency)", value: usd(Math.round((hm.metrics.rehabBudget + hm.metrics.contingency) * 100)) },
            { label: "Verified projects (36 months)", value: String(hm.metrics.verifiedProjects) },
          ]}
        />
      ) : (
        <p className="text-sm text-titanium">No hard money file yet.</p>
      )}
      <p className="mt-3 text-sm">
        <Link className="font-medium text-ink underline underline-offset-2" href={href}>
          {hm ? "Open the hard money file" : "Start the hard money file"}
        </Link>
      </p>
    </Section>
  );
}
