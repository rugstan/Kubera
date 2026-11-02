import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { stageLabel } from "@/lib/deals/stages";
import { DEAL_PROGRAM_LABELS, dealPrograms } from "@/lib/deals/types";
import { createDealAction } from "./actions";
import { Badge, Field, Flash, Loading, NotConfigured, Section, Select, SignInRequired, Submit, Table, money, when } from "./ui";

export const metadata: Metadata = { title: "Deals" };

type Search = Promise<{ notice?: string; error?: string }>;

export default function DealsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Deal desk</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Deals</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">Stage, lender outreach, compensation ledger and compliance records for every loan Kubera brokers.</p>
      </div>
      <Suspense fallback={<Loading label="deals" />}>
        <DealsData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DealsData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = dealDeskRuntime();
  if (!rt) return <NotConfigured />;
  const deals = await rt.store.listDeals({ limit: 200 });
  return (
    <>
      <Flash error={sp.error} notice={sp.notice} />
      <Section title="Pipeline">
        <Table
          empty="No deals yet."
          head={["Deal", "Program", "Stage", "Loan amount", "Terms", "Updated"]}
          rows={deals.map((d) => [
            <Link className="font-medium text-accent hover:underline" href={`/deals/${d.id}`} key="t">
              {d.title}
            </Link>,
            DEAL_PROGRAM_LABELS[d.program],
            stageLabel(d.program, d.stage),
            money(d.loanAmountCents),
            d.termSheetAcceptedAt ? <Badge key="l">Locked</Badge> : <Badge key="o" tone="good">Open</Badge>,
            when(d.updatedAt),
          ])}
        />
      </Section>
      {can(staff, "write") ? (
        <Section description="Starts at intake on the program's stage template." title="New deal">
          <form action={createDealAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" name="title" placeholder="Sunrise Assisted Living refinance" required />
            <Select label="Program" name="program" options={dealPrograms.map((p) => ({ value: p, label: DEAL_PROGRAM_LABELS[p] }))} required />
            <Field label="Borrower" name="borrowerName" />
            <Field label="Loan amount (USD)" name="loanAmount" placeholder="12,500,000" />
            <Field label="Property address" name="propertyAddress" />
            <Field label="State" name="propertyState" placeholder="CA" />
            <Select
              label="Collateral"
              name="collateral"
              options={[
                { value: "", label: "Not yet known" },
                { value: "real_property", label: "Lien on real property" },
                { value: "business_assets", label: "Business assets only (no real property)" },
              ]}
            />
            <Field hint="Links vault documents for packaging." label="Lead ID" name="leadId" />
            <div className="sm:col-span-2">
              <Submit>Create deal</Submit>
            </div>
          </form>
        </Section>
      ) : null}
    </>
  );
}
