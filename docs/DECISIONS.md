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
