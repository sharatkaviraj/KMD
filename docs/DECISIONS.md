# Decisions

Settings, not facts to re-derive. Add a row rather than arguing a point twice.
An agent that picks a default the plan left open records it here.

| # | Decision | Why |
|---|---|---|
| D-1 | VPPS One is a separate repo, Vercel project and Postgres schema from the fee app | The first attempt guarded the fee *module* but changed 45 shared platform files. A boundary enforced by structure cannot be forgotten; one enforced by review can |
| D-2 | No feature flags, no canary users, no release types, no approval gates | They existed only to protect `director@` from shared code. There is no shared code now |
| D-3 | Build on `schoolfees-dev` (`wtgxcptmucjerhufzjcf`) with test-session data; cut over to live at the end | Janmejay's call. Lets the whole app be built and used before any real data is involved |
| D-4 | Everything VPPS One owns lives in the `vppsone` schema | Makes the cutover additive-by-construction and collisions impossible |
| D-5 | Fee tables are SELECT-only, and no constraint points into `public` | A foreign key would be a write into the fee app's schema |
| D-6 | VPPS One has its own roles, not `public.users.role` | Being an accountant in the fee app says nothing about teaching |
| D-7 | Push to main through a PR the agent merges when CI is green | Keeps CI honest without adding a person-shaped wait |
| D-8 | Local folder is `Desktop\vppsone`, not `VPPS one` | npm refuses spaces and capitals in a project directory name |
| D-9 | Supabase Storage for files; Cloudflare only if storage or egress cost bites | One fewer service to run |
| D-10 | Parent-facing WhatsApp stays human-pressed | Unchanged from the original plan |
| D-11 | `office` may manage staff profiles, not just read them | PLAN §3 gives office the master data and PROGRESS 1.3 files staff under it. A profile is not an account — `user_id` is nullable and logins are created in Supabase Auth by an admin — so editing one cannot grant anybody access |
| D-12 | The root file is `src/proxy.ts`, not `middleware.ts` | Next.js 16 renamed the convention and deprecated the old name. The fee app is already on `proxy.ts`, so this matches what is running in production |
| D-13 | Writes have no RLS policy at all; server actions check the permission and then use the service-role client | Keeps "who may write" in one readable TypeScript file instead of spread across policies a role change would have to be kept in step with. The SELECT policy still governs every read |
| D-14 | Permission names are the whole platform's, not only Phase 1's | Six role lists written a phase at a time drift apart. Naming the full surface once makes the map readable as a whole, and `can()` is exhaustively tested against it |
| D-15 | `view_only` gets dashboards, not every `:view` | "Read-only dashboards" (PLAN §3) is oversight — the daily numbers and who teaches what. It stops short of per-child records: no notes, marks, documents or collection |
| D-16 | An unknown role resolves to `view_only`, never to anything higher | A role added to the `staff_role` enum before the code that understands it must not be able to arrive as an admin |
| D-17 | `short_name` immutability is a database trigger, not only a form rule | It is the timetable's join key; a rename orphans every slot that named it. A server action can be rewritten, a trigger cannot be forgotten |
| D-18 | `short_name` is unique case-insensitively | "RKS" and "rks" are the same teacher to everyone except a plain unique constraint, and a case-variant duplicate is a silently wrong timetable import |
| D-19 | Exposing the `vppsone` schema to PostgREST is a migration file, applied additively | Creating the schema is not enough — PostgREST answered `PGRST106 Invalid schema` until it was exposed. It has to be replayed at cutover like any other migration, and it appends rather than replaces so the fee app keeps `public` |
| D-20 | `getCurrentStaff()` is cached per request, not across requests | The fee app caches the profile for 60s because of its traffic; this app has a few dozen users, so a role change or a deactivation should take effect on the next navigation |
| D-21 | Signed in with no staff profile is a named state, not an error | VPPS One shares `auth.users` with the fee app, so any fee-app account can sign in here and succeed. The login page says why instead of failing blankly |
| D-22 | Migration files are named for the version the Supabase MCP recorded | The MCP assigns its own timestamp. Naming the file to match keeps the repo and the database's history in exact correspondence for the cutover replay |
| D-23 | The proxy sends signed-out visitors to `/login`, but never sends signed-in ones away from it | The proxy has a JWT, not a profile. Bouncing on the JWT loops forever against a session whose profile was deactivated, and every hop runs the page. The login page already decides this from the profile, so one authority instead of two disagreeing ones |
| D-24 | The design system is the fee app's "Ledger Calm" palette, ported to Tailwind v4 `@theme` | The same staff use both apps on the same phones. A second visual language is a second thing to learn, for no gain |
| D-25 | Signed-in screens live in the `src/app/(app)/` route group, guarded by its layout | Makes the guard structural: a new screen is protected by where its file sits, not by somebody remembering a call at the top of it |
| D-26 | Navigation is derived from `can()`, and each item carries a `ready` flag | One map for access and for navigation, so they cannot drift. `ready` exists because the phase ships over several deploys — a tab whose route has not landed is a 404 with the school's name on it. A test asserts the flag matches a real page file, in both directions |
| D-27 | Pages use `requirePermission()` (redirects); server actions use `assertPermission()` (throws) | `redirect()` works by throwing a navigation signal, which a `try/catch` inside an action would swallow — and a swallowed guard is a guard that passed |
| D-28 | A navigation bar with fewer than two tabs is not rendered | Its only job is showing where else you could go. With one tab it says nothing and costs 68px of a phone screen |
| D-29 | Staff search filters in the browser, over the whole list | A school has a few dozen staff. One fetch and instant filtering beats a round trip per keystroke, and it keeps working where the signal is worst — which is the corridor, which is where it is used |
| D-30 | A phone number that is not a 10-digit Indian mobile is refused, not stored as typed | Phase 5 messages these numbers. A wrong number that looks right is worse than a blank |
| D-31 | Staff are deactivated, never deleted | The timetable, attendance and marks all reference the profile, and `short_name` is the join key. Inactive means "not in the pickers", not "never existed" |
| D-32 | Fee-table reads go through the service-role client, after `assertPermission()` in the repository function itself | The fee app's RLS gates `public.classes` and `public.students` on `has_any_permission()`, which reads `public.users.role`. VPPS One staff have no row there (D-6), so a cookie-client read returns zero rows **and no error** — which renders as "the school has no classes". A policy would fix it and rule 2 forbids adding one to a fee table, so the guard moves into the app. It sits in the repository rather than the caller so a future call site cannot forget it |
| D-33 | The class-label editor saves one row at a time | Nineteen classes get filled in over more than one sitting. A single form with one Save at the bottom loses the lot to an interruption |
| D-34 | The academic session is derived from the fee app's class rows, not configured | There is no `public.sessions` table; the label lives on each class. Deriving it means the cutover follows the real session with no variable to remember. `VPPSONE_SESSION_LABEL` overrides it for the weeks when two sessions overlap |
