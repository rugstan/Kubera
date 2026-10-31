import type { Metadata } from "next";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/dal";
import { parseRange } from "@/lib/reporting/dates";
import { FeesView } from "./_components/FeesView";
import { LendersView } from "./_components/LendersView";
import { Overview } from "./_components/Overview";
import { SourcesView } from "./_components/SourcesView";
import { RangeNav, ViewNav } from "./_components/ui";
import { canViewReports, parseView } from "./_lib/access";
import { loadBundle } from "./_lib/load";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const generatedFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">Business reporting</p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-ink">Reports</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">Pipeline, fee forecast, lender hit rate and lead-source return, computed from the deal desk records.</p>
      </div>
      <Suspense fallback={<div className="bento h-96 animate-pulse" aria-label="Loading reports" />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reports({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const range = parseRange(sp.range);
  const ctx = await requireStaff(`/reports?view=${view}&range=${range}`);
  if (!canViewReports(ctx.principal)) {
    return <div className="bento p-8 text-titanium">Reports are available to brokers and administrators.</div>;
  }

  const now = new Date();
  const result = await loadBundle(ctx.services, range, now);
  if (result.status === "unavailable") {
    return <div className="bento p-8 text-titanium">Reports need the database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load deal records.</div>;
  }
  if (result.status === "error") {
    return (
      <div role="alert" className="bento p-8 text-red-800">
        The reports could not be built. Try again in a moment; if it keeps happening, check the server log.
      </div>
    );
  }
  const r = result.bundle;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <ViewNav view={view} range={range} />
        <RangeNav view={view} range={range} />
      </div>
      <p className="mb-5 text-[13px] text-titanium">
        {r.window.label}: {r.window.from} to {r.window.to}. Generated {generatedFmt.format(now)} Pacific.
      </p>
      {view === "overview" ? <Overview r={r} /> : view === "fees" ? <FeesView r={r} /> : view === "lenders" ? <LendersView r={r} /> : <SourcesView r={r} />}
    </>
  );
}
