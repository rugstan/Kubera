import type { Metadata } from "next";
import { Suspense } from "react";
import { Flash, Loading, NotConfigured, Section, SignInRequired } from "@/app/(staff)/deals/ui";
import { lenderRuntime } from "@/lib/agents/lenders/runtime";
import { currentStaff } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { BoxForm } from "../../_components/BoxForm";

export const metadata: Metadata = { title: "New credit box" };

type Search = Promise<{ error?: string }>;

export default function NewBoxPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Lender matching</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">New credit box</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">A new box starts in review; a broker approves it before matching uses it.</p>
      </div>
      <Suspense fallback={<Loading label="form" />}>
        <NewBoxData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewBoxData({ searchParams }: { searchParams: Search }) {
  const [staff, sp] = await Promise.all([currentStaff(), searchParams]);
  if (!staff) return <SignInRequired />;
  const rt = lenderRuntime();
  if (!rt) return <NotConfigured />;
  if (!can(staff, "write")) return <Flash error="Adding credit boxes needs broker or admin access." />;
  const lenders = await rt.desk.store.listLenders();
  return (
    <>
      <Flash error={sp.error} />
      <Section title="Appetite">
        <BoxForm box={null} lenders={lenders} />
      </Section>
    </>
  );
}
