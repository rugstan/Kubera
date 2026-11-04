import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Field, Flash, Loading, NotConfigured, Section, Select, SignInRequired, Submit, when } from "@/app/(staff)/deals/ui";
import { boxStaleness } from "@/lib/agents/lenders/credit-box";
import { lenderRuntime } from "@/lib/agents/lenders/runtime";
import { currentStaff } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { reviewBoxAction } from "../../actions";
import { BoxForm } from "../../_components/BoxForm";

export const metadata: Metadata = { title: "Credit box" };

type Params = Promise<{ id: string }>;
type Search = Promise<{ notice?: string; error?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function BoxPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="credit box" />}>
      <BoxData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

function ReviewButton({ id, version, op, label, children }: { id: string; version: number; op: string; label: string; children?: React.ReactNode }) {
  return (
    <form action={reviewBoxAction} className="flex flex-wrap items-end gap-2">
      <input name="boxId" type="hidden" value={id} />
      <input name="recordVersion" type="hidden" value={version} />
      <input name="op" type="hidden" value={op} />
      <input name="back" type="hidden" value="box" />
      {children}
      <Submit tone={op === "approve" ? "primary" : "glass"}>{label}</Submit>
    </form>
  );
}

async function BoxData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired level={1} />;
  const rt = lenderRuntime();
  if (!rt) return <NotConfigured level={1} />;
  if (!UUID.test(id)) notFound();
  const [box, lenders] = await Promise.all([rt.store.getBox(id), rt.desk.store.listLenders()]);
  if (!box) notFound();
  const write = can(staff, "write");
  const lender = lenders.find((l) => l.id === box.lenderId) ?? null;
  const stale = boxStaleness(box, rt.desk.now());

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href="/lenders">
          ← All credit boxes
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{box.label}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={box.status === "approved" ? "good" : box.status === "pending_review" ? "warn" : box.status === "rejected" ? "bad" : "neutral"}>{box.status.replace("_", " ")}</Badge>
          <Badge>{box.source === "partner_registration" ? "From /partners registration" : "Staff entry"}</Badge>
          <Badge tone={lender ? "neutral" : "warn"}>{lender ? lender.name : "Not linked to a panel lender"}</Badge>
          {stale.stale ? <Badge tone="warn">{stale.reason}</Badge> : <Badge>Verified {when(box.verifiedAt)}</Badge>}
        </div>
        {box.reviewNote ? <p className="mt-2 text-sm text-titanium">Review note: {box.reviewNote}</p> : null}
      </div>
      <Flash error={sp.error} notice={sp.notice} />
      {write ? (
        <Section description="Approve only appetite you have confirmed with the lender. Approval links the box to a panel lender whose programs cover it." title="Review">
          <div className="flex flex-wrap gap-4">
            {box.status === "pending_review" ? (
              <>
                <ReviewButton id={box.id} label="Approve" op="approve" version={box.recordVersion}>
                  {!box.lenderId ? <Select label="Link to lender" name="lenderId" options={[{ value: "", label: "Choose…" }, ...lenders.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }))]} /> : null}
                </ReviewButton>
                <ReviewButton id={box.id} label="Reject" op="reject" version={box.recordVersion}>
                  <Field label="Reason" name="note" required />
                </ReviewButton>
              </>
            ) : null}
            {box.status === "approved" ? <ReviewButton id={box.id} label="Verified today" op="verify" version={box.recordVersion} /> : null}
            {box.status !== "pending_review" ? <ReviewButton id={box.id} label="Reopen for review" op="reopen" version={box.recordVersion} /> : null}
            {box.status !== "retired" ? <ReviewButton id={box.id} label="Retire" op="retire" version={box.recordVersion} /> : null}
          </div>
        </Section>
      ) : null}
      <Section title={write ? "Appetite" : "Appetite (read only)"}>{write ? <BoxForm box={box} lenders={lenders} /> : <pre className="overflow-x-auto text-xs">{JSON.stringify(box, null, 2)}</pre>}</Section>
    </>
  );
}
