import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Flash, Loading, Section, Submit, when } from "@/app/(staff)/deals/ui";
import { requireStaff } from "@/lib/auth/dal";
import { intelRuntime } from "@/lib/agents/intel/runtime";
import { INTEL_LIMITS, INTEL_STATUS_LABELS } from "@/lib/agents/intel/types";
import { editIntelAction, reviewIntelAction } from "../../actions";
import { UUID } from "../../_lib/forms";

export const metadata: Metadata = { title: "Market note" };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default function DraftPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="draft" />}>
      <DraftData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DraftData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  await requireStaff(`/prospects/intel/${id}`);
  const rt = await intelRuntime();
  if (!rt) return <p className="bento p-6 text-sm text-titanium">Storage is not configured.</p>;
  const d = await rt.intel.getDraft(id);
  if (!d) notFound();
  const pending = d.status === "pending_review";
  const byId = new Map(d.signals.map((s) => [s.id, s]));

  return (
    <>
      <Link className="text-sm text-titanium hover:text-ink" href="/prospects/intel">
        ← All drafts
      </Link>
      <div>
        <p className="eyebrow">Market note · week of {d.weekStart} · version {d.version}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{d.headline}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={d.status === "approved" ? "good" : d.status === "rejected" ? "bad" : d.status === "pending_review" ? "warn" : "neutral"}>{INTEL_STATUS_LABELS[d.status]}</Badge>
          <Badge>{d.generatedBy === "model" ? `Written by ${d.servedModel ?? d.model ?? "the market-intel model"}` : "Rules digest"}</Badge>
          {d.guardrailHits.length ? <Badge tone="warn">Output guardrails matched: {d.guardrailHits.join(", ")}</Badge> : null}
          {d.injectionCodes.length ? <Badge tone="warn">Instruction-like text was removed from the sources</Badge> : null}
        </div>
        {d.note ? <p className="mt-3 text-sm text-titanium">{d.note}</p> : null}
        {d.promptId ? (
          <p className="mt-1 text-xs text-titanium">
            Prompt {d.promptId}@{d.promptVersion} ({d.promptSha256?.slice(0, 12)})
          </p>
        ) : null}
      </div>
      <Flash error={typeof sp.error === "string" ? sp.error : undefined} notice={typeof sp.notice === "string" ? sp.notice : undefined} />

      {pending ? (
        <Section title="Edit" description="Fix wording or drop a bullet by clearing it. Citations stay as the model wrote them, so an edit cannot invent a source.">
          <form action={editIntelAction} className="space-y-4">
            <input name="id" type="hidden" value={d.id} />
            <label className="block">
              <span className="field-label">Headline</span>
              <input className="field" defaultValue={d.headline} maxLength={INTEL_LIMITS.headline} name="headline" required />
            </label>
            <label className="block">
              <span className="field-label">Summary</span>
              <textarea className="field" defaultValue={d.summary} maxLength={INTEL_LIMITS.summary} name="summary" required rows={4} />
            </label>
            {d.sections.map((s, i) => (
              <fieldset className="rounded-2xl border border-black/10 p-4" key={i}>
                <legend className="px-1 text-sm font-semibold text-ink">{s.title}</legend>
                <input name={`section-${i}-title`} type="hidden" value={s.title} />
                <div className="space-y-3">
                  {s.bullets.map((b, j) => (
                    <label className="block" key={j}>
                      <span className="field-label">Bullet {j + 1}</span>
                      <textarea className="field" defaultValue={b.text} maxLength={INTEL_LIMITS.bulletText} name={`bullet-${i}-${j}`} rows={2} />
                      <span className="mt-1 block text-xs text-titanium">Cites {b.signalIds.map((sid) => byId.get(sid)?.title ?? sid).join("; ")}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <Submit tone="glass">Save edits</Submit>
          </form>
        </Section>
      ) : (
        <Section title="Note">
          <p className="text-sm text-ink">{d.summary}</p>
          <div className="mt-4 space-y-4">
            {d.sections.map((s, i) => (
              <div key={i}>
                <h3 className="text-sm font-semibold text-ink">{s.title}</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b.text}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Sources" description="The public signals this note was written from. Check them before sharing anything.">
        <ul className="space-y-2 text-sm">
          {d.signals.map((s) => (
            <li key={s.id}>
              {s.url ? (
                <a className="text-accent underline-offset-2 hover:underline" href={s.url} rel="noreferrer noopener" target="_blank">
                  {s.title}
                </a>
              ) : (
                s.title
              )}
              <span className="text-titanium">
                {" "}
                · {s.source.replace("_", " ")}
                {s.publishedAt ? ` · ${s.publishedAt}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {pending ? (
        <Section title="Decision" description="Approving marks the note reviewed for internal use. It does not publish or send anything.">
          <div className="grid gap-4 md:grid-cols-2">
            <form action={reviewIntelAction} className="space-y-3">
              <input name="id" type="hidden" value={d.id} />
              <input name="decision" type="hidden" value="approved" />
              <label className="block">
                <span className="field-label">Note (optional)</span>
                <input className="field" maxLength={INTEL_LIMITS.reviewNote} name="note" />
              </label>
              <Submit>Approve</Submit>
            </form>
            <form action={reviewIntelAction} className="space-y-3">
              <input name="id" type="hidden" value={d.id} />
              <input name="decision" type="hidden" value="rejected" />
              <label className="block">
                <span className="field-label">Why is it rejected?</span>
                <input className="field" maxLength={INTEL_LIMITS.reviewNote} name="note" required />
              </label>
              <Submit tone="glass">Reject</Submit>
            </form>
          </div>
        </Section>
      ) : d.reviewedBy ? (
        <p className="text-sm text-titanium">
          {INTEL_STATUS_LABELS[d.status]} by {d.reviewedBy.replace(/^staff:/, "")} on {when(d.reviewedAt)}
          {d.reviewNote ? `: ${d.reviewNote}` : "."}
        </p>
      ) : null}
    </>
  );
}
