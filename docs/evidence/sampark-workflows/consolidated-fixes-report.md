# Consolidated final review corrections — 16 October 2026

Starting commit: `88c7923c6e79b423313b4744397959d049254086`, branch `codex/sampark-teacher-workflows`. This bounded wave addresses the six Important findings, the browser-warning assertion and the diagnosed CI fixture failures. Release, remote migration application, corrected-head CI and independent scoped review belong to the controller. No school data, real credentials, messages, provider configuration or protected database was used.

## Changes

1. Public collection-task POST retains its original task token through validation and the transactional `save_teacher_task` collection branch. Signed-in task saves retain the original actor. The task/request locks precede final authority checks; the nested canonical proposal writer receives the pinned request generation. `resolveTask` rejects a changed capability/assignee, strips the capability from its result, and rechecks current authority. Collection context rechecks both original authority and its pinned request generation after roster reads.
2. `recordAnswers` uses the atomic RPC for unmanaged legacy requests whenever the additive schema is installed. Direct compatibility writes require an explicit missing-table/schema-cache error; permission and network failures cannot select the fallback.
3. Server-derived scalar draft hashes include actor/public entry, public task capability, request generation, session, student IDs and field IDs. RequestForm remounts all editor/recovery state when this scope changes. Signed-in, task-link and legacy `/r` entry points supply these scopes.
4. `manage_teacher_task` takes task then linked-request locks before final active-manager permission and recipient-ownership checks. Permission loss or actor/target deactivation during either wait refuses without rotating/reassigning the task.
5. The actual signed-in legacy page passes an explicit `assigned-request` photo credential with an opaque actor/request-generation hash. Authority resolves the existing assigned request and rechecks that pinned generation, target membership and current actor; it never creates a duplicate managed task.
6. sharp is patched from 0.35.4 to 0.35.5. JPEG/PNG/WebP byte signatures are checked before invoking sharp, so SVG/XML/GIF inputs never reach the decoder. Existing pixel/dimension/size checks and metadata-stripping output remain. Lockfile changes are limited to sharp and its platform/libvips packages.

Browser fixture aliases now explicitly replace the newly imported task/photo server actions in mobile-ui, sibling-context, export-followup and operations-admin. These deterministic synthetic adapters refuse writes; they do not hide server-only modules or introduce browser substitutes for backend internals. The academic touch fixture uses instant document scrolling: the CI trace showed smooth scrolling moving Release during tap, with no command dispatched. Command/ledger assertions and timeouts remain unchanged. Integrated acceptance now asserts `warnings` is empty before recording a passed result.

## RED and GREEN

- Original-code focused regression run: three files, eight tests, five failures. It reproduced a rotated task row accepted by the real resolver, actual POST dropping the original credential, revoked context returned after roster read, installed unmanaged request bypassing its RPC, and absent scalar draft isolation. Three existing scope tests passed.
- Decoder regression before the signature guard: three tests failed because unsupported SVG, XML/SVG and GIF bytes reached sharp before rejection.
- `node tests/sql/teacher-task-credential-regressions.mjs --baseline` loads the reviewed `88c7923` SQL through read-only `git show` and fails the collection writer assertion. The same regression against current SQL passes original-token rotation/reassignment, original actor denial and unmanaged closed/rotated request rejection. No production SQL file is swapped to demonstrate RED.
- Current focused run: **15 files / 72 tests passed, zero skips, 44.70s**. Includes actual route/resolver, shared writer, mounted scalar editor isolation, actual legacy page props and photo authority, decoded-photo placement, academic durable recovery, action guard and SQL lock-order source guards.

Focused command:

```text
npx vitest run tests/teacher-task-credential-races.test.ts tests/collection-atomic-writer.test.ts tests/teacher-task-draft-scope.test.ts tests/collection-draft-isolation.test.tsx tests/legacy-task-photo-entry.test.tsx tests/teacher-tasks-collection.test.ts tests/profile-photo-authority.test.ts tests/photo-storage-format.test.ts tests/profile-photo-placement.test.ts tests/teacher-task-draft-recovery.test.tsx tests/teacher-tasks-save.test.ts tests/teacher-tasks-lock-order.test.ts tests/teacher-tasks-schema.test.ts tests/profile-photo-editor.test.tsx tests/action-guards.test.ts
```

