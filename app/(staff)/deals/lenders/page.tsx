import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { lenderCategories } from "@/lib/compliance/schemas";
import { appliedFilters, caStatus, emptyStateSuggestions, lenderListHref, lenderListView, parseLenderListQuery, serializeLenderListQuery, type FilterLink, type LenderListQuery, type LenderListView } from "@/lib/deals/lender-list";
import { LENDER_STALE_AFTER_DAYS, lenderStaleness } from "@/lib/deals/lenders";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { DEAL_PROGRAM_LABELS, dealPrograms } from "@/lib/deals/types";
import { lenderAction, saveLenderAction } from "../actions";
import { Badge, Check, Field, Flash, Loading, LoanTypeBadges, LoanTypeFieldset, NotConfigured, Section, Select, SignInRequired, Submit, Table, money, when } from "../ui";
import { LenderFilters } from "./_components/LenderFilters";

export const metadata: Metadata = { title: "Lender panel" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function LendersPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Deal desk</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Lender panel</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">Program appetite, broker-friendly flag and fee splits. Appetite not verified in {LENDER_STALE_AFTER_DAYS} days is stale and needs acknowledgment before a submission.</p>
      </div>
      <Suspense fallback={<Loading label="lenders" />}>
        <LendersData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const split = (kind: string, value: number) => (kind === "none" ? "None" : kind === "flat" ? money(value) : `${value}% of ${kind === "percent_of_loan" ? "loan" : "lender fee"}`);

function AppliedFilters({ query }: { query: LenderListQuery }) {
  const links = appliedFilters(query);
  if (!links.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-xs text-titanium" id="applied-filters-label">
        Applied:
      </span>
      <ul aria-labelledby="applied-filters-label" className="flex flex-wrap gap-2">
        {links.map((f) => (
          <li key={f.key}>
            <Link aria-label={`Remove filter: ${f.label}`} className="pill pill-glass min-h-11 max-w-full whitespace-normal text-xs" href={f.href}>
              {f.label} <span aria-hidden="true">×</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link className="inline-flex min-h-11 items-center text-sm text-accent underline" href="/deals/lenders">
        Clear all
      </Link>
    </div>
  );
}

function EmptyState({ links }: { links: FilterLink[] }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/15 p-5" role="status">
      <p className="font-medium text-ink">No lenders match these filters.</p>
      <p className="mt-1 text-sm text-titanium">Try one of these:</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.key}>
            <Link className="pill pill-glass min-h-11 max-w-full whitespace-normal text-center" href={l.href}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pagination<T>({ query, view }: { query: LenderListQuery; view: LenderListView<T> }) {
  return (
    <nav aria-label="Lender list pages" className="mt-4 flex flex-wrap items-center gap-3">
      {view.page > 1 ? (
        <Link className="pill pill-glass min-h-11" href={lenderListHref(query, { page: view.page - 1 })} rel="prev">
          Previous
        </Link>
      ) : null}
      <span className="text-sm text-titanium">
        Page {view.page} of {view.pages}
      </span>
      {view.page < view.pages ? (
        <Link className="pill pill-glass min-h-11" href={lenderListHref(query, { page: view.page + 1 })} rel="next">
          Next
        </Link>
      ) : null}
    </nav>
  );
}

async function LendersData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured />;
  const query = parseLenderListQuery(sp);
  const lenders = await rt.store.listLenders();
  const view = lenderListView(lenders, query);
  // The row actions post this back so a click returns to the same filtered page.
  const listQuery = serializeLenderListQuery({ ...query, page: view.page }).replace(/^\?/, "");
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const write = can(staff, "write");
  const now = rt.now();
  const filtered = view.total !== view.panelTotal;

  return (
    <>
      <Flash error={one("error")} notice={one("notice")} />
      <Section description="Filter by the kind of loan a lender makes; deal programs still drive matching." id="panel" title="Panel">
        <LenderFilters counts={view.counts} query={query} />
        <p aria-live="polite" className="mt-4 text-sm text-titanium" id="lender-results">
          {view.total ? `Showing ${view.from}–${view.to} of ${view.total} lenders` : "No lenders match"}
          {filtered ? ` (${view.panelTotal} on the panel)` : ""}
        </p>
        <AppliedFilters query={query} />
        <div className="mt-4">
          {view.total === 0 && lenders.length === 0 ? (
            <p className="text-sm text-titanium">No lenders on the panel yet.</p>
          ) : view.total === 0 ? (
            <EmptyState links={emptyStateSuggestions(query)} />
          ) : (
            <Table
              empty="No lenders on the panel yet."
              head={["Lender", "Contact", "Deal programs", "Size", "Fee split", "Verified", ""]}
              label="Lenders matching the filters"
              rows={view.rows.map((l) => {
                const s = lenderStaleness(l, now);
                const ca = caStatus(l);
                return [
                  <span className="flex flex-col gap-1" key="n">
                    <Link className="font-medium hover:underline" href={`/deals/lenders/${l.id}`}>
                      {l.name}
                    </Link>
                    <LoanTypeBadges types={l.loanTypes} />
                    <span className="flex flex-wrap gap-1">
                      {l.brokerFriendly ? <Badge tone="good">Broker-friendly</Badge> : null}
                      {!l.active ? <Badge tone="bad">Inactive</Badge> : null}
                      <Badge>{l.category.replace(/_/g, " ").toLowerCase()}</Badge>
                      {ca === "unconfirmed" ? <Badge tone="warn">CA unconfirmed</Badge> : ca === "no" ? <Badge tone="bad">Not in CA</Badge> : null}
                    </span>
                  </span>,
                  <span className="flex flex-col gap-1" key="c">
                    <span>{l.primaryContactName ?? <span className="text-titanium">No primary contact</span>}</span>
                    <span className="break-all">{l.contactEmail ?? <Badge tone="warn">No email on file</Badge>}</span>
                  </span>,
                  l.programs.map((p) => DEAL_PROGRAM_LABELS[p]).join(", ") || "—",
                  `${money(l.minLoanCents)} – ${money(l.maxLoanCents)}`,
                  split(l.feeSplitKind, l.feeSplitValue),
                  s.stale ? (
                    <Badge key="s" tone="warn">
                      {s.ageDays === null ? "Never" : `${s.ageDays} days ago`}
                    </Badge>
                  ) : (
                    when(l.verifiedAt)
                  ),
                  write ? (
                    <div className="flex flex-wrap gap-2" key="a">
                      <form action={lenderAction}>
                        <input name="lenderId" type="hidden" value={l.id} />
                        <input name="op" type="hidden" value="verify" />
                        <input name="listQuery" type="hidden" value={listQuery} />
                        <Submit tone="glass">Verified today</Submit>
                      </form>
                      <form action={lenderAction}>
                        <input name="lenderId" type="hidden" value={l.id} />
                        <input name="op" type="hidden" value="toggle" />
                        <input name="listQuery" type="hidden" value={listQuery} />
                        <Submit tone="glass">{l.active ? "Deactivate" : "Reactivate"}</Submit>
                      </form>
                    </div>
                  ) : null,
                ];
              })}
            />
          )}
        </div>
        {view.pages > 1 ? <Pagination query={query} view={view} /> : null}
      </Section>
      {write ? (
        <Section title="Add a lender">
          <form action={saveLenderAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required />
            <Select label="Lender category" name="category" options={lenderCategories.map((c) => ({ value: c, label: c.replace(/_/g, " ").toLowerCase() }))} />
            <Field hint="Charter or license number evidencing the category." label="Category evidence" name="categoryEvidenceRef" />
            <fieldset className="sm:col-span-2">
              <legend className="field-label">Programs</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {dealPrograms.map((p) => (
                  <label className="flex items-center gap-2 text-sm" key={p}>
                    <input name="programs" type="checkbox" value={p} /> {DEAL_PROGRAM_LABELS[p]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <LoanTypeFieldset legend="Loan types" name="loanTypes" selected={[]} />
              <p className="mt-1 text-xs text-titanium">Leave all unticked to fill them in from the programs and notes.</p>
            </div>
            <Field label="Minimum loan (USD)" name="minLoan" />
            <Field label="Maximum loan (USD)" name="maxLoan" />
            <Field hint="Comma separated; empty = nationwide." label="States" name="states" placeholder="CA, NV" />
            <Field label="Asset types" name="assetTypes" placeholder="assisted living, hotel" />
            <Select
              label="Fee split"
              name="feeSplitKind"
              options={[
                { value: "none", label: "None" },
                { value: "percent_of_loan", label: "% of loan" },
                { value: "percent_of_lender_fee", label: "% of lender fee" },
                { value: "flat", label: "Flat (cents)" },
              ]}
            />
            <Field label="Split value" name="feeSplitValue" step="0.0001" type="number" />
            <Field label="Fee / correspondent agreement ref" name="feeAgreementRef" />
            <Field label="Appetite notes" name="appetiteNotes" />
            <Field autoComplete="off" label="Primary contact name" name="contactName" />
            <Field autoComplete="off" hint="A name creates the primary contact; an email alone becomes the submission inbox." label="Primary contact email" name="contactEmail" type="email" />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Check label="Broker-friendly" name="brokerFriendly" />
              <Check defaultChecked label="Appetite and split verified today" name="verifiedNow" />
            </div>
            <div className="sm:col-span-2">
              <Submit>Add lender</Submit>
            </div>
          </form>
        </Section>
      ) : null}
    </>
  );
}
