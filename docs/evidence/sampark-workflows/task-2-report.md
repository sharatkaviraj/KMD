# Task 2 — approved portraits, staff photos and authentic branding

Date: 16 October 2026. Branch: `codex/sampark-teacher-workflows`.
Implementation base: `9043eae91258e44e217e2a0db77e8ee7e93536e0` (approved Task 1).
Status: implemented locally; independent review and Task 4 integrated acceptance remain with the controller. The migration is authored and **unapplied**.

## Delivered behavior and authority

- A photograph is a canonical `student_photo` collection answer bound to an immutable uploaded-byte proposal. The same assigned request, frozen membership and current capability checks serve `/teach/tasks/[id]`, `/t/tasks/[token]`, and existing collection links. `submitCollectionPayload` refuses a scalar photo value; `submitCollectionPhoto` is its multipart counterpart. The SQL binding trigger prevents a generic collection decision from accepting a photograph without the photo review writer.
- Teacher photos stay pending until an active administrator approves them. The administrator sees the pending and current portraits in `/collection/review`, reached from Needs you. Approval calls the existing `place_student_photo` and updates the proposal and canonical answer atomically. Rejection never creates an official portrait. Task completion derives from the existing answer status, including its distinct rejected state. Prior official-photo rows and decided answers remain as history.
- A class teacher opening the existing student portrait control reuses authorized photo work, or creates a one-child canonical task through `ensure_student_photo_task`. Current class-teacher dates and membership are checked. A decided round remains decided; Request details again creates the correction round through Task 1's existing restart action. Reassignment preserves original proposal attribution and permits current authorized review; old capabilities and cross-actor replay are refused.
- Existing legitimate admin/office direct-photo policy is preserved. Office does not gain permission to approve teacher proposals. The reachable ported fee action first requires native `fees:view`; teachers fail that guard, and office maps to fee `view_only`. The actual adapter guard is tested, without changing fee roles, the public photo bucket, or fee writers.
- Staff can change their own portrait at `/preferences` and `/teach/more?view=profile`. The server derives self from the authenticated actor. Editing another staff member from the staff list/profile requires current `staff:manage`, matching existing detail-edit policy. Role and activation actions remain unchanged. Inactive actors fail, and staff photo history records the actor and prior rows.
- Native Students table, list and cards, Student 360, teacher class/student views, staff list/profile, personal profile and sidebar use approved photographs. Teacher readers use `attendance:view` plus current-session enrollment intersected with `classScopeFor` before service reading/signing; teachers were not given directory permission or expanded RLS. Pending proposal URLs exist only in an authorized editor or administrator review. Private URLs are signed for 300 seconds and rendered without the shared image optimizer.

## Editing and reliable saves

The shared editor supports file selection, camera input and drag/drop, local preview, and explicit Save/Cancel. Choosing or cancelling does not upload. Browser compression follows School Fees' 600px/0.78 JPEG approach, stepping through qualities 0.78, 0.68, 0.58, 0.48 and 0.4, but refuses output still above 200 KiB. The server independently decodes JPEG/PNG/WebP bytes using `sharp`, rejects invalid/SVG/animated input and input above 8 MiB, bounds decode pixels, applies orientation, strips metadata, and enforces the actual 600px/200 KiB JPEG result. Caller MIME and dimensions are not trusted. Existing `sharp@0.35.4` moved from dev dependencies to runtime dependencies; no version or installed package changed.

Private storage objects are immutable and named by stable command identity. A duplicate upload is downloaded and hash-verified before RPC replay. Changed bytes cannot reuse the object. A lost response never deletes possibly committed bytes. Individual editors and office folder placement persist the compressed image and exact command before sending; storage failure prevents send. Unknown outcomes lock replacement/cancellation until the same command is retried, including after reload. Definite refusal preserves editable input. Recovery is scoped to the authorized actor, target, request/session and token generation; it does not grant server authority.

