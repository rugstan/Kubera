# Document vault: operations, backup and restore

Owner: Document vault workstream (K). Anything marked **VERIFY** is a fact that changes outside this repo; confirm it at the source and record the as-of date here.

The vault holds borrower financials (T-12s, rent rolls, PFS, tax returns). Treat every file as restricted data: never copy one into a ticket, chat or a laptop folder. Reference the document id instead.

## How the vault works (what you are operating)

| Stage | Where the file is | Database status | Who can read it |
| --- | --- | --- | --- |
| Upload URL issued | nowhere yet | `pending_upload` | nobody |
| Uploaded, checked | `deal-documents-quarantine` | `quarantined` | nobody |
| Scanned clean | `deal-documents` | `clean` | staff, via a 60-second signed URL, audited |
| Malware found | deleted | `infected` | nobody (row kept as the record) |
| Refused at finalize | deleted | `rejected` | nobody |
| Scanner kept failing | `deal-documents-quarantine` | `scan_failed` | nobody until staff review |

Code: `lib/documents/*` (rules), `workers/scan/*` (scanner), `app/api/documents/*` (HTTP). Schema: `supabase/migrations/20261103000500_k_document_vault.sql`.

### Environment

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vault storage and tables. Without them the routes answer 503. |
| `LEAD_TOKEN_SECRET` / `DOCUMENT_TOKEN_SECRET` | Signs the expiring upload tokens (15 minutes by default, `DOCUMENT_UPLOAD_TTL_SECONDS`). |
| `CLAMAV_REST_URL` (+ `CLAMAV_REST_API_KEY`, `CLAMAV_REST_SCAN_PATH`) | The malware scanner. **Without a scanner nothing ever leaves quarantine**: uploads succeed, downloads stay refused, and `/api/documents/scan` reports `skipped: scanner-not-configured`. |
| `CRON_SECRET` | Authorizes the scan trigger `GET /api/documents/scan`. |
| `DOCUMENT_STAFF_TOKEN` | Interim staff credential for download and delete until staff sessions (WS-I) replace it. 32+ characters. |
| `VAULT_BACKUP_KEY` | AES-256 key for file backups (`openssl rand -base64 32`). |

### Running the scanner

Either schedule `GET /api/documents/scan` every minute with `Authorization: Bearer $CRON_SECRET` (a Vercel Cron entry or any scheduler; the browser also kicks off a scan right after each finalize), or run `npm run scan:worker` in a container (`-- --once` for a single cycle). Both are safe to run at the same time: documents are leased in the database (`claim_documents_for_scan`).

