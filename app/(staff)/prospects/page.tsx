import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Field, Flash, Loading, Section, Select, Submit, Table, when } from "@/app/(staff)/deals/ui";
import { requireStaff } from "@/lib/auth/dal";
import { intelRuntime } from "@/lib/agents/intel/runtime";
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS, PROSPECT_PROGRAMS, PROSPECT_PROGRAM_LABELS, PROSPECT_STATUSES, PROSPECT_STATUS_LABELS, WINDOW_BUCKETS, WINDOW_BUCKET_LABELS } from "@/lib/agents/intel/types";
import { scanAction, settleAllAction } from "./actions";
import { StatusBadge, ScoreBar, day, dollars, programLabel, typeLabel, windowLabel } from "./_components/format";
import { filterFromSearch } from "./_lib/forms";

export const metadata: Metadata = { title: "Refinance prospects" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function ProspectsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Prospecting</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Refinance-maturity prospects</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">
          Properties whose recorded mortgage matures soon, ranked by a score you can read factor by factor. The data is public record; the score ranks who to look at first and says nothing about what any lender would do.
          Outreach is drafted here and goes out only after a broker approves it.
        </p>
      </div>
      <Suspense fallback={<Loading label="prospects" />}>
        <ProspectsData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ProspectsData({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await requireStaff("/prospects");
  const rt = await intelRuntime();
  if (!rt) return <NotConfigured />;
  const filter = filterFromSearch(sp);
  const [rows, counts, scans] = await Promise.all([rt.prospects.listProspects(filter), rt.prospects.countByStatus(), rt.prospects.listScans(5)]);
  const notice = typeof sp.notice === "string" ? sp.notice : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const active = Object.entries(counts).filter(([s]) => s !== "not_a_fit" && s !== "do_not_contact").reduce((n, [, c]) => n + c, 0);
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  return (
    <>
      <Flash error={error} notice={notice} />
      {rt.mode === "demo" ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Demo data: every property and owner here is invented.</p> : null}

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active prospects" value={active} />
        <Stat label="New" value={counts.new} />
        <Stat label="Outreach drafted" value={counts.drafted} hint="Waiting on a broker or on you" />
        <Stat label="Do not contact" value={counts.do_not_contact} />
      </section>

      <Section id="scan" title="Scan recorded mortgages" description="Pulls recorded mortgages that mature inside the window for the ZIP codes you enter, then scores and stores them. A repeat scan refreshes the facts and never touches your notes, contact or status.">
        {rt.provider ? (
          <form action={scanAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block">
                <span className="field-label">ZIP codes (up to 25)</span>
                <textarea className="field" defaultValue="" name="zips" placeholder="90001, 91201, 92801" required rows={2} />
              </label>
            </div>
            <Field defaultValue={0} hint="Months from today. Negative includes loans that already passed maturity." label="Matures from (months)" name="fromMonths" step="1" type="number" />
            <Field defaultValue={18} label="Matures by (months)" name="toMonths" step="1" type="number" />
            <Field hint="Skips loans known to be smaller." label="Minimum original loan ($)" name="minLoanAmount" placeholder="1000000" />
            <fieldset className="sm:col-span-2 lg:col-span-3">
              <legend className="field-label">Property types (none checked = all)</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                {PROPERTY_TYPES.filter((t) => t !== "other").map((t) => (
                  <label className="flex min-h-11 items-center gap-2 text-sm text-ink" key={t}>
                    <input className="size-4 accent-[var(--color-accent)]" name="propertyType" type="checkbox" value={t} />
                    {PROPERTY_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex items-end">
              <Submit>Run scan</Submit>
            </div>
          </form>
        ) : (
          <p className="text-sm text-titanium">
            No recorded-mortgage provider is configured. Set <code>ATTOM_API_KEY</code> (and confirm the ATTOM agreement covers prospecting) to enable scans. Existing prospects stay available.
          </p>
        )}
        {scans.length ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink">Recent scans</h3>
            <Table
              empty=""
              head={["When", "Provider", "Result", "Started by"]}
              rows={scans.map((s) => [
                when(s.createdAt),
                s.provider,
                s.status === "failed" ? <Badge key="r" tone="bad">Failed{s.error ? `: ${s.error}` : ""}</Badge> : s.status === "running" ? "Running" : `${s.found} found, ${s.createdCount} new, ${s.updatedCount} refreshed`,
                s.startedBy.replace(/^staff:/, ""),
              ])}
            />
          </div>
        ) : null}
      </Section>

      <Section id="list" title={`Prospects (${rows.length}${rows.length >= (filter.limit ?? 0) ? "+" : ""})`}>
        <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
          <Select defaultValue={param("status") || "active"} label="Status" name="status" options={[{ value: "active", label: "Active" }, ...PROSPECT_STATUSES.map((s) => ({ value: s, label: PROSPECT_STATUS_LABELS[s] }))]} />
          <Select defaultValue={param("program")} label="Program" name="program" options={[{ value: "", label: "Any" }, ...PROSPECT_PROGRAMS.map((p) => ({ value: p, label: PROSPECT_PROGRAM_LABELS[p] }))]} />
          <Select defaultValue={param("window")} label="Maturity" name="window" options={[{ value: "", label: "Any" }, ...WINDOW_BUCKETS.map((w) => ({ value: w, label: WINDOW_BUCKET_LABELS[w] }))]} />
          <Field defaultValue={param("minScore")} label="Minimum score" name="minScore" step="1" type="number" />
          <Field defaultValue={param("q")} label="Address, city, owner or APN" name="q" />
          <div className="flex items-end gap-2">
            <Submit tone="glass">Filter</Submit>
          </div>
        </form>
        <Table
          empty="No prospects match. Run a scan, or loosen the filters."
          head={["Score", "Property", "Owner", "Loan", "Starting point", "Status"]}
          rows={rows.map((p) => [
            <ScoreBar key="s" score={p.score} />,
            <span key="p">
              <Link className="font-medium text-accent underline-offset-2 hover:underline" href={`/prospects/${p.id}`}>
                {p.addressLine1}
              </Link>
              <span className="block text-xs text-titanium">
                {[p.city, p.state].filter(Boolean).join(", ")} · {typeLabel(p)}
              </span>
            </span>,
            <span key="o">
              {p.ownerName ?? "Unknown"}
              <span className="block text-xs text-titanium">{p.ownerKind === "entity" ? "Entity" : p.ownerKind === "individual" ? "Individual" : "Owner type unclear"}</span>
            </span>,
            <span key="l">
              {day(p.loanMaturityDate)}
              <span className="block text-xs text-titanium">
                {windowLabel(p.windowBucket)} · {dollars(p.loanOriginalCents)} original
              </span>
            </span>,
            programLabel(p.recommendedProgram),
            <StatusBadge key="st" status={p.status} />,
          ])}
        />
        <form action={settleAllAction} className="mt-4">
          <Submit tone="glass">Check waiting outreach for broker decisions</Submit>
        </form>
      </Section>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bento p-5">
      <p className="text-[13px] text-titanium">{label}</p>
      <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[13px] text-titanium">{hint}</p> : null}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="bento p-6">
      <h2 className="text-lg font-semibold text-ink">Prospecting storage is not configured</h2>
      <p className="mt-2 text-sm text-titanium">Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to store prospects, drafts and the do-not-contact list.</p>
    </div>
  );
}
