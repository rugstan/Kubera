import type { Metadata } from "next";
import { Suspense } from "react";
import { Field, Flash, Loading, Section, Select, Submit, Table, when } from "@/app/(staff)/deals/ui";
import { requireStaff } from "@/lib/auth/dal";
import { intelRuntime } from "@/lib/agents/intel/runtime";
import { SUPPRESSION_KINDS, SUPPRESSION_REASONS } from "@/lib/agents/intel/types";
import { addSuppressionAction } from "../actions";

export const metadata: Metadata = { title: "Do not contact" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const KIND_LABEL = { email: "Email address", domain: "Email domain", owner: "Owner name", address: "Property or mailing address" } as const;
const REASON_LABEL = { opt_out: "Asked not to be contacted", complaint: "Complaint", bounce: "Address bounced", staff: "Staff decision" } as const;

export default function SuppressionsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Prospecting</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Do-not-contact list</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">
          Anyone here is skipped by scans and refused by outreach drafts, and an approved draft is blocked again right before it would be sent. Values are stored as one-way hashes; only a masked hint is shown.
        </p>
      </div>
      <Suspense fallback={<Loading label="list" />}>
        <SuppressionData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SuppressionData({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await requireStaff("/prospects/suppressions");
  const rt = await intelRuntime();
  if (!rt) return <p className="bento p-6 text-sm text-titanium">Storage is not configured.</p>;
  const rows = await rt.prospects.listSuppressions(200);
  return (
    <>
      <Flash error={typeof sp.error === "string" ? sp.error : undefined} notice={typeof sp.notice === "string" ? sp.notice : undefined} />
      <Section title="Add an entry" description="For example the sender of an unsubscribe reply. Matching prospects are marked do not contact.">
        <form action={addSuppressionAction} className="grid gap-4 sm:grid-cols-4">
          <Select label="Type" name="kind" options={SUPPRESSION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <Field label="Value" name="value" required />
          <Select label="Reason" name="reason" options={SUPPRESSION_REASONS.map((r) => ({ value: r, label: REASON_LABEL[r] }))} />
          <div className="flex items-end">
            <Submit>Add</Submit>
          </div>
        </form>
      </Section>
      <Section title={`Entries (${rows.length})`}>
        <Table empty="Nothing on the list." head={["Type", "Entry", "Reason", "Added", "By"]} rows={rows.map((r) => [KIND_LABEL[r.kind], r.label, REASON_LABEL[r.reason], when(r.createdAt), r.createdBy.replace(/^staff:/, "")])} />
      </Section>
    </>
  );
}
