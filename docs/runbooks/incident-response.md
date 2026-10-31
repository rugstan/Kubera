# Incident response and California breach notification

Applies to outages, security incidents, suspected data exposure, leaked credentials, and any event where borrower, lender or partner data may have been accessed by someone who should not have it.

This runbook is operational guidance, not legal advice. **Statutory deadlines and thresholds below are marked VERIFY; confirm them with counsel at the start of any incident that may involve personal information.**

## Roles

| Role | Who | Does |
| --- | --- | --- |
| Incident commander (IC) | Designated officer or a delegate they name | Owns decisions, assigns work, declares start and end |
| Technical lead | Senior engineer on call | Containment, investigation, fix |
| Communications lead | A licensed broker | Every message to borrowers, lenders, partners and regulators (nothing goes out without IC approval) |
| Counsel | Outside counsel | Notification obligations, privilege, regulator contact |
| Scribe | Anyone free | Keeps the timeline in the incident ticket |

## Severity

| Level | Definition | Response |
| --- | --- | --- |
| SEV1 | Confirmed or likely unauthorized access to personal information or the document vault; production fully down; leaked service-role key | Start now, all roles, notify counsel within the hour |
| SEV2 | Major feature down (qualifier, sizer, uploads, CRM sync), degraded security control (rate limit, captcha, RLS) | Respond within 1 hour, IC decides on escalation |
| SEV3 | Minor defect, single-user issue, no data risk | Normal ticket |

## First 30 minutes

1. **Declare.** Open an incident ticket; name the IC and scribe; note the discovery time (UTC). The discovery time starts several legal clocks.
2. **Contain before you investigate.**
   - Bad release: Instant Rollback ([deploy-and-rollback.md](./deploy-and-rollback.md)).
   - Leaked credential: rotate it now at the vendor (Supabase service-role key, `TWENTY_API_KEY`, `ANTHROPIC_API_KEY`, `LEAD_TOKEN_SECRET`, `CRON_SECRET`, Resend/Telnyx/Zoho tokens), then update Vercel variables and redeploy. Rotating `LEAD_TOKEN_SECRET` invalidates outstanding upload tokens, which is acceptable.
   - Abusive traffic: tighten Vercel Firewall rules or enable Attack Challenge Mode; confirm Turnstile and the rate limiter are active.
   - Compromised staff or vendor account: disable the user, revoke sessions and API keys, review the vendor's audit log.
3. **Preserve evidence.** Export (do not delete) Vercel runtime logs, Supabase logs and audit tables, Sentry events, and vendor audit logs for the incident window. Do not wipe or rebuild affected systems until evidence is captured.
4. **Do not tamper with records.** The vault and audit trail are the source of truth for what was accessed.

## Investigate

Answer these in the ticket, in order:

- What happened, and when did it start and end (UTC)?
- Which systems and data stores were reachable? (Supabase tables, `deal-documents` bucket, Twenty workspace, mailboxes, vendor accounts.)
- Which records were **actually** accessed or exfiltrated, versus merely exposed? Use storage access logs, download audit rows and API logs.
- Whose data: borrowers, principals, lenders, partners, staff? How many individuals, and how many are California residents?
- Which data elements: names, emails, phone numbers (usually not "personal information" under the breach statute on their own), and the notification-triggering elements listed below.
- Was the data encrypted with a key that was also exposed? (Application-layer field encryption protects SSN/DOB/account numbers only if the key was not compromised.)
- Is the weakness closed, and how do we know?

## California breach notification (Civ. Code §1798.82)

### Does it apply?

A "breach of the security of the system" is unauthorized acquisition of **unencrypted** computerized data that compromises the security, confidentiality or integrity of personal information. It also applies if the data was encrypted but the encryption key or credentials were acquired too. Good-faith acquisition by an employee or agent for business purposes is not a breach if the data is not further disclosed.

"Personal information" is a person's first name or initial and last name **plus** any of: Social Security number; driver's license, California ID, tax ID, passport, military ID or other government ID number; account number or credit/debit card number in combination with a required security code or password; medical information; health insurance information; unique biometric data; automated license plate reader data; genetic data. It also includes a username or email address **in combination with** a password or security question and answer that permits access to an online account.

Kubera collects most of these through the principals, personal financial statement and document-vault flows, so assume the statute applies whenever the vault, principal records or application-layer encryption keys are in scope.

### Deadlines (VERIFY with counsel; amended effective 2026-01-01)

- **Individuals:** notify affected California residents in the most expedient time possible and without unreasonable delay. As amended by SB 446, no later than **30 calendar days** after discovery. Law-enforcement delay requests can defer notice only if documented in writing.
- **Attorney General:** if **more than 500** California residents are affected, submit a sample copy of the notification to the California Attorney General's office, within **15 calendar days** of notifying individuals.
- **Other regimes to check with counsel (VERIFY):** the FTC Safeguards Rule (16 CFR Part 314) requires notice to the FTC for events involving unencrypted customer information of 500 or more consumers; lender agreements and the e-sign, CRM and email vendors' contracts may require their own, shorter notice windows; cyber-insurance policies usually require prompt carrier notice **before** hiring responders.

### Notice content

Title the notice **"Notice of Data Breach"** and use these headings, in plain language, in at least 10-point type:

1. What Happened
2. What Information Was Involved
3. What We Are Doing
4. What You Can Do
5. For More Information

Include: the date of the breach (or estimated range), the date of discovery, the date of the notice, whether the notice was delayed for law enforcement, a general description of the incident, the types of information involved, a toll-free number and address for questions, and, if an SSN or government ID number was exposed, offer **at least 12 months of identity-theft prevention and mitigation services at no cost** (VERIFY the current requirement and who must provide it). Include credit-bureau and FTC contact details.

### Who sends it

The communications lead (a licensed broker) sends notices after IC and counsel approval, by first-class mail or email (email notice must meet the E-SIGN Act consent rules; otherwise use mail or substitute notice). Do not route breach notices through automated workflows.

## Communicate

- **Internal:** status updates to the IC channel every 30 minutes during SEV1.
- **Borrowers and partners:** only after the IC approves; factual, no speculation, no promises about outcomes.
- **Lenders and funders with active deals:** check each lender agreement for a breach-notice clause and send within its window.
- **Regulators and insurers:** through counsel.
- **Press and social media:** nothing without IC and counsel.

## Recover and close

- Confirm the fix with a test, not an assumption. Re-run `npm test`, `npm run test:e2e`, and any exploit reproduction.
- Rotate anything that could have been seen during the incident, not just what was proven stolen.
- Re-enable disabled accounts only after credential reset and MFA re-enrolment.
- Write the post-incident review within **5 business days**: timeline, root cause, what worked, what did not, action items with owners and dates. Blameless format.
- Retain the incident file, notices sent, and evidence per the retention policy (and legal hold if litigation is possible).

## Quick reference: where to look

| Question | Source |
| --- | --- |
| What did the app do? | Vercel runtime logs; Sentry (PII-scrubbed) |
| Who touched which table or file? | Supabase logs; download audit rows; storage access logs |
| Which CRM records changed? | Twenty timeline activities and webhook rows in `crm_events` |
| Who signed in to a vendor? | The vendor's audit log (see [vendor-mfa-checklist.md](./vendor-mfa-checklist.md)) |
| Is CRM sync backed up? | Rows with `crm_error` set in `leads` and `partners`; `/api/cron/crm-retry` response |
