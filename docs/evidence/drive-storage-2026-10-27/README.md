# D-333 evidence — 27 October 2026

What was run for Drive-backed student documents, and what was not.

## Run, all synthetic, nothing remote

| Check | Result |
|---|---|
| Migration `20261027114837` on PGlite 0.3.15 against synthetic prerequisites shaped like dev (`migration-dry-run.mjs`, output `migration-dry-run.txt`) | Applies; an existing row reads `supabase` / `stored` / version 1; 9 bad inputs refused by the right constraint; new tables RLS on, granted to `service_role` only; bucket `vppsone-drive-backups` private, 16 MB |
| `tests/drive-upload-flow.test.ts` — the upload flow against an in-memory Drive (`tests/fake-drive.fixture.ts`) | 10 MB PDF in 3 chunks, stored with Drive's sha256; double Save is one document; another person's id refused; HTML named `.pdf` refused before any byte reaches Drive; out-of-order chunk answered with the resume offset; half-delivered chunk resumed from Drive's count; rate limit retried; checksum mismatch never listed; missing Drive sha256 checked by download; expired session refused; revoked membership fails the row; racing first uploads make one folder |
| `tests/drive-chunked-upload.test.ts` — the browser loop | Every byte in order with the right checksum; dropped connections and a busy server resumed with one id throughout; wrong type and > 10 MB stopped before any request; out-of-scope refused once |
| `tests/document-open-route.test.ts` — `/documents/<id>` | Another class's document: denied, nothing signed, nothing fetched; forged id: denied without a query; no permission: denied; bucket document: one-minute signed link as before; Drive document: streamed `private, no-store`, `nosniff`, inline, safe file name; Range passed through; Drive down: 503 with no detail |
| `tests/google-workload-identity.test.ts` | Vercel token → STS → service-account token with the right audience, subject type and scope; cached until five minutes before expiry; no Vercel identity → refused without a request; 400/403 → `revoked`; network/503 → `unavailable` |
| `tests/drive-backup-restore.test.ts` | Copy → isolated restore with the private key → same sha256 for every file; no plaintext in the sealed bytes; wrong key and one changed byte refused; 2048-bit key refused; checksum mismatch never copied; time budget leaves the rest for the next night; one failed read does not stop the others |
| `tests/document-files.test.ts` | Type by magic bytes only; file names safe for headers; request and chunk rules; who uploads to Drive |
| `npm run recovery -- keygen`, then seal and `verify` a synthetic file, with a throwaway key in a scratch folder (deleted) | `1 of 1 copies open and match their recorded sha256.` |

## Applied, with the owner's approval

- Migration `20261027114837_document_storage_providers` on `wtgxcptmucjerhufzjcf`
  (the database VPPS One reads; not the live fee database), before the code
  shipped. Checked afterwards: the 3 existing rows read `supabase` / `stored`;
  `student_documents` still has exactly one key to `staff_profiles`, so the
  deployed build's embed keeps working; `documents_provider = 'supabase'`;
  bucket `vppsone-drive-backups` private; no grant on the three new tables to
  `anon` or `authenticated`.
- Google project `vpps-one-files` (256623860240), service account
  `vppsone-drive`, pool `vercel`, provider `vppsone-production`, one
  `workloadIdentityUser` binding for the production subject. No key created;
  no organisation policy changed.

- Folder `VPPS One documents` (`1MPLDVfid2eQIMNs8rRQTzEhaUZFVh826`) in the
  existing Shared Drive "Share", shared with the service account as writer on
  the folder only; settings row filled with identifiers and the recovery
  key's public half (fingerprint `9c7fea21b804a1a3…`).
- Pilot list = the owner's staff profile. One upload and two opens through
  production at 12:19 UTC, recorded in `docs/DRIVE-STORAGE.md`.

- The scheduled Document backup run, 27 Oct 22:06 UTC: `ok` in 9.6 s; Drive
  health check passed (write 3,770 ms, read 1,665 ms); the pilot document's
  Drive sha256 re-verified; one sealed copy made (369,423 bytes, sha256
  `db32c87b…`, key `9c7fea21…`).
- Restore check, 28 Oct: that sealed object downloaded from
  `vppsone-drive-backups` (sha256 matched the record) and opened with the
  school's private key by `npm run recovery -- verify`: "1 of 1 copies open
  and match their recorded sha256". Nothing decrypted was written to disk;
  the downloaded copy was deleted.

## D-334, 28 October 2026 (production)

- Migration `20261028035840_drive_central_backup` dry-run on PGlite
  (`migration2-dry-run.mjs`, output `migration2-dry-run.txt`) and applied to
  `wtgxcptmucjerhufzjcf` with the owner's approval before PR 127 merged.
- Admin synthetic pilot: 8 synthetic PDFs (100 KB, 1 MB, 5 MB, 9.5 MB, then
  4 × 1 MB at once) uploaded and opened through production as the owner; all
  `stored` with Drive's sha256 equal to the browser's. Timings in
  `docs/DRIVE-STORAGE.md`.
- First `drive-backup` run (manual, 04:35 UTC): `ok` in 99 s; snapshot
  `snapshot-2026-10-28T04-35-09Z` (204 tables, 49,644 rows, both schemas one
  moment, sealed 3,934,080 bytes, sha256 `47eb5842…`); 13 sealed file copies;
  the approved copy-only move of 11 synthetic bucket documents (13,787,636
  bytes), 0 parked, originals kept.
- Restore checks with the school's private key, downloads deleted after:
  snapshot "204 of 204 tables match their count, digest and checksum (49644
  rows)"; one file copy from `backups/file copies/` "1 of 1 copies open and
  match their recorded sha256".

## Not run

- The non-admin (QA Office) pilot upload, and so the rollout to every role.
- The JPEG pilot file.
- A full rebuild of the database from a snapshot into an empty project.
