# Source-note privacy failures — release verification

Base: `9212f9b4ff5c2f3193fe9ac55293da4d4ed29f62`.
Branch: `codex/technical-followup-20261025`.

## Behavior and scope

Parent sharing previously continued after its second source-note lookup failed or
returned no row. It now refuses before queue insertion or plan-status writes.
Support-plan reads previously returned content when a referenced source note was
missing; they now reject incomplete source results before returning content.
Four new regression assertions failed before repair.

Private-plan author-only access is unchanged. No consent policy, permission,
schema, notification delivery, deployment setting or dependency is changed.
Existing `shareExcerpt` wording does not grant permission to broaden access.

An independent reviewer examined the action, reader and regression tests. Its
partial-source-result coverage suggestion was added alongside a no-source control;
final review found no blocking defect. The tests exercise the real action/reader
with fake external dependencies, no-write assertions and recovery behavior.

Separate synthetic timetable parser/import/substitution tests preserve important
integration assertions without requiring local real-school fixtures. Their invented
fixture contains two days, three classes, six teachers and seven subjects, including
shared/parallel/combined cells. Review improvements added six-busy/two-free cover
capacity, distinct master IDs, and complete teacher/day grid assertions. All 47
cases passed after rereview. These tests supplement the existing suites; none is
removed or weakened.

## Local verification completed before publication

| Check | Result |
|---|---|
| Focused notes tests | 76 passed |
| Synthetic unit batches plus new timetable tests | 251 distinct files / 14,439 tests passed |
| Full-project TypeScript | Unmodified TypeScript 5.9.3 CLI exit 0, 1,854 roots / 2,804 total files |
| Full production build | Next 16.3.5 `next build --webpack` passed, including its TypeScript step and 143 page-generation tasks |
| Browser checks | 16 class/notes and 8 cover component checks; 4 actual production-server signed-out checks; all 28 passed |
| Changed-file ESLint, port imports, bundle budgets, diff integrity | Passed |
| Theme parity | Skipped: separate reference checkout absent |

The constrained PC required full-context diagnostic checkpointing through TypeScript's
own incremental builder and serializer, followed by the ordinary full CLI as the
definitive gate. No roots or semantic checks were removed. The build used temporary
single-worker/cache settings and bounded child heaps; original configuration was
restored byte-for-byte. No temporary build configuration is part of this patch.

Earlier compiler heap failures and one initial Windows preload-path failure are
retained in local evidence. Later complete compiler/build runs passed. The successful
build took 220.1 seconds and left at least 1.10 GiB available RAM and 1.69 GiB free
disk. Existing dependencies were used; Claude was not interrupted.

Local checks used fake data and inert credentials. Component-browser transports were
synthetic; signed-out production-browser checks covered hydration, layout, protected
redirects and install assets without submitting credentials. Database/provider
traffic was blocked. No live records, real notifications or migrations were used.

## Remote release gates

The user authorized publication/deployment on 25 October. Main was freshly fetched
and unchanged at the base above. The normal GitHub/Vercel pipeline is retained.
A draft PR is the next step; all applicable checks must pass for its exact head
before it is made ready and merged. No branch protection or approval is bypassed.

Confirmed Vercel project: `vppsone` / `prj_ueGVosJdpoBKehru1RwnNYpAlCoq`,
team `team_dfL3N9HEewBhgmlOp0Y1EOxd`, canonical host `vppsone.vercel.app`.
Release/deployment identifiers and final acceptance results will be recorded after
the corresponding operations succeed.

The original three timetable fixture suites were not run locally under the fake-data
restriction; the normal repository CI remains unchanged. Authenticated register/cover
acceptance and the historical weak-network register delay remain unverified. They
require separately scoped synthetic-backend/test-session access. School-policy
decisions remain open and do not block these two fail-closed fixes. Reusable cloud
authentication setup is handled separately; no credentials or grants are added here.
