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
