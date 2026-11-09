# Setup — what is already wired

| | |
|---|---|
| Repo | `github.com/veerpatta/vppsone` (private) |
| Local | `C:\Users\AnandKumari\Desktop\vppsone` |
| Vercel | project `vppsone`, connected to the repo — every push to `main` deploys |
| Live | https://vppsone.vercel.app |
| Database | Supabase `wtgxcptmucjerhufzjcf` (project name still `schoolfees-dev`) — **One's main, production database and its only test bed** (D-338, D-346) |
| Supabase CLI | `supabase init` done, `project_id = "vppsone"` |

## One database, confined where it is not production (D-338, D-346)

There is no separate dev database. Production, Preview, local `next dev`, the
scripts and the tests all point at `wtgxcptmucjerhufzjcf`, so what keeps
test work off real data is not the URL but two guards:

- **The database marker** `vppsone.deployment.environment` — `dev` today,
  `production` from the Phase 1 lockdown (an owner step, done as postgres).
  Unreadable counts as production. While it says production, QA / smoke-lab /
  day-run sign-in works only for `is_test_account` profiles, and the seeding
  scripts write only TEST-2026-27 data and test accounts
  (`scripts/target-guard.mjs#toolScope`: `read-only`, `test-scoped`, or
  `dev-only` = refuses production). `replicate-live.mjs` never runs there.
  A deployment that declares itself production (`VERCEL_ENV=production` or
  `VPPSONE_ENV=live`) is treated as production by these guards even while the
  marker still says `dev` (`readEffectiveEnvironment`).
- **Confined deployments** — anything but `VERCEL_ENV=production` —
  `isConfinedDeployment()` in `src/platform/deployment/confinement.ts`:
  every user is treated as a test account and fee writes go through only for
  TEST-session students (`modules/fees/platform/supabase/write-guard.ts`).
  On your machine that means a real-session payment is refused with
  "Fee changes are switched off here…" — post against a TEST-2026-27 student.
- **Fee writes** on production need `app_settings.fee_writes_enabled = 'true'`
  (D-345); the money functions and BEFORE triggers on the money tables check
  it themselves, for every API caller (anon, authenticated, service role).
  Only the owner, as postgres in the SQL editor / MCP, can set that key — the
  API is refused (`42501`). TEST receipts are numbered `TST…`.

The fees app's live database `vgqyilgstjvgohrsiwkb` is never a target. Its
local `.env.local` keys for this project were disabled on 30 Oct (owner
approved), so the fees app run locally cannot touch One's data.

## Environment

`.env.local` carries the values copied from the fee app, with the Supabase ones
pointed at **One's main project**. The same set (minus
`SUPABASE_DEV_DB_PASSWORD`, which is local-only — scripts/migrate/lib/one-db.mjs
uses it for direct session-pooler connections) is set on Vercel for
Production, Preview and Development.

| Key | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `SUPABASE_PROJECT_REF` | schoolfees-dev |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | schoolfees-dev |
| `SUPABASE_DEV_DB_PASSWORD` | schoolfees `.env.local`, local only |
| `NEXT_PUBLIC_SCHOOL_NAME`, `NEXT_PUBLIC_SENTRY_DSN` | the fee app |
| `NEXT_PUBLIC_SITE_URL` | `https://vppsone.vercel.app` |
| `VPPSONE_ENV` | `dev` |

Not carried over, because Vercel will not decrypt Secret-type values and the
fee app's backup stores them as `[SENSITIVE]`:
`SENTRY_AUTH_TOKEN`, `CRON_SECRET`. Add them from Sentry directly when
Phase 7 needs them; `CRON_SECRET` should be a fresh value, not the fee app's.
`AISENSY_*` are not read by One any more: it sends from the school's own
WhatsApp number, set up as in [whatsapp/SETUP.md](whatsapp/SETUP.md) (D-562).

### The AI helper's key (D-324)

| Key | Source |
|---|---|
| `ANTHROPIC_API_KEY` | the school's Claude Console (console.anthropic.com → API keys), Secret type, server only |

Without it the AI helper is simply absent: no button, no route call, no cost.
To switch it on, create a key in the Claude Console (a workspace of its own
for VPPS One, with its own spend limit, is the tidy way), add it on Vercel for
Production and Preview as a **Sensitive** variable, and redeploy. For local
work put it in `.env.local`; never commit it, never paste it into a chat or a
ticket. Then Settings → AI helper shows "Connected", and the admin sets the
monthly budget (default $25), the daily limit per person (default 60) and
which features are on. The budget here is an estimate from reported usage;
set a hard spend limit on the Console workspace as well, which is the one the
bill obeys.

### The scheduled jobs (Phase 7.1)

