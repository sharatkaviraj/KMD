# Setup — what is already wired

| | |
|---|---|
| Repo | `github.com/veerpatta/vppsone` (private) |
| Local | `C:\Users\AnandKumari\Desktop\vppsone` |
| Vercel | project `vppsone`, connected to the repo — every push to `main` deploys |
| Live | https://vppsone.vercel.app |
| Database | Supabase `schoolfees-dev` — `wtgxcptmucjerhufzjcf` |
| Supabase CLI | `supabase init` done, `project_id = "vppsone"` |

## Environment

`.env.local` carries the values copied from the fee app, with the Supabase ones
pointed at **dev**. The same set (minus `SUPABASE_DEV_DB_PASSWORD`, which is
local-only) is set on Vercel for Production, Preview and Development.

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
`AISENSY_API_KEY`, `AISENSY_CAMPAIGN`, `SENTRY_AUTH_TOKEN`, `CRON_SECRET`.
Add them from AiSensy and Sentry directly when Phase 5 / Phase 7 needs them;
`CRON_SECRET` should be a fresh value, not the fee app's.

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

## One command you still need to run

The Supabase CLI on this PC is installed but not signed in:

```
supabase login          # opens the browser, once
npm run db:link         # links this folder to schoolfees-dev
```

Until then, migrations are applied through the Supabase MCP, which needs no
login — that is the default path in `CLAUDE.md` and works today.
