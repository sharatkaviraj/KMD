# Cutover to live data (PLAN §7, task 7.3)

**Revision 2 notice:** this live-data runbook is outside the active R0–R8 queue.
Original 7.3 remains deferred and does not block parity, UI or test-data work.
Revalidate this runbook against all new migrations and ownership decisions
before a future explicitly requested cutover. See `PLAN.md` §7.

**Nothing in this file has been run.** It writes to the live fee project
`vgqyilgstjvgohrsiwkb`, which rule 8 makes somebody else's decision and
`docs/PROGRESS.md` has always recorded as "Janmejay decides when". This is the
runbook, checked as far as it can be checked without doing it.

**Step 1 (applying the migrations) is superseded by
`docs/cutover/LIVE-MIGRATION-PLAN.md` (20 Oct 2026).** The claim that used to
stand here — that every migration only creates things in `vppsone` and
`public` is never touched — is wrong: `current_staff_role_reads_vppsone`
replaces `private.current_staff_role()`, the fee-collector change replaces
`public.has_permission`, `native_defaulter_recovery_refresh` writes
`public.defaulter_recovery_state`, `expose_vppsone_to_postgrest` changes a
shared PostgREST setting, three files add Storage buckets, and three files must
never reach live. Follow the plan's pre-flight, phases and rollback.

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
- `docs/cutover/fee-collector-posts-payments.sql` (D-261): the fee-side grant
  that lets fee collectors post. It is applied on dev only. Diff it against
  live's `public.has_permission` first, then run it on live with the owner's
  go-ahead, or every fee collector's payment will be refused

---

## The steps

### 1. Apply the migrations

Follow `docs/cutover/LIVE-MIGRATION-PLAN.md` §§3–4: pre-flight P0–P15, then
phases M1 (the `vppsone` schema, three QA files skipped), M2 (the fee-side
functions, owner approval), M3 (expose `vppsone` to PostgREST — skip it and the
app answers `PGRST106` on its first request, D-19) and M4 (first admin, settings,
bells). Never `supabase db push`.

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

### 5. Check the fee app

`public.has_permission` and `private.current_staff_role` changed in M2, so the
fee app is not untouched. Verify with the plan's Gate M2 (fingerprint diff,
per-user role checks, the fee app's accountant screens) and compare P11's
baseline: the `public` table list and `public.students` / `public.receipts`
counts unchanged.

### 6. Turn the jobs on and watch one morning

The crons in `vercel.json` start firing as soon as `CRON_SECRET` is set. **They
fail silently if it is not** — the route refuses everything rather than
accepting everything (D-92), which is the right way round but means "nothing
happened" is the symptom. Open `/jobs` the next morning and check
`open-registers` has a green run against today, not an empty card.

---

## Rollback

See `docs/cutover/LIVE-MIGRATION-PLAN.md` §6. In short: point Production back at
DEV and redeploy; undo M3; restore the two fee functions from the bodies saved
in P4 (never drop them) and prove it with the fingerprint diff; only then, and
only if it must go, touch `vppsone` — while M2's `current_staff_role` is live it
reads `vppsone.staff_profiles`, so dropping the schema would take the fee app's
permission checks down.

Rollback does not undo time: anything staff entered on the live deployment
between cutover and rollback is in live's `vppsone` schema and not in DEV's. The
decision to roll back is a decision about a day's attendance, not about a deploy.