| Key | What it is |
|---|---|
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …` on every cron request. Set it and the four crons in `vercel.json` work with no further configuration. |
| `JOBS_SECRET` | Derives each job's own trigger token, `HMAC(JOBS_SECRET, job)`. Only needed to trigger a single job from somewhere that is not Vercel's scheduler. |

**A deploy with neither set runs no jobs at all**, which is deliberate: an
unconfigured deploy should be inert rather than open (D-92). It also means the
jobs quietly do nothing until somebody sets `CRON_SECRET` — so check `/jobs`
after the first morning rather than assuming.

`npm run jobs:tokens` prints each job's URL for the current `.env.local`.
Production tokens come from production's own `JOBS_SECRET` and are not in this
repo.

Both are **set on Vercel production** as of 2026-09-17, through
`vercel env add <NAME> production`. Environment variables only reach a running
deployment when it is rebuilt, so setting them is two steps:

```bash
vercel env add CRON_SECRET production
vercel redeploy "$(vercel ls --prod --meta githubCommitSha=$(git rev-parse HEAD))"
```

Take the deployment to redeploy from the commit, not from the top of
`vercel ls --prod` — that list is not reliably newest-first, and redeploying
the wrong row quietly rolls production back to an older commit while still
reporting success.

### Checking the screens (Phase 7.4)

`npm run smoke:roles` signs in as each of the six QA roles and opens every
screen under `(app)/`, comparing what happens against what that screen's own
`requirePermission()` asks for. Needs the dev server running. Two QA accounts
were added for the coordinator roles, so all six are covered.

### Signing in as a test account (Phase 7.0)

`npm run dev:login -- teacher` prints a one-time link for a `@qa.vpps.local`
account; opening it signs in with no password. It refuses any other address and
refuses to run against anything but dev, so it cannot mint a link for a real
member of staff. `npm run dev:login` with no argument lists the accounts.

Nothing belonging to the live fee database was copied — no `POSTGRES_*`, no
production Supabase URL, key or JWT secret. The sync script refused any value
containing the production project ref.

## Authentication

Same as the fee app, deliberately. VPPS One uses **Supabase Auth on the same
project family**, so:

- On dev today: the QA users already in `schoolfees-dev` — `qa.admin@qa.vpps.local`,
  `qa.teacher@qa.vpps.local`, `qa.accountant@qa.vpps.local`,
  `qa.viewonly@qa.vpps.local`. Set a password for one of them in the Supabase
  dashboard (Authentication → Users) to sign in.
- After the cutover: literally the same `auth.users` rows as the fee app, so
  `raj@vpps.co.in` and everyone else sign in with the password they already use.
  No second account, no second password, no migration of users.

The implementation is ported from the fee app rather than reinvented: the
cookie-based `@supabase/ssr` server client, the session-refresh middleware and
the login page shape all come from `schoolfees` (see `docs/SOURCES.md`).
What differs is only where a signed-in user's **role** comes from —
`vppsone.staff_profiles`, not `public.users` (D-6).

## Supabase CLI

Signed in and linked to `schoolfees-dev` (2026-09-16). Useful commands:

```
npm run db:diff      # what differs between local and the vppsone schema on dev
npm run db:types     # generate TypeScript types for the vppsone schema
npm run db:link      # re-link if the folder is ever cloned fresh
```

### Migrations are applied through the Supabase MCP, not `db push`

`supabase db push` **cannot** be used on this project, and this is not a
misconfiguration. The database's `schema_migrations` table holds 230 versions
belonging to the fee app, none of which have files in this repo, so the CLI
stops with "Remote migration versions not found in local migrations directory"
before it applies anything. Repairing that history would mean deleting the fee
app's migration records from a database the fee app also uses — not worth it,
and the same situation exists on the live project, so `db push` would never
become usable here anyway.

So the routine is:

1. Write the migration as a numbered file in `supabase/migrations/` (`vppsone`
   objects only), or — for a change to the fee schema One owns on this
   database (D-338) — in `supabase/fee-migrations/`, with a header saying why
   it differs from the fees app (see that folder's README for the
   `fee_<version>_<name>` ledger naming).
2. Apply it to `wtgxcptmucjerhufzjcf` with the Supabase MCP (`apply_migration`).
   Never to `vgqyilgstjvgohrsiwkb`.
3. The file is the source of truth.

The MCP stamps its own version when it applies a migration, so name the file
after what it recorded rather than what you guessed. `docs/PROGRESS.md` lists
every version applied here, and the two agree on purpose (D-22).

### A new schema also has to be exposed to PostgREST

Creating `vppsone` is not enough to read it from supabase-js. PostgREST serves
only the schemas it is told to, and on this project that was
`public, graphql_public` — so every read came back

```
PGRST106  Invalid schema: vppsone
```

no matter what the grants said. `20260916191935_expose_vppsone_to_postgrest.sql`
appends `vppsone` to `pgrst.db_schemas` on the `authenticator` role and reloads
PostgREST. It is additive and idempotent: it never removes an entry, so the fee
app keeps `public`.

Exposing a schema is not the same as granting access to it. `anon` has no
`USAGE` on `vppsone`, so a signed-out request gets
`42501 permission denied for schema vppsone`; `authenticated` gets through the
grant and is then filtered by each table's RLS policy.

Two things follow:

- **At cutover this migration matters as much as the others.** Skip it and the
  live app answers `PGRST106` on its first request (PLAN §7 step 1).
- If the exposed schemas are ever set from the dashboard
  (Settings → API → Exposed schemas), set them there too. The role setting
  takes precedence, so a dashboard value that disagrees is silently ignored and
  the next person to read it is misled.

## QA sign-in

`npm run seed:dev` gives four of the QA accounts a `vppsone.staff_profiles`
row — admin, teacher, office and view_only. It is idempotent, and it runs only
against One's main project (`wtgxcptmucjerhufzjcf`). It is `test-scoped`
(`toolScope`): while the database marker says `dev` it behaves as it always
has; once the marker says `production` it creates and changes only
`is_test_account` profiles and TEST-2026-27 data, and refuses anything else.

Passwordless QA sign-in (`/login?…` with `QA_LOGIN_KEY`), the Smoke Lab and
the day-run seats follow the same rule: on production they admit only
`is_test_account` profiles, checked before any token is minted. Until Phase 3
flags the QA accounts as test accounts, a production marker (or a Vercel
production deployment) therefore refuses every QA sign-in — fail closed.

`qa.director@qa.vpps.local` and `qa.collector@qa.vpps.local` are deliberately
left without a profile: they are the "signed in, but not staff here" case, and
that path is worth being able to reach on purpose (D-21).

The accounts themselves are the fee app's QA users and already existed; their
passwords came from a `TEST_STAFF_PASSWORD` that is not stored anywhere in
either repo. Ask Janmejay for the current one, or set a new one from the
Supabase dashboard (Authentication → Users). Never commit it.

## Test data

Three scripts, in order. All three run only against One's main project
(rule 3), and every name they write is invented (rule 6). All three are
`test-scoped`: on a `dev` marker they seed the active session as before; on a
`production` marker they write only into TEST-2026-27, about test-account
staff only, and refuse otherwise. So on production the chain needs
test-account teachers whose short names match the fixture timetable (Phase 3
creates them) and TEST-2026-27 class aliases; `seed:timetable` then publishes
the TEST-2026-27 timetable that `seed:scenarios` reads. On production
`seed:scenarios` adds only missing message templates (never overwrites the
school's) and queues no message.

```bash
npm run seed:dev && npm run seed:timetable && npm run seed:scenarios
```

- **`seed:dev`** — staff profiles for the QA accounts (above).
- **`seed:timetable`** — parses `tests/fixtures/timetable-2026-27.csv` with the
  app's own parser and publishes it: 768 cells → 1038 slots, 172 teaching
  assignments. Almost every screen from Phase 2 onwards is shaped by a
  published timetable, and a dev database without one is a database where half
  the app is an empty state.
- **`seed:scenarios`** — one of every state worth looking at: four absence
  shapes on one day, a published plan and a hard draft one, four cover policies
  (part-time, duty-holder, office, zero automatic cap), a month of registers
  with every status and one left open, a child with no attendance at all, three
  corrections (waiting, approved, rejected), a note of every kind, **an open
  collection request with a working public link**, answers in every shape the
  review queue splits on, two WhatsApp templates with a queued message each,
  and one document in the private bucket.

The collection request prints its own link when the script runs
(`/r/<token>`). Open it in a browser with no session: that is exactly what a
teacher sees, and it is the fastest way to check the whole loop.

Both of the latter load app source directly through `scripts/alias-hook.mjs`,
which teaches Node the `@/` alias — so the seeded cover plan is produced by the
real engine rather than by a copy of it that drifts (D-67). Re-running any of
them is safe.

`raj@vpps.co.in` is seeded as class teacher of one class and is pinned onto one
cover duty, so the Today card has something in it for the account the school
actually tests with.

**Name new migrations after `20260916160100`**, the highest version already
recorded here. Start at `20260916170000`. Lower timestamps would sort before
rows that are already applied.

The dev database's history also still lists the abandoned School One migrations
whose objects were dropped on revert. Harmless: everything VPPS One creates
lives in the `vppsone` schema with later timestamps. Left alone on purpose —
those rows belong to the fee app's history, not this project's.

## Language

Each staff member reads the app in Hindi, English or both — it is a column on
their profile, not a setting for the whole app (PLAN §3a, D-35).

`npm run seed:dev` leaves the QA accounts on `hi`. `raj@vpps.co.in` is `en`.
To change somebody, edit their profile in the app, or:

```sql
update vppsone.staff_profiles
   set preferred_language = 'en'   -- 'hi' | 'en' | 'both'
 where short_name = 'RAJ';
```

Signed out, the login screen uses a cookie the last successful sign-in wrote on
that device; a phone nobody has signed in on yet shows both (D-36).
