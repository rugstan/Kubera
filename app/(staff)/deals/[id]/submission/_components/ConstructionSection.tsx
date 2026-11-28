import Link from "next/link";
import { Badge } from "@/app/(staff)/deals/ui";
import { usd } from "../_lib/format";
import { EditorSection, Facts, type SectionProps } from "./EditorSection";

// Construction and C-PACE. The general contractor, its license and the CSLB
// check live on the construction desk and are shown here, not retyped.

export function ConstructionSection({ view, write }: SectionProps) {
  const c = view.ctx.construction;
  const budget = view.ctx.spreadFigures.constructionBudget;
  const href = c ? `/construction/project?id=${encodeURIComponent(c.project.id)}` : "/construction";
  return (
    <EditorSection
      description="Budget, timeline and approvals. Yield on cost and LTC are computed in the panel."
      facts={
        <Facts
          note={
            <>
              The contractor and its license check are kept on the{" "}
              <Link className="font-medium text-ink underline underline-offset-2" href={href}>
                construction desk
              </Link>
              .
            </>
          }
          rows={[
            { label: "General contractor", value: c?.project.generalContractorName ?? "Not on the construction desk yet" },
            { label: "CSLB license check", value: c?.licenseCheck ? <Badge tone={c.licenseCheck.status === "clear" ? "good" : "warn"}>{c.licenseCheck.status.replace(/_/g, " ")}</Badge> : "Not run" },
            ...(budget ? [{ label: `Budget spread (${budget.asOf})`, value: usd(budget.totalCents) }] : []),
          ]}
        />
      }
      id="construction"
      view={view}
      write={write}
    />
  );
}
