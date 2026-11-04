import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/dal";
import { californiaDate, can } from "@/lib/auth/policy";
import { dealReferenceToken } from "@/lib/mail/classify";
import { MAILBOXES, INBOUND_MAILBOXES } from "@/lib/mail/mailboxes";
import { heldAttachments, listReviewQueue, reviewReasonLabel } from "@/lib/mail/review";
import { mailReviewDeps } from "@/lib/mail/server";
import type { ReviewMail } from "@/lib/mail/store";
import { assignMailAction, dismissMailAction } from "./actions";

export const metadata: Metadata = { title: "Mail review" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" });

const QUEUES = [...new Set(INBOUND_MAILBOXES.map((m) => MAILBOXES[m].queue))];
const QUEUE_LABELS: Record<string, string> = {
  "deal-desk": "Deal desk (deals@)",
  documents: "Documents (docs@)",
  "capital-markets": "Capital markets (lenders@)",
  "third-party-reports": "Third-party reports (vendors@)",
  closing: "Closing (closing@)",
};

const ERRORS: Record<string, string> = {
  not_in_queue: "That message is no longer waiting for review; someone may have resolved it already.",
  unknown_target: "No single deal or lead matches that reference. Use a CC- deal reference, a deal ID or a lead ID.",
  not_assignable: "That message was never read successfully. Open it in the mailbox, then dismiss it here.",
  not_configured: "The mail review queue is not configured on this deployment.",
  forbidden: "Your role cannot file inbound mail.",
  mfa: "Confirm two-step verification, then try again.",
  signed_out: "Your session ended. Sign in again.",
  bad_request: "That message could not be read. Reload the page and try again.",
};

const count = (v: string | string[] | undefined) => {
  const n = Number(typeof v === "string" ? v : NaN);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export default function MailReviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <div className="mb-6">
        <p className="eyebrow">
          <Link href="/documents" className="hover:underline">
            Documents
          </Link>
        </p>
        <h1 className="font-display text-[32px] font-semibold text-ink">Mail review</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-titanium">
          Inbound email that could not be filed automatically: no matching deal, more than one match, a sender that did not authenticate, or a message that looks
          suspicious. File it to a deal or lead, or dismiss it. Attachments stay in quarantine until the message is filed, then they are scanned before anyone can
          open them.
        </p>
      </div>
      <Suspense fallback={<div className="bento h-72 animate-pulse" aria-label="Loading the mail review queue" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const ctx = await requireStaff("/documents/mail");
  const allowed = can(ctx.principal, "view_documents", californiaDate(new Date()));
  if (!allowed.ok) return <div className="bento p-8 text-titanium">{allowed.reason}</div>;
  const canFile = can(ctx.principal, "review_mail", californiaDate(new Date())).ok;
  const deps = mailReviewDeps(ctx.services.mode);
  if (!deps) return <div className="bento p-8 text-titanium">The mail review queue is not configured on this deployment.</div>;
  const queue = typeof sp.queue === "string" && QUEUES.includes(sp.queue) ? sp.queue : null;
  const items = await listReviewQueue(deps.store, { queue });
  const assigned = z.uuid().safeParse(sp.assigned).success;
  const dismissed = z.uuid().safeParse(sp.dismissed).success;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Something went wrong. Try again.") : null;
  const registered = count(sp.registered);
  const failed = count(sp.failed);
  const held = count(sp.held);

  return (
    <>
      {assigned ? (
        <p role="status" className="notice-success mb-5 rounded-xl px-4 py-3 text-[14px]">
          Message filed.
          {registered ? ` ${registered} ${registered === 1 ? "attachment was" : "attachments were"} added to the vault and will be scanned before they can be opened.` : ""}
          {held ? ` ${held} ${held === 1 ? "attachment stays" : "attachments stay"} with the message (no lead to file ${held === 1 ? "it" : "them"} under, or this mailbox keeps attachments with the message).` : ""}
        </p>
      ) : null}
      {assigned && failed ? (
        <p role="alert" className="notice-danger mb-5 rounded-xl px-4 py-3 text-[14px]">
          {failed} {failed === 1 ? "attachment" : "attachments"} could not be added to the vault and stayed in quarantine. Ask an administrator to check the documents log.
        </p>
      ) : null}
      {dismissed ? (
        <p role="status" className="notice-success mb-5 rounded-xl px-4 py-3 text-[14px]">
          Message dismissed.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice-danger mb-5 rounded-xl px-4 py-3 text-[14px]">
          {error}
        </p>
      ) : null}

      <form className="bento mb-4 flex flex-wrap items-end gap-3 p-4" action="/documents/mail">
        <div>
          <label htmlFor="mail-queue" className="field-label">
            Queue
          </label>
          <select id="mail-queue" name="queue" defaultValue={queue ?? ""} className="field">
            <option value="">All queues</option>
            {QUEUES.map((q) => (
              <option key={q} value={q}>
                {QUEUE_LABELS[q] ?? q}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]">
          Filter
        </button>
      </form>

      {items.length === 0 ? (
        <div className="bento p-10 text-center text-titanium">Nothing is waiting for review.</div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4" aria-label="Messages waiting for review">
          {items.map((m) => (
            <li key={m.id} className="min-w-0">
              <MailCard mail={m} canFile={canFile} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function suggestedTarget(m: ReviewMail): string {
  if (m.dealId) return dealReferenceToken(m.dealId);
  return m.leadId ?? "";
}

function MailCard({ mail: m, canFile }: { mail: ReviewMail; canFile: boolean }) {
  const titleId = `mail-${m.id}`;
  const held = heldAttachments(m);
  const failed = m.status === "failed";
  return (
    <article className="bento p-6" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={`${failed ? "badge-danger" : "badge-warning"} rounded-full px-2.5 py-0.5 font-medium`}>{failed ? "Processing failed" : "Needs review"}</span>
        {m.suspicious ? <span className="badge-danger rounded-full px-2.5 py-0.5 font-medium">Suspicious</span> : null}
        <span className="text-titanium">
          {m.mailbox}@ · received <time dateTime={m.receivedAt}>{dateFmt.format(new Date(m.receivedAt))}</time>
          {failed ? null : ` · ${m.category.replace(/_/g, " ")} · DMARC ${m.dmarc}`}
        </span>
      </div>
      <h2 id={titleId} className="mt-2 break-words text-[17px] font-semibold leading-snug text-ink">
        {failed ? "Message could not be read" : m.subject || "(no subject)"}
      </h2>
      {failed ? (
        <p className="mt-1 text-[14px] text-titanium">
          Every retry failed ({m.attempts}). Last error: {m.error ?? "unknown"}.
        </p>
      ) : (
        <>
          <p className="mt-1 break-words text-[14px] text-ink">
            From {m.fromName ? `${m.fromName} ` : ""}
            <span className="text-titanium">&lt;{m.fromAddress}&gt;</span>
          </p>
          {m.snippet ? <p className="mt-2 break-words text-[14px] text-titanium">{m.snippet}</p> : null}
        </>
      )}
      {m.reviewReasons.length ? (
        <ul className="mt-3 list-disc pl-5 text-[14px] text-warning" aria-label="Why it needs review">
          {m.reviewReasons.map((r) => (
            <li key={r}>{reviewReasonLabel(r)}</li>
          ))}
        </ul>
      ) : null}
      {m.attachments.length ? (
        <div className="mt-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-titanium">Attachments</h3>
          <ul className="mt-1 text-[14px] text-ink">
            {m.attachments.map((a) => (
              <li key={a.attachmentId} className="break-words">
                {a.fileName}{" "}
                <span className="text-titanium">
                  ·{" "}
                  {a.status === "stored"
                    ? "held in quarantine"
                    : a.status === "registered"
                      ? "in the vault"
                      : a.status === "skipped_type"
                        ? "not kept (file type not accepted)"
                        : a.status === "skipped_size"
                          ? "not kept (too large)"
                          : a.status === "skipped_limit"
                            ? "not kept (too many attachments)"
                            : "could not be stored"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canFile ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          {failed ? null : (
            <form action={assignMailAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={m.id} />
              <div>
                <label htmlFor={`target-${m.id}`} className="field-label">
                  Deal reference, deal ID or lead ID
                </label>
                <input
                  id={`target-${m.id}`}
                  name="target"
                  required
                  maxLength={80}
                  defaultValue={suggestedTarget(m)}
                  placeholder="CC-1A2B3C4D"
                  autoComplete="off"
                  className="field w-72 max-w-full"
                  aria-describedby={held.length ? `held-${m.id}` : undefined}
                />
              </div>
              <button type="submit" className="pill pill-primary min-h-11 px-5 py-2 text-[15px]">
                File message
              </button>
              {held.length ? (
                <p id={`held-${m.id}`} className="w-full text-[13px] text-titanium">
                  Filing to a lead adds {held.length} {held.length === 1 ? "attachment" : "attachments"} to the vault for scanning.
                </p>
              ) : null}
            </form>
          )}
          <form action={dismissMailAction}>
            <input type="hidden" name="id" value={m.id} />
            <button type="submit" className="pill pill-glass min-h-11 px-5 py-2 text-[15px]">
              Dismiss
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}
