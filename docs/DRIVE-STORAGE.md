# Student documents in the school's Google Drive (D-333)

Status on 27 October 2026: **code written and tested; Drive switched off.**
The owner approved the migration, the Google project, a dedicated Shared
Drive and the backup plan the same day. Nothing reaches Google for a member of
staff until the settings row names them (pilot) or says `gdrive` (everyone).
Until then every upload and every document behaves exactly as before, from
the private Supabase bucket.

## What moves, and what does not

| | Where the bytes are | Changed by this work |
|---|---|---|
| **Student documents** (Aadhaar, birth certificate, TC, photograph, report, other — `vppsone.student_documents`) | Supabase bucket `vppsone-documents` today; the school Shared Drive once switched on | **Yes.** New uploads go to Drive for the pilot list, then for everybody; existing files stay where they are and keep working |
| Profile photographs (`vppsone-photos`, the photo review flow) | Supabase | No. Small (≤ 2 MB, usually ~100 KB), shown as thumbnails on lists; streaming each through a function from Drive would make the Students list slower. Listed as a possible later stage |
| Fee app buckets (`parent-documents`, `student-photos`, `defaulter-voice-notes`, `nightly-backups`) | Supabase (fee app) | No. The fee app's, and on the protected live project for the live fee app |
| Generated PDFs (receipts, statements, report cards) | Rendered on demand, not stored | No |
| Archives (`vppsone-archives`) | Supabase | Archives now also carry the sealed Drive copies (below) |
| Every record: students, fees, attendance, marks, permissions | Postgres | No. Drive holds bytes only; the row stays the index |

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
- Bucket uploads go through a Server Action, whose body limit is Next's
  default **1 MB** (`next.config.ts` sets none), so documents between 1 and
  10 MB have been failing despite the "up to 10 MB" text. Not changed here:
  Drive uploads do not go through a Server Action, and switching to Drive is
  the fix. If Drive is not approved, raise `serverActions.bodySizeLimit` to
  `4mb` (Vercel's ceiling) and change the text to 4 MB.

## Backup and recovery

A Drive file id in the database restores nothing if the Google account is
lost, and a second folder in the same Drive is not a second copy.

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
service account; remove the binding above; remove the account from the
Shared Drive; or set `documents_provider = 'supabase'` and clear the Drive
identifiers in the settings row.

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
| Sealed copies | Same size as the documents (+ ~600 bytes each), in Supabase Storage | Assumption: 600 children × 4 documents × 400 KB ≈ 1 GB. **Supabase Free allows 1 GB of storage in total**, so a full roll of documents may need Pro ($25/month, 100 GB) or another independent store — a decision, not a purchase made here |
| Google Cloud project, WIF, STS, IAM Credentials | No charge, no billing account | Google pricing pages |

Performance against real Drive is **not measured yet**: it needs the pilot.
The pilot measures upload time per MB, time to first byte and full download
for 100 KB / 1 MB / 5 MB / 10 MB synthetic files with 1 and 4 at once,
compared with the bucket's signed URL. Until then this page claims nothing
about speed.

## Migration of existing files

There are three rows in `student_documents`, all 193-byte synthetic PDFs from
the 22 September smoke run (one more object in the bucket has no row). No
real student document exists in VPPS One to migrate. They stay in the bucket;
copying them is not worth a migration run. The copy-only migration script is
deliberately not written until there is a real set to copy, an approved
source, destination and scope.
