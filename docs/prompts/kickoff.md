# Kickoff — VPPS One revision 2

Run from `C:\Users\AnandKumari\Desktop\vppsone`. Copy the prompt below into
your coding agent. It replaces the archived Phase 1.1 kickoff. New tasks begin
at R0.1; old live-cutover task 7.3 is outside this program.

```text
Implement the latest VPPS One plan, revision 2, in this existing repository.

Read AGENTS.md, CLAUDE.md, docs/PLAN.md, docs/PROGRESS.md, docs/PARITY.md,
docs/QA.md, docs/QA-BASELINE-2026-09-17.md, docs/DECISIONS.md, docs/SOURCES.md
and relevant docs/SETUP.md instructions. Read the installed Next.js guides in
node_modules/next/dist/docs before changing framework code; this project uses
Next.js 16.3.5 and old assumptions may be wrong.

Start at the first actionable R-row, currently R0.1. Preserve the existing
implementation and completed Phase 1–7 history. Do not rerun the old foundation
kickoff and do not stop at deferred live-cutover task 7.3.

The plan's working scope keeps the original SamPark and School Fees apps in
their current repositories/deployments, makes them clearly reachable from
VPPS One, restores missing native SamPark workflows, and improves the daily
experience for all six roles. School Fees remains the authoritative fee app;
VPPS One reads fees and offers validated context links, with no second ledger.
If the user has since explicitly chosen native fee rebuilding, update the
ownership/architecture plan as required by PLAN section 9 before fee writes.

Use C:\Users\AnandKumari\Projects\sampark and
C:\Users\AnandKumari\Projects\schoolfees as read-only references. Verify their
current source commits and deployed/test origins. Preserve original routes
and familiar names. A launcher is not full native parity, and a login-page
response is not proof that a workflow works.

R0 deliverables: finish the feature parity register, record reproducible bugs
and baseline timings, establish deterministic six-role/second-teacher fixtures,
test-run cleanup and mock messaging, and implement independent role expectations
plus browser workflow smoke. Existing baseline passed 1904 unit tests and 216
role/page combinations, but these do not cover all state transitions, missing
SamPark features, cross-app workflows or physical-device usability.

Then execute R1–R8 in dependency order: app access and role navigation; useful
role homes/student workspace; SamPark requests/rounds/Excel lists/master-office
links/review; photos/import/export parity; attendance/timetable/marks reliability;
complete fee handoffs; measured speed/accessibility; deep smoke and acceptance.
Build bounded vertical slices, normally one PR per progress task, rather than
a single enormous rewrite. Continue to subsequent actionable tasks after each
verified merge; leave an exact next-task handoff if your session ends.

Design for nontechnical staff on phones. A teacher sees today's work, own
classes, assigned requests, marks and covers. Office/admin see student search,
SamPark, School Fees and actionable queues with owners. Academic/exam/view-only
accounts get the priorities specified in the plan. Preserve hi/en/both, clear
verbs, large labeled controls, honest saved/queued/failed states and useful
desktop tables. Measure query/render/bundle/save hotspots before optimizing.

Use test data freely within the verified dev target. Keep fixture resets scoped
to the test run. Preserve role and class correctness. Mock all external messages
and payment/provider effects; don't treat a real destination as test simply
because VPPS One has test students. New objects belong in vppsone; fee public
tables remain SELECT-only under this plan. Apply dev migrations with the
documented Supabase MCP workflow; do not repair shared fee migration history.

For every task: record acceptance, implement, run npm run check and relevant
role/integration/browser tests, exercise invalid input, retries, double submits,
stale tabs, expired login, offline/storage failures, >1000 rows, language and
mobile layouts. Assert actual persisted and downstream results. Missing fixtures,
skipped tests and source-only hypotheses cannot be counted as passes. Fix P0/P1
bugs with regression coverage before moving past the phase gate.

Update PROGRESS, PARITY, decisions and QA evidence in the same change. Commit,
push, open a PR, wait for CI, merge to main and verify the deployed commit and
changed workflows. Proceed autonomously with routine authorized test work.
Do not alter sibling apps, cut over to live data, send real messages or incur
provider charges as an incidental part of this work.

Report each completed slice with commit, tests and counts, deployed behavior,
remaining defects and exact next task. Separate code delivery from physical
Android/WhatsApp webview/camera/printer/staff acceptance when that evidence is
unavailable. Keep going on independent ready work if an optional integration
is blocked; do not mark the whole plan complete until its gates are met.
```
