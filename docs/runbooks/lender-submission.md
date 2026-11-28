# Lender submission

How staff prepare a deal for a lender, ask a broker to approve it, and send it; what the readiness override means; and why nothing is emailed to a lender today. The design is in the lender-ready deal submission spec; the code is `lib/deals/submission/` (facts, readiness, summary, email, send) and `app/(staff)/deals/[id]/submission/` (the editor and preview).

## The one path

Every lender submission goes through **Deal → Lender submission → Preview → Request broker approval**. There is no other send: the deal page and the matching desk (`/lenders/deals/[id]`) both post to the same request, and `sendPackageToLender` refuses any send that does not carry a prepared submission (readiness, the locked summary and the exact email). A broker approves every submission with a fresh authenticator code before a share link exists.

## Prepare the submission

1. Open the deal (`/deals/[id]`). The **Lender submission** card shows the lender-ready meter for Screen (soft quote), Term sheet and Underwrite, and the first missing items. Press **Prepare lender submission**.
2. First time only: the editor shows **Suggested values** from the lead intake, saved spreads and the public record. Nothing is stored until you press **Start from these**. Each value keeps its source tag (*Per borrower*, *From spread*, *Public record*); retyping a value makes it *Entered*.
3. Fill the sections the deal's playbook shows (the playbook comes from the deal program; change it on Loan request within the allowed set). Each section saves on its own. A refused save names the field and keeps what you typed.
   - **No ratio can be typed.** LTV, LTC, DSCR, debt yield, cap rate and yield on cost are computed in the side panel, each with its formula and inputs. A missing input reads "Needs: …", never a zero.
   - DSCR needs an **assumed rate and amortization** on Loan request. Lenders see it labelled "an assumption, not a quote".
   - Ground-up **construction** has no Operating financials section; enter the **projected stabilized NOI** and the months to stabilize in the Construction section.
   - Never type an SSN, ITIN, EIN, date of birth, account or routing number, or a guarantor's name in free text. The editor refuses those shapes; they belong in the document vault.
4. Fix every missing item the meter lists. Each one links to its field (or to the checklist desk, the principals file, the hard money file or the construction desk).

## Preview

Press **Preview the email and summary** (or open `/deals/[id]/submission/preview`). Pick a lender and what to ask for. The page shows:

- the **fit** against the lender's recorded box (what fits, what is outside it, what the lender has not recorded);
- the **exact email**, subject and body, with `{{SHARE_LINK}}` and `{{LINK_EXPIRES}}` where the link goes after approval, and its SHA-256;
- the **summary** the lender will see behind the link (also as a PDF: **Open the summary PDF**).

The preview writes nothing, locks nothing and asks no approval. The email the broker approves is byte for byte what the preview shows for the same facts, lender and documents.

## Request broker approval

On the preview, tick the lenders and the vault documents (the deal summary is always included) and press **Request broker approval**. For the whole batch the summary is built, rendered and stored, and the package version is locked; then each lender gets its own approval request with its own email. Nothing is sent and no link exists until a broker approves.

### What the override means

If required items are missing for the stage you ask for, the request is **refused** and lists them, unless you give a **reason of at least 20 characters** ("Reason to send with items missing"). With a reason:

- the missing items and the reason are stored on the submission (`lender_outreach.readiness_missing`, `readiness_override_reason`) and shown to the approving broker on `/approvals`, with a link to the preview;
- the email tells the lender plainly what is not yet in hand;
- the **broker's approval is the control**: the reason asks a broker to accept the gap; it does not approve anything by itself.

The same reason also lets through a lender the matcher did not rank, or whose recorded box the request falls outside ("LTV 78% vs 75% maximum"); the broker sees that too.

**No reason lifts a hard stop.** An open sanctions hold, a deal on hold, held for counsel, closed, withdrawn or lost, an inactive lender, or a lender with no recorded appetite for the program stop the request whatever is written.

## After approval

1. The broker approves on `/approvals` (authenticator code required).
2. On the deal page, press **Check approval** on the submission's row.
3. **Email to lenders is off** (the default), so nothing is emailed. The page shows, **once**, the share link and the approved email with the link and its expiry filled in, with **Copy subject** and **Copy email**. Send it from your own mailbox, to the lender's submission contact, unchanged.
4. Press **Mark sent**. The one-time view closes.

The lender's link opens a page with the locked summary above the documents. It expires (30 days at most), counts opens, and stops working if the submission is withdrawn or a hold is placed. Withdraw a submission from its row to revoke the link.

If the profile, the lender's contact or the email changes after approval was requested, re-checking reports a conflict: withdraw the submission and request approval again, so a broker approves what will actually be sent.

## Lender email stays off

Email to lenders is controlled by `LENDER_EMAIL_ENABLED`, read only in `lib/deals/mailer.ts` (`lenderEmailEnabled`) and wired in `lib/deals/runtime.ts`. It is **unset**, and nothing in the submission flow sets, reads around or changes it: with it unset the desk builds, previews, locks and approves, and staff send the approved text by hand. Turning it on is the **owner's decision** (open question 8 of the spec), made once previews on real deals look right; only then does an approved submission send its stored text automatically, still only after a broker approves it.

## Where things are recorded

| What | Where |
| --- | --- |
| Deal and property facts, with each field's source | `deal_submission_profiles` (audited with old and new values) |
| Sponsor summary | `deal_sponsor_profiles` (audit keeps who changed which column, never the values) |
| The summary each lender was shown | `deal_summaries` (immutable; the PDF's SHA-256 is in the locked package manifest) |
| Stage, missing items, override reason, fit, the approved email and its hash | `lender_outreach` |
| The broker's decision and step-up | `approvals` and the re-authentication proof |
