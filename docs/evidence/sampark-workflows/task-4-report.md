# Task 4 — local integrated acceptance

16 October 2026. Branch `codex/sampark-teacher-workflows`; Task 4 started at `157be09370fcb82a1d5b267b6ca0b0f07b9967b6`. This report covers local implementation and synthetic acceptance. At 11:27:28 UTC the parent forwarded the user's approval of the exact three-migration dev packet; **approved, not applied** at this worker checkpoint. Independent final review, approved migration application, PR/CI, merge, deployment and deployed-commit verification belong to the controller. No hosted database, provider, credential, configuration or real-message mutation was performed here. Original checkouts were read only.

## Implemented

- Closed the actual legacy teacher-proposal bypass. A teacher-owned `/r` request with no `teacher_tasks` row could previously be accepted by office through canonical `accept_submissions`. The trigger now requires an active administrator for all collection decisions and prevents reopening decided proposals; the legacy review action and list use the same rule. The canonical writer is unchanged. Trigger refusal rolls back its official record, audit history and command atomically. Unrelated direct office record/photo policy stays intact.
- Existing Settings → Integrations uses `taskDeliveryAvailability` for task automation. It shows Setup pending and the deliberately deferred campaign/template work, counts active **local** templates without treating them as provider approval, and opens reviewed task-link sharing. Existing parent dispatch information remains separate. No provider setup or send was attempted.
- Manual sharing produces a usable WhatsApp link after recipient/list review. Opening it is unconfirmed delivery. Unknown provider outcomes block manual and API resend until attributed reconciliation; successful not-sent reconciliation immediately restores review. Persisted queued state says Queued — not sent, in English/Hindi.
- Outstanding academic saves say school save unconfirmed, preserving the exact command across reload/retry. Known incomplete/locked refusals remain editable. No writer or recovery semantics changed for this wording fix.
- Added actual canonical marks/attendance integration and canonical legacy-review SQL tests, and wired the new SQL checks into the existing pinned PGlite CI job. Retained the three existing PostgreSQL lock jobs.
- Added genuine production-component browser acceptance and screenshots; fixed the photo fixture's ESM configuration using `.mjs` and placed its cache under `.test-artifacts/profile-photos-vite`. ESLint now ignores generated `.test-artifacts/**` and `tests/*/dist/**`, matching the already ignored browser output locations. Source/test code remains linted.
- Updated plan/spec/PROGRESS/DECISIONS for reviewed Tasks 1–3, the deferred external setup and separate controller release gates. Included the controller's initial inspection and Task 1 concurrency records after checking their claims.

## RED → GREEN evidence

1. `node tests/sql/legacy-teacher-review.mjs` failed against the original task migration because canonical office approval succeeded. With the broadened trigger it passes office accept/reject refusal, zero partial official/history/command writes, admin approval/exact replay, immutable decision and unrelated direct-office writer. The fixture loads actual `20261004100729_record_writer_and_history.sql`; no review-writer double.
2. `npx vitest run tests/teacher-proposal-review.test.ts tests/teacher-task-delivery-ui.test.tsx`: 2 files / 11 tests passed. Actual production review action blocks office/teacher before the repository and preserves admin command identity. Actual TaskDelivery follows send-unknown → attributed not-sent → new preview immediately.
3. The existing academic recovery test reproduced the contradictory “not yet saved by school” text after a lost response. Added assertions failed first, then `npx vitest run tests/teacher-task-draft-recovery.test.tsx` passed all 10 tests after state-specific bilingual wording. Reload still retains the exact original command and avoids the false not-saved statement.
4. First complete `npm test`: 202 files passed / 2 failed; 13,740 tests passed / 2 failed, total 204 files / 13,742 tests. The static guard registry did not recognize the reviewed `photoAuthority` capability guard, and Student360 recovery still mocked removed `studentProfilePhoto` rather than `approvedStudentPhotos`. The static test now recognizes that guard only in its exact action file, still requiring each action to call a guard. The page test mocks the current authorized reader. No production permission rule was loosened. Focused `npx vitest run tests/action-guards.test.ts tests/student360-page-recovery.test.ts tests/profile-photo-authority.test.ts tests/profile-photo-readers.test.ts`: 4 files / 24 tests passed, including denial, rotation and current-class cases.

## Local checks

