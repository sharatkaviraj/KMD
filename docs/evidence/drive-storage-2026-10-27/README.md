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

## Not run

- Nothing against the Shared Drive or Drive's API yet (pilot).
- No performance measurement against real Drive; the pilot does that.
- No migration of existing files: there are three 193-byte synthetic PDFs in
  `student_documents` and no real student document.
