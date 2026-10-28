# One central store in the school's Google Drive (D-333, D-334)

Status on 28 October 2026: see "Where it stands" at the end. In short: the
code is deployed; Drive is the store for two pilot accounts (the owner and
QA Office), and only the owner's has uploaded; the first backup into Drive ran
and was restored with the school's key; the 11 bucket documents were copied
in, originals kept; the rollout to every role still waits for one upload from
the office account.

## The central store

**One destination for every role**: the folder `VPPS One documents`
(`1MPLDVfid2eQIMNs8rRQTzEhaUZFVh826`) in the school's Shared Drive "Share"
(`0AP-Gd2gbSzZZUk9PVA`), chosen by the owner on 27 and 28 Oct. Every upload,
from any role allowed to add documents (admin and office; teachers hold no
document permission), goes through VPPS One's backend to that folder as the
service account `vppsone-drive@vpps-one-files.iam.gserviceaccount.com`. Nobody
signs in to Google, picks a Drive, or holds a credential; the uploader is
recorded as `uploaded_by` in the database, never as a Drive owner.

**Who owns the files.** Files in a Shared Drive belong to the `vpps.co.in`
organisation, not to any one account. raj@vpps.co.in is the drive's only
manager (organizer), so only that account can open, move, share or delete
them in Drive, and they survive any account being deleted or suspended. The
service account is a writer on the one folder and not a member of the drive.
A folder in raj@vpps.co.in's own My Drive was offered and declined: Google no
longer lets a service account own files in a My Drive, so it would need a
stored refresh token from the owner's consent, and My Drive files go with
the account if it is ever removed.

**Changing the destination** is refused by the database while any document
lives in Drive, unless the same transaction says
`set local vppsone.confirm_storage_move = 'yes'` (do that only after copying
every Drive document). Every change to the settings row is recorded in
`vppsone.file_storage_settings_history`.

**No silent fallback.** If the settings row cannot be read, the student page
says storage cannot be reached and offers no upload, and every upload route
refuses with a retryable error. While Drive is the store for a person, the
bucket upload route refuses them (`provider_off`). The old Server Action
upload, a second way into the bucket, is removed.

## What is where (inventory, 28 Oct)

| Data | Where it lives | In Drive | Today |
|---|---|---|---|
| Student documents uploaded through Drive | Drive folder (primary) | yes, the original; sealed copy also kept in Supabase `vppsone-drive-backups` (another provider) | 9: one real 369 KB PDF (27 Oct) and 8 synthetic pilot files (28 Oct), 20.9 MB |
| Student documents that were in the bucket `vppsone-documents` | Drive folder since 28 Oct (copy-only move); the bucket originals are kept | yes, verified by Drive's sha256 | 11 moved, all synthetic, 13.8 MB; 1 unfinished upload left in the bucket untouched |
| Profile photographs `vppsone-photos` | Supabase (stays: shown as thumbnails on lists, private signed URLs) | sealed copy nightly | 1 |
| Fee app photographs `student-photos`, voice notes `defaulter-voice-notes` | Supabase | sealed copy nightly | 0, 0 |
| Generated receipt PDFs `parent-documents` | Supabase, transient (made again from the receipt) | no; the receipts themselves are in the snapshot | 3 |
| `nightly-backups`, `vppsone-archives` | Supabase; backups of backups | no | 0, 66 |
| Generated PDFs (receipts, statements, report cards) | not stored; drawn on demand | — | — |
| Every record: students, fees, attendance, marks, notes, permissions, transactions (`vppsone` and `public` schemas) | **Postgres stays the system of record** | nightly sealed snapshot of every table | 204 tables, 49,644 rows on 28 Oct (28.6 MB of JSON, 3.9 MB sealed) |
| Sign-in accounts (Supabase Auth) | Supabase Auth | **no**: password hashes are never exported; staff profiles are in the snapshot, sign-in would be re-invited after a restore | — |

Google Drive is not a transactional database and nothing here makes it one:
the app reads and writes Postgres, and Drive holds file bytes and copies.

The database VPPS One reads is `wtgxcptmucjerhufzjcf` (schoolfees-dev,
D-208). The live fee database `vgqyilgstjvgohrsiwkb` is not touched by any
part of this.

