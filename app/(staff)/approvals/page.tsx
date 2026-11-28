import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { requiresReauthentication } from "@/lib/agents/core/reauth";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can, licenseStatus } from "@/lib/auth/policy";
import { getApprovalService } from "@/lib/approvals/server";
import { isSelfApproval, kindLabel, needsSeparateApprover, type ApprovalRecord } from "@/lib/approvals/types";
import { DecisionForm, SweepButton } from "./DecisionForm";
import { approvalSubmissionContent, requirementLabel, type ApprovalSubmissionContent } from "@/app/(staff)/deals/[id]/submission/_lib/data";
import { SummaryView } from "@/app/(staff)/deals/[id]/submission/_components/SummaryView";
import { lenderSubmissionDetails, relativeExpiry, statusLabel, type SubmissionApprovalDetails } from "./format";

export const metadata: Metadata = { title: "Approvals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">Broker approval gate</p>
        <h1 className="font-display text-[32px] font-semibold text-ink">Approvals</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">
          Nothing leaves Corin (email, text, lender submission, e-sign or CRM change) until a licensed broker approves it here. Requests that time out
          expire and are never sent.
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading approvals" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view = sp.view === "decided" ? "decided" : "pending";
  const ctx = await requireStaff(view === "decided" ? "/approvals?view=decided" : "/approvals");
  const service = await getApprovalService();
  if (!service) return <div className="bento p-8 text-titanium">The approval queue is not configured on this deployment, so nothing can be sent.</div>;

  const now = new Date();
  const today = californiaDate(now);
  const approve = can(ctx.principal, "approve", today);
  const reject = can(ctx.principal, "reject", today);
  const lic = licenseStatus(ctx.principal.profile, today);
  const records = await service.list({ status: view === "pending" ? "pending" : ["approved", "rejected", "expired", "cancelled"], limit: 200 });
  // A lender submission's card shows what is approved, from storage: the stored email and the locked summary.
  const contents = new Map<string, ApprovalSubmissionContent | null>(await Promise.all(records.filter((r) => r.kind === "lender_submission").map(async (r) => [r.id, await approvalSubmissionContent(r)] as const)));
  const decidedId = z.uuid().safeParse(sp.decided).data;
  // An override the viewer requested needs another approver, unless the viewer is the designated officer.
  const officer = ctx.principal.profile.dreLicenseType === "broker_officer" && Boolean(ctx.principal.profile.dreLicenseNumber);
  const ownOverride = (r: ApprovalRecord) => !officer && needsSeparateApprover(r) && isSelfApproval(r, { userId: ctx.principal.userId, email: ctx.principal.email });
  const justDecided = decidedId ? await service.get(decidedId) : null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Approval views">
          <ul className="flex gap-2">
            {(["pending", "decided"] as const).map((v) => (
              <li key={v}>
                <Link
                  href={v === "pending" ? "/approvals" : "/approvals?view=decided"}
                  aria-current={view === v ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium ${view === v ? "bg-ink text-white" : "border border-black/10 bg-white text-ink"}`}
                >
                  {v === "pending" ? "Waiting for a decision" : "Decided"}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {reject.ok ? <SweepButton /> : null}
      </div>

      {justDecided && justDecided.status !== "pending" ? (
        <p role="status" className="notice-success mb-5 rounded-xl px-4 py-3 text-[14px]">
          {kindLabel(justDecided.kind)} {justDecided.status}: {justDecided.summary}
        </p>
      ) : null}

      {lic.status === "expiring" && ctx.principal.staffRoles.includes("broker") ? (
        <p role="status" className="notice-warning mb-5 rounded-xl px-4 py-3 text-[14px]">
          Your DRE license on file expires in {lic.daysToExpiry} {lic.daysToExpiry === 1 ? "day" : "days"}. Renew it and ask an administrator to update your profile.
        </p>
      ) : null}

      {records.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">{view === "pending" ? "No requests are waiting. Everything is decided." : "No decisions yet."}</div>
      ) : (
        <ul className="grid gap-4" aria-label={view === "pending" ? "Requests waiting for a decision" : "Decided requests"}>
          {records.map((r) => (
            <li key={r.id}>
              <ApprovalCard
                record={r}
                now={now}
                pending={view === "pending"}
                canApprove={approve.ok && !ownOverride(r)}
                blocked={!approve.ok ? approve.reason : ownOverride(r) ? "You requested this submission with a reason to send anyway; another licensed broker, or the designated officer, must approve it." : undefined}
                canReject={reject.ok}
                content={contents.get(r.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ApprovalCard({ record: r, now, pending, canApprove, blocked, canReject, content }: { record: ApprovalRecord; now: Date; pending: boolean; canApprove: boolean; blocked?: string; canReject: boolean; content: ApprovalSubmissionContent | null }) {
  const payload = JSON.stringify(r.payload, null, 2);
  const submission = lenderSubmissionDetails(r, requirementLabel);
  return (
    <article className="bento p-6" aria-labelledby={`approval-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="badge rounded-full px-2.5 py-0.5 font-medium">{kindLabel(r.kind)}</span>
        {pending ? (
          <span className="text-titanium">{relativeExpiry(r.expiresAt, now)}</span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${r.status === "approved" ? "badge-success" : "badge"}`}>{statusLabel(r)}</span>
        )}
      </div>
      <h2 id={`approval-${r.id}`} className="mt-2 text-[17px] font-semibold leading-snug text-ink">
        {r.summary}
      </h2>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-[14px] text-titanium sm:grid-cols-2">
        <div>
          <dt className="inline">Requested by </dt>
          <dd className="inline text-ink">{r.requestedBy}</dd>
        </div>
        <div>
          <dt className="inline">Requested </dt>
          <dd className="inline">
            <time dateTime={r.createdAt}>{dateFmt.format(new Date(r.createdAt))}</time>
          </dd>
        </div>
        {r.dealId ? (
          <div>
            <dt className="inline">Deal </dt>
            <dd className="inline">
              <Link href={`/deals/${r.dealId}`} className="text-accent underline underline-offset-2">
                Open deal
              </Link>
            </dd>
          </div>
        ) : null}
        {!pending && r.decidedAt ? (
          <div>
            <dt className="inline">Decided </dt>
            <dd className="inline">
              <time dateTime={r.decidedAt}>{dateFmt.format(new Date(r.decidedAt))}</time>
              {r.decidedByLabel ? ` by ${r.decidedByLabel}` : ""}
              {r.decidedByDre ? ` (DRE ${r.decidedByDre})` : ""}
            </dd>
          </div>
        ) : null}
        {r.decisionReason ? (
          <div className="sm:col-span-2">
            <dt className="inline">Reason </dt>
            <dd className="inline text-ink">{r.decisionReason}</dd>
          </div>
        ) : null}
      </dl>
      {submission ? <SubmissionDetails d={submission} content={content} id={r.id} pending={pending} /> : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-[14px] font-medium text-accent">What will be sent</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-canvas p-3 text-[13px] leading-relaxed text-ink">{payload}</pre>
      </details>
      {pending ? (
        <DecisionForm id={r.id} summary={r.summary} canApprove={canApprove} approveBlockedReason={blocked} canReject={canReject} stepUp={requiresReauthentication(r)} />
      ) : null}
    </article>
  );
}

/**
 * A lender submission's readiness, override reason and fit exceptions, and
 * what the broker approves: the stored email subject and text and the locked
 * summary, each with whether it matches the hash in the request. The live
 * preview is linked only as the current draft.
 */
function SubmissionDetails({ d, content, id, pending }: { d: SubmissionApprovalDetails; content: ApprovalSubmissionContent | null; id: string; pending: boolean }) {
  const inactive = content?.outreachStatus && content.outreachStatus !== "pending_approval" && pending ? content.outreachStatus.replace(/_/g, " ") : null;
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-canvas p-3 text-[14px] text-ink">
      {d.stageLabel ? (
        <p>
          <span className="text-titanium">Asks the lender for </span>
          {d.stageLabel.toLowerCase()}
        </p>
      ) : null}
      {inactive ? (
        <p className="font-medium text-danger" role="note">
          This submission is {inactive}; approving it sends nothing.
        </p>
      ) : null}
      {d.missing.length ? (
        <div>
          <p className="font-medium text-danger">Required items missing ({d.missing.length})</p>
          <ul className="list-disc pl-5">
            {d.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : d.readinessChecked ? (
        <p>Every required item is in hand.</p>
      ) : null}
      {d.overrideReason ? (
        <p>
          <span className="font-medium">Reason to send anyway: </span>
          {d.overrideReason}
        </p>
      ) : null}
      {d.fitExceptions.length ? (
        <div>
          <p className="font-medium text-warning">Outside the lender&apos;s recorded box</p>
          <ul className="list-disc pl-5">
            {d.fitExceptions.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {content?.email ? (
        <details className="rounded-lg bg-white/70 p-2" open>
          <summary className="cursor-pointer font-medium">The email you are approving (stored, exactly as it will be sent)</summary>
          <p className={`mt-2 text-[13px] font-medium ${content.emailVerified ? "text-success" : "text-danger"}`} data-testid="approval-email-hash">
            {content.emailVerified ? "Matches the SHA-256 in this request." : content.emailProblem}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-titanium">Subject</p>
          <p className="break-words font-medium" data-testid="approval-email-subject">
            {content.email.subject}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-titanium">Body (the link and its expiry are filled in only after approval)</p>
          <pre className="mt-1 max-h-96 max-w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/[0.03] p-3 font-mono text-[12px] leading-relaxed" data-testid="approval-email-body" tabIndex={0}>
            {content.email.text}
          </pre>
        </details>
      ) : content?.emailProblem ? (
        <p className="font-medium text-danger">{content.emailProblem}</p>
      ) : null}
      {content?.summary ? (
        <details className="rounded-lg bg-white/70 p-2">
          <summary className="cursor-pointer font-medium">The locked deal summary the lender will see</summary>
          <p className={`mt-2 text-[13px] font-medium ${content.summaryVerified ? "text-success" : "text-danger"}`} data-testid="approval-summary-hash">
            {content.summaryVerified ? "Matches the SHA-256 in this request." : "This summary does not match the SHA-256 in the request. Reject it and ask for the submission to be prepared again."}
          </p>
          <div className="mt-2">
            <SummaryView headingLevel={4} idPrefix={`approval-summary-${id}`} spec={content.summary} />
          </div>
        </details>
      ) : content && content.summaryId ? (
        <p className="font-medium text-danger">The locked summary for this request was not found. Reject it and ask for the submission to be prepared again.</p>
      ) : null}
      {d.draftHref ? (
        <p>
          <Link className="font-medium text-accent underline underline-offset-2" href={d.draftHref}>
            Open the current draft
          </Link>{" "}
          <span className="text-titanium">(rebuilt from what is saved now; not what you are approving)</span>
        </p>
      ) : null}
    </div>
  );
}
