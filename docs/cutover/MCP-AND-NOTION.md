# The fees MCP and Notion at T0 — and a read-only MCP for One (design only)

Go-live Phase G (plan §9.5; critique0 #29; critique1 B4, B18). Nothing here
changes the fees app, its worker or its Notion jobs; nothing here is built.

## What freezes at T0

| Thing | Reads | After T0 |
|---|---|---|
| **Fees MCP** — Cloudflare worker `schoolfees-live-mcp` (`workers/schoolfees-mcp` in the fees repo): `get_session_money_summary`, `today_fee_collection_brief`, `get_recent_payments`, the recovery and defaulter tools… | the fees database `vgqyilgstjvgohrsiwkb`, `public`, with its own service key; OAuth sign-in for fees `admin`/`accountant` | **frozen at T0** — every answer describes the fees database, which stops receiving the desk's postings at F1. Tail payments still land there, so it is not even a clean snapshot |
| **Notion fee sync** — pg_cron `notion-fee-sync-daily` (and `-test`) on the fees database, `0 1 * * *`, from the `v_notion_*` views | the fees database | **frozen at T0**, the same way |
| The owner's `vpps-fee-list` workflow | an exported `VPPSaicontextbundle*.xlsx` | keeps working **if the export comes from One** (`/fees/exports/ai-context-bundle`, same sheet and column names — export parity, plan §5.4 / B5) |

**At T0 the owner is told, in these words** (runbook "After 14:00"):

> From Sunday 13 Dec the fee figures in the Claude fees connector and in
> Notion are as of Saturday evening and will not change. The live figures are
> in One (one.vpps.co.in). Use One's export for the daily fee list.

Nothing is switched off on the fees side: the worker and the Notion jobs keep
running against the fees database, so nothing breaks — they just stop being
current. Retiring them is part of retiring the fees app (owner decision).

## Notion (critique1 B18)

Default: **Notion freezes at T0**; it is not recreated in
`one-live-cron-jobs.sql`. One's database already has the same five views
(`v_notion_daily_collection_summary`, `v_notion_daily_summary`,
`v_notion_family_fee_summary`, `v_notion_student_fee_summary`,
`v_notion_student_fee_sync` — checked read-only on wtgx, 31 Oct), because the
fee schema was copied. If the owner wants Notion current after T0 (Q13):
recreate the fees app's `notion-fee-sync-daily` job on One's database with its
own Notion secret in One's Vault, as an added block in
`one-live-cron-jobs.sql` — a copy (rule 4), after reading the fees job's
command read-only. Its output would include TEST-2026-27 rows unless the views
are filtered: decide that first.

## A read-only MCP for One (design)

**Goal:** the same questions the owner asks today (money summary, today's
collection, a student's dues, defaulters, recovery queue) answered from One's
database, read-only by construction, for real admins and the accountant only,
never showing TEST data to anyone who should not see it.

**Recommended shape — copy the fees worker (rule 4), change four things:**

1. **New worker, new secrets.** `vppsone-mcp` (Cloudflare), its own wrangler
   vars and secrets — never the fees worker's. `NEXT_PUBLIC_SUPABASE_URL` =
   wtgx. The fees worker stays untouched and is retired with the fees app.
2. **Read-only by construction, not by habit.** The fees worker holds a
   service-role key and is careful. One's should not need to be careful:
   - the REST client is the sealed pattern of `scripts/migrate/lib/fees-readonly.mjs`
     — only `GET` on an allowlist of views/tables and `POST /rpc/` to an
     allowlist of `STABLE` read functions; anything else throws, with a test;
   - and the key is not the service role: a dedicated Postgres role
     `vppsone_mcp_reader` (`NOLOGIN`, `SELECT` on the allowlisted views and
     `EXECUTE` on the read functions only, no write privilege anywhere) used
     through PostgREST with a short-lived JWT whose `role` claim is that role
     — minted by the worker per request with the project's JWT signing key,
     or, if Supabase's asymmetric keys rule that out, a separate Supabase
     project API key restricted to it. Decide at build time; until then the
     service role behind the sealed client is the fallback.
3. **Identity from One, not from the fees role table.** OAuth sign-in against
   wtgx's GoTrue as today, then the role from `vppsone.staff_profiles`
   (D-350: One's staff list is the authority) — allowed: real `admin` and
   `accountant`, `is_test_account = false`, active. A test account may sign in
   only to a TEST-only mode (every query filtered to `TEST-%` sessions) or not
   at all.
4. **TEST stays out.** Every money tool takes the session from
   `app_settings.active_session_label` (rule 3a, never a sort) and excludes
   `TEST-%` sessions unless asked by a real admin; headcount and money use the
   same "on roll / on roll or paid" scope rules the fees worker documents.

**Also:**
- `SCHOOLFEES_DOC_TOKEN` (the document bridge, `/api/fees/service/documents`)
  only if receipts/photos are served; a new value, set on One's Production
  env and the worker together (ENV-INVENTORY.md).
- The worker logs tool names and counts, never arguments that carry a name or
  phone.
- One's own `assist` feature (`ANTHROPIC_API_KEY` is set on One Production)
  reading **real** data needs the owner's yes (Q13). Until then, keep it to
  TEST data or switch it off in its settings.

**Not done in this phase:** any worker code, role, grant or deploy. The work
is one PR after T0+14, once One's figures are the record: port the worker,
add the `vppsone_mcp_reader` role and grants in a `vppsone` migration (with
`has_table_privilege` checks pinned in a test), deploy with the owner's yes,
and repoint the owner's Claude connector.