All commands run from this isolated checkout, using its existing task-local dependency junction. No dependency installation or original-checkout edits. Node 24.19.0; PGlite 0.5.10 / PostgreSQL 18.6; portable PostgreSQL 17.10; Chromium 1243 via the existing Playwright cache.

| Check | Result |
| --- | --- |
| `$env:NODE_OPTIONS='--max-old-space-size=6144'; npm run typecheck` | PASS: Next route typegen and TypeScript |
| `npm run lint` | PASS: 0 errors, 9 existing warnings listed below; no warning on any changed line |
| `npm run check:port` | PASS: 730 ported files, none left to rewrite |
| `$env:SCHOOLFEES_REPO='C:\Users\AnandKumari\Projects\schoolfees'; npm run check:theme` | PASS: all 430 tokens match; original repo read only |
| `npm test` final corrected run | PASS: 204 files / 13,742 tests, zero skips; 197.29 seconds |
| `node tests/sampark-workflows/acceptance.mjs` final wording refresh | PASS: both widths; 28 refreshed screenshots; zero app console warnings/errors, zero external requests |
| `node tests/profile-photos/acceptance.mjs` after `.mjs` correction | PASS: 1440px English/login and 390px Hindi/public; Vite optimizer info only, no native-config warning |
| `npm run build` with CI-only placeholders below | PASS: Next 16.3.5 webpack; compilation 2.6 min, TypeScript 85 sec, all 141 static-generation entries completed |
| `npm run check:bundles` | PASS: all 8 baseline route budgets; `/students` 173.3 KB gzip, `/login` 153.3 KB, `/teach` 170.1 KB |
| `git diff --check` | PASS; Git's LF→CRLF working-copy notices are informational |

Build environment is process-local and exactly follows `.github/workflows/ci.yml`: `NEXT_PUBLIC_SUPABASE_URL=https://ci-build-only.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_build_only`, `NEXT_PUBLIC_SCHOOL_NAME=Shri Veer Patta Senior Secondary School`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `VPPSONE_ENV=dev`, `NODE_OPTIONS=--max-old-space-size=6144`. No `.env` was read/copied by a test harness and no real key was used.

### Actual SQL and concurrency

All six local SQL commands passed against the exact current migration files:

```text
node tests/sql/teacher-tasks.mjs
node tests/sql/profile-photos.mjs
node tests/sql/teacher-task-delivery.mjs
node tests/sql/legacy-teacher-review.mjs
node tests/sql/teacher-task-canonical-writers.mjs
node tests/sql/migration-inventory.mjs
```

The standalone scripts use `../sql-test-runtime/node_modules/@electric-sql/pglite` via their default relative import or accept an explicit installed module path. CI installs pinned `@electric-sql/pglite@0.5.10` under `$RUNNER_TEMP/task-sql` and passes that path. `migration-inventory.mjs` applies all three migrations together and writes the exact catalog; it does not connect remotely. Base Task 1 scope fixture intentionally uses writer doubles; the new canonical-writer fixture replaces every writer/roster double with actual `save_marks`, `paper_roster`, latest `save_attendance_register`, `attendance_roster` and actual exam class-lock trigger definitions from repository migrations. Synthetic prerequisite tables remain test scaffolding. It covers audited saves/corrections, invalid/incomplete/stale/roster refusal, locked marks rollback, spoofed actor replacement, exact replay, login/token paths, invalid/reassigned/revoked capabilities and current-assignment changes.

Fresh PostgreSQL 17.10 runs used the workspace-only `../run-task4-locks-local.mjs` harness:

```text
node ../run-task4-locks-local.mjs task
node ../run-task4-locks-local.mjs photo
node ../run-task4-locks-local.mjs delivery
```

All 20 observed-lock schedules passed: 3 task creation/restart; 12 photo authority after actual lock waits; 5 task delivery claim/authority/ambiguity schedules. Each used a separate fresh verified workspace directory and loopback-only port 5432, reserved with the controller before startup. `finally` stopped each server and removed its temporary password file. Follow-up verified no port-5432 listener, no `postmaster.pid` and no password file. Retained local logs are `../pg-test-runtime/task4-{task,photo,delivery}-result.log`; no live endpoint or hosted script was used. This supersedes historical authored-only/not-run concurrency wording. CI execution itself remains pending.

## Browser evidence and limits

