"use client";

import { useEffect, useRef, useState } from "react";
import { claimApprovedEmailAction, type ClaimedShare } from "../actions";
import { CopyText } from "./submission/_components/CopyText";

// The approved email and its share link, shown once (spec 5.1 step 6, email
// to lenders off). The deal page only says that one is waiting; this
// component claims it on its first render through a server action, which
// deletes the one-time cookies in the same step, so a refresh or a second
// tab shows nothing. Each hand-off has its own id: after approving a second
// lender on the same page (the server action redirects back here and the
// component keeps its state), the new id triggers a new claim, which replaces
// the email shown. It hides itself once the submission is no longer approved
// (marked sent, or withdrawn).

export function OneTimeApprovedEmail({ dealId, handoff, approvedOutreachIds }: { dealId: string; handoff: string | null; approvedOutreachIds: readonly string[] }) {
  const [claimed, setClaimed] = useState<ClaimedShare | null>(null);
  const lastClaimed = useRef<string | null>(null);

  useEffect(() => {
    if (!handoff || lastClaimed.current === handoff) return;
    lastClaimed.current = handoff;
    let live = true;
    claimApprovedEmailAction(dealId).then(
      (r) => {
        if (live && r) setClaimed(r);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [dealId, handoff]);

  if (!claimed) return null;
  if (claimed.outreachId && !approvedOutreachIds.includes(claimed.outreachId)) return null;
  const { shareUrl, email } = claimed;
  return (
    <div className="notice-warning rounded-2xl px-4 py-3 text-sm" id="approved-email" role="status">
      <p className="font-medium">
        {email
          ? "Approved. Email to lenders is off: send this exact email from your mailbox now, then press Mark sent. The link is shown only once."
          : "Approved. Send this link to the lender from your mailbox now; it is shown only once."}
      </p>
      <p className="mt-1 break-all font-mono text-xs" data-testid="share-url">
        {shareUrl}
      </p>
      {email ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-titanium">Subject</p>
          <p className="break-words font-medium text-ink" data-testid="approved-email-subject">
            {email.subject}
          </p>
          <p className="text-xs font-medium uppercase tracking-wide text-titanium">Body (the text the broker approved, with the link filled in)</p>
          <pre className="max-h-96 max-w-full overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-white/70 p-3 font-mono text-[12px] leading-relaxed text-ink" data-testid="approved-email-body" tabIndex={0}>
            {email.text}
          </pre>
          <div className="flex flex-wrap gap-3">
            <CopyText label="Copy subject" text={email.subject} />
            <CopyText label="Copy email" text={email.text} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
