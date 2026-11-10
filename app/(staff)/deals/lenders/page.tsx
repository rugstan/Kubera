import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { lenderCategories } from "@/lib/compliance/schemas";
import { LENDER_STALE_AFTER_DAYS, lenderStaleness } from "@/lib/deals/lenders";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { DEAL_PROGRAM_LABELS, dealPrograms } from "@/lib/deals/types";
import { lenderAction, saveLenderAction } from "../actions";
import { Badge, Check, Field, Flash, Loading, NotConfigured, Section, Select, SignInRequired, Submit, Table, money, when } from "../ui";

export const metadata: Metadata = { title: "Lender panel" };

type Search = Promise<{ notice?: string; error?: string }>;

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

async function LendersData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured />;
  const lenders = await rt.store.listLenders();
  const now = rt.now();
  const write = can(staff, "write");
  return (
    <>
      <Flash error={sp.error} notice={sp.notice} />
      <Section title="Panel">
        <Table
          empty="No lenders on the panel yet."
          head={["Lender", "Contact", "Programs", "Size", "Fee split", "Verified", ""]}
          rows={lenders.map((l) => {
            const s = lenderStaleness(l, now);
            return [
              <span key="n">
                <Link className="font-medium hover:underline" href={`/deals/lenders/${l.id}`}>
                  {l.name}
                </Link>
                <span className="mt-1 flex flex-wrap gap-1">
                  {l.brokerFriendly ? <Badge tone="good">Broker-friendly</Badge> : null}
                  {!l.active ? <Badge tone="bad">Inactive</Badge> : null}
                  <Badge>{l.category.replace(/_/g, " ").toLowerCase()}</Badge>
                </span>
              </span>,
              <span className="flex flex-col gap-1" key="c">
                <span>{l.primaryContactName ?? <span className="text-titanium">No primary contact</span>}</span>
                <span className="break-all">{l.contactEmail ?? <Badge tone="warn">No email on file</Badge>}</span>
              </span>,
              l.programs.map((p) => DEAL_PROGRAM_LABELS[p]).join(", "),
              `${money(l.minLoanCents)} – ${money(l.maxLoanCents)}`,
              split(l.feeSplitKind, l.feeSplitValue),
              s.stale ? <Badge key="s" tone="warn">{s.ageDays === null ? "Never" : `${s.ageDays} days ago`}</Badge> : when(l.verifiedAt),
              write ? (
                <div className="flex flex-wrap gap-2" key="a">
                  <form action={lenderAction}>
                    <input name="lenderId" type="hidden" value={l.id} />
                    <input name="op" type="hidden" value="verify" />
                    <Submit tone="glass">Verified today</Submit>
                  </form>
                  <form action={lenderAction}>
                    <input name="lenderId" type="hidden" value={l.id} />
                    <input name="op" type="hidden" value="toggle" />
                    <Submit tone="glass">{l.active ? "Deactivate" : "Reactivate"}</Submit>
                  </form>
                </div>
              ) : null,
            ];
          })}
        />
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