The folder workflow preserves existing filename matching and explicit selection, and now uses the same compression and durable per-file command behavior. No automatic cleanup removes refused or uncertain storage objects; bounded orphan cleanup is future maintenance work and must prove non-reference before deleting anything.

## Source and branding evidence

Read-only references inspected in `C:/Users/AnandKumari/Projects/schoolfees`:

- `src/modules/students/ui/student-photo-upload.tsx`: `MAX_DIMENSION=600`, `JPEG_QUALITY=0.78`, `MAX_OUTPUT_BYTES=200*1024`; the original loop returns its final blob even if still oversized. The new shared implementation enforces the cap.
- `src/modules/students/ui/student-photo-sheet.tsx`: explicit Save/Cancel wrapper. Its direct public/fee writer was not copied into the proposal flow.
- The ported equivalents under `src/modules/students-fees/ui/` and `src/app/(app)/fees/students/actions.ts` retain their existing fee-specific authority and storage.

`Get-FileHash -Algorithm SHA256` confirmed identical source/destination assets:

| Asset | SHA256 in both repositories |
| --- | --- |
| `public/branding/veer-patta-school-logo.jpg` | `48A2D3356213890AF723B19509A1057C59878A844006304970E6B53FAA19274A` |
| `public/branding/icon-192.png` | `22D2E3013C48D5CC9F203A4AD08CAE775D3CE6811E488368C1E23091164A5544` |

The vx sidebar's text `VP` placeholder now uses `schoolBrand.logo`. Actual sign-in already uses the authentic logo through `Crest`/`BrandBand` in `src/vx/screens/system/brand.tsx`; browser/Apple metadata already uses the verified `icon-192.png`. Those correct existing paths were inspected and retained. No asset was regenerated or copied. Installed Next 16.3.5 guides for images and server actions/mutations were read before continuation edits.

## Exact migration inventory and deployment dependency

File: `supabase/migrations/20261016080000_profile_photos.sql`.

- Two new `vppsone` tables: `photo_proposals` (immutable command/request/student/field/actor/capability binding, payload, expected official photo, decision/decider/time) and `staff_photos` (command/staff/actor/payload/current/history). Both enable RLS, revoke anon/authenticated access and grant service-role access. There are no ordinary-client policies.
- Two new indexes: `photo_proposals_request(request_id,student_id)` and unique partial `staff_photos_current(staff_id) WHERE replaced_at IS NULL`. Primary keys and declared vppsone-only foreign keys accompany those tables; no foreign key is added to a public table.
- Five new security-definer functions, each with empty search path: `guard_photo_answer()`; `submit_student_photo(uuid,text,jsonb)`; `review_student_photo(uuid,uuid,boolean)`; `save_staff_photo(uuid,uuid,jsonb)`; `ensure_student_photo_task(uuid,uuid,text)`. The four callable functions are service-role-only; the trigger helper is not granted to ordinary callers.
- One new `BEFORE INSERT OR UPDATE` trigger, `photo_answer_bound`, on existing `vppsone.collection_submissions`.
- One idempotent seed of `vppsone.collection_fields` key `student_photo` (bilingual labels, text storage, collect mode). The stored text is a proposal command UUID, never an independently approvable generic value.
- Runtime writes are limited to these new tables and existing vppsone task, collection, official photo and photo command/history rows through their established writers. Existing `place_student_photo` is reused without replacement. The existing private `vppsone-photos` bucket is reused; there is no bucket creation/public expansion, storage policy change, public-schema object/table mutation, permission-matrix change, provider configuration, credential or persistent-access change.

The controller's separately verified intended target is `schoolfees-dev` (`wtgxcptmucjerhufzjcf`), subject to fresh verification and the combined migration approval step. No remote database was contacted for this task. New proposal/staff-photo/direct-teacher editing features require the migration; deploying UI alone cannot enable them. Ordinary existing direct office placement continues to use its already-existing schema.