## How it works

```
browser ──chunks (≤3.75 MiB)──▶ VPPS One /documents/uploads ──resumable upload──▶ Shared Drive
browser ◀──streamed, no-store── VPPS One /documents/<id>     ◀──alt=media────────── Shared Drive
                                      │
                                      └── nightly: read, check sha256, seal ──▶ Supabase vppsone-drive-backups
```

- **Identity, no key.** The org forbids service-account keys
  (`iam.disableServiceAccountKeyCreation`), and a key in an environment
  variable is the thing that leaks. Vercel gives every production function an
  OIDC token; Google's Security Token Service trades it for a federated token,
  and IAM Credentials trades that for a one-hour token of the service account
  `vppsone-drive@…`. The Workload Identity provider accepts only tokens whose
  subject is `owner:veerpattas-projects:project:vppsone:environment:production`
  — a preview deployment or a laptop gets nothing.
- **What the account can reach.** One folder, `VPPS One documents`
  (`1MPLDVfid2eQIMNs8rRQTzEhaUZFVh826`), in the school's existing Shared
  Drive "Share" (`0AP-Gd2gbSzZZUk9PVA`), where it is a **writer**: it can add
  files there and edit their content, not delete or trash them, and it is
  not a member of the drive, so the drive's other contents are invisible to
  it. That is an access-control list on the folder, enforced by Google, not
  a folder the code happens to choose. It is not a Workspace user, has no
  domain-wide delegation, and is shared on nothing else. (The owner chose
  the existing drive over a new one on 27 Oct; folder-level access keeps the
  unrelated file already in that drive out of reach.)
- **Scope.** `https://www.googleapis.com/auth/drive`. `drive.file` (only files
  the app created) would be narrower and should work because the app creates
  every file it touches; it is the first thing to try in the pilot, and the
  constant is in `src/platform/google/workload-identity.ts`.
