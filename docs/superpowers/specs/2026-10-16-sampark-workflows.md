# Sampark workflow integration — agreed scope

Preserve the current pale blue/white/teal VPPS One design and navigation. Use the verified `veerpatta/sampark` repository at `C:/Users/AnandKumari/Projects/sampark` as behavior reference, and existing VPPS collection, review, marks, attendance and message infrastructure.

1. Students: missing-field filters, including No photo, select matching children and request one scoped list task from a chosen teacher or distribute by class/house/route/subject responsibility. Preview recipients, children/counts, requested fields and due date. Never one link per child by default.
2. Student profile: contextual requests for missing details and marks, opening the relevant scoped work for its responsible teacher.
3. Needs you: primary assignment/follow-up/review surface. Compact To assign, Waiting on teachers, To approve groups, a few priority cards and View all. Assignment editor is a desktop side panel/mobile bottom sheet with grouped children, prefilled but editable teachers and explicit preview. Reuse the same task across entry points and prevent duplicate creation/sends. Reminders only for pending work.
4. Teacher login and external no-login link complete the same task, scope and completion state. Unified data collection, assigned marks and class attendance; reuse existing writers and direct save audit/locks for marks/attendance. Revalidate current responsibility, active status and revoked links on reads and writes.
5. Teachers propose student details and photos; only administrator approval changes official records. No pending image appears as the official avatar. Add photo control in the existing avatar position: camera/file, drag/drop where appropriate, preview, explicit Save/Cancel and compression. Verify School Fees' 600px/about 200KB approach; approved photo appears consistently in existing directory layouts and profile.
6. Own staff profile photo editing in account and admin staff photo/details editing according to current role policy with audit. Do not expand staff privileges. Reflect portraits in Teachers list/profile.
7. Use an authentic existing school logo in header, sign-in and browser icon. Locate it in verified school repositories; do not generate a substitute.
8. Reuse AiSensy infrastructure with approved previews, durable idempotency and unknown-outcome handling. Distinguish queued, provider accepted/delivered only with evidence, opened, submitted and approved. No blind retries.

## Authorization

Implementation, synthetic/local mocked testing, review, commits, push/PR/merge and application deployment are authorized. No real WhatsApp sends, live teacher access-token creation, credential changes, paid upgrades or live schoolfees writes/migrations. Any database migration execution needs a separate exact-target/scope approval. Do not inspect secret files or expose secrets. Original checkouts remain unchanged. Requested execution model: GPT-6 Astra extra-high.

## Existing evidence

Baseline main `dd1e9a5` includes PR95/96. `/collection`, `/r/[token]`, `/t/[token]`, review and rounds exist. `/teach/marks` and external `/t/marks/[token]` share the marks writer and assignment checks. `/teach/attendance` uses audited register commands. `/teach/more?view=links` contains marks links. Collection does not yet have a verified signed-in equivalent. Staff-notice outbox has leased claim/stamp/finish and Unknown handling. Runtime AiSensy campaign configuration is unverified.


## Release steering — 16 October 2026, 10:31 UTC

Leave AiSensy WhatsApp campaigns/templates pending in the existing Integrations surface. Show that automated task sending is unavailable; local active template rows are not external approval. Keep reviewed manual task-link sharing usable and truthful about unconfirmed sends. Complete and release the remaining tasks, photos and academic workflows after exact-target migration approval, independent review and required CI. Provider setup is deliberately deferred, not a release blocker. No campaign, credential, configuration or real-send action is part of this deferral.