The fixture mounts production `SettingsScreen`, `StudentsScreen`, `Student360`, `StaffScreen`, `LoginScreen`, `BrandBand`, `TaskDelivery`, `TaskAcademicForm` and their real controls/providers. Only server/data/provider/auth boundaries are deterministic synthetic adapters; the assignment preview uses the production planner. The Vite loader refuses unexpected server-only modules, defines an empty environment and uses an empty env directory. The browser aborts every request outside its loopback fixture origin. Manual WhatsApp links are inspected without opening/sending them.

Screenshots show production components in a synthetic fixture, **not a complete authenticated Next application shell or deployed route**. The LoginScreen branding is real; its inner synthetic continuation explicitly says no credentials are entered or sent. Approved portrait and pending portrait fixtures are separate synthetic database states; screenshot comparison alone is not an end-to-end real approval transaction. SQL/action tests establish those authority/write boundaries. Camera acceptance supplies a synthetic image to the actual capture input; it does not exercise a physical camera or iOS/WebKit.

At 390×844 and 1440×1000 the browser asserts no horizontal document overflow and exercises:

- Pending Integrations in English/Hindi → reviewed manual link; local contracts do not enable the API button.
- Missing photograph list with two children, parent search and Pending fee filter, retaining class/SR/fee rows; existing directory unit tests additionally assert canonical SR/parent+fee intersection. No-photo field preselection, common-list count/fields, recipient edit invalidation, interrupted creation and same-command double-click retry.
- Actual Student360 avatar position for pending versus approved portrait, photo preview/explicit Cancel, compression under 204,800 bytes, uncertain save plus reload/restore/exact photo retry; actual staff portrait location and authentic sign-in/header branding.
- Marks through synthetic login boundary and scoped-link route: known incomplete/locked refusals stay editable; unknown save freezes the command, survives reload and retries identically. Attendance local edit survives reload and saves. Capability revocation/assignment authority is proven in actual SQL/authority tests, not a mocked browser claim.
- Double send, accepted/interrupted finish represented as unknown, no automatic resend, attributed not-sent reconciliation and new preview, completed-before-send refusal.

Representative [screenshots](screenshots/) are `integrations-pending`, `manual-sharing`, `provider-unknown`, `students-no-photo`, `common-task-preview`, `student-profile-{pending,preview,approved}`, `staff-profile-approved`, `sign-in-branding`, `marks-uncertain-{login,link}`, `attendance-saved`, and `integrations-pending-hi`, each with `-390.png` and `-1440.png`. The final browser console/error/external-request counters are in [browser-results.json](browser-results.json). Inspected mobile and desktop outputs show legible controls/copy, authentic crest, expected avatar placement and no clipped content. Tabs retain their intended horizontal scrolling.

## Migration scope, compatibility and deferral

[Exact approval packet](migration-approval.md) and [queried catalog](migration-catalog.json) enumerate all objects, grants, policies, hashes, template codes, data impact and rollback. The three SHA256 values are:

```text
20261016070000_teacher_tasks.sql        9a712c301e4ca0dcfef922f6541cd733ea2cf4300f7f463cb4c6a1eb605e612f
20261016080000_profile_photos.sql       fba3175a0f69e61c56cf90900ac43d61775c879d591982034d53cb8c56bd57ba
20261016090000_teacher_task_delivery.sql a8567aa9a513db58059084bc73d351533e8ccc2bb013733c18b5c3c0edeb71eb
```

The only intended remote target is controller-verified `schoolfees-dev` `wtgxcptmucjerhufzjcf`; protected live `vgqyilgstjvgohrsiwkb` is excluded. At 11:00 UTC the controller verified production's public Supabase URL, active PG17 target and 304 applied migrations; none of these three applied. At 11:13 UTC it confirmed all six task template codes absent and the public site origin `https://vppsone.vercel.app`. Template seeds are plain INSERT (duplicate code would refuse the migration); the field seed alone uses conflict-do-nothing. This worker did not perform remote reads or writes.

No public-schema or fee-table changes. Four new tables, 26 security-definer functions with empty search paths, service-role-only callable functions, new private task message policy/columns/triggers, and local contracts. Existing older readers have selected missing-schema fallbacks, but **no blanket pre-migration route compatibility claim** is made. Approved schema must precede release of dependent flows. Code rollback should retain additive task/proposal/history/image data; old office review and generic managed/reserved sends intentionally remain refused. Destructive reversal needs a separate data-preserving plan.

