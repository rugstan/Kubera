import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can, licenseStatus } from "@/lib/auth/policy";
import { getApprovalService } from "@/lib/approvals/server";
import { kindLabel, type ApprovalRecord } from "@/lib/approvals/types";
import { DecisionForm, SweepButton } from "./DecisionForm";
import { relativeExpiry, statusLabel } from "./format";

export const metadata: Metadata = { title: "Approvals" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

export default function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">Broker approval gate</p>
        <h1 className="font-display text-[32px] font-semibold tracking-tight text-ink">Approvals</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">
          Nothing leaves Kubera (email, text, lender submission, e-sign or CRM change) until a licensed broker approves it here. Requests that time out
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
  const decidedId = z.uuid().safeParse(sp.decided).data;
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
        <p role="status" className="badge-emerald mb-5 rounded-xl px-4 py-3 text-[14px]">
          {kindLabel(justDecided.kind)} {justDecided.status}: {justDecided.summary}
        </p>
      ) : null}

      {lic.status === "expiring" && ctx.principal.staffRoles.includes("broker") ? (
        <p role="status" className="badge-gold mb-5 rounded-xl px-4 py-3 text-[14px]">
          Your DRE license on file expires in {lic.daysToExpiry} {lic.daysToExpiry === 1 ? "day" : "days"}. Renew it and ask an administrator to update your profile.
        </p>
      ) : null}

      {records.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">{view === "pending" ? "No requests are waiting. Everything is decided." : "No decisions yet."}</div>
      ) : (
        <ul className="grid gap-4" aria-label={view === "pending" ? "Requests waiting for a decision" : "Decided requests"}>
          {records.map((r) => (
            <li key={r.id}>
              <ApprovalCard record={r} now={now} pending={view === "pending"} canApprove={approve.ok} blocked={approve.ok ? undefined : approve.reason} canReject={reject.ok} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ApprovalCard({ record: r, now, pending, canApprove, blocked, canReject }: { record: ApprovalRecord; now: Date; pending: boolean; canApprove: boolean; blocked?: string; canReject: boolean }) {
  const payload = JSON.stringify(r.payload, null, 2);
  return (
    <article className="bento p-6" aria-labelledby={`approval-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="badge-emerald rounded-full px-2.5 py-0.5 font-medium">{kindLabel(r.kind)}</span>
        {pending ? (
          <span className="text-titanium">{relativeExpiry(r.expiresAt, now)}</span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 font-medium ${r.status === "approved" ? "badge-emerald" : "border border-black/10 bg-canvas text-ink"}`}>{statusLabel(r)}</span>
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
      <details className="mt-3">
        <summary className="cursor-pointer text-[14px] font-medium text-accent">What will be sent</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-canvas p-3 text-[13px] leading-relaxed text-ink">{payload}</pre>
      </details>
      {pending ? <DecisionForm id={r.id} summary={r.summary} canApprove={canApprove} approveBlockedReason={blocked} canReject={canReject} /> : null}
    </article>
  );
}