ClamAV: run a clamav-rest sidecar next to clamd and set `CLAMAV_REST_URL`. Set clamd `StreamMaxLength` (and the sidecar's body limit) to at least 50 MB, otherwise large files error and park as `scan_failed`. Keep signatures current (`freshclam` daily). **VERIFY** the sidecar image's response format matches `workers/scan/clamav.ts` after any image change by scanning an EICAR file (`npm test -- workers/scan` covers the parser; do a live check too).

## Routine checks

Weekly, as compliance or the platform owner:

1. `select status, count(*) from documents group by 1;` Anything `quarantined` older than an hour means the scanner is down or not configured. `scan_failed` rows need a person (below).
2. `npm run vault -- verify` (add `--deep` monthly): every `clean` row has its file, with the recorded size (and SHA-256 under `--deep`). Non-zero exit means a file is missing or changed.
3. Review `document_events` for `scan_infected`, `scan_failed` and `download_denied`.

### An infected upload

The worker deletes the file and keeps the row (`status = 'infected'`, `scan_signature`). Nothing to clean up. Tell the advisor who owns the lead so they can ask the borrower for a fresh copy through the normal channel (a broker sends it; the approval gate applies to humans too). Do not open or forward the file.

### A `scan_failed` document

The scanner errored on all attempts. Find out why (`document_events` rows of type `scan_error` carry the message, never the file). Once the scanner is healthy, release it for another round:

```sql
update documents set status = 'quarantined', scan_attempts = 0, scan_error = null, scan_lease_until = null
where id = '<document id>' and status = 'scan_failed';
```

If the file can never be scanned (for example above the scanner's size limit), delete it with `DELETE /api/documents/<id>` and ask the borrower to resend it split or emailed to the advisor.

### Downloads and the audit trail

Staff get files with `GET /api/documents/<id>/download` (`Authorization: Bearer $DOCUMENT_STAFF_TOKEN`, optional `x-staff-actor` and `?purpose=`). The response is a signed URL valid for 60 seconds; the `download` event is written first, and no event means no URL. `document_events` is append-only (a trigger refuses update, delete and truncate) and survives deletion of the document. Only `purge_document_events(cutoff)` can remove rows, and only those older than three years (**VERIFY** the horizon with counsel).

## Backups

Supabase backs up Postgres but **not** the Storage objects, so database restore points leave `clean` rows pointing at missing files. The file backup closes that gap.

- **What:** every `clean` document, encrypted file by file (AES-256-GCM, each blob bound to its name) plus an encrypted manifest. Quarantined, infected and rejected files are never backed up.
- **How often:** daily, after the nightly retention run (`/api/cron/retention`, 10:23 UTC), so the archive does not contain data that run just deleted. Backups are incremental: an already archived file is not copied again.
- **Where:** a private location outside Supabase (a different cloud account or an offline volume). Keep `VAULT_BACKUP_KEY` somewhere else (a password manager with MFA, and a sealed offline copy); an archive without its key is unreadable, and a key stored next to the archive defeats the encryption.
- **How long:** keep archives **at most 35 days** and no longer than the privacy retention schedule allows. Longer retention would keep personal information after a deletion request. (Retention periods are in `lib/privacy/retention.ts`.)

```bash
# Daily, from a machine or job with the service-role key and VAULT_BACKUP_KEY:
npm run vault -- backup --dest /mnt/vault-backups/$(date -u +%F)
npm run vault -- verify
```

`backup` exits non-zero when a `clean` row has no file (`missing`) or a file no longer matches its recorded hash (`corrupt`); neither is archived. Treat either as an incident (see [incident-response.md](./incident-response.md)): the stored file is damaged or was tampered with.

Each day's directory is a complete restore point. Sync it off the machine (for example `rclone` to the archive location) and prune directories older than 35 days.

## Restore

Restore never recreates database rows; the database comes from Supabase. The file restore only writes files for rows that exist, are `clean`, and have the same path. A document deleted after the backup (retention run, deletion request) therefore stays deleted.

### A. Storage bucket lost or damaged, database intact

```bash
npm run vault -- verify                                   # lists what is missing
npm run vault -- restore --src /mnt/vault-backups/<date> --dry-run
npm run vault -- restore --src /mnt/vault-backups/<date>
npm run vault -- verify --deep
```

The restore report lists `restored`, `alreadyPresent`, `skippedNoRow` (deleted since the backup, left deleted on purpose), `skippedChangedRow`, `conflicts` (a different file already sits at the path; re-run with `--overwrite` only after confirming the archived copy is the right one) and `failed`. Any `failed` entry means a bad key or a damaged archive blob: try the previous day's archive for those ids.

### B. Database restored to an earlier point (Supabase PITR or backup)

1. Restore the database first, then run procedure A with the newest archive taken **before** the restore point (**VERIFY** current Supabase point-in-time recovery window and plan limits).
2. Rows that came back from the past may include documents that were deleted since. **Re-apply deletions before you re-open the app:** run the retention job once (`GET /api/cron/retention` with the cron secret) and re-process verified privacy requests completed after the restore point (`privacy_requests` with `completed_at` later than the restore time; their `resolution` says what was deleted). Record this in the incident ticket.
3. Rows in `quarantined` or `pending_upload` whose files are gone are harmless: the scan worker parks them (`scan_failed`) or the sweep removes them. Ask the borrower to re-upload if their lead is still active.
4. `document_events` is restored with the database, so the audit trail may be missing the last minutes before the restore point. Note that gap in the ticket.

### C. One file

Run procedure A. It only touches files that are missing, so it is safe to run for a single lost file.

### Restore drill

Once a quarter, restore the latest archive into a staging project (never production) and run `verify --deep` there. Record the date, the archive used and the result below.

| Date | Archive | Result | By |
| --- | --- | --- | --- |
| _not yet run_ | | | |

## Deleting documents

`DELETE /api/documents/<id>` (staff token) removes the file from both buckets and then the row, and records a `deleted` event. A document under legal hold is refused (HTTP 423). The nightly retention run deletes a lead's documents with the lead (rows and files in the vault bucket); this endpoint is for single documents and for cleaning up anything left in the quarantine bucket.