External AiSensy campaigns/templates are intentionally deferred in Integrations. Automated sends remain unavailable until separately authorized configuration and verified contracts exist. Manual sharing and the other approved work can release after the independent review, DB and CI gates; no provider acceptance/delivery or live deployment is claimed here.

## Warnings, corrections and not-run checks

- JSDOM full-suite output contains two existing `Window.scrollTo()` not-implemented notices. They are not browser application errors.
- The nine lint warnings are all in files unchanged by Task 4: `src/platform/pdf/document-kit.tsx:292,335,414` — three `jsx-a11y/alt-text` warnings; `src/ui/shell/sidebar-nav.tsx:17` — unused `ProtectedNavigationItem`; `tests/accountant-mobile/actions.ts:4,19` — two unused `_input` parameters; `tests/mobile-ui/student-actions.ts:4` — unused `_args`; `tests/payment-parity-flow.test.tsx:10` — unused `_prefetch`; `tests/payment-ui/actions.ts:2` — unused `boot`. The six unused-symbol warnings use `@typescript-eslint/no-unused-vars`. No newly changed line introduces a warning.
- Initial parallel lint/browser/type/unit run was resource-heavy. Lint traversed generated Vite dependencies and emitted Babel's >500 KB generation notice; that run was stopped, generated-only ignore paths added, and full lint passed. Refreshed browser initially timed out at first navigation under that load; the final sequential run passed. One unrelated read-only process launch failed before creation with MXC HRESULT `0x80070020`; a later read succeeded. No mutation had an uncertain outcome.
- Sequential browser refreshes exposed two fixture timing races: Playwright `setInputFiles` can inject into a disabled input before draft loading finishes, while the production chooser correctly refuses work until ready; and the Retry label appears while a command is persisting, before the boundary call is recorded. The fixture now asserts the real file/camera input is enabled before supplying an image, then waits for Retry to become enabled and the photo boundary call before inspecting its payload. Product behavior/recovery was unchanged. The final rerun passed both widths; the report records the earlier failed attempts rather than treating them as product passes.
- Windows Chromium startup writes DNS/Vulkan diagnostics to disposable `debug.log`; these are separate from captured app console/page errors. The log is kept outside tracked evidence and is not committed. The prior Vite native-loader/CommonJS warning is addressed by `.mjs`, not suppression.
- The first sandboxed production build could not resolve `fonts.googleapis.com` for existing Next font imports (`ENOTFOUND`). It was stopped after the download retries; the same exact CI-placeholder build was retried with network-capable execution for public fonts. No product code or real environment configuration changed for this retry.
- General hosted Playwright, smoke, seed, verify and replica scripts were never run. No actual school login, school data, real teacher capability, external message, live migration, live provider configuration, GitHub CI or deployed route was exercised by this worker. Real-device/iOS/camera and school staff trial remain outside synthetic acceptance.
- Controller initial-inspection evidence is historical: source logo hashes were rechecked (`48a2d3356213890af723b19509a1057c59878a844006304970e6b53faa19274a` in both repositories); reference upload limits/source locations corroborate it. Its early unverified target / absent-PG statements are superseded by later controller metadata and actual local PG evidence. The included Task 1 concurrency log matches the three claimed schedules, and Task 4 independently reran them.
- [Rulings](rulings.md) preserves all four controller rulings. Compared with the four `Ruling:` entries in the ignored work ledger: model/review choice, Windows bookkeeping, legitimate direct-office photo policy and six frozen-language campaign contracts agree. The export records exact dev approval without claiming application or release.

## Self-review and handoff

Self-review checked the actual canonical legacy decision transaction, admin UI/action/DB consistency, unchanged unrelated direct-office writer, reviewed delivery readiness, unknown-outcome recovery, synthetic-only test boundaries, exact SQL hashes/catalog, fixture caption honesty, generated-only lint exclusion and retained evidence. All local gates pass; no known product blocker remains from this worker's checks. The local commit is titled `fix: complete SamPark integration acceptance`. Independent review is the controller's next step; approved dev migration application, CI and release boxes remain incomplete. Existing warnings and the intentionally deferred provider setup are recorded above rather than represented as operational/live acceptance.
