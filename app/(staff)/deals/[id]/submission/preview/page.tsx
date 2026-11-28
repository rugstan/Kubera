import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Loading, NotConfigured, Section, SignInRequired, Submit } from "@/app/(staff)/deals/ui";
import { currentStaff, dealDeskRuntime } from "@/lib/deals/runtime";
import { can } from "@/lib/deals/session";
import { defaultTargetStage } from "@/lib/deals/submission/readiness";
import { TARGET_STAGE_LABELS, isTargetStage, targetStages, type TargetStage } from "@/lib/deals/submission/types";
import { advisorFor, getPreview } from "../_lib/data";
import { ReadinessMeter } from "../_components/ReadinessMeter";
import { RequestApprovalForm } from "../_components/RequestApprovalForm";
import { RequestFields } from "../_components/RequestFields";
import { SummaryView } from "../_components/SummaryView";

// The exact email (subject and body) and the summary a lender would get, per
// lender and target stage, built in memory on every view: this page writes
// nothing, calls no approval gate and sends nothing. The request form below
// asks for broker approval; email to lenders stays off unless configured.

export const metadata: Metadata = { title: "Submission preview" };

type Params = Promise<{ id: string }>;
type Search = Promise<{ lender?: string; stage?: string }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PreviewPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading label="submission preview" />}>
      <PreviewData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PreviewData({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, sp, staff] = await Promise.all([params, searchParams, currentStaff()]);
  if (!staff) return <SignInRequired level={1} />;
  if (!dealDeskRuntime()) return <NotConfigured level={1} />;
  if (!UUID.test(id)) notFound();
  const requested = typeof sp.lender === "string" && UUID.test(sp.lender) ? sp.lender : null;
  const stageParam = typeof sp.stage === "string" && isTargetStage(sp.stage) ? sp.stage : null;
  // The same advisor the request signs with, so the approved email matches this preview byte for byte.
  const advisor = advisorFor(staff);
  // First pass picks the default stage (highest ready, else Screen) and lender (the requested one, else the first on the panel).
  const first = await getPreview(id, requested, stageParam ?? "screen", advisor);
  if (!first) notFound();
  const stage: TargetStage = stageParam ?? defaultTargetStage(first.view.readiness);
  const lenderId = requested && first.lenders.some((l) => l.id === requested) ? requested : (first.lenders[0]?.id ?? null);
  const preview = stage === (stageParam ?? "screen") && lenderId === requested ? first : ((await getPreview(id, lenderId, stage, advisor)) ?? first);
  const { view, fit, email, lender, blocked } = preview;
  const deal = view.ctx.deal;
  const write = can(staff, "write");
  const readiness = view.readiness[stage];
  const missing = readiness.required.filter((r) => !r.met).length;

  return (
    <>
      <div>
        <Link className="text-sm text-titanium hover:text-ink" href={`/deals/${deal.id}/submission`}>
          ← Back to the submission
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{deal.title}: submission preview</h1>
      </div>
      {view.lenderEmailEnabled ? (
        <div className="notice-warning rounded-2xl px-4 py-3 text-sm" role="note">
          <p className="font-medium">Email to lenders is on.</p>
          <p className="mt-1">After a broker approves, this exact text is sent with the link filled in. This page itself sends nothing.</p>
        </div>
      ) : (
        <div className="notice-warning rounded-2xl px-4 py-3 text-sm" role="note">
          <p className="font-medium">Email to lenders is off.</p>
          <p className="mt-1">After a broker approves, you will get the link and this text to send from your own mailbox. This page builds the email in memory; it saves nothing and sends nothing.</p>
        </div>
      )}

      <Section description="Pick a lender and what to ask for. The summary is the same for every lender; only the greeting and the fit lines change." title="What to preview">
        <form className="grid gap-4 sm:grid-cols-3" method="get">
          <label className="block min-w-0">
            <span className="field-label">Lender</span>
            <select className="field" defaultValue={lenderId ?? ""} name="lender">
              {preview.lenders.length ? (
                preview.lenders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${l.name}${l.stale ? " (verification stale)" : ""}`}
                  </option>
                ))
              ) : (
                <option value="">No panel lender covers this program</option>
              )}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="field-label">Ask for</span>
            <select className="field" defaultValue={stage} name="stage">
              {targetStages.map((s) => (
                <option key={s} value={s}>
                  {TARGET_STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Submit tone="glass">Show preview</Submit>
          </div>
        </form>
      </Section>

      {blocked ? (
        <div className="notice-danger rounded-2xl px-4 py-3 text-sm" role="alert">
          <p className="font-medium">The summary and the email cannot be built from what is saved.</p>
          <p className="mt-1">{blocked} Edit the text in the editor, then preview again.</p>
        </div>
      ) : null}
      {preview.neutralCopy.length ? (
        <div className="notice-warning rounded-2xl px-4 py-3 text-sm" role="note">
          <p className="font-medium">Fair-lending check on staff-typed text</p>
          <p className="mt-1">These words touch a protected characteristic. Edit the text unless it is needed; the approving broker sees them with the request.</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.neutralCopy.map((f) => (
              <li key={`${f.topic}-${f.term}-${f.textIndex}`}>
                &ldquo;{f.term}&rdquo; ({f.label})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Section title={`Readiness: ${TARGET_STAGE_LABELS[stage]}`}>
        <ReadinessMeter headingLevel={3} readiness={view.readiness} stages={[stage]} />
      </Section>

      {lender && fit ? (
        <Section description="Compared with what the lender has on record; facts outside the box are stated plainly in the email." title={`Fit: ${lender.name}`}>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-titanium">Fits the recorded box</dt>
              <dd className="mt-1 text-ink">{fit.matches.length ? fit.matches.join("; ") : "Nothing recorded to compare"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-titanium">Outside the box</dt>
              <dd className={`mt-1 ${fit.exceptions.length ? "text-danger" : "text-ink"}`}>{fit.exceptions.length ? fit.exceptions.join("; ") : "None"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-titanium">Not recorded by the lender</dt>
              <dd className="mt-1 text-ink">{fit.unknown.length ? fit.unknown.join("; ") : "Nothing"}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {fit.staleness.stale ? <Badge tone="warn">{fit.staleness.reason ?? "Verification stale"}</Badge> : <Badge tone="good">Verified within the window</Badge>}
            {lender.portalUrl ? <Badge>This lender takes submissions through its portal</Badge> : null}
          </div>
          {lender.submissionInstructions ? <p className="mt-3 text-sm text-ink">Lender instructions: {lender.submissionInstructions}</p> : null}
        </Section>
      ) : null}

      <Section description="Exactly what the broker approves. The link and its expiry are filled in only after approval." title="The email">
        {email ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-titanium">Subject</p>
              <p className="mt-1 break-words font-medium text-ink" data-testid="email-subject">
                {email.subject}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-titanium">Body</p>
              <pre className="mt-1 max-w-full whitespace-pre-wrap break-words rounded-2xl bg-black/[0.03] p-4 font-mono text-[13px] leading-relaxed text-ink" data-testid="email-body">
                {email.text}
              </pre>
            </div>
            <p className="break-all text-xs text-titanium">Email SHA-256 {email.sha256}</p>
          </div>
        ) : preview.emailError ? (
          <p className="text-sm text-danger" role="alert">
            The email to this lender cannot be built: {preview.emailError}
          </p>
        ) : (
          <p className="text-sm text-titanium">{blocked ? "Fix the text above to see the email." : "Pick a lender to see the email."}</p>
        )}
      </Section>

      <Section description="The one-page summary behind the share link, the same for every lender." title="The summary">
        <p className="mb-4 text-sm">
          <Link className="font-medium text-accent underline-offset-2 hover:underline" href={`/deals/${deal.id}/submission/summary.pdf?stage=${stage}`} prefetch={false}>
            Open the summary PDF
          </Link>
        </p>
        {preview.summary ? <SummaryView spec={preview.summary} /> : <p className="text-sm text-titanium">Fix the text above to see the summary.</p>}
      </Section>

      {write ? (
        <Section description="Locks the package version and asks a broker to approve this submission. Nothing is sent before that." title="Request broker approval">
          <RequestApprovalForm label="Request broker approval">
            <RequestFields checkedLenderId={lenderId} dealId={deal.id} documents={preview.documents} leadLinked={Boolean(deal.leadId)} lenders={preview.lenders} missingCount={missing} stage={stage} />
          </RequestApprovalForm>
        </Section>
      ) : null}
    </>
  );
}
