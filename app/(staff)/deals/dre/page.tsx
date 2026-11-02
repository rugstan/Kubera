import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { NOTIFY_WITHIN_DAYS, THRESHOLD_AGGREGATE_CENTS, THRESHOLD_LOAN_COUNT } from "@/lib/deals/dre";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { dreSnapshotAction } from "../actions";
import { Badge, Field, Flash, Loading, NotConfigured, Section, SignInRequired, Submit, Table, money, when } from "../ui";
import { liveThreshold } from "./data";

export const metadata: Metadata = { title: "DRE reporting" };

type Search = Promise<{ notice?: string; error?: string }>;

export default function DrePage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Deal desk</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">DRE reporting</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">
          Threshold-broker monitor (B&amp;P §10232): {THRESHOLD_LOAN_COUNT} or more real-property loans aggregating over {money(THRESHOLD_AGGREGATE_CENTS)} negotiated in the past 12 months, or expected in the next 12. A threshold broker notifies the DRE within {NOTIFY_WITHIN_DAYS} days (RE 853). Criteria and form fields are pending counsel review.
        </p>
      </div>
      <Suspense fallback={<Loading label="counters" />}>
        <DreData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DreData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured />;
  const [c, reports] = await Promise.all([liveThreshold(rt), rt.store.listDreReports()]);
  const year = Number(c.asOf.slice(0, 4));
  return (
    <>
      <Flash error={sp.error} notice={sp.notice} />
      <Section title="Threshold monitor">
        <div className="flex flex-wrap gap-2">
          {c.thresholdMet ? <Badge tone="bad">Threshold met</Badge> : c.approaching ? <Badge tone="warn">Approaching</Badge> : <Badge tone="good">Below threshold</Badge>}
          {c.thresholdMet ? <Badge tone={c.notified ? "good" : "warn"}>{c.notified ? "RE 853 recorded" : `Notify the DRE by ${c.notifyBy}`}</Badge> : null}
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-titanium">
              Past 12 months ({c.trailing.from} – {c.trailing.to})
            </dt>
            <dd className="font-semibold text-ink">
              {c.trailing.count} loans · {money(c.trailing.aggregateCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-titanium">Pipeline from term sheet onward</dt>
            <dd className="text-ink">
              {c.forward.count} loans · {money(c.forward.aggregateCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-titanium">Payments collected for note owners</dt>
            <dd className="text-ink">0 (Kubera does not service loans)</dd>
          </div>
          <div>
            <dt className="text-xs text-titanium">Business-asset-only loans (review)</dt>
            <dd className="text-ink">{c.excludedForReview.count}</dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Link className="pill pill-glass min-h-11" prefetch={false} href="/deals/dre/export?kind=threshold">
            Threshold CSV
          </Link>
          {c.thresholdMet ? (
            <Link className="pill pill-glass min-h-11" prefetch={false} href="/deals/dre/export?kind=RE853">
              RE 853 data (JSON)
            </Link>
          ) : null}
          <Link className="pill pill-glass min-h-11" prefetch={false} href={`/deals/dre/export?kind=RE860&year=${year - 1}`}>
            RE 860 data {year - 1} (CSV)
          </Link>
          <Link className="pill pill-glass min-h-11" prefetch={false} href={`/deals/dre/export?kind=RE881&year=${year - 1}`}>
            RE 881 data {year - 1} (CSV)
          </Link>
          {can(staff, "write") ? (
            <form action={dreSnapshotAction}>
              <input name="op" type="hidden" value="snapshot" />
              <Submit>Save snapshot</Submit>
            </form>
          ) : null}
        </div>
        {c.thresholdMet && can(staff, "officer") ? (
          <form action={dreSnapshotAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input name="op" type="hidden" value="re853_filed" />
            <Field label="RE 853 filed on" name="filedOn" required type="date" />
            <Submit>Record RE 853 filing</Submit>
          </form>
        ) : null}
      </Section>
      <Section title="History">
        <Table
          empty="No snapshots saved."
          head={["As of", "Kind", "Threshold", "First met", "Notify by", "Filed", "By"]}
          rows={reports.map((r) => [r.asOf, r.reportKind, r.thresholdMet ? "Met" : "Not met", r.firstMetOn ?? "—", r.notifyBy ?? "—", r.notifiedOn ?? "—", `${r.createdBy} · ${when(r.createdAt)}`])}
        />
      </Section>
    </>
  );
}
