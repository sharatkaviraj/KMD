# Where to copy code from

Three sibling repos on the laptop, at `C:\Users\AnandKumari\Projects\`. All three
are **read-only references** — never commit to them from this project.

Port code with its tests. Where the port changes behaviour, say so in the PR.
Code that has run the school for a year is evidence; a rewrite is a guess.

## `timetable2025` — the timetable engine

Plain JS, no build step, runs as a static app on Firebase.

| File | What it holds | Goes to |
|---|---|---|
| `scripts/data.js` | `parseTimetable`, `buildTeacherMap`, the cell grammar, parallel-vs-shared detection, combined-section merging, `SHORT_SUBJECTS` | `src/modules/timetable/domain/parse-timetable.ts` (task 2.1) |
| `scripts/substitution.js` | the substitution engine | **ported** → `src/modules/substitutions/domain/engine.ts` (task 4.1). Whole, minus `createPlanStore` (plans are database rows here) and the `DEFAULT_SHIFTS` / `RESERVE_STAFF` / `DUTY_STAFF` constants, which named real teachers in source — rule 6, and they are rows in `cover_policies` now (D-61) |
| `scripts/app.js` | the rendering logic for class/teacher/day grids | reference for task 2.4 |
| `scripts/i18n.js` | Hindi labels teachers already recognise | `src/messages/` — as Hindi/English **pairs**, since language is per account (PLAN §3a) |
| `tests/` | the engine's own test suite | **ported first** → `tests/substitution-engine.test.ts`. Four of its 34 tests are about that repo's `data.js`, `i18n.js` and bell schedules rather than the engine; VPPS One covers those in `parse-timetable.test.ts` and `language.test.ts` |

Known from the earlier port: the fixture produces 768 cells, 30 parallel, 60
shared, 19 teachers, 23 subject labels. `SHORT_SUBJECTS` spellings are applied
at *render* time, never at parse — applying them while parsing produces labels
that match no subject row.

## `sampark` — collection and WhatsApp

Next.js + Drizzle. `src/lib/` is the useful part.

| File(s) | What | Goes to |
|---|---|---|
| `requests.ts`, `fields.ts`, `field-keys.ts`, `submissions.ts` | token-link requests and the field registry | **ported** → `src/modules/collection/domain/{fields,requests,review}.ts` (5.1–5.2). `validateField` came across whole, with its errors turned into Hindi/English pairs. An accepted answer lands in `vppsone.student_records` and never in the fee app (rule 2, D-69) |
| `auth/token.ts`, `request-origin.ts`, `ratelimit.ts` | resolving a token, the origin, and the budgets | **ported** → `src/modules/collection/data/{requests-repo,rate-limit}.ts` (5.1). Note that `routes.ts` in that repo is the **bus-route master**, not the URL routes — the `/r` `/t` `/w` handlers are pages under its `src/app/`. `BUS_ROUTES` is not ported: transport belongs to the fee app |
| `documents.ts`, `document-store.ts`, `photos.ts`, `photo-store.ts` | document and photo handling | **ported in shape** → `src/modules/collection/data/documents-repo.ts` (5.3), onto Supabase Storage rather than Vercel Blob. Photo capture and its separate rate budgets are not ported: nothing in VPPS One photographs a class yet |
| `aisensy.ts`, `whatsapp*.ts`, `templates.ts`, `send-queue.ts` | the AiSensy integration, template registry, send queue and log | **ported in shape** → `src/modules/collection/{domain/messages.ts,data/messages-repo.ts}` (5.4). The dispatch seam is deliberately unconfigured: a parent-facing row is refused outright (D-10, D-76) and a staff one needs an `AISENSY_API_KEY` this repo does not carry. `reminders.ts` is Phase 7.2 |
| `name-match.ts`, `phone.ts`, `precedence.ts`, `completeness.ts` | matching submissions to students, phone normalisation | Phase 5.2 |
| `marks.ts`, `subjects.ts`, `progress.ts` | marks and progress shapes | **ported in shape** → `src/modules/assessments/domain/{assessments,report-card}.ts` (6.1–6.4). The shapes came across; the arithmetic did not. Sampark totals a subject over whatever marks exist, which reads an unmarked paper and a nought as the same thing — here they are three states, not two (D-79), an unmarked paper is out of both halves and an absence is a nought it is out of (D-81). `progress.ts` is the source of the rule that **finished papers stay on the board**, which is the one thing about it worth keeping verbatim |
| `timetable-import.ts`, `teachers.ts`, `classes.ts` | how Sampark modelled the same data | compare before designing Phase 1–2 tables |
| `excel.ts`, `student-export.ts` | export helpers | **not ported** (6.5). Both pull in a spreadsheet library to write `.xlsx`; VPPS One writes CSV in the browser and posts only the log row, so there is nothing to install and nothing to generate server-side. The BOM-and-CRLF quoting rule is the part taken — without it Excel opens Hindi as mojibake, which is what these files exist to avoid |

Sampark uses Drizzle against its own database. Take the **logic and the shapes**,
not the schema definitions — VPPS One's tables are defined in
`supabase/migrations/`.

## `schoolfees` — the fee app

Do not import from it and do not change it. Useful as a reference for:

- the Supabase browser/server/admin client setup and the auth middleware
- the UI kit and mobile shell patterns already proven on these users' phones
- `src/modules/students` for how the student and class shapes are read
- the PDF generation approach used for receipts (Phase 3.6, 6.4) — **not followed for the report card**: it prints from the browser instead (D-85)

Its production database holds the real `students`, `classes` and `sessions` that
VPPS One reads. Its dev twin — `schoolfees-dev` — is the database VPPS One is
built on, so those tables are already present in `public` with test rows.

### Authentication — port it, do not redesign it

VPPS One keeps the fee app's authentication exactly: Supabase Auth on the same
project, cookie-based `@supabase/ssr`, the same session-refresh middleware. Take
these files from `schoolfees` and adapt the import paths:

| From `schoolfees` | To |
|---|---|
| `src/platform/supabase/client.ts` | same path — browser client |
| `src/platform/supabase/server.ts` | same path — cookie-based server client |
| `src/platform/supabase/admin.ts` | same path — service-role client, server only |
| `src/platform/supabase/middleware.ts` | same path — session refresh |
| `src/platform/supabase/session.ts` | same path |
| `src/app/auth/login/page.tsx` + `actions.ts` | `src/app/login/` |
| `src/app/auth/forgot-password/`, `update-password/` | same shape, later |

Do **not** port `sign-up` — VPPS One creates no accounts; an admin does.

The one deliberate difference: a signed-in user's role comes from
`vppsone.staff_profiles`, never from `public.users.role` (D-6). The fee app's
`src/platform/auth/roles.ts` is a useful shape to read, not a file to copy.

Because it is the same Supabase project, the accounts are the same accounts. On
dev those are the `qa.*@qa.vpps.local` users; after the cutover they are the real
ones, so nobody gets a second password.
