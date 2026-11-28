import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Flash, Loading, NotConfigured, SignInRequired, money } from "@/app/(staff)/deals/ui";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { PLAYBOOK_LABELS } from "@/lib/deals/submission/playbooks";
import type { SectionId } from "@/lib/deals/submission/types";
import { DEAL_PROGRAM_LABELS } from "@/lib/deals/types";
import { loadSubmissionView, type SubmissionView } from "./_lib/data";
import { AgencySection } from "./_components/AgencySection";
import { CapitalStackSection } from "./_components/CapitalStackSection";
import { ConstructionSection } from "./_components/ConstructionSection";
import { DocumentsSection } from "./_components/DocumentsSection";
import { FinancialsSection } from "./_components/FinancialsSection";
import { HashScroll } from "./_components/HashScroll";
import { HotelSection } from "./_components/HotelSection";
import { HudSection } from "./_components/HudSection";
import { LoanRequestSection } from "./_components/LoanRequestSection";
import { MetricsPanel } from "./_components/MetricsPanel";
import { PlanExitSection } from "./_components/PlanExitSection";
import { PrefillPanel } from "./_components/PrefillPanel";
import { PropertySection } from "./_components/PropertySection";
import { ReadinessMeter } from "./_components/ReadinessMeter";
import { RehabSection } from "./_components/RehabSection";
import { RentalSection } from "./_components/RentalSection";
import { SbaSection } from "./_components/SbaSection";
import { SectionNav } from "./_components/SectionNav";
import { SourcesUsesSection } from "./_components/SourcesUsesSection";
import { SponsorSection } from "./_components/SponsorSection";
import { TenancySection } from "./_components/TenancySection";
import type { SectionProps } from "./_components/EditorSection";
import { ValueSection } from "./_components/ValueSection";

// The lender submission editor (spec 4.1–4.7): one form per section, only the
// sections the deal's playbook uses, a source tag on every value, computed
// metrics with their formulas, and the lender-ready meter whose missing items
// link to the field that fixes them. Static shell; the data streams in behind
// Suspense. Analysts read it without forms.

export const metadata: Metadata = { title: "Lender submission" };

type Params = Promise<{ id: string }>;
type Search = Promise<{ notice?: string; error?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECTIONS: Record<Exclude<SectionId, "documents">, (p: SectionProps) => React.ReactNode> = {
  loan_request: LoanRequestSection,
  property: PropertySection,
  value: ValueSection,
  financials: FinancialsSection,
  sponsor: SponsorSection,
  plan_exit: PlanExitSection,
  sources_uses: SourcesUsesSection,
  construction: ConstructionSection,
  rehab: RehabSection,
  rental: RentalSection,
  sba: SbaSection,
  hotel: HotelSection,
  tenancy: TenancySection,
  agency: AgencySection,
  hud: HudSection,
  capital_stack: CapitalStackSection,
};

export default function SubmissionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="lender submission" />}>
      <SubmissionData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function Side({ view }: { view: SubmissionView }) {
  return (
    <>
      <ReadinessMeter readiness={view.readiness} samePage={`/deals/${encodeURIComponent(view.ctx.deal.id)}/submission`} />
      <MetricsPanel metrics={view.metrics} />
    </>
  );
}

async function SubmissionData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired level={1} />;
  if (!dealDeskRuntime()) return <NotConfigured level={1} />;
  if (!UUID.test(id)) notFound();
  const view = await loadSubmissionView(id);
  if (!view) notFound();
  const write = can(staff, "write");
  const deal = view.ctx.deal;

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href={`/deals/${deal.id}`}>
          ← Back to the deal
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{deal.title}: lender submission</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge>{PLAYBOOK_LABELS[view.playbook]}</Badge>
          <Badge>{DEAL_PROGRAM_LABELS[deal.program]}</Badge>
          <Badge>{money(deal.loanAmountCents)}</Badge>
          <Link className="text-sm font-medium text-accent underline-offset-2 hover:underline" href={`/deals/${deal.id}/submission/preview`}>
            Preview the email and summary
          </Link>
          <Link className="text-sm font-medium text-accent underline-offset-2 hover:underline" href={`/deals/${deal.id}/submission/summary.pdf`} prefetch={false}>
            Summary PDF
          </Link>
        </div>
      </div>
      <Flash error={sp.error} notice={sp.notice} />
      <HashScroll />
      {write ? null : (
        <p className="notice-warning rounded-2xl px-4 py-3 text-sm" role="note">
          You have read access: the submission shows without forms. A broker or administrator edits it.
        </p>
      )}
      {view.prefill ? <PrefillPanel dealId={deal.id} prefill={view.prefill} write={write} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[11rem_minmax(0,1fr)_18rem]">
        <div className="min-w-0 lg:col-span-2 xl:sticky xl:top-[calc(var(--staff-header-height,7.75rem)+1rem)] xl:col-span-1 xl:self-start">
          <SectionNav view={view} />
        </div>
        <div className="min-w-0 space-y-6">
          <details className="bento p-4 lg:hidden">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-ink">Lender-ready meter and computed metrics</summary>
            <div className="mt-3 space-y-6">
              <Side view={view} />
            </div>
          </details>
          {view.sections.map((s) => {
            if (s.id === "documents") return <DocumentsSection key={s.id} view={view} />;
            const Render = SECTIONS[s.id];
            return <Render key={s.id} view={view} write={write} />;
          })}
        </div>
        <div
          aria-label="Lender-ready meter and computed metrics"
          className="hidden min-w-0 lg:sticky lg:top-[calc(var(--staff-header-height,7.75rem)+1rem)] lg:block lg:max-h-[calc(100dvh-var(--staff-header-height,7.75rem)-2rem)] lg:self-start lg:overflow-y-auto"
          role="region"
          tabIndex={0}
        >
          <div className="bento space-y-6 p-4">
            <Side view={view} />
          </div>
        </div>
      </div>
    </>
  );
}
