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
| `scripts/substitution.js` | the substitution engine | `src/modules/substitutions/domain/` (task 4.1) |
| `scripts/app.js` | the rendering logic for class/teacher/day grids | reference for task 2.4 |
| `scripts/i18n.js` | Hindi labels teachers already recognise | `src/messages/` |
| `tests/` | the engine's own test suite | port **first**, before the code |

Known from the earlier port: the fixture produces 768 cells, 30 parallel, 60
shared, 19 teachers, 23 subject labels. `SHORT_SUBJECTS` spellings are applied
at *render* time, never at parse — applying them while parsing produces labels
that match no subject row.

## `sampark` — collection and WhatsApp

Next.js + Drizzle. `src/lib/` is the useful part.

| File(s) | What | Goes to |
|---|---|---|
| `requests.ts`, `fields.ts`, `field-keys.ts`, `submissions.ts` | token-link requests and the field registry | Phase 5.1–5.2 |
| `routes.ts`, `request-origin.ts`, `ratelimit.ts` | the `/r` `/t` `/w` link routes and their guards | Phase 5.1 |
| `documents.ts`, `document-store.ts`, `photos.ts`, `photo-store.ts` | document and photo handling | Phase 5.3 |
| `aisensy.ts`, `whatsapp*.ts`, `templates.ts`, `send-queue.ts`, `reminders.ts` | the AiSensy integration, template registry, send queue and log | Phase 5.4 / 7.2 |
| `name-match.ts`, `phone.ts`, `precedence.ts`, `completeness.ts` | matching submissions to students, phone normalisation | Phase 5.2 |
| `marks.ts`, `subjects.ts`, `progress.ts` | marks and progress shapes | Phase 6 |
| `timetable-import.ts`, `teachers.ts`, `classes.ts` | how Sampark modelled the same data | compare before designing Phase 1–2 tables |
| `excel.ts`, `student-export.ts` | export helpers | Phase 6.5 |

Sampark uses Drizzle against its own database. Take the **logic and the shapes**,
not the schema definitions — VPPS One's tables are defined in
`supabase/migrations/`.

## `schoolfees` — the fee app

Do not import from it and do not change it. Useful as a reference for:

- the Supabase browser/server/admin client setup and the auth middleware
- the UI kit and mobile shell patterns already proven on these users' phones
- `src/modules/students` for how the student and class shapes are read
- the PDF generation approach used for receipts (Phase 3.6, 6.4)

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
