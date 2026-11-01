import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/lib/auth/dal";
import { REVIEW_STATUS_LABELS, REVIEW_VIEWS, REVIEW_VIEW_LABELS, type ReviewView } from "@/lib/ai/review/types";
import { when } from "./_components/Transcript";
import { reviewStoreFor } from "./_lib/runtime";

export const metadata: Metadata = { title: "AI review" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const parseView = (v: unknown): ReviewView => ((REVIEW_VIEWS as readonly string[]).includes(String(v)) ? (v as ReviewView) : "needs_review");

export default function AiReviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">AI supervision</p>
        <h1 className="font-display text-[32px] font-semibold text-ink">AI review</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">
          Ask Kubera AI conversations. Sentences the output guardrails caught are rewritten before the borrower sees them and flagged here. Flag, annotate and
          sign off conversations so wrong or risky answers get fixed at the source.
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading conversations" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const ctx = await requireStaff(view === "needs_review" ? "/ai-review" : `/ai-review?view=${view}`);
  const store = reviewStoreFor(ctx.services);
  if (!store) return <div className="bento p-8 text-titanium">The review queue needs the database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load conversations.</div>;

  let stats;
  let rows;
  try {
    [stats, rows] = await Promise.all([store.stats(), store.list(view, 100)]);
  } catch (err) {
    console.error("[ai-review] could not load conversations:", err instanceof Error ? err.message : err);
    return (
      <div role="alert" className="bento p-8 text-danger">
        The conversations could not be loaded. Try again in a moment.
      </div>
    );
  }

  return (
    <>
      <section aria-label="Review summary" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Conversations" value={stats.total} />
        <Stat label="Needs review" value={stats.needsReview} hint="Flagged and not yet signed off" />
        <Stat label="Reviewed" value={stats.reviewed} />
        <Stat label="Guardrail hits, 30 days" value={stats.guardrailHits30d} hint="Sentences rewritten or flagged" />
      </section>

      <nav aria-label="Review views" className="mb-5">
        <ul className="flex flex-wrap gap-2">
          {REVIEW_VIEWS.map((v) => (
            <li key={v}>
              <Link
                href={v === "needs_review" ? "/ai-review" : `/ai-review?view=${v}`}
                aria-current={view === v ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium ${view === v ? "bg-ink text-white" : "border border-black/10 bg-white text-ink"}`}
              >
                {REVIEW_VIEW_LABELS[v]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {rows.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">{view === "needs_review" ? "Nothing is waiting for review." : "No conversations match this view."}</div>
      ) : (
        <ul className="grid gap-3" aria-label={REVIEW_VIEW_LABELS[view]}>
          {rows.map((c) => (
            <li key={c.id}>
              <article className="bento p-5" aria-labelledby={`conv-${c.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  {c.flagged ? <span className="badge-warning rounded-full px-2.5 py-0.5 font-medium">Flagged</span> : null}
                  {c.guardrailCount > 0 ? <span className="badge-danger rounded-full px-2.5 py-0.5 font-medium">Guardrail: {c.guardrailCount}</span> : null}
                  <span className={`rounded-full px-2.5 py-0.5 font-medium ${c.reviewStatus === "reviewed" ? "badge-success" : "badge"}`}>{REVIEW_STATUS_LABELS[c.reviewStatus]}</span>
                  {c.annotationCount > 0 ? <span className="text-titanium">{c.annotationCount} {c.annotationCount === 1 ? "note" : "notes"}</span> : null}
                </div>
                <h2 id={`conv-${c.id}`} className="mt-2 text-[16px] font-semibold leading-snug text-ink">
                  <Link href={`/ai-review/${c.id}`} className="underline-offset-2 hover:underline">
                    {c.preview || "(no messages)"}
                  </Link>
                </h2>
                {c.flagReason ? <p className="mt-1 text-[14px] text-titanium">{c.flagReason}</p> : null}
                <p className="mt-2 text-[13px] text-titanium">
                  {c.turnCount} {c.turnCount === 1 ? "turn" : "turns"} · started <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
                  {c.page ? ` · from ${c.page}` : ""}
                  {c.leadLinked ? " · tied to a lead" : ""}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="bento p-5">
      <p className="text-[13px] text-titanium">{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[13px] text-titanium">{hint}</p> : null}
    </div>
  );
}
