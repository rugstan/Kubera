import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Flash, Loading, Section, Submit, Table, when } from "@/app/(staff)/deals/ui";
import { xaiModel } from "@/lib/ai/gateway";
import { requireStaff } from "@/lib/auth/dal";
import { intelRuntime } from "@/lib/agents/intel/runtime";
import { INTEL_STATUS_LABELS, type IntelStatus } from "@/lib/agents/intel/types";
import { generateIntelAction } from "../actions";

export const metadata: Metadata = { title: "Market intel" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function IntelPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <div>
        <p className="eyebrow">Market intel</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Weekly market note</h1>
        <p className="mt-2 max-w-2xl text-sm text-titanium">
          A short note written from public signals only: rate benchmarks, HUD and SBA notices in the Federal Register, and public feeds. It never sees borrower, partner or deal data, and every bullet cites the signal it came
          from. Drafts wait here for review; nothing is published or sent.
        </p>
      </div>
      <Suspense fallback={<Loading label="drafts" />}>
        <IntelData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const TONE: Record<IntelStatus, "neutral" | "good" | "warn" | "bad"> = { pending_review: "warn", approved: "good", rejected: "bad", superseded: "neutral" };

async function IntelData({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await requireStaff("/prospects/intel");
  const rt = await intelRuntime();
  if (!rt) return <p className="bento p-6 text-sm text-titanium">Storage is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).</p>;
  const drafts = await rt.intel.listDrafts({ limit: 30 });
  const modelReady = rt.gateway.available(xaiModel(), "xai");

  return (
    <>
      <Flash error={typeof sp.error === "string" ? sp.error : undefined} notice={typeof sp.notice === "string" ? sp.notice : undefined} />
      <Section title="Write this week's note" description={modelReady ? "Written by the market-intel model (xAI) through the model gateway." : "No xAI key is configured (XAI_API_KEY), so the note is a rules digest of the signals instead of a written summary."}>
        <form action={generateIntelAction} className="flex flex-wrap items-end gap-3">
          <label className="block min-w-64 flex-1">
            <span className="field-label">Optional focus (a topic, for example hotel debt)</span>
            <input className="field" maxLength={200} name="focus" />
          </label>
          <Submit>Generate draft</Submit>
        </form>
      </Section>
      <Section title="Drafts">
        <Table
          empty="No drafts yet."
          label="Market note drafts table"
          head={["Week of", "Headline", "Written by", "Status", "Created"]}
          rows={drafts.map((d) => [
            d.weekStart,
            <span key="h">
              <Link className="font-medium text-accent underline-offset-2 hover:underline" href={`/prospects/intel/${d.id}`}>
                {d.headline}
              </Link>
              {d.guardrailHits.length ? (
                <span className="ml-2">
                  <Badge tone="warn">Guardrail hits</Badge>
                </span>
              ) : null}
            </span>,
            d.generatedBy === "model" ? "Market-intel model" : "Rules digest",
            <Badge key="s" tone={TONE[d.status]}>
              {INTEL_STATUS_LABELS[d.status]}
            </Badge>,
            when(d.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