## Database evidence and exact scope

All seven current scripts pass against actual migration sources on synthetic PGlite 0.5.10 / PostgreSQL 18.6:

```text
node tests/sql/teacher-task-credential-regressions.mjs
node tests/sql/teacher-tasks.mjs
node tests/sql/profile-photos.mjs
node tests/sql/teacher-task-delivery.mjs
node tests/sql/legacy-teacher-review.mjs
node tests/sql/teacher-task-canonical-writers.mjs
node tests/sql/migration-inventory.mjs
```

Canonical marks/attendance and legacy review scripts load the actual shipped writers and relevant triggers; the ordinary task fixture's academic writer doubles prove delegation only. Real PostgreSQL 17.10 additionally passed **26 observed-lock schedules**, using the existing workspace-only harness commands `node ../run-task4-locks-local.mjs task`, `photo`, `delivery`: nine task schedules (six new authority-loss waits), twelve photo schedules, five delivery schedules. Each fresh loopback-only cluster verified its workspace directory before testing; all servers stopped in finally, password files were removed, and port 5432 released. Initial sandbox loopback EACCES was resolved by the authorized network-capable local executor; it was not a SQL failure.

Task migration SHA256: `5d39c31a0761af0a9ab64ac9376015ccb1900fcf75df750f29da94cca56b0b32`. Photo migration remains `fba3175a0f69e61c56cf90900ac43d61775c879d591982034d53cb8c56bd57ba`; delivery remains `a8567aa9a513db58059084bc73d351533e8ccc2bb013733c18b5c3c0edeb71eb`.

Only the existing `save_teacher_task`, `record_collection_answers`, `manage_teacher_task` bodies changed. No signature, grant/revoke, security setting, object, table, policy, constraint, seed or migration data effect changed. The [revised packet](migration-approval.md) and executable [catalog](migration-catalog.json) detail this delta and unchanged rollback/data-retention guidance. The parent confirmed existing user approval covers this tightening; application remains unapplied at this worker checkpoint and gated by scoped review/checks. The protected `vgqyilgstjvgohrsiwkb` project is excluded; only the controller may apply to `wtgxcptmucjerhufzjcf`.

## Local final gates

With PowerShell `$env:NODE_OPTIONS='--max-old-space-size=6144'`, `npm run typecheck` passed (route type generation and TypeScript) and `npm run lint` passed with zero errors and nine preexisting warnings. `npm run check:theme` passed all 430 tokens against the read-only fee checkout, and `npm run check:port` passed all 730 ported files. No changed line introduces a lint warning:

| File and line | Existing rule / identifier |
| --- | --- |
| `src/platform/pdf/document-kit.tsx:292,335,414` | Three `jsx-a11y/alt-text` warnings |
| `src/ui/shell/sidebar-nav.tsx:17` | `@typescript-eslint/no-unused-vars`: `ProtectedNavigationItem` |
| `tests/accountant-mobile/actions.ts:4,19` | Two `@typescript-eslint/no-unused-vars`: `_input` |
| `tests/mobile-ui/student-actions.ts:4` | `@typescript-eslint/no-unused-vars`: `_args` |
| `tests/payment-parity-flow.test.tsx:10` | `@typescript-eslint/no-unused-vars`: `_prefetch` |
| `tests/payment-ui/actions.ts:2` | `@typescript-eslint/no-unused-vars`: `boot` |

All six affected browser configurations passed sequentially, **125 tests, zero skips**, using local Chromium 1243 with `PLAYWRIGHT_BROWSERS_PATH` pointing at the installed browser runtime:

| Config passed to `node node_modules/@playwright/test/cli.js test --config` | Result |
| --- | --- |
| `export-followup.playwright.config.ts` | 5 passed, 29.1s |
| `student-profile.playwright.config.ts` | 27 passed, 2.3m |
| `student360-mobile.playwright.config.ts` | 12 passed, 53.8s |
| `operations-admin.playwright.config.ts` | 18 passed, 1.1m |
| `academic-ui.playwright.config.ts` | 60 passed, 3.0m; original touch360 failure passed in 6.4s, unchanged command/ledger assertions |
| `student360-sibling.playwright.config.ts` | 3 passed, 11.2s; preceded by `npx vite build --config tests/sibling-context/vite.config.ts` (8.56s), then `PHONEOPS_SIBLING_STATIC_DIR=../evidence/sibling-context-static` |

`node tests/sampark-workflows/acceptance.mjs` passed both 390/1440 loops on the corrected source at 12:41-12:42 UTC and refreshed all 28 production-component screenshots. [browser-results.json](browser-results.json) records zero warnings, zero page/console errors and zero external requests for both widths; warnings are now asserted. `node tests/profile-photos/acceptance.mjs` passed 1440px English/login and 390px Hindi/public, including file/camera preview, cancel, capped bytes, durable exact retry and no overflow; its runner blocks non-loopback requests without counting attempted requests. The refreshed [uncertain public save](screenshots/marks-uncertain-link-390.png) remains legible and unclipped with accurate unconfirmed wording. These images show production-component fixtures with synthetic action/auth adapters, not a deployed authenticated route/shell.

Browser-runner warnings are distinct from application console warnings: existing NO_COLOR/FORCE_COLOR notices; Vite's TS-config native-loader future warning; mobile-ui's broad startup dependency scan reaches unused `design.html` and reports unresolved `server-only` through `src/modules/reports/data/ledger-queries.ts`, then skips prebundling. The actual selected routes pass their page-error assertions; no server-only or redirect shim was added. The sibling static build reports plugin timing information. These fixture/tooling messages are retained rather than hidden.

The corrected-head full repository Vitest, production build and bundle budgets are deliberately assigned to **mandatory GitHub CI**, concurrent with scoped review, under controller Ruling 6. They are not claimed locally green for this wave. Historical `88c7923` local full-suite/build/bundle success remains in [Task 4 report](task-4-report.md); it does not establish current-head success.

## Dependency and evidence limitations

The final runtime reports sharp 0.35.5 and libvips 8.18.7. Read-only `npm audit --omit=dev --package-lock-only --json` now reports two deferred baseline production findings: Next (critical) and source-map-js (high); sharp is absent. Next/eslint/source-map-js were not upgraded, per controller Ruling 5 and the user's priority-release scope. No speculative exploit investigation was performed.

The initial npm install encountered sandbox DNS; its network-capable retry replaced the local node_modules junction then refused the preexisting remote SheetJS tarball under npm12's EALLOWREMOTE rule. No manifest/lock changes survived that failed install. The partial tree was preserved under the verified task root, the original isolated dependency junction restored, and a tiny isolated sharp runtime installed. A package-lock-only update was restricted to sharp/platform/libvips entries; unrelated npm metadata rewrites were discarded. Only those patched runtime packages were copied into the preserved task dependency directory. No npm security setting was relaxed and no unrelated SheetJS fetch or source change occurred.

Browser checks use production components with explicit synthetic action/auth boundaries and synthetic records, not authenticated deployed routes or real provider delivery. Chromium widths do not establish physical camera, iOS/WebKit or all-device behavior. AiSensy setup remains intentionally pending; manual sharing does not claim delivery. The [six controller rulings](rulings.md) preserve both this scope and the required release gates.

## Handoff and self-review

Reviewed the complete product/fixture/test diff against all six findings, verified unchanged SQL signatures/catalog/grants/data effects and the three recorded file hashes, confirmed only sharp/platform/libvips dependency changes, and checked whitespace with `git diff --check`. The local commit is titled `fix: preserve task authority and repair acceptance fixtures`. All required local gates are complete; corrected-head full CI, independent scoped review, controller migration application and release verification remain mandatory and pending. There were no remote mutations and no local PostgreSQL server remains running.