Rollback should first restore the prior application code while retaining new history and private bytes. No destructive down migration is supplied. Dropping new objects/data after usage requires a separate reviewed plan; previously approved portraits can reference proposal storage paths and must remain valid. Task 1's migration is a prerequisite.

## Typed integration surfaces

- `domain/profile-photo.ts`: `PhotoCredential` is `{kind:"task",id,token?}`, `{kind:"request",token}`, `{kind:"student",id}` or `{kind:"staff",id?}`. `PhotoSaveResult` is `{ok:true}` or `{ok:false,reason:string}`. `PhotoEditorContext` contains recovery `scope`, optional `studentId`, current and proposal ids/URLs, `decided` and `proposal`. `PhotoInput` contains `commandId`, `studentId`, both expected ids, bytes and source.
- `data/profile-photo-context.ts`: `photoAuthority(credential, studentId?)` resolves current authority; `readPhotoContext(auth)` exposes authorized current/pending context. Returned teacher-direct credentials may be normalized to the canonical task credential. `signedPhoto(path)` is server-only and used after caller authorization.
- Server actions: `openPhotoEditorAction(credential,studentId?)`; `saveProfilePhotoAction(credential,form)` with `photo`, `commandId`, `scope`, `studentId`, `source`, `expectedCurrent`, `expectedProposal`; `reviewPhotoAction(proposalId,accept)`. Every save re-resolves authority. Existing `placePhotoAction(form)` retains its contract and adds optional `reason` for unknown-outcome recovery.
- `teacher-tasks/data/collection-save.ts`: existing `submitCollectionPayload` remains for scalar answers; new `submitCollectionPhoto(request,input)` checks the same frozen request membership and dispatches the immutable photo proposal. No task identifier or Task 1 RPC signature changes.
- `approvedStudentPhotos(ids)` and `approvedStaffPhotos(ids)` return `Map<string,string>` of approved/current signed URLs, with chunked id filters and authorization before privileged reads. UI row types add optional portrait URLs.
- UI: `ProfilePhotoControl({credential,studentId?,language})`, `PhotoEditor({context,language,save,onClose})`; `RequestForm` adds optional `photoCredential`; `FolderPlacement` now requires the server-produced `recoveryScope`. Task 3 can continue consuming the unchanged canonical task/collection status interface.

## TDD and recovery provenance

The first implementer became unavailable after an executor outage. All uncommitted implementation was retained; the continuation inspected the full diff and recovered ledger rather than rebuilding it. No commit had been attempted. The missing `PrivatePhoto` fixture import/use was confirmed absent and completed. Controller-owned `initial-inspection.md` and `task-1-concurrency-local.md` were preserved and excluded from the commit.

The following RED → GREEN evidence is recorded in the pre-outage task ledger/recovery handoff, not reconstructed or represented as newly observed failures:

| Regression | Recovered evidence |
| --- | --- |
| `tests/profile-photo-placement.test.ts` | Four failing cases (fake JPEG, trusted dimensions, uncertain-byte deletion, changed-byte replay) became four passing cases. |
| `node tests/sql/profile-photos.mjs` | Unbound generic photo input was accepted before the binding migration and rejected after it; actual migration fixture then passed. |
| `tests/profile-photo-editor.test.tsx` | Eighth folder reload/uncertain-command case was RED before durable folder recovery and GREEN after. Earlier seven editor checks had passed. |
| `tests/profile-photo-readers.test.ts` | Teacher approved-avatar reader regression failed because teachers lack `students:view`; current class-scope authorization fixed it. |

Fresh continuation commands below verify final behavior. Other tests are regression evidence; no unsupported claim that every case was written before implementation is made. The lost pre-outage read-only test/lint sessions are not treated as successful evidence.

## Fresh local validation

All commands ran from this checkout with synthetic values, no `.env` reads and no hosted service calls. `node_modules` resolves to the isolated `task/dependencies/node_modules`. The SQL runner imports the existing disposable PGlite 0.5.10 / PostgreSQL 18.6 runtime from `task/sql-test-runtime`, outside application dependencies.

