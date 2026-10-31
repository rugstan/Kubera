import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { REVIEW_STATUS_LABELS } from "@/lib/ai/review/types";
import { AnnotationForm, FlagForm, ReviewStatusForm } from "../_components/Forms";
import { Notes, Transcript, when } from "../_components/Transcript";
import { reviewStoreFor } from "../_lib/runtime";

export const metadata: Metadata = { title: "AI conversation" };

type Params = Promise<{ id: string }>;

export default function ConversationPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="bento h-96 animate-pulse" aria-label="Loading conversation" />}>
      <Conversation params={params} />
    </Suspense>
  );
}

async function Conversation({ params }: { params: Params }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireStaff(`/ai-review/${id}`);
  const store = reviewStoreFor(ctx.services);
  if (!store) return <div className="bento p-8 text-titanium">The review queue needs the database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to load conversations.</div>;
  const c = await store.get(id);
  if (!c) notFound();

  const conversationNotes = c.annotations.filter((a) => a.messageIndex === null);
  const targets = c.messages.map((m, i) => ({ index: i, label: `Message ${i + 1}, ${m.role === "user" ? "borrower" : "Kubera AI"}` }));

  return (
    <>
      <Link href="/ai-review" className="text-sm text-titanium hover:text-ink">
        ← All conversations
      </Link>
      <div className="mt-2 mb-6">
        <p className="eyebrow">AI conversation</p>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink">{c.preview || "(no messages)"}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {c.flagged ? <span className="badge-gold rounded-full px-2.5 py-0.5 font-medium">Flagged</span> : null}
          {c.guardrailCount > 0 ? <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-900">Guardrail hits: {c.guardrailCount}</span> : null}
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${c.reviewStatus === "reviewed" ? "badge-emerald" : "border border-black/10 bg-canvas text-ink"}`}>{REVIEW_STATUS_LABELS[c.reviewStatus]}</span>
          <span className="text-titanium">
            Started <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
            {c.page ? ` from ${c.page}` : ""}
            {c.leadLinked ? ", tied to a lead" : ""}
          </span>
        </div>
        {c.flagged ? (
          <p className="mt-3 text-[14px] text-ink">
            <span className="text-titanium">Flag reason: </span>
            {c.flagReason ?? "none given"}
            {c.flaggedBy ? <span className="text-titanium"> ({c.flaggedBy === "guardrail" ? "output guardrail" : c.flaggedBy.replace(/^staff:/, "")}, {when(c.flaggedAt)})</span> : null}
          </p>
        ) : null}
        {c.reviewStatus !== "unreviewed" && c.reviewedBy ? (
          <p className="mt-1 text-[14px] text-titanium">
            {REVIEW_STATUS_LABELS[c.reviewStatus]} by {c.reviewedBy.replace(/^staff:/, "")}, {when(c.reviewedAt)}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="mb-3 text-[18px] font-semibold tracking-tight text-ink">
            Transcript
          </h2>
          <Transcript messages={c.messages} events={c.guardrailEvents} annotations={c.annotations} />
        </section>

        <aside aria-label="Review actions" className="grid content-start gap-5">
          <section aria-labelledby="status-heading" className="bento p-5">
            <h2 id="status-heading" className="text-[16px] font-semibold text-ink">
              Review status
            </h2>
            <div className="mt-3">
              <ReviewStatusForm conversationId={c.id} status={c.reviewStatus} />
            </div>
          </section>
          <section aria-labelledby="flag-heading" className="bento p-5">
            <h2 id="flag-heading" className="text-[16px] font-semibold text-ink">
              {c.flagged ? "Flag" : "Flag this conversation"}
            </h2>
            <div className="mt-3">
              <FlagForm conversationId={c.id} flagged={c.flagged} />
            </div>
          </section>
          <section aria-labelledby="note-heading" className="bento p-5">
            <h2 id="note-heading" className="text-[16px] font-semibold text-ink">
              Add a note
            </h2>
            <div className="mt-3">
              <AnnotationForm conversationId={c.id} messages={targets} />
            </div>
            {conversationNotes.length > 0 ? (
              <>
                <h3 className="mt-5 text-[14px] font-semibold text-ink">Notes on the whole conversation</h3>
                <Notes notes={conversationNotes} />
              </>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}
