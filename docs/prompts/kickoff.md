# Kickoff — task 1.1

Paste this into Claude Code from `C:\Users\AnandKumari\Desktop\vppsone` after:

```
git checkout main; git pull; git checkout -b p1-1-foundation; claude
```

---

You are starting VPPS One. Read `CLAUDE.md`, then `docs/PLAN.md`,
`docs/PROGRESS.md`, `docs/DECISIONS.md` and `docs/SOURCES.md` in full before you
write anything. They are the whole plan; you need nothing else.

Short version of what matters: this is a **new, separate** application from the
fee app. There is no shared code with it, so there are no feature flags, no
canary users, no release types and no approval gates. You build, you test, you
open a PR, you merge it yourself when CI is green. The only hard boundaries are:
everything you create lives in the `vppsone` Postgres schema, fee tables in
`public` are SELECT-only, and the database is always `schoolfees-dev`
(`wtgxcptmucjerhufzjcf`) — never the live one.

## Build task 1.1 — foundation

**Database** (migration files in `supabase/migrations/`, applied to dev with the
Supabase MCP):

- `create schema vppsone`, usage granted to `authenticated` and `service_role`
- `vppsone.staff_role` enum: `admin`, `office`, `academic_coordinator`,
  `exam_coordinator`, `teacher`, `view_only`
- `vppsone.staff_profiles`: `id`, `user_id` (→ `auth.users`, nullable — not
  every staff member logs in), `display_name`, `short_name` (unique, immutable,
  this is the timetable's join key), `role`, `phone`, `whatsapp_phone`,
  `is_teaching`, `is_active`, `preferred_language`, `created_by`, timestamps
- RLS on, with a SELECT policy for authenticated users. No INSERT/UPDATE/DELETE
  policies — writes go through server actions that have already checked
  permission and then use the service-role client.

Write each migration as a numbered file in the repo **and** apply it to the dev
project with the Supabase MCP. The files are the source of truth: at cutover
they get replayed against the live project in order.

**App:**

- `src/platform/supabase/`: browser client, server client (cookie-based, for
  Server Components and Actions), and an admin client that refuses to be
  constructed outside a server context
- `src/platform/supabase/middleware.ts` + `middleware.ts`: refresh the session,
  send signed-out users to `/login` and signed-in users away from it
- `/login`: email + password, Hindi-first labels, mobile-first, real error
  states. No signup — accounts are created by an admin.
- `src/platform/auth/`: `getCurrentStaff()` (auth user → `staff_profiles` row,
  cached per request), `permissions.ts` with one `can(staff, permission)` and
  the role → permission map from `docs/PLAN.md` §3, and `requirePermission()`
  for the top of a page or action
- `/` redirects to `/dashboard`; `/dashboard` is a placeholder showing who is
  signed in, their role, and an environment badge driven by `VPPSONE_ENV`

**Dev data:**

- `scripts/seed-dev.mjs` (`npm run seed:dev`): upsert a `staff_profiles` row for
  each existing QA auth user — `qa.admin@qa.vpps.local` as `admin`,
  `qa.teacher@qa.vpps.local` as `teacher`, `qa.accountant@qa.vpps.local` as
  `office`, `qa.viewonly@qa.vpps.local` as `view_only`. Idempotent. Test names
  only, never a real person.

**Quality:**

- Vitest, with unit tests for `can()` covering every role
- `npm run check` = typecheck + lint + test + build, plus a GitHub Actions
  workflow running it on every PR
- Pure logic in `domain/`, nothing there importing the database

## When you are done

1. `npm run check` passes.
2. Push, open a PR, wait for CI, merge it yourself, delete the branch.
3. Update `docs/PROGRESS.md`: row 1.1 to `done`, with branch, commit and one
   line on what remains or surprised you.
4. Add a `docs/DECISIONS.md` row for anything the plan left open that you chose.
5. Tell Janmejay the URL to look at and exactly what to try.

Then stop. The next task is row 1.2.

---

## Added after the first draft — read this too

**Authentication is ported, not designed.** Take the Supabase clients, the
session-refresh middleware and the login page from the fee app rather than
writing your own — the exact file list is at the bottom of `docs/SOURCES.md`.
It is the same Supabase project, so the accounts are the same accounts: on dev
the `qa.*@qa.vpps.local` users, and after the cutover the real ones, with no
second password for anybody. The only deliberate difference is that a user's
role comes from `vppsone.staff_profiles`, never `public.users.role`.

**The environment is already set up** — see `docs/SETUP.md`. `.env.local` and
Vercel both carry the fee app's keys with Supabase pointed at dev, including
`SUPABASE_SERVICE_ROLE_KEY`. You do not need to ask for any key to build task
1.1. `AISENSY_*`, `SENTRY_AUTH_TOKEN` and `CRON_SECRET` are deliberately absent
until Phase 5 and Phase 7 need them.

**Migrations** can go through the Supabase MCP (no login needed) or through the
Supabase CLI, which is signed in and linked to dev — `npm run db:push`. Either
is fine. Name your first migration `20260916170000_...` or later: lower
timestamps sort before rows already applied to this database. `docs/SETUP.md`
has the detail.