| Command / check | Observed result |
| --- | --- |
| Focused Vitest command below | PASS: 11 files, **5,055 tests**, 104.10 seconds. Includes photo/editor/authority/fee guard/readers, existing placement/reader tests, Student 360, No photo assignment preselection, shared collection saves and architecture. |
| `node tests/sql/profile-photos.mjs` | PASS: real existing photo migration + Task 1 migration + Task 2 migration execute; four assertion groups cover binding, pending invisibility, generic approval prevention, admin review, replay, decided rounds, staff authorization/history, stale approval/rejection, fresh rounds, attribution through reassignment, old-capability/cross-actor refusal, revocation and class-teacher self-wrapper. |
| Changed-file ESLint command below | PASS, exit 0, no diagnostics. Ordinary Git LF/CRLF notices appeared while enumerating files. |
| `node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0, no diagnostics. |
| Browser command below, default sandbox | Failed before page load: `net::ERR_NETWORK_ACCESS_DENIED` for its own `http://127.0.0.1:3228/fixture.html`. Its server/browser were closed by `finally`. |
| Same browser command with approved sandbox escalation | PASS: both 1440px English/login and 390px Hindi/public scenarios. Preview screenshots were also visually inspected. |
| `git diff --check` | Initial check found a trailing blank line in `photo-forms.tsx`; removed and final check passed. Ordinary Git LF/CRLF notices only. |

Focused command:

```powershell
npm test -- tests/profile-photo-authority.test.ts tests/profile-photo-editor.test.tsx tests/profile-photo-fee-policy.test.ts tests/profile-photo-placement.test.ts tests/profile-photo-readers.test.ts tests/photo-placement.test.ts tests/student-profile-photo.test.ts tests/student360-stream-recovery.test.tsx tests/teacher-task-assignment-recovery.test.tsx tests/teacher-tasks-collection.test.ts tests/architecture.test.ts
```

Scoped lint:

```powershell
$paths = @((git -c core.quotePath=false diff --name-only) + (git -c core.quotePath=false ls-files --others --exclude-standard)) | Where-Object { $_ -match '\.(ts|tsx|mjs)$' -and $_ -notmatch '^\.vite-photos/' }
node node_modules/eslint/bin/eslint.js @paths
```

Browser check:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/AnandKumari/AppData/Local/ms-playwright'
node tests/profile-photos/acceptance.mjs
```

The browser fixture imports the production editor and uses stub actions. Every non-loopback request is blocked. It covers 1440px English/signed-in credentials and 390px Hindi/public credentials, file/camera preview, explicit Save, inert Cancel, capped compressed output, unchanged official portrait on proposal, exact unknown-command retry after reload, console errors and horizontal overflow. Images are synthetic solid-colour portraits. Four screenshots are in `docs/evidence/sampark-workflows/photo-screenshots/` (`preview`/`saved` for each size). This is Chromium mobile emulation, not WebKit or a physical camera/device; native whole-page/backend integration belongs to Task 4. The Vite runner emits an existing native-config-loader compatibility warning; it is not an application failure.

PGlite is single-session evidence. It does not prove multi-session photo races or hosted Postgres integration. No complete package suite, production build or full-page screenshot pass was repeated in this task. Task 4 owns those final gates, and independent review remains pending. No push, merge, deploy, remote migration, real capability, real WhatsApp message or external data mutation occurred.

Before staging, the continuation resolved `.vite-photos` and `debug.log` to their exact absolute paths inside this checkout, confirmed the cache and descendants had no reparse points, inspected the log as Chromium graphics/DNS warnings, and removed only those generated artifacts. The controller's two untracked evidence files remain untouched. Self-review covered canonical answer binding, admin-only approval, current teacher/staff scope, immutable replay and prior-photo history, reader visibility, source hashes, migration inventory, and the final file list.