- **Uploads.** Vercel refuses request bodies over 4.5 MB on every plan, so
  the browser sends 3.75 MiB chunks (a multiple of Drive's 256 KiB) to VPPS
  One, which forwards each to a Drive resumable session. The session URL is a
  capability to write that file, so it stays in a server-only table. The first
  chunk's magic bytes must match the declared type (PDF/JPEG/PNG/WebP) before
  anything reaches Drive. At the end Drive's own size and sha256 must equal
  what the browser declared, or the row is `failed` and never listed.
- **Duplicates and retries.** The browser mints the document id when a file
  is chosen; a second tap of Save, or a retry after a dropped connection, finds
  the same upload. After a failed chunk the server asks Drive how much it has
  and sends only the rest.
- **Viewing.** `/documents/<id>` reads the row as the person asking, through
  `student_documents_select_scoped`: the permission and the class are the
  database's answer. Drive documents stream through VPPS One with
  `private, no-store`, `nosniff`, `no-referrer`, and Range support for PDF
  viewers. Drive has no anonymous signed URL, nobody else is shared on the
  files, and the app never creates an "anyone with the link" permission — so a
  copied Drive file id is useless without a Google account that is a member.
- **Requests.** The upload routes accept only requests carrying
  `x-vppsone-upload: 1` (another site cannot send it without a CORS preflight)
  and, when an `Origin` is present, this site's. A timeout or gateway error
  page is treated as the network and resumed; only signed-out is final.
- **Removing.** Hides the row (`removed_at`); the Drive file stays. The app
  deletes nothing from Drive. Bucket documents are removed as before. A
  removed row's name and note stay readable through the API to people who
  could read it before; its bytes are not served.
- **Downloads** are saved with the extension of the checked type (a PDF
  uploaded as `notes.html` downloads as `notes.pdf`). The Open route may run
  five minutes, so a 10 MB file reaches a slow phone whole.
- **Page speed.** The student page still reads metadata only; bytes are
  fetched when **Open** is pressed. No thumbnails are generated.

### Fixed in passing

- `/documents/<id>` used to read the row with the service role after checking
  only the permission, so a class teacher holding another class's document id
  could open it. It now reads as the person (both stores).
- Bucket uploads trusted the browser's MIME type; they now check the bytes,
  and check the child is in the uploader's scope.
- Bucket uploads used to go through a Server Action, whose body limit is
  Next's default **1 MB**, so documents between 1 and 10 MB failed despite the
  "up to 10 MB" text. Found here; fixed separately in #125 (27 Oct), which
  sends bucket uploads straight to a single-object signed destination and
  checks the stored bytes before listing them (`docs/BUCKET-UPLOAD-STAGING.md`).
  The Drive path is unchanged by it.

## Backup and recovery

A Drive file id in the database restores nothing if the Google account is
lost, and a second folder in the same Drive is not a second copy.

### Into the central Drive folder: "Backup to Google Drive" (D-334)

The nightly `drive-backup` job (22:00 UTC, 03:30 IST; also Jobs → Run now)
writes into `VPPS One documents/backups/`:

1. **The snapshot, first**: every `vppsone` table and every fee (`public`)
   table as Postgres's canonical JSON, with row counts and digests. Each
   schema is read in one statement (`backup_schema_export`), so its tables
   are one moment; if that call is ever too big or slow, tables are read one
   by one and the summary says `oneMoment: no`. The bundle
   `snapshot-<time>.jsonl.gz.sealed` starts with a sealed manifest (digests,
   checksums, the list of every stored file and its copy), then one line per
   table; gzipped, sealed, read back by sha256 after upload. Beside it,
   `snapshot-<time>.summary.json` in plain text says only when, which schema
   version and app commit, how many rows in which tables, and the bundle's
   checksum — no row, no file name, no row digest. Catalogue:
   `vppsone.drive_snapshots`.
2. **File copies** (`backups/file copies/`): a sealed copy of every object
   in `vppsone-documents`, `vppsone-photos`, `student-photos` and
   `defaulter-voice-notes`, once per version and per recovery key (a file is
   read again only if it changed since its copy, or the key changed). Names
   are opaque (`copy-<hash>-<hash>.sealed`): a path can carry a student id,
   and a voice-note path says that family owes fees. Catalogue:
   `vppsone.drive_object_copies`.
3. **The copy-only move**, only while `bucket_migration_approved_at` is set:
   each stored bucket document is read, checked against its size, type and
   recorded sha256, written into the session folder, read back by Drive's own
   sha256, and only then pointed at Drive (`migrated_at`) — and only if the
   row was not removed or changed meanwhile. The bucket original is kept.
   Anything that does not match is **parked** (`migration_failed_at`,
   `migration_note` says why, and names any unused Drive file) and is not
   tried again until somebody clears it.

Steps 2 and 3 run by deadline within the job's five minutes, cannot stop
each other or the snapshot, and carry on the next night. The run fails, where
it is read on the Jobs screen, if Drive is not set up, if no valid recovery
key is set (nothing is ever written unsealed), if the snapshot fails, or if
any copy or move failed or was parked; each is named in the function log
(`vppsone.backup` lines, ids only).

**Retention**: none decided. The owner chose on 28 Oct to keep every backup
for now; the service account cannot delete anything in Drive, so pruning is
the owner's, as the drive's manager. Growth is the snapshot size per night
(see the first run's `snapshotKB` on the Jobs screen) plus changed files.

**Restoring from Drive.** Download a snapshot and its summary from
`backups/` (as raj@vpps.co.in), then
`npm run recovery -- snapshot --key <private.pem> --bundle <….sealed> --summary <….summary.json>`
checks every table; add `--out <folder>` to write one `<schema>.<table>.json`
per table (they hold children's records: a computer you control, deleted
afterwards). File copies open with `npm run recovery -- open`.

**Proved on 28 October** with the first run's output and the school's private
key, on the office PC: the snapshot bundle downloaded from Drive (sha256
`47eb5842…`, equal to `drive_snapshots.sealed_sha256`) and its summary gave
"204 of 204 tables match their count, digest and checksum (49644 rows)"; one
sealed file copy downloaded from `backups/file copies/` opened to its
recorded sha256 ("1 of 1 copies open and match"). Nothing decrypted was
written to disk, and both downloads were deleted afterwards.

Loading those files into an empty database at the snapshot's schema version
(apply the migrations first), per table, in dependency order (staff, fields
and classes before what points at them), for both schemas:

```sql
insert into <schema>.<table> (<every column except generated ones>)
overriding system value
select <the same columns> from jsonb_populate_recordset(null::<schema>.<table>, '<file contents>'::jsonb);
-- then, for each identity or serial column:
select setval(pg_get_serial_sequence('<schema>.<table>', '<column>'), coalesce(max(<column>), 1)) from <schema>.<table>;
```

`overriding system value` is needed for `generated always as identity`
columns; generated (computed) columns are left out and recompute themselves;
`setval` puts sequences past the restored rows. Sign-in accounts are not in
the snapshot: staff are invited again and matched to their restored
`staff_profiles`. **This full rebuild has not been rehearsed**: what is
proved is that a snapshot opens with the key and every table's count,
Postgres digest and checksum match (synthetic test and the tool), and that
the per-table export format reloads to the same digest (the existing archive
drill). A rehearsal into a scratch project is the next step before relying
on it alone.

**What a single account cannot protect against.** Everything above lives in
one Shared Drive managed by one account. If that drive is deleted, or the
Workspace itself is lost, the Drive copies go with it. Two things stand
outside it today: the operational database itself, and the sealed copies of
Drive documents in Supabase (`vppsone-drive-backups`, below). An independent
encrypted copy elsewhere (another provider or a second organisation) would
need the owner's explicit approval; none is made.

### Out of Google: sealed copies of Drive documents in Supabase (D-333)

- **Independent copy.** The nightly `document-backup` job (03:00 IST) closes
  uploads nobody finished, checks Drive end to end (write, read back), checks
  up to 100 documents' sha256 in Drive's metadata against the recorded one
  (oldest check first, so a new revision uploaded over a file is noticed),
  then reads each Drive document that has no copy, checks it against the
  sha256 recorded at upload, seals it and writes it to the private Supabase
  bucket `vppsone-drive-backups` — another provider. Any file that changed,
  no longer matches its checksum, or cannot be copied fails the run where it
  is read on the Jobs screen; nothing is overwritten. The job also refuses a
  recovery key under 3072 bits or one whose fingerprint does not match.
- **Sealed.** AES-256-GCM per file, the key wrapped with RSA-OAEP-SHA256
  (≥ 3072-bit; the tool makes 4096). The app holds only the public half
  (`file_storage_settings.recovery_public_key`), so it can make copies and
  never read them. Format in `src/modules/archives/domain/recovery-envelope.ts`.
- **The recovery key.** Made on the administrator's computer:
  `npm run recovery -- keygen --out <folder>`. Keep
  `vppsone-recovery-private.pem` in two offline places (a USB stick in the
  office safe and a second one at home, or a printout). It is never uploaded,
  pasted into chat, or stored in VPPS One. Losing it means the sealed copies
  cannot be opened — Drive itself is then the only copy.
- **Metadata.** The year-end archive (`docs/ARCHIVE.md`) keeps every
  `vppsone` table with counts and digests, and now includes the
  `vppsone-drive-backups` objects byte for byte, so one archive holds the rows
  and the sealed bytes together with one manifest.
- **Restore test.** `npm run recovery -- verify --key <private.pem> --dir
  <downloaded folder> --expect <list.json>` opens every copy and checks it
  against `content_sha256`. Run it once when the key is made and once a term.
  Automated evidence: `tests/drive-backup-restore.test.ts` (copy → open with
  the private key → same sha256; wrong key and one changed byte refused).

### If something goes wrong

| Event | What happens | What to do |
|---|---|---|
| Google is slow or down | Upload says "try again; nothing lost" and resumes; Open says try in a minute; the student page itself is unaffected | Wait |
| Service account removed from the Shared Drive, or the pool binding deleted | Uploads and Opens of Drive documents refuse; nightly job fails with `revoked` | Re-add it as Contributor, or switch `documents_provider` back to `supabase` (one statement, below) |
| Google account or Shared Drive lost | Drive documents cannot open | Download `vppsone-drive-backups`, open with the recovery key, upload to a new Shared Drive or the bucket, update `drive_file_id` / `storage_provider` |
| Supabase project lost | Rows gone; Drive still holds every file, named by id with `appProperties` | Restore the database from its backup or the year-end archive; the file ids in it still point at Drive |
| Recovery key lost | Sealed copies unreadable | Make a new key; the next nightly run re-seals every document for it (rows whose fingerprint differs are copied again) |

## Settings and the switch

All in one server-only row, `vppsone.file_storage_settings` — identifiers,
never a secret:

```sql
-- 1. After the Google setup: where Drive is, and who the app is.
update vppsone.file_storage_settings set
  shared_drive_id = '<0A…>', root_folder_id = '<1…>',
  google_project_number = '<number>', workload_pool_id = 'vercel',
  workload_provider_id = 'vppsone-production',
  service_account_email = 'vppsone-drive@vpps-one-files.iam.gserviceaccount.com',
  updated_at = now()
where id = 1;

-- 2. Pilot: only these staff upload to Drive.
update vppsone.file_storage_settings set drive_pilot_staff_ids = array['<staff id>']::uuid[] where id = 1;

-- 3. Everyone (only after the pilot report and approval).
update vppsone.file_storage_settings set documents_provider = 'gdrive' where id = 1;

-- Back out at any stage: new uploads return to the bucket at once.
update vppsone.file_storage_settings set documents_provider = 'supabase', drive_pilot_staff_ids = '{}' where id = 1;

-- Copy-only move of bucket documents (approved 28 Oct for the 11 synthetic files):
update vppsone.file_storage_settings set bucket_migration_approved_at = now() where id = 1;
-- ...and its rollback: every moved row points at its kept bucket original again.
update vppsone.student_documents set storage_provider = 'supabase', drive_file_id = null, migrated_at = null
where migrated_at is not null;
-- A parked document is tried again once its cause is understood:
update vppsone.student_documents set migration_failed_at = null, migration_note = null where id = '<id>';
```

Backing out never strands a document: Drive rows keep opening from Drive
while the configuration stays set.

## Google setup

**Done 27 October 2026**, approved by the owner: project `vpps-one-files`
(number `256623860240`, organisation `vpps.co.in`), the four APIs, service
account `vppsone-drive@vpps-one-files.iam.gserviceaccount.com` (no keys),
pool `vercel`, provider `vppsone-production`, and the `workloadIdentityUser`
binding for the production subject. Domain restricted sharing did **not**
refuse the binding, so no organisation policy was changed.

All under the `vpps.co.in` organisation, as raj@vpps.co.in, with `gcloud`
(Claude in Chrome is blocked from clicking in Cloud Console by browser policy).
No billing account, no purchase. The commands, for the record or a rebuild:

```bash
gcloud projects create vpps-one-files --name="VPPS One Files" --organization=754985356765
gcloud services enable drive.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project=vpps-one-files
gcloud iam service-accounts create vppsone-drive --display-name="VPPS One document storage" --project=vpps-one-files
gcloud iam workload-identity-pools create vercel --location=global --display-name="Vercel" --project=vpps-one-files
gcloud iam workload-identity-pools providers create-oidc vppsone-production --location=global \
  --workload-identity-pool=vercel --project=vpps-one-files \
  --issuer-uri="https://oidc.vercel.com/veerpattas-projects" \
  --allowed-audiences="https://vercel.com/veerpattas-projects" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.sub == 'owner:veerpattas-projects:project:vppsone:environment:production'"
gcloud iam service-accounts add-iam-policy-binding vppsone-drive@vpps-one-files.iam.gserviceaccount.com \
  --project=vpps-one-files --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/256623860240/locations/global/workloadIdentityPools/vercel/subject/owner:veerpattas-projects:project:vppsone:environment:production"
```

Revoking the app's access, from the most to the least drastic: disable the
service account; remove the binding above; remove its access to the folder;
or set `documents_provider = 'supabase'` (new uploads stop going to Drive).
Clearing or changing the Drive identifiers in the settings row is refused
while documents live in Drive (D-334); a deliberate move uses
`set local vppsone.confirm_storage_move = 'yes'` and also empties
`vppsone.drive_folders` in the same transaction, after every Drive document
has been copied to the new place.

Then, in Drive as raj@vpps.co.in (done 27 Oct through the Drive connector,
because Chrome is policy-blocked on drive.google.com): a folder
`VPPS One documents` in the existing Shared Drive "Share", shared with
`vppsone-drive@…` as **writer** on that folder only. Its permissions read:
raj@vpps.co.in organizer (inherited), the service account writer; the drive
root still lists only raj@vpps.co.in.

Two things may refuse, and each needs its own decision:

1. **Domain restricted sharing** (`iam.allowedPolicyMemberDomains`, allowed
   customer `C015skn9i`) may refuse the `principal://` binding above, because
   a federated identity is not a Workspace customer. If it does, the narrowest
   fix is a project-level policy on `vpps-one-files` only.
2. **External members on Shared Drives.** A service account counts as
   outside `vpps.co.in`. If Workspace forbids external Shared Drive members,
   an admin must allow it for this one Shared Drive (Admin console asks
   raj@vpps.co.in to re-enter the password, which Claude does not do).

**Administrator recovery.** Whoever holds Organization Administrator on
`vpps.co.in` (today raj@vpps.co.in) can see and change all of the above. The
Shared Drive's managers can always open, move or download every file, with or
without VPPS One. There is no credential to rotate; revoking is deleting the
binding or the membership.

## Limits and cost (measured or quoted, never guessed)

| | Figure | Source |
|---|---|---|
| Drive API | free for standard use; 1,000,000 quota units/min/project, 325,000/min/user; a 10 MB upload is a few requests | Google's Drive API limits page, read 27 Oct 2026. Google says charges for exceeding quota are planned later in 2026 |
| Shared Drive | 500,000 items; 750 GB upload per account per day | Google Workspace help, read 27 Oct 2026 |
| Workspace storage | **Not verified.** Reported as ~100 TB pooled (consistent with Workspace for Education); Admin console needs a password re-entry Claude does not do | — |
| Vercel | 4.5 MB request body (hence chunks); streamed responses are not capped; each Open passes the file through the function once | Vercel docs, read 27 Oct 2026 |
| Vercel bandwidth | Assumption: 100 Opens a day × 500 KB ≈ 1.5 GB a month | Assumption, not measured |
| Sealed copies | Same size as the documents (+ ~600 bytes each), in Supabase Storage | The Supabase organisation is on the **Free** plan (read 27 Oct) and this project holds about 2 MB of objects today. Assumption: 600 children × 4 documents × 400 KB ≈ 1 GB, and **Free allows 1 GB of file storage per project**, so a full roll of documents may need Pro ($25/month, 100 GB) or another independent store — a decision for later, not a purchase made here |
| Google Cloud project `vpps-one-files` | No charge possible: **billing is not enabled** on it (read 27 Oct). Drive, IAM, IAM Credentials and STS need none | `gcloud billing projects describe` |

### Pilot, 27 October 2026 (production, Drive on for raj@vpps.co.in only)

One upload, from the owner's account at 12:19 UTC: a 368,841-byte PDF, kind
"other", to one student record. It was not one of the synthetic pilot files
(those are in the owner's scratch folder, unused). Function timings from the
`vppsone.drive` log lines, region `bom1` — **one sample each, not a benchmark**:

| Step | ms | What it includes |
|---|---|---|
| begin | 2,725 | first Google token in that instance (STS + IAM Credentials), creating the `session 2026-27` folder, opening the resumable session, two database writes |
| chunk (whole file) | 2,585 | 369 KB forwarded to Drive, Drive's sha256 compared with the browser's |
| open, first | 2,584 | scoped row read, settings read, token, until Drive's first byte |
| open, second | 1,654 | the same with the token cached |

Checked afterwards: the row is `stored` with Drive's sha256; the file is in
`VPPS One documents/session 2026-27`, named by ids only, with exactly two
permissions (the owner as organizer, the service account as writer); the
service account is still not a member of the drive.

**Backup and restore, proved 28 October.** The scheduled `document-backup`
run at 22:06 UTC on 27 Oct (03:36 IST) finished `ok` in 9.6 s: Drive health
check passed (write 3,770 ms, read back 1,665 ms, "Read back what was
written in VPPS One documents"), Drive's sha256 for the pilot document
re-verified, one sealed copy made (368,841 bytes → 369,423 sealed, recorded
sha256 `db32c87b…`, key `9c7fea21…`). Restore check the same morning: the
sealed object downloaded from `vppsone-drive-backups` (sha256 matched the
record), then `npm run recovery -- verify` with the school's private key:
"1 of 1 copies open and match their recorded sha256", i.e. exactly the bytes
uploaded to Drive. The decrypted bytes were never written to disk, and the
downloaded copy was deleted afterwards.

### Synthetic pilot, 28 October 2026 (production, the owner's account)

Eight synthetic PDFs (no real data) uploaded through the live app to one
synthetic student, then opened, measured from the browser end to end
(chunking, every round trip, Drive's checks). **One run each, not a
benchmark**:

| File | Upload | Open: first byte | Open: whole file |
|---|---|---|---|
| 100 KB (first upload of the run, cold instance) | 6.2 s | 1.5–2.4 s for every size | 1.7–3.5 s |
| 1 MB | 4.6 s | | |
| 5 MB | 8.0 s | | |
| 9.5 MB | 9.5 s | | |
| 4 × 1 MB at once | all four within ~6 s | | |
| Bucket documents, same session, for comparison | — | 0.5–0.7 s | 0.8–2.1 s |

All eight rows are `stored` with Drive's sha256 equal to the browser's. So a
Drive document takes about a second longer to start opening than a bucket
one (the service-account token and Drive's own latency), and uploads are
bounded by the 3.75 MiB chunk round trips. The JPEG in the scratch folder was
not uploaded.

## Migration of existing files

Approved by the owner on 28 Oct, copy-only, for the 11 stored bucket
documents (all synthetic). Done by the first `drive-backup` run (manual, 28
Oct 04:35 UTC, `ok` in 99 s), step 3 above:

| | Count | Bytes |
|---|---|---|
| Stored bucket documents | 11 | 13,787,636 |
| Copied into `VPPS One documents/session 2026-27`, Drive's sha256 equal to the record | 11 | 13,787,636 |
| ...of which had no sha256 recorded at upload (older rows): size and type checked, and Drive's sha256 compared with the bytes read from the bucket | 3 | |
| Parked (mismatch or failure) | 0 | |
| Bucket originals deleted | 0 (all kept; `student_documents_migrated_kept` enforces it) | |
| Unfinished upload row (`uploading`, 329 bytes) | left alone, not part of the move | |

Each moved row now reads `gdrive` / `migrated_at` set, and opens from Drive.
The rollback statement in "Settings and the switch" points them back at
their bucket originals.

## Where it stands, 28 October 2026

| | State | Evidence |
|---|---|---|
| Code deployed | **Yes**: PRs 122, 123, 124, 126, 127 (125 the bucket fix), production commit `9537e7c` | Vercel production deployment, CI green |
| Central storage enabled | **For two pilot accounts only**: the owner (uploaded 9 files) and QA Office (office role; has not uploaded yet). `documents_provider` is still `supabase` for everyone else | `file_storage_settings` |
| Non-admin pilot | **Not done.** It needs someone signed in as QA Office to upload one synthetic file; Claude does not sign in to the live app with a password, and the QA day-run pairing expired on 19 Oct | — |
| Rollout to every role | **Not done**, by the brief's rule: only after both pilots | — |
| Migration | **Done** for the 11 bucket documents, copy-only, originals kept | table above |
| Backups scheduled | **Yes**: `document-backup` 21:30 UTC (sealed copies to Supabase) and `drive-backup` 22:00 UTC (snapshot, file copies, move) every night | `vercel.json` |
| Latest backup | `drive-backup` 28 Oct 04:35 UTC (manual): snapshot of 204 tables / 49,644 rows, 13 file copies, 11 moved; `document-backup` 27 Oct 22:06 UTC: 1 sealed copy | `job_runs` |
| Restore verified | **Yes, for what was backed up**: snapshot 204/204 tables; one file copy from Drive; one sealed copy from Supabase. **Not** a full rebuild into an empty database | above |
| Retention | Keep everything (owner's choice, 28 Oct) | — |

To finish: sign in as QA Office (any browser), upload a synthetic PDF to a
synthetic student, open it; then check its row (`uploaded_by` = QA Office,
`storage_provider = 'gdrive'`, `stored`) and run step 3 of the settings above.
