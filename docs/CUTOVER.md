# Cutover to live data (PLAN §7, task 7.3)

**Revision 2 notice:** this live-data runbook is outside the active R0–R8 queue.
Original 7.3 remains deferred and does not block parity, UI or test-data work.
Revalidate this runbook against all new migrations and ownership decisions
before a future explicitly requested cutover. See `PLAN.md` §7.

**Nothing in this file has been run.** It writes to the live fee project
`vgqyilgstjvgohrsiwkb`, which rule 8 makes somebody else's decision and
`docs/PROGRESS.md` has always recorded as "Janmejay decides when". This is the
runbook, checked as far as it can be checked without doing it.

It is short because §2 was designed for it: every migration only ever creates
things inside the `vppsone` schema, so `public` — which is the fee app — is
never touched. The fee app cannot notice this happening.

---

## Before the day

Run `npm run cutover:check`. It reads **dev only** and refuses to connect to
anything else. It answers the two questions worth answering in advance:

- is every migration file in this repo actually recorded as applied on dev, and
  in the same order? A file nobody applied is a table that will not exist on
  live, and the failure will arrive as a 500 on a Tuesday.
- is the master data actually there — staff, subjects, class aliases, class
  teachers, a calendar, a published timetable, enrolments? Step 3 below is
  "seed the master data for real", and knowing what "for real" has to contain
  is easier before than during.

Have ready:

- a fresh `CRON_SECRET` and `JOBS_SECRET` for production (not dev's, not the
  fee app's — see `docs/SETUP.md`)
- the live project's URL, publishable key and service-role key
- the school's real timetable file, the one §2 imports

---

## The steps

### 1. Apply every `vppsone` migration to the live project

In order, by version, exactly the list in `docs/PROGRESS.md`. Through the
Supabase MCP, the same way they were applied to dev (D-22) — never
`supabase db push`.

**`20260916191935_expose_vppsone_to_postgrest` is not optional and is not a
schema object.** It is a PostgREST setting, so it does not come along with the
tables; skip it and the app answers `PGRST106 Invalid schema: vppsone` on its
very first request, with nothing in the logs that looks like a permissions
problem (D-19). It is the single easiest thing to miss here.

Nothing in the list touches `public`. Confirm that before running them, not
after: `grep -L "vppsone" supabase/migrations/*.sql` should print nothing, and
`grep -n "public\." supabase/migrations/*.sql` should show only comments and
`references auth.users`.

### 2. Point production at live

On the Vercel project, for **Production only**:

| Key | New value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` | the live project |
| `SUPABASE_PROJECT_REF` | `vgqyilgstjvgohrsiwkb` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | live |
| `SUPABASE_SERVICE_ROLE_KEY` | live |
| `VPPSONE_ENV` | `live` |
| `CRON_SECRET`, `JOBS_SECRET` | fresh values |

Leave Preview and Development on dev. The whole point of the separation is that
a preview deploy can never reach live data, and changing all three environments
at once would throw that away on the first day it matters.

Redeploy. The env badge in the header should stop saying **टेस्ट**.

### 3. Seed the master data for real

In this order, because each depends on the one before:

1. **Staff** — real names, real short names, real roles, real phone numbers.
   Not from a script in this repo: rule 6 means no real staff member's details
   are ever committed here. Entered through `/staff`, or a one-off local script
   that reads a file kept outside the repo.
2. **Subjects and class aliases** — `/academics`. The aliases are what the
   timetable import resolves its column headings against, so they come before
   the import, not after it.
3. **Class teachers and the calendar** — `/academics`. Both are needed before
   the jobs are useful: `open-registers` skips a holiday it cannot see, and
   `attendance-reminder` has nobody to ask on a class with no class teacher.
4. **The real timetable** — `/timetable/import`. Dry run first; it reports what
   is missing grouped by the screen that fixes it, which is why 1 and 2 come
   first.

### 4. Build `enrolments` from the real `public.students`

`/enrolments`. It reconciles both sides and names five kinds of difference; on
the first run against real data expect it to find some. Work through them
there rather than in SQL — a vanished student is a row to keep, not delete
(D-43).

### 5. Check the fee app is unchanged

It should be, because nothing in `public` moved. Look anyway:

- open the fee app and take a payment on its dev twin first, then look at
  production's dashboard and one student's record
- `select count(*) from public.students` before and after should match
- no new object in `public`: compare `information_schema.tables` for
  `table_schema = 'public'` against a snapshot taken before step 1

### 6. Turn the jobs on and watch one morning

The crons in `vercel.json` start firing as soon as `CRON_SECRET` is set. **They
fail silently if it is not** — the route refuses everything rather than
accepting everything (D-92), which is the right way round but means "nothing
happened" is the symptom. Open `/jobs` the next morning and check
`open-registers` has a green run against today, not an empty card.

---

## Rollback

Point the production environment variables back at dev and redeploy. That is
the whole of it.

Nothing in the fee app has to be undone, because nothing in the fee app was
done. The `vppsone` schema left behind on the live project is inert — no fee-app
query names it, no trigger fires from it, and no foreign key points into it
(rule 2, D-5). Leave it; it is where the data will be when you come back.

The one thing rollback does **not** undo is time: anything staff entered into
the live deployment between cutover and rollback is in the live project's
`vppsone` schema and not in dev's. So the decision to roll back is a decision
about a day's attendance, not about a deploy.
